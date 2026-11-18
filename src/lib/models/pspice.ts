/**
 * PSpice -> ngspice conversion for vendor SPICE models.
 *
 * Vendor models (TI, Infineon, ...) are usually written for PSpice. ngspice
 * reads most of it, but a few constructs differ. Each rule below fixes one
 * difference found in real vendor files; anything we know we can't convert is
 * reported as a warning so the model can be checked by hand.
 */

export interface ConvertResult {
	text: string;        // ngspice-ready model text
	changes: string[];   // What was rewritten (for the import log)
	warnings: string[];  // Constructs that may still not work in ngspice
}

/** Subcircuit header: name and port list, e.g. ".SUBCKT CSD17382F4 1 2 3" */
export interface SubcktHeader {
	name: string;
	ports: string[];
}

export function convertPspiceToNgspice(source: string): ConvertResult {
	const changes: string[] = [];
	const warnings: string[] = [];

	// Normalise line endings and drop non-ASCII bytes (they only appear in comments
	// and can confuse the parser)
	let lines = source
		.replace(/\r\n?/g, '\n')
		.replace(/[^\x09\x0a\x20-\x7e]/g, '?')
		.split('\n');

	// 1. ".param name value" -> ".param name=value" (PSpice allows a missing '=';
	//    in ngspice it makes the parser run away and exhaust memory)
	lines = lines.map((line) => {
		const m = line.match(/^(\s*\.param)\s+([A-Za-z_]\w*)\s+([^=\s]\S*)\s*$/i);
		if (!m) return line;
		changes.push(`.param ${m[2]}: added '='`);
		return `${m[1]} ${m[2]}=${m[3]}`;
	});

	// 2. MOSFET model LEVEL=7 is BSIM3v3 in PSpice; ngspice calls it LEVEL=8
	let inMosModel = false;
	lines = lines.map((line) => {
		if (/^\s*\.model\s+\S+\s+[np]mos\b/i.test(line)) inMosModel = true;
		else if (!/^\s*(\+|\*|$)/.test(line)) inMosModel = false;
		if (inMosModel && /\blevel\s*=\s*7\b/i.test(line)) {
			changes.push('MOSFET model LEVEL=7 (PSpice BSIM3) -> LEVEL=8 (ngspice BSIM3)');
			return line.replace(/\b(level\s*=\s*)7\b/i, '$18');
		}
		return line;
	});

	// 3. Resistors with a temperature-coefficient model: PSpice writes
	//    "Rname n1 n2 MODEL value" with ".MODEL MODEL RES(TC1=.. TC2=..)".
	//    ngspice wants the value first; put TC1/TC2 on the instance instead.
	const resModels = new Map<string, string>();
	lines = lines.filter((line) => {
		const m = line.match(/^\s*\.model\s+(\S+)\s+res\s*\((.*)\)\s*$/i);
		if (!m) return true;
		const params = [...m[2].matchAll(/\b(tc1|tc2)\s*=\s*(\{[^}]*\}|\S+)/gi)]
			.map((p) => `${p[1].toLowerCase()}=${p[2]}`)
			.join(' ');
		resModels.set(m[1].toUpperCase(), params);
		return false;
	});
	lines = lines.map((line) => {
		const m = line.match(/^(\s*R\S*)\s+(\S+)\s+(\S+)\s+([A-Za-z_]\w*)\s+(\S+)\s*$/i);
		if (!m || !resModels.has(m[4].toUpperCase())) return line;
		changes.push(`${m[1].trim()}: resistor model ${m[4]} -> value first, ${resModels.get(m[4].toUpperCase())}`);
		return `${m[1]} ${m[2]} ${m[3]} ${m[5]} ${resModels.get(m[4].toUpperCase())}`.trimEnd();
	});

	// 4. Diode area given as a bare number after the model name: this ngspice
	//    build rejects that ("could not find a valid modelname"); "area=" works
	lines = lines.map((line) => {
		const m = line.match(/^(\s*D\S*\s+\S+\s+\S+\s+[A-Za-z_]\w*)\s+(\{[^}]*\}|[-+0-9.][0-9.eE+-]*)\s*$/i);
		if (!m) return line;
		changes.push(`${m[1].trim().split(/\s+/)[0]}: diode area -> area=${m[2]}`);
		return `${m[1]} area=${m[2]}`;
	});

	// Things we can't convert automatically
	const joined = lines.join('\n');
	const checks: [RegExp, string][] = [
		[/\bVALUE\s*=/i, 'behavioural VALUE= sources (E/G with VALUE) need rewriting as B sources'],
		[/\bTABLE\b/i, 'TABLE lookups may need rewriting'],
		[/\bPOLY\s*\(/i, 'POLY() controlled sources may need checking'],
		[/\bLIMIT\s*\(/i, 'LIMIT() is PSpice-only (use min/max)'],
		[/^\s*\.lib\b/im, '.lib references other files that are not included']
	];
	for (const [re, msg] of checks) if (re.test(joined)) warnings.push(msg);

	// Always end with a newline so whatever follows isn't glued onto a comment
	let text = joined.replace(/\s+$/, '') + '\n';
	return { text, changes, warnings };
}

/** Find all .SUBCKT headers in a model file */
export function findSubckts(text: string): SubcktHeader[] {
	const out: SubcktHeader[] = [];
	for (const m of text.matchAll(/^\s*\.subckt\s+(.*)$/gim)) {
		const [name, ...rest] = m[1].trim().split(/\s+/);
		// Ports end where parameters start ("params:" or "name=value")
		const stop = rest.findIndex((t) => /^params:$/i.test(t) || t.includes('='));
		out.push({ name, ports: stop < 0 ? rest : rest.slice(0, stop) });
	}
	return out;
}

/**
 * Read a pin-name hint such as "* SUBCKT Definition:  1=D  2=G  3=S" (TI style).
 * Returns pin names in port order, or null if there is no such comment.
 */
export function findPortNames(text: string, ports: string[]): string[] | null {
	const comment = text.match(/^\*.*\b(?:subckt|pins?)\b.*$/im)?.[0] ?? '';
	const map = new Map([...comment.matchAll(/\b(\w+)\s*=\s*([A-Za-z]+)\b/g)].map((m) => [m[1], m[2].toUpperCase()]));
	if (map.size === 0) return null;
	const names = ports.map((p) => map.get(p));
	return names.every(Boolean) ? (names as string[]) : null;
}
