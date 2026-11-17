/**
 * KiCad symbol importer
 *
 * Reads symbols from KiCad symbol libraries (.kicad_sym, KiCad 6+) and writes
 * their drawing geometry as a TypeScript module that component-defs.ts uses.
 *
 * Usage:
 *   pnpm exec tsx scripts/import-kicad-symbol.ts [options] --symbol <Lib>:<Symbol>=<key> [...]
 *
 *   <Lib>     A library name (e.g. "Device"), looked up in the KiCad symbol
 *             directories, or a path to a .kicad_sym file.
 *   <Symbol>  The symbol name inside the library (e.g. "Q_NMOS").
 *   <key>     The key it gets in the generated module (e.g. "nmos_bd").
 *
 * Options:
 *   --out <file>        Output module (default: src/lib/schematic/kicad-symbols.generated.ts)
 *   --scale <n>         Schematic units per mm (default: 20 / 2.54, i.e. KiCad's
 *                       100 mil grid becomes two 10-unit grid squares)
 *   --lib-dir <dir>     Extra directory to search for libraries (repeatable)
 *   --list <Lib>        List the symbols in a library and exit
 *   --where             Print the KiCad symbol directories that were found and exit
 *
 * The whole output file is regenerated on each run, so pass every symbol you
 * want to keep. `pnpm symbols:import` runs the command for the built-in set.
 *
 * Limitations: text items are skipped, pin shapes (inverted bubble, clock) are
 * drawn as plain lines, "background" fills are drawn unfilled, and only unit 1
 * (plus the shared unit 0) of the first body style is imported.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve, relative } from 'path';

// ---------------------------------------------------------------------------
// S-expression parser
// ---------------------------------------------------------------------------

type SExpr = string | SExpr[];

function parseSExpr(text: string): SExpr {
	let i = 0;
	const n = text.length;

	function skipWs() {
		while (i < n && /\s/.test(text[i])) i++;
	}

	function parseNode(): SExpr {
		skipWs();
		if (text[i] === '(') {
			i++;
			const list: SExpr[] = [];
			for (;;) {
				skipWs();
				if (i >= n) throw new Error('Unexpected end of file inside list');
				if (text[i] === ')') {
					i++;
					return list;
				}
				list.push(parseNode());
			}
		}
		if (text[i] === '"') {
			i++;
			let s = '';
			while (i < n && text[i] !== '"') {
				if (text[i] === '\\' && i + 1 < n) {
					const c = text[i + 1];
					s += c === 'n' ? '\n' : c;
					i += 2;
				} else {
					s += text[i++];
				}
			}
			i++; // closing quote
			return s;
		}
		const start = i;
		while (i < n && !/[\s()]/.test(text[i])) i++;
		return text.slice(start, i);
	}

	return parseNode();
}

const isList = (e: SExpr): e is SExpr[] => Array.isArray(e);
const head = (e: SExpr): string | undefined => (isList(e) && typeof e[0] === 'string' ? e[0] : undefined);
const children = (e: SExpr[], name: string): SExpr[][] =>
	e.filter((c): c is SExpr[] => isList(c) && head(c) === name);
const child = (e: SExpr[], name: string): SExpr[] | undefined => children(e, name)[0];
const num = (e: SExpr | undefined, idx: number): number => Number((e as SExpr[])[idx]);

// ---------------------------------------------------------------------------
// Output geometry (mirrors DrawCmd / SymbolGeometry in component-defs.ts)
// ---------------------------------------------------------------------------

type DrawCmd =
	| { type: 'M'; x: number; y: number }
	| { type: 'L'; x: number; y: number }
	| { type: 'A'; cx: number; cy: number; r: number; start: number; end: number }
	| { type: 'C'; x: number; y: number; r: number }
	| { type: 'R'; x: number; y: number; w: number; h: number };

interface SymbolGeometry {
	source: string;
	description: string;
	paths: DrawCmd[][];
	filled: DrawCmd[][];
	pins: { x: number; y: number; name: string }[];
	labelOffset: { x: number; y: number };
	valueOffset: { x: number; y: number };
	width: number;
	height: number;
}

// ---------------------------------------------------------------------------
// Library discovery
// ---------------------------------------------------------------------------

function kicadSymbolDirs(extra: string[]): string[] {
	const home = homedir();
	const candidates = [
		...extra,
		...Object.entries(process.env)
			.filter(([k]) => /^KICAD\d*_SYMBOL_DIR$/.test(k))
			.map(([, v]) => v as string),
		// Flatpak (system and user installs)
		'/var/lib/flatpak/runtime/org.kicad.KiCad.Library.Symbols/x86_64/stable/active/files/symbols',
		join(home, '.local/share/flatpak/runtime/org.kicad.KiCad.Library.Symbols/x86_64/stable/active/files/symbols'),
		// Distro packages
		'/usr/share/kicad/symbols',
		'/usr/local/share/kicad/symbols',
		// macOS
		'/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols',
	];
	// Per-user and versioned installs (~/.local/share/kicad/<ver>/symbols, Windows Program Files)
	for (const base of [join(home, '.local/share/kicad'), 'C:\\Program Files\\KiCad']) {
		if (!existsSync(base)) continue;
		for (const ver of readdirSync(base).sort().reverse()) {
			candidates.push(join(base, ver, 'symbols'), join(base, ver, 'share/kicad/symbols'));
		}
	}
	const seen = new Set<string>();
	return candidates.filter((d) => {
		if (!d || seen.has(d) || !existsSync(d) || !statSync(d).isDirectory()) return false;
		seen.add(d);
		return readdirSync(d).some((f) => f.endsWith('.kicad_sym') || f.endsWith('.kicad_symdir'));
	});
}

/** Returns the file to read for a symbol, handling both .kicad_sym files and .kicad_symdir folders */
function resolveLibrary(lib: string, symbol: string | null, dirs: string[]): string {
	if (lib.endsWith('.kicad_sym') || lib.includes('/') || lib.includes('\\')) {
		const p = resolve(lib);
		if (!existsSync(p)) throw new Error(`Library file not found: ${p}`);
		return p;
	}
	for (const dir of dirs) {
		const file = join(dir, `${lib}.kicad_sym`);
		if (existsSync(file)) return file;
		const symdir = join(dir, `${lib}.kicad_symdir`);
		if (existsSync(symdir)) {
			if (!symbol) return symdir;
			const f = join(symdir, `${symbol}.kicad_sym`);
			if (existsSync(f)) return f;
		}
	}
	throw new Error(
		`Library "${lib}" not found. Searched:\n  ${dirs.join('\n  ') || '(no KiCad symbol directories found)'}\n` +
			`Pass a path to the .kicad_sym file or use --lib-dir.`
	);
}

const libCache = new Map<string, SExpr[]>();

/** Load all top-level symbol nodes from a library file or symdir */
function loadSymbols(path: string): SExpr[] {
	const cached = libCache.get(path);
	if (cached) return cached;
	const files = statSync(path).isDirectory()
		? readdirSync(path).filter((f) => f.endsWith('.kicad_sym')).map((f) => join(path, f))
		: [path];
	const symbols: SExpr[] = [];
	for (const f of files) {
		const root = parseSExpr(readFileSync(f, 'utf8'));
		if (!isList(root) || head(root) !== 'kicad_symbol_lib') {
			throw new Error(`${f} is not a KiCad 6+ symbol library (old .lib files are not supported)`);
		}
		symbols.push(...children(root, 'symbol'));
	}
	libCache.set(path, symbols);
	return symbols;
}

function findSymbol(symbols: SExpr[], name: string): SExpr[] | undefined {
	return symbols.find((s): s is SExpr[] => isList(s) && s[1] === name);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

const round = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0

function convertSymbol(spec: string, dirs: string[], scale: number): { key: string; geom: SymbolGeometry } {
	const m = spec.match(/^(.+):([^:=]+)=(\w+)$/);
	if (!m) throw new Error(`Bad --symbol "${spec}", expected <Lib>:<Symbol>=<key>`);
	const [, lib, symName, key] = m;

	const libPath = resolveLibrary(lib, symName, dirs);
	const symbols = loadSymbols(libPath);
	let sym = findSymbol(symbols, symName);
	if (!sym) throw new Error(`Symbol "${symName}" not found in ${libPath}`);

	// Properties come from the symbol itself; graphics may come from a parent via (extends)
	const props = new Map<string, SExpr[]>();
	for (const p of children(sym, 'property')) props.set(p[1] as string, p);
	let gfx = sym;
	let gfxName = symName;
	for (let depth = 0; child(gfx, 'extends') && depth < 10; depth++) {
		gfxName = child(gfx, 'extends')![1] as string;
		const parent = findSymbol(symbols, gfxName);
		if (!parent) throw new Error(`"${symName}" extends "${gfxName}", which is not in the library`);
		gfx = parent;
	}

	// KiCad mm, y up  ->  schematic units, y down
	const pt = (e: SExpr[] | undefined, a = 1, b = 2) => ({ x: round(num(e, a) * scale), y: round(-num(e, b) * scale) });

	const paths: DrawCmd[][] = [];
	const filled: DrawCmd[][] = [];
	const pins: SymbolGeometry['pins'] = [];
	const warnings: string[] = [];
	const add = (cmds: DrawCmd[], item: SExpr[]) => {
		const fillType = child(child(item, 'fill') ?? [], 'type')?.[1];
		(fillType === 'outline' || fillType === 'color' ? filled : paths).push(cmds);
	};

	// Units are named <name>_<unit>_<bodyStyle>; take shared unit 0 and unit 1, body style 0/1
	const units = children(gfx, 'symbol').filter((u) => {
		const um = (u[1] as string).match(/_(\d+)_(\d+)$/);
		return um && Number(um[1]) <= 1 && Number(um[2]) <= 1;
	});

	for (const unit of units) {
		for (const item of unit) {
			if (!isList(item)) continue;
			switch (head(item)) {
				case 'polyline': {
					const pts = (child(item, 'pts') ?? []).filter((p): p is SExpr[] => head(p) === 'xy').map((p) => pt(p));
					if (pts.length < 2) break;
					add([{ type: 'M', ...pts[0] }, ...pts.slice(1).map((p) => ({ type: 'L' as const, ...p }))], item);
					break;
				}
				case 'rectangle': {
					const a = pt(child(item, 'start'));
					const b = pt(child(item, 'end'));
					add([{ type: 'R', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: round(Math.abs(b.x - a.x)), h: round(Math.abs(b.y - a.y)) }], item);
					break;
				}
				case 'circle': {
					const c = pt(child(item, 'center'));
					add([{ type: 'C', x: c.x, y: c.y, r: round(num(child(item, 'radius'), 1) * scale) }], item);
					break;
				}
				case 'arc': {
					const arc = arcFromThreePoints(pt(child(item, 'start')), pt(child(item, 'mid')), pt(child(item, 'end')));
					if (arc) add([arc], item);
					else warnings.push('skipped a degenerate arc');
					break;
				}
				case 'bezier': {
					const p = (child(item, 'pts') ?? []).filter((q): q is SExpr[] => head(q) === 'xy').map((q) => pt(q));
					if (p.length !== 4) break;
					const cmds: DrawCmd[] = [{ type: 'M', ...p[0] }];
					for (let s = 1; s <= 12; s++) {
						const t = s / 12, u = 1 - t;
						cmds.push({
							type: 'L',
							x: round(u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x),
							y: round(u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y),
						});
					}
					add(cmds, item);
					break;
				}
				case 'pin': {
					const at = child(item, 'at');
					const end = pt(at);
					const angle = num(at, 3) || 0;
					const len = num(child(item, 'length'), 1) * scale;
					// Pin "at" is the connection point; the pin line runs from there toward the body
					const rad = (angle * Math.PI) / 180;
					const body = { x: round(end.x + Math.cos(rad) * len), y: round(end.y - Math.sin(rad) * len) };
					const hidden = item.includes('hide') || child(item, 'hide')?.[1] === 'yes';
					if (len > 0 && !hidden) {
						paths.push([{ type: 'M', ...end }, { type: 'L', ...body }]);
					}
					const pinName = child(item, 'name')?.[1] as string;
					const pinNumber = child(item, 'number')?.[1] as string;
					const name = pinName && pinName !== '~' ? pinName : pinNumber;
					if (end.x % 10 !== 0 || end.y % 10 !== 0) {
						warnings.push(`pin ${name} at (${end.x}, ${end.y}) is off the 10-unit grid; wires won't snap to it`);
					}
					pins.push({ ...end, name });
					break;
				}
				case 'text':
				case 'text_box':
					warnings.push('skipped text item');
					break;
			}
		}
	}

	if (pins.length === 0) warnings.push('symbol has no pins');

	// Bounding box is symmetric about the origin (hit-testing assumes that)
	const xs: number[] = [], ys: number[] = [];
	const extend = (x: number, y: number, r = 0) => { xs.push(Math.abs(x) + r); ys.push(Math.abs(y) + r); };
	for (const cmds of [...paths, ...filled]) {
		for (const c of cmds) {
			if (c.type === 'M' || c.type === 'L') extend(c.x, c.y);
			else if (c.type === 'C') extend(c.x, c.y, c.r);
			else if (c.type === 'A') extend(c.cx, c.cy, c.r);
			else if (c.type === 'R') { extend(c.x, c.y); extend(c.x + c.w, c.y + c.h); }
		}
	}
	const width = round(2 * Math.max(0, ...xs));
	const height = round(2 * Math.max(0, ...ys));

	// Reference / Value text positions, falling back to the right of the body
	const propPos = (name: string, fallback: { x: number; y: number }) => {
		const at = props.get(name) && child(props.get(name)!, 'at');
		return at ? pt(at) : fallback;
	};

	for (const w of new Set(warnings)) console.warn(`  warning (${key}): ${w}`);

	return {
		key,
		geom: {
			source: `${relativeLibName(libPath)}:${symName}${gfxName !== symName ? ` (graphics from ${gfxName})` : ''}`,
			description: (props.get('Description')?.[2] as string) ?? '',
			paths,
			filled,
			pins,
			labelOffset: propPos('Reference', { x: width / 2 + 5, y: -10 }),
			valueOffset: propPos('Value', { x: width / 2 + 5, y: 10 }),
			width,
			height,
		},
	};
}

function relativeLibName(p: string): string {
	return p.split(/[\\/]/).filter((s) => /\.kicad_sym(dir)?$/.test(s)).map((s) => s.replace(/\.kicad_sym(dir)?$/, ''))[0] ?? p;
}

/** Circle through three points, as a canvas arc that passes through `mid` */
function arcFromThreePoints(
	s: { x: number; y: number },
	m: { x: number; y: number },
	e: { x: number; y: number }
): DrawCmd | null {
	const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
	if (Math.abs(d) < 1e-9) return null;
	const s2 = s.x * s.x + s.y * s.y, m2 = m.x * m.x + m.y * m.y, e2 = e.x * e.x + e.y * e.y;
	const cx = (s2 * (m.y - e.y) + m2 * (e.y - s.y) + e2 * (s.y - m.y)) / d;
	const cy = (s2 * (e.x - m.x) + m2 * (s.x - e.x) + e2 * (m.x - s.x)) / d;
	const ang = (p: { x: number; y: number }) => (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
	let a0 = ang(s), a1 = ang(e);
	const am = ang(m);
	// Canvas arcs sweep with increasing angle; swap ends if mid isn't on that sweep
	const sweep = (a: number) => (((a - a0) % 360) + 360) % 360;
	if (sweep(am) > sweep(a1)) [a0, a1] = [a1, a0];
	return { type: 'A', cx: round(cx), cy: round(cy), r: round(Math.hypot(s.x - cx, s.y - cy)), start: round(a0), end: round(a1) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
	const args = process.argv.slice(2);
	const specs: string[] = [];
	const extraDirs: string[] = [];
	let out = 'src/lib/schematic/kicad-symbols.generated.ts';
	let scale = 20 / 2.54;
	let listLib: string | null = null;
	let where = false;

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = () => {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			return args[++i];
		};
		if (a === '--symbol') specs.push(next());
		else if (a === '--out') out = next();
		else if (a === '--scale') scale = Number(next());
		else if (a === '--lib-dir') extraDirs.push(next());
		else if (a === '--list') listLib = next();
		else if (a === '--where') where = true;
		else if (a === '--help' || a === '-h') {
			console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
			return;
		} else throw new Error(`Unknown argument "${a}" (try --help)`);
	}

	const dirs = kicadSymbolDirs(extraDirs);

	if (where) {
		console.log(dirs.length ? dirs.join('\n') : 'No KiCad symbol directories found.');
		return;
	}

	if (listLib) {
		const path = resolveLibrary(listLib, null, dirs);
		for (const s of loadSymbols(path)) if (isList(s)) console.log(s[1]);
		return;
	}

	if (specs.length === 0) throw new Error('Nothing to import: pass at least one --symbol <Lib>:<Symbol>=<key> (try --help)');
	if (!(scale > 0)) throw new Error('--scale must be a positive number');

	const entries = specs.map((spec) => {
		console.log(`Importing ${spec}`);
		return convertSymbol(spec, dirs, scale);
	});

	const command = ['pnpm exec tsx scripts/import-kicad-symbol.ts', ...process.argv.slice(2)].join(' ');
	// Pretty-print, but keep each flat object (draw command, pin, offset) on one line
	const format = (geom: SymbolGeometry) =>
		JSON.stringify(geom, null, '\t')
			.replace(/\{\s*([^{}[\]]*?)\s*\}/g, (_, inner: string) => `{ ${inner.replace(/\s*\n\s*/g, ' ')} }`)
			.replace(/\n/g, '\n\t');
	const body = entries.map(({ key, geom }) => `\t${key}: ${format(geom)}`).join(',\n');
	const file =
		`/**\n * Symbols imported from KiCad. GENERATED FILE - do not edit by hand.\n *\n * Regenerate with:\n *   ${command}\n */\n\n` +
		`import type { SymbolGeometry } from './component-defs';\n\n` +
		`export const KICAD_SYMBOLS = {\n${body}\n} satisfies Record<string, SymbolGeometry>;\n`;

	writeFileSync(out, file);
	console.log(`Wrote ${entries.length} symbol(s) to ${relative(process.cwd(), resolve(out))}`);
}

try {
	main();
} catch (err) {
	console.error(`Error: ${err instanceof Error ? err.message : err}`);
	process.exit(1);
}
