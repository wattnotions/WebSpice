/**
 * Ratings check ("stress") after a simulation run.
 *
 * For every part with datasheet ratings (vendor models with a
 * <PART>.datasheet.json), compare what the simulation did to the part with its
 * absolute maximum ratings, and turn each comparison into a score:
 *
 *   score = round(10 x value / limit)   0 = lots of headroom ... 10 = at the limit
 *   score = 11                          over the limit
 *
 * The part's overall score is its worst rating. SPICE models don't fail or
 * heat up when overdriven, so this is what tells you a part would be damaged.
 */

import type { Schematic } from '../schematic/types';
import { analyzeConnectivity } from './connectivity';
import { drainSenseSource } from './netlist-generator';
import { findSubcircuit } from '../models';

/** One signal from the simulator (name like "v(2)" or "i(vsense_m1)") */
export interface SimSignal {
	name: string;
	values: number[];
}

export interface StressItem {
	key: 'vds' | 'vgs' | 'id_peak' | 'id_rms' | 'power';
	label: string;
	value: number;
	limit: number;
	unit: string;
	ratio: number;   // value / limit
	score: number;   // 0..10, or 11 when over
	note: string;    // How the value was measured
}

export interface PartStress {
	componentId: string;
	instName: string;
	part: string;
	score: number;            // Worst item score
	worst: StressItem;
	items: StressItem[];
	tjEstimate?: number;      // Rough junction temperature from average power, degC
	tjMax?: number;
}

export interface StressReport {
	parts: PartStress[];
	maxScore: number;         // Worst score across all parts (-1 when nothing was checked)
}

/** Ambient temperature assumed for the junction estimate */
const AMBIENT_C = 25;

/** Ratio -> 0..10 score, 11 when over the limit */
export function scoreFromRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) return 11;
	if (ratio > 1) return 11;
	return Math.max(0, Math.round(ratio * 10));
}

/** Colour for a score: green (0) -> yellow -> red (10), magenta when over (11) */
export function scoreColor(score: number): string {
	if (score >= 11) return '#ff33ff';
	const hue = 120 - 12 * Math.max(0, Math.min(10, score));
	return `hsl(${hue}, 100%, 50%)`;
}

/** Short description of a score for tooltips and the status bar */
export function scoreLabel(score: number): string {
	if (score >= 11) return 'over the limit';
	if (score >= 9) return 'at the limit';
	if (score >= 7) return 'close to the limit';
	if (score >= 4) return 'moderate headroom';
	return 'plenty of headroom';
}

/** Time-weighted average of f over the run (trapezoid rule; one point = that value) */
function timeAverage(time: number[] | null, values: number[]): number {
	if (values.length === 0) return 0;
	if (!time || time.length !== values.length || values.length === 1) {
		return values.reduce((a, b) => a + b, 0) / values.length;
	}
	let area = 0;
	for (let i = 1; i < values.length; i++) {
		area += 0.5 * (values[i] + values[i - 1]) * (time[i] - time[i - 1]);
	}
	const span = time[time.length - 1] - time[0];
	return span > 0 ? area / span : values[0];
}

const maxOf = (v: number[]) => v.reduce((m, x) => (x > m ? x : m), -Infinity);

/**
 * Check every rated part in the schematic against the simulation results.
 * `data` is the simulator output for a transient/DC/OP run (real values).
 */
export function computeStress(schematic: Schematic, data: SimSignal[]): StressReport {
	const parts: PartStress[] = [];
	const signal = (name: string) => data.find((d) => d.name.toLowerCase() === name.toLowerCase())?.values;
	const time = signal('time') ?? null;
	const length = data.find((d) => d.values.length > 0)?.values.length ?? 0;

	const connectivity = analyzeConnectivity(schematic);
	const netName = new Map(connectivity.nets.map((n) => [n.id, n.name]));
	const pinNet = (compId: string, pin: string) => {
		const pc = connectivity.pinConnections.find((p) => p.componentId === compId && p.pinName === pin);
		return pc?.netId ? netName.get(pc.netId) : undefined;
	};
	const nodeVoltage = (net: string | undefined): number[] | undefined =>
		net === undefined ? undefined : net === '0' ? new Array(length).fill(0) : signal(`v(${net})`);

	for (const comp of schematic.components) {
		if (!['nmos', 'pmos', 'nmos_bd', 'pmos_bd'].includes(comp.type)) continue;
		const model = comp.attributes['Value'] ? findSubcircuit(comp.attributes['Value']) : undefined;
		const ratings = model?.datasheet?.absolute_maximum;
		if (!model || !ratings) continue;

		const instName = comp.attributes['InstName'] || comp.id;
		const vd = nodeVoltage(pinNet(comp.id, 'D'));
		const vg = nodeVoltage(pinNet(comp.id, 'G'));
		const vs = nodeVoltage(pinNet(comp.id, 'S'));
		const id = signal(`i(${drainSenseSource(instName)})`);
		if (!vd || !vg || !vs) continue;

		const pChannel = model.kind === 'pmos';
		const vds = vd.map((v, i) => (pChannel ? vs[i] - v : v - vs[i]));
		const vgs = vg.map((v, i) => Math.abs(v - vs[i]));
		const items: StressItem[] = [];
		const add = (key: StressItem['key'], label: string, value: number, limit: number | undefined, unit: string, note: string) => {
			if (limit === undefined || !(limit > 0)) return;
			const ratio = value / limit;
			items.push({ key, label, value, limit, unit, ratio, score: scoreFromRatio(ratio), note });
		};

		add('vds', 'VDS', Math.max(0, maxOf(vds)), ratings.vds_max, 'V', 'highest drain-source voltage');
		add('vgs', 'VGS', maxOf(vgs), ratings.vgs_max, 'V', 'highest gate-source voltage (either polarity)');

		let avgPower: number | undefined;
		if (id) {
			const absId = id.map(Math.abs);
			add('id_peak', 'ID peak', maxOf(absId), ratings.id_pulsed ?? ratings.id_continuous, 'A',
				ratings.id_pulsed ? 'highest drain current vs the pulsed rating' : 'highest drain current');
			const rms = Math.sqrt(timeAverage(time, id.map((x) => x * x)));
			add('id_rms', 'ID (RMS)', rms, ratings.id_continuous, 'A', 'RMS drain current over the run vs the continuous rating');
			// Power absorbed: (VD - VS) x current into the drain
			avgPower = Math.max(0, timeAverage(time, vd.map((v, i) => (v - vs[i]) * id[i])));
			add('power', 'Power', avgPower, ratings.pd_max, 'W', 'average power over the run vs the power rating');
		}
		if (items.length === 0) continue;

		const worst = items.reduce((a, b) => (b.ratio > a.ratio ? b : a));
		const rth = model.datasheet?.thermal?.rth_ja_min_cu;
		parts.push({
			componentId: comp.id,
			instName,
			part: model.name,
			score: worst.score,
			worst,
			items,
			tjEstimate: avgPower !== undefined && rth ? AMBIENT_C + avgPower * rth : undefined,
			tjMax: ratings.tj_max
		});
	}

	return { parts, maxScore: parts.reduce((m, p) => Math.max(m, p.score), -1) };
}

/** Value formatting with an SI prefix, e.g. 0.0153 A -> "15.3 mA" */
export function formatSI(value: number, unit: string): string {
	const abs = Math.abs(value);
	const prefixes: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n']];
	const [scale, prefix] = abs === 0 ? [1, ''] : prefixes.find(([s]) => abs >= s) ?? [1e-9, 'n'];
	// Trim trailing zeros after the decimal point only (so 500 stays 500, 1.50 -> 1.5)
	const digits = (value / scale).toPrecision(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
	return `${digits} ${prefix}${unit}`;
}
