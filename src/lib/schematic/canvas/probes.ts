/**
 * Probe utilities for schematic canvas
 * Drawing and logic for voltage/current probes
 */

import type { Point, Wire, Schematic } from '../types';
import { pointOnWire, pointsEqual, analyzeConnectivity } from '$lib/netlist/connectivity';
import { hitTestWire } from './hit-testing';

/**
 * Draw a voltage probe shape (pointed tip like multimeter probe)
 */
export function drawVoltageProbe(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	color: string,
	label: string,
	scale: number
): void {
	const s = 1 / scale; // Scale factor

	ctx.save();
	ctx.translate(x, y);

	// Pointed tip
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(0, 0); // Tip
	ctx.lineTo(4 * s, -8 * s);
	ctx.lineTo(8 * s, -8 * s);
	ctx.lineTo(8 * s, -28 * s);
	ctx.lineTo(4 * s, -28 * s);
	ctx.lineTo(4 * s, -8 * s);
	ctx.closePath();
	ctx.fill();

	// Handle
	ctx.fillStyle = '#333333';
	ctx.fillRect(3 * s, -40 * s, 6 * s, 14 * s);

	// Label (+/-)
	ctx.fillStyle = '#ffffff';
	ctx.font = `bold ${10 * s}px sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(label, 6 * s, -18 * s);

	ctx.restore();
}

/**
 * Draw a current clamp/transformer shape
 */
export function drawCurrentClamp(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	scale: number
): void {
	const s = 1 / scale;

	ctx.save();
	ctx.translate(x, y);

	// Clamp jaws (open loop shape)
	ctx.strokeStyle = '#ff8800';
	ctx.lineWidth = 3 * s;
	ctx.beginPath();
	// Left jaw
	ctx.arc(0, -15 * s, 12 * s, 0.3 * Math.PI, 0.9 * Math.PI);
	ctx.stroke();
	ctx.beginPath();
	// Right jaw
	ctx.arc(0, -15 * s, 12 * s, 0.1 * Math.PI, -0.1 * Math.PI, true);
	ctx.lineTo(6 * s, -15 * s);
	ctx.stroke();

	// Handle
	ctx.fillStyle = '#ff8800';
	ctx.fillRect(-4 * s, -30 * s, 8 * s, 8 * s);
	ctx.fillStyle = '#333333';
	ctx.fillRect(-3 * s, -45 * s, 6 * s, 16 * s);

	// "I" label
	ctx.fillStyle = '#ffffff';
	ctx.font = `bold ${8 * s}px sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('I', 0, -26 * s);

	ctx.restore();
}

/**
 * Find the node name for a wire by using connectivity analysis
 */
export function findNodeForWire(startWire: Wire, schematic: Schematic): string | null {
	const connectivity = analyzeConnectivity(schematic);

	const wireEndpoints = [
		{ x: startWire.x1, y: startWire.y1 },
		{ x: startWire.x2, y: startWire.y2 }
	];

	// Find which net contains this wire's endpoints
	for (const net of connectivity.nets) {
		for (const ep of wireEndpoints) {
			for (const netPoint of net.points) {
				if (pointsEqual(ep, netPoint)) {
					return net.name;
				}
			}
		}
	}

	// Also check if any junction on this wire is part of a net
	for (const junc of schematic.junctions) {
		const jp = { x: junc.x, y: junc.y };
		if (pointOnWire(jp, startWire)) {
			for (const net of connectivity.nets) {
				for (const netPoint of net.points) {
					if (pointsEqual(jp, netPoint)) {
						return net.name;
					}
				}
			}
		}
	}

	return null;
}


/** A net found under the cursor, for probing */
export interface ProbeNet {
	name: string;      // SPICE node name ("0" is ground), same numbering as the generated netlist
	isGround: boolean;
	wires: Wire[];     // Wires belonging to this net (for highlighting)
	pins: Point[];     // Component pin positions on this net
}

/**
 * Find the net under a point: a component pin within `pinTolerance`, or a wire
 * within `wireTolerance`. Works straight from the schematic, so it doesn't need
 * a generated netlist. Pins win over wires so you can probe a part's terminal.
 */
export function findNetAt(
	pos: Point,
	schematic: Schematic,
	pinTolerance = 6,
	wireTolerance = 5
): ProbeNet | null {
	const connectivity = analyzeConnectivity(schematic);
	const key = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;

	let netId: string | null = null;

	// 1. Nearest component pin
	let best = pinTolerance;
	for (const pc of connectivity.pinConnections) {
		const d = Math.hypot(pc.position.x - pos.x, pc.position.y - pos.y);
		if (d <= best && pc.netId) {
			best = d;
			netId = pc.netId;
		}
	}

	// 2. Wire under the cursor
	if (!netId) {
		const wire = [...schematic.wires].reverse().find((w) => hitTestWire(w, pos.x, pos.y, wireTolerance));
		if (wire) {
			const ends = new Set([key({ x: wire.x1, y: wire.y1 }), key({ x: wire.x2, y: wire.y2 })]);
			netId = connectivity.nets.find((n) => n.points.some((p) => ends.has(key(p))))?.id ?? null;
		}
	}

	const net = netId ? connectivity.nets.find((n) => n.id === netId) : undefined;
	if (!net) return null;

	const points = new Set(net.points.map(key));
	return {
		name: net.name,
		isGround: net.isGround,
		wires: schematic.wires.filter((w) => points.has(key({ x: w.x1, y: w.y1 })) || points.has(key({ x: w.x2, y: w.y2 }))),
		pins: connectivity.pinConnections.filter((pc) => pc.netId === net.id).map((pc) => pc.position)
	};
}

/** Highlight a net's wires and pins (probe-mode hover feedback) */
export function drawNetHighlight(
	ctx: CanvasRenderingContext2D,
	net: ProbeNet,
	color: string,
	scale: number
): void {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.globalAlpha = 0.45;
	ctx.lineWidth = 6 / scale;
	ctx.lineCap = 'round';
	for (const w of net.wires) {
		ctx.beginPath();
		ctx.moveTo(w.x1, w.y1);
		ctx.lineTo(w.x2, w.y2);
		ctx.stroke();
	}
	ctx.fillStyle = color;
	for (const p of net.pins) {
		ctx.beginPath();
		ctx.arc(p.x, p.y, 4 / scale, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}
