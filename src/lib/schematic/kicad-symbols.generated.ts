/**
 * Symbols imported from KiCad. GENERATED FILE - do not edit by hand.
 *
 * Regenerate with:
 *   pnpm exec tsx scripts/import-kicad-symbol.ts --symbol Device:Q_NMOS=nmos_bd --symbol Device:Q_PMOS=pmos_bd
 */

import type { SymbolGeometry } from './component-defs';

export const KICAD_SYMBOLS = {
	nmos_bd: {
		"source": "Device:Q_NMOS",
		"description": "N-MOSFET transistor",
		"paths": [
			[
				{ "type": "M", "x": 2, "y": -15 },
				{ "type": "L", "x": 2, "y": 15 }
			],
			[
				{ "type": "M", "x": 2, "y": 0 },
				{ "type": "L", "x": -20, "y": 0 }
			],
			[
				{ "type": "M", "x": 6, "y": -18 },
				{ "type": "L", "x": 6, "y": -10 }
			],
			[
				{ "type": "M", "x": 6, "y": -4 },
				{ "type": "L", "x": 6, "y": 4 }
			],
			[
				{ "type": "M", "x": 6, "y": 10 },
				{ "type": "L", "x": 6, "y": 18 }
			],
			[
				{ "type": "M", "x": 6, "y": 14 },
				{ "type": "L", "x": 26, "y": 14 },
				{ "type": "L", "x": 26, "y": -14 },
				{ "type": "L", "x": 6, "y": -14 }
			],
			[
				{ "type": "C", "x": 13, "y": 0, "r": 22 }
			],
			[
				{ "type": "M", "x": 20, "y": -20 },
				{ "type": "L", "x": 20, "y": -14 }
			],
			[
				{ "type": "M", "x": 20, "y": 20 },
				{ "type": "L", "x": 20, "y": 0 },
				{ "type": "L", "x": 6, "y": 0 }
			],
			[
				{ "type": "M", "x": 23, "y": -3 },
				{ "type": "L", "x": 29, "y": -3 }
			],
			[
				{ "type": "M", "x": 26, "y": -3 },
				{ "type": "L", "x": 23, "y": 2 },
				{ "type": "L", "x": 29, "y": 2 },
				{ "type": "L", "x": 26, "y": -3 }
			],
			[
				{ "type": "M", "x": 20, "y": -40 },
				{ "type": "L", "x": 20, "y": -20 }
			],
			[
				{ "type": "M", "x": -40, "y": 0 },
				{ "type": "L", "x": -20, "y": 0 }
			],
			[
				{ "type": "M", "x": 20, "y": 40 },
				{ "type": "L", "x": 20, "y": 20 }
			]
		],
		"filled": [
			[
				{ "type": "M", "x": 8, "y": 0 },
				{ "type": "L", "x": 16, "y": -3 },
				{ "type": "L", "x": 16, "y": 3 },
				{ "type": "L", "x": 8, "y": 0 }
			],
			[
				{ "type": "C", "x": 20, "y": -14, "r": 2 }
			],
			[
				{ "type": "C", "x": 20, "y": 14, "r": 2 }
			]
		],
		"pins": [
			{ "x": 20, "y": -40, "name": "D" },
			{ "x": -40, "y": 0, "name": "G" },
			{ "x": 20, "y": 40, "name": "S" }
		],
		"labelOffset": { "x": 40, "y": -10 },
		"valueOffset": { "x": 40, "y": 10 },
		"width": 80,
		"height": 80
	},
	pmos_bd: {
		"source": "Device:Q_PMOS",
		"description": "P-MOSFET transistor",
		"paths": [
			[
				{ "type": "M", "x": 2, "y": -15 },
				{ "type": "L", "x": 2, "y": 15 }
			],
			[
				{ "type": "M", "x": 2, "y": 0 },
				{ "type": "L", "x": -20, "y": 0 }
			],
			[
				{ "type": "M", "x": 6, "y": -18 },
				{ "type": "L", "x": 6, "y": -10 }
			],
			[
				{ "type": "M", "x": 6, "y": -14 },
				{ "type": "L", "x": 26, "y": -14 },
				{ "type": "L", "x": 26, "y": 14 },
				{ "type": "L", "x": 6, "y": 14 }
			],
			[
				{ "type": "M", "x": 6, "y": -4 },
				{ "type": "L", "x": 6, "y": 4 }
			],
			[
				{ "type": "M", "x": 6, "y": 10 },
				{ "type": "L", "x": 6, "y": 18 }
			],
			[
				{ "type": "C", "x": 13, "y": 0, "r": 22 }
			],
			[
				{ "type": "M", "x": 20, "y": -20 },
				{ "type": "L", "x": 20, "y": -14 }
			],
			[
				{ "type": "M", "x": 20, "y": 20 },
				{ "type": "L", "x": 20, "y": 0 },
				{ "type": "L", "x": 6, "y": 0 }
			],
			[
				{ "type": "M", "x": 23, "y": 3 },
				{ "type": "L", "x": 29, "y": 3 }
			],
			[
				{ "type": "M", "x": 26, "y": 3 },
				{ "type": "L", "x": 23, "y": -2 },
				{ "type": "L", "x": 29, "y": -2 },
				{ "type": "L", "x": 26, "y": 3 }
			],
			[
				{ "type": "M", "x": 20, "y": -40 },
				{ "type": "L", "x": 20, "y": -20 }
			],
			[
				{ "type": "M", "x": -40, "y": 0 },
				{ "type": "L", "x": -20, "y": 0 }
			],
			[
				{ "type": "M", "x": 20, "y": 40 },
				{ "type": "L", "x": 20, "y": 20 }
			]
		],
		"filled": [
			[
				{ "type": "M", "x": 18, "y": 0 },
				{ "type": "L", "x": 10, "y": -3 },
				{ "type": "L", "x": 10, "y": 3 },
				{ "type": "L", "x": 18, "y": 0 }
			],
			[
				{ "type": "C", "x": 20, "y": -14, "r": 2 }
			],
			[
				{ "type": "C", "x": 20, "y": 14, "r": 2 }
			]
		],
		"pins": [
			{ "x": 20, "y": -40, "name": "D" },
			{ "x": -40, "y": 0, "name": "G" },
			{ "x": 20, "y": 40, "name": "S" }
		],
		"labelOffset": { "x": 40, "y": -10 },
		"valueOffset": { "x": 40, "y": 10 },
		"width": 80,
		"height": 80
	}
} satisfies Record<string, SymbolGeometry>;
