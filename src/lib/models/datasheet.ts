/**
 * Datasheet data for a part, from static/SpiceModels/<PART>/<PART>.datasheet.json.
 *
 * Kept separate from the vendor SPICE file so that file stays untouched.
 * All values are in SI units (V, A, W, ohm, F, C, s, J; degC; degC/W).
 * Used for things the SPICE model can't do, such as checking a simulation
 * against the part's absolute maximum ratings.
 */

export interface MinTypMax {
	min?: number;
	typ?: number;
	max?: number;
}

export interface PartDatasheet {
	part: string;
	manufacturer: string;
	description?: string;
	datasheet: { url: string; document?: string; revised?: string };
	package?: { name: string; size_mm?: number[]; pins?: string[] };

	/** Absolute maximum ratings: exceeding these can damage the part */
	absolute_maximum: {
		conditions?: string;
		vds_max: number;
		vgs_max: number;
		id_continuous: number;
		id_pulsed?: number;
		id_pulsed_max_width?: number;
		id_pulsed_max_duty?: number;
		pd_max: number;
		tj_min?: number;
		tj_max: number;
		eas?: number;
		notes?: string[];
		[key: string]: unknown;
	};

	thermal?: {
		rth_ja_min_cu?: number;
		rth_ja_1in2_cu?: number;
		notes?: string[];
		[key: string]: unknown;
	};

	/** Electrical characteristics table (typical/min/max); free-form beyond the basics */
	electrical?: {
		vgs_th?: MinTypMax & { conditions?: string };
		rds_on?: { vgs: number; id?: number; typ?: number; max?: number }[];
		[key: string]: unknown;
	};

	[key: string]: unknown;
}

/** Fields the rating checks rely on; returns a list of problems (empty = OK) */
export function validateDatasheet(d: unknown, expectedPart: string): string[] {
	const problems: string[] = [];
	const ds = d as Partial<PartDatasheet>;
	if (!ds || typeof ds !== 'object') return ['not a JSON object'];
	if (typeof ds.part !== 'string') problems.push('missing "part"');
	else if (ds.part.toUpperCase() !== expectedPart.toUpperCase()) {
		problems.push(`"part" is ${ds.part} but the model is ${expectedPart}`);
	}
	if (typeof ds.manufacturer !== 'string') problems.push('missing "manufacturer"');
	if (typeof ds.datasheet?.url !== 'string') problems.push('missing "datasheet.url"');
	const am = ds.absolute_maximum;
	if (!am) {
		problems.push('missing "absolute_maximum"');
	} else {
		for (const key of ['vds_max', 'vgs_max', 'id_continuous', 'pd_max', 'tj_max'] as const) {
			if (typeof am[key] !== 'number' || !Number.isFinite(am[key])) {
				problems.push(`absolute_maximum.${key} must be a number (SI units)`);
			}
		}
	}
	return problems;
}
