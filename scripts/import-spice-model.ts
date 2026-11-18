/**
 * Vendor SPICE model importer
 *
 * Scans a folder for PSpice/SPICE model files (.lib, .mod, .sub, .cir, .txt),
 * converts each to ngspice syntax (src/lib/models/pspice.ts) and writes every
 * .SUBCKT found to src/lib/models/subcircuits.generated.ts, where the netlist
 * generator and the part dialog pick them up.
 *
 * If <PART>.datasheet.json sits in the same folder as the model (ratings,
 * thermal data, electrical table; see src/lib/models/datasheet.ts), it is
 * checked and stored with the model.
 *
 * Usage:
 *   pnpm models:import
 *   pnpm exec tsx scripts/import-spice-model.ts [--dir static/SpiceModels] [--out <file>]
 *                                               [--kind NAME=nmos|pmos] [--pins NAME=D,G,S]
 *
 *   --kind   Override the device kind if it can't be worked out from the model
 *   --pins   Override the pin names (in .SUBCKT port order) if the file has no
 *            "1=D 2=G 3=S" style comment
 *
 * The whole output file is regenerated on each run from everything in --dir.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { convertPspiceToNgspice, findSubckts, findPortNames } from '../src/lib/models/pspice';
import { validateDatasheet, type PartDatasheet } from '../src/lib/models/datasheet';

type Kind = 'nmos' | 'pmos';

interface Entry {
	name: string;
	kind: Kind;
	pins: string[];
	description: string;
	source: string;
	text: string;
	datasheet?: PartDatasheet;
}

function listModelFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...listModelFiles(p));
		else if (/\.(lib|mod|sub|cir|txt|spi|sp)$/i.test(name)) out.push(p);
	}
	return out.sort();
}

/** Read <name>.datasheet.json next to the model file, if there is one */
function readDatasheet(modelFile: string, name: string): PartDatasheet | undefined {
	const dir = dirname(modelFile);
	const file = readdirSync(dir).find((f) => f.toLowerCase() === `${name.toLowerCase()}.datasheet.json`);
	if (!file) return undefined;
	const path = join(dir, file);
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		throw new Error(`${relative(process.cwd(), path)} is not valid JSON: ${err instanceof Error ? err.message : err}`);
	}
	const problems = validateDatasheet(data, name);
	if (problems.length) {
		throw new Error(`${relative(process.cwd(), path)}:\n  ${problems.join('\n  ')}`);
	}
	return data as PartDatasheet;
}

/** Work out N or P channel from the MOSFET(s) inside the subcircuit */
function detectKind(text: string): Kind | null {
	const models = new Map(
		[...text.matchAll(/^\s*\.model\s+(\S+)\s+([np]mos|vdmos)\b(.*)/gim)].map((m) => [
			m[1].toUpperCase(),
			m[2].toLowerCase() === 'vdmos' ? (/\bpchan\b/i.test(m[3]) ? 'pmos' : 'nmos') : (m[2].toLowerCase() as Kind)
		])
	);
	for (const m of text.matchAll(/^\s*M\S*\s+\S+\s+\S+\s+\S+(?:\s+\S+)?\s+([A-Za-z_]\w*)/gim)) {
		const kind = models.get(m[1].toUpperCase());
		if (kind) return kind as Kind;
	}
	return null;
}

function describe(text: string, name: string): string {
	const vendor = text.match(/^\*\s*Released by:\s*(.+)$/im)?.[1]?.trim();
	const datasheet = text.match(/^\*\s*Datasheet:\s*(\S+)/im)?.[1];
	return [vendor ? `${vendor} ${name}` : name, 'vendor model', datasheet ? `(datasheet ${datasheet})` : '']
		.filter(Boolean)
		.join(' ');
}

function main() {
	const args = process.argv.slice(2);
	let dir = 'static/SpiceModels';
	let out = 'src/lib/models/subcircuits.generated.ts';
	const kindOverride = new Map<string, Kind>();
	const pinOverride = new Map<string, string[]>();

	for (let i = 0; i < args.length; i++) {
		const next = () => args[++i] ?? (() => { throw new Error(`${args[i - 1]} needs a value`); })();
		const [flag] = [args[i]];
		if (flag === '--dir') dir = next();
		else if (flag === '--out') out = next();
		else if (flag === '--kind') { const [n, k] = next().split('='); kindOverride.set(n.toUpperCase(), k as Kind); }
		else if (flag === '--pins') { const [n, p] = next().split('='); pinOverride.set(n.toUpperCase(), p.split(',').map((s) => s.trim().toUpperCase())); }
		else if (flag === '--help' || flag === '-h') { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); return; }
		else throw new Error(`Unknown argument "${flag}" (try --help)`);
	}

	const entries: Entry[] = [];
	for (const file of listModelFiles(dir)) {
		const raw = readFileSync(file, 'latin1');
		const subckts = findSubckts(raw);
		if (subckts.length === 0) continue;

		const { text, changes, warnings } = convertPspiceToNgspice(raw);
		console.log(`${relative(process.cwd(), file)}`);
		for (const c of changes) console.log(`  converted: ${c}`);
		for (const w of warnings) console.warn(`  WARNING: ${w}`);

		for (const sc of subckts) {
			const key = sc.name.toUpperCase();
			const kind = kindOverride.get(key) ?? detectKind(text);
			const pins = pinOverride.get(key) ?? findPortNames(raw, sc.ports);
			if (!kind) { console.warn(`  SKIPPED ${sc.name}: can't tell N or P channel (use --kind ${sc.name}=nmos)`); continue; }
			if (!pins || pins.length !== sc.ports.length) { console.warn(`  SKIPPED ${sc.name}: unknown pin order (use --pins ${sc.name}=D,G,S)`); continue; }
			if (!['D', 'G', 'S'].every((p) => pins.includes(p))) { console.warn(`  SKIPPED ${sc.name}: pins ${pins.join(',')} aren't a 3-pin D/G/S MOSFET`); continue; }
			const datasheet = readDatasheet(file, sc.name);
			entries.push({
				name: sc.name,
				kind,
				pins,
				description: datasheet
					? `${datasheet.manufacturer} ${sc.name}: ${datasheet.description ?? 'vendor model'}`
					: describe(raw, sc.name),
				source: relative(process.cwd(), resolve(file)),
				text,
				datasheet
			});
			console.log(`  -> ${sc.name}: ${kind.toUpperCase()}, ports ${sc.ports.join(' ')} = ${pins.join(' ')}`);
			if (datasheet) {
				const am = datasheet.absolute_maximum;
				console.log(`     datasheet: ${datasheet.datasheet.document ?? datasheet.datasheet.url}, ` +
					`VDS ${am.vds_max} V, VGS ${am.vgs_max} V, ID ${am.id_continuous} A, PD ${am.pd_max} W, TJ ${am.tj_max} C`);
			} else {
				console.log(`     (no ${sc.name}.datasheet.json, so no ratings for this part)`);
			}
		}
	}

	const body = entries
		.map((e) => `\t${JSON.stringify(e.name)}: {\n` +
			`\t\tname: ${JSON.stringify(e.name)},\n` +
			`\t\tkind: ${JSON.stringify(e.kind)},\n` +
			`\t\tpins: ${JSON.stringify(e.pins)},\n` +
			`\t\tdescription: ${JSON.stringify(e.description)},\n` +
			`\t\tsource: ${JSON.stringify(e.source)},\n` +
			`\t\ttext: ${JSON.stringify(e.text)}` +
			(e.datasheet ? `,\n\t\tdatasheet: ${JSON.stringify(e.datasheet, null, '\t').replace(/\n/g, '\n\t\t')}` : '') +
			`\n\t}`)
		.join(',\n');

	writeFileSync(
		out,
		`/**\n * Vendor subcircuit models, converted to ngspice. GENERATED FILE - do not edit by hand.\n *\n` +
			` * Regenerate with:\n *   pnpm models:import\n */\n\n` +
			`import type { SubcircuitModel } from './component-library';\n\n` +
			`export const SUBCIRCUIT_MODELS: Record<string, SubcircuitModel> = {\n${body}\n};\n`
	);
	console.log(`Wrote ${entries.length} model(s) to ${out}`);
}

try {
	main();
} catch (err) {
	console.error(`Error: ${err instanceof Error ? err.message : err}`);
	process.exit(1);
}
