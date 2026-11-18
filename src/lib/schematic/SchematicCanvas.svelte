<script lang="ts">
	import { onMount } from 'svelte';
	import type { Point, Schematic, Component, Wire, ProbeType, TextComment } from './types';
	import { getModeName, MODE_SHORTCUTS } from './types';
	import type { ComponentType } from './types';
	import { renderComponent } from './component-renderer';
	import { COMPONENT_DEFS, getComponentByShortcut } from './component-defs';
	import { scoreColor } from '$lib/netlist/stress';

	import {
		screenToSchematic as screenToSchematicUtil,
		snapToGrid as snapToGridUtil,
		getWireSegments,
		isPointOnWireSegment,
		findComponentAt as findComponentAtUtil,
		findWireAt as findWireAtUtil,
		findJunctionAt as findJunctionAtUtil,
		findDirectiveAtPos as findDirectiveAtPosUtil,
		drawVoltageProbe as drawVoltageProbeUtil,
		findNetAt,
		drawNetHighlight,
		drawGrid as drawGridUtil,
		drawOrigin as drawOriginUtil,
		drawWires as drawWiresUtil,
		drawJunctions as drawJunctionsUtil,
		drawNodeLabels as drawNodeLabelsUtil,
		drawDirectives as drawDirectivesUtil,
		drawComments as drawCommentsUtil,
		findCommentAt as findCommentAtUtil,
		measureComment as measureCommentUtil
	} from './canvas';

	import {
		type EditorState,
		type EditorAction,
		type HitTestResult,
		createInitialEditorState,
		getEditorMode,
		hasSelection,
		getSelectionCount,
		editorReducer,
		applyMutations
	} from './editor';

	interface ProbeEvent {
		type: ProbeType;
		node1: string;
		node2?: string;
		componentId?: string;
		label: string;
	}

	let {
		schematic = $bindable({ components: [], wires: [], junctions: [] }),
		onprobe,
		oneditcomponent,
		oneditdirectives,
		oneditcomment,
		onmodechange,
		stressScores = {},
		fitRequest = 0
	}: {
		schematic: Schematic;
		onprobe?: (event: ProbeEvent) => void;
		oneditcomponent?: (component: Component) => void;
		oneditdirectives?: () => void;
		/** Open the comment editor; isNew means it isn't in schematic.comments yet */
		oneditcomment?: (comment: TextComment, isNew: boolean) => void;
		/** Called when the editor mode changes ('select', 'probe', 'wire', ...) */
		onmodechange?: (mode: string) => void;
		/** Ratings-check score per component id (0-10, 11 = over); colours parts and shows a badge */
		stressScores?: Record<string, number>;
		/** Bump this number to zoom the view so the whole circuit fills the canvas */
		fitRequest?: number;
	} = $props();

	/**
	 * Zoom and pan so the whole circuit (parts, wires, junctions, comments,
	 * directives) fills the canvas, with a margin. An empty schematic just
	 * resets the view.
	 */
	export function fitToContent() {
		if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const grow = (x: number, y: number) => {
			minX = Math.min(minX, x); minY = Math.min(minY, y);
			maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
		};
		for (const comp of schematic.components) {
			const def = COMPONENT_DEFS[comp.type];
			const sideways = comp.rotation === 90 || comp.rotation === 270;
			const hw = (sideways ? def.height : def.width) / 2;
			const hh = (sideways ? def.width : def.height) / 2;
			grow(comp.x - hw, comp.y - hh);
			grow(comp.x + hw + 40, comp.y + hh);  // + room for the name/value labels on the right
		}
		for (const w of schematic.wires) { grow(w.x1, w.y1); grow(w.x2, w.y2); }
		for (const j of schematic.junctions) grow(j.x, j.y);
		for (const c of schematic.comments ?? []) {
			const box = measureCommentUtil(ctx, c);
			grow(box.x, box.y); grow(box.x + box.width, box.y + box.height);
		}
		for (const d of schematic.directives ?? []) {
			if (d.x !== undefined && d.y !== undefined) { grow(d.x, d.y); grow(d.x + d.text.length * 8, d.y + 16); }
		}
		if (!Number.isFinite(minX)) {
			dispatch({ type: 'RESET_VIEW', canvasWidth: canvas.width, canvasHeight: canvas.height });
			return;
		}
		const margin = 30 * getDpr();
		const w = Math.max(maxX - minX, 50), h = Math.max(maxY - minY, 50);
		const scale = Math.max(0.1, Math.min(4, (canvas.width - 2 * margin) / w, (canvas.height - 2 * margin) / h));
		dispatch({
			type: 'SET_VIEW',
			scale,
			offsetX: canvas.width / 2 - ((minX + maxX) / 2) * scale,
			offsetY: canvas.height / 2 - ((minY + maxY) / 2) * scale
		});
	}

	// Fit when asked (e.g. an example or file was opened). Runs on the next frame so the
	// canvas has its final size; not tracked, so later edits don't re-fit.
	$effect(() => {
		if (fitRequest > 0) requestAnimationFrame(() => fitToContent());
	});

	/** Turn the voltage probe tool on or off (used by the toolbar button) */
	export function toggleProbeMode() {
		if (editorState.modeState.type === 'probing') {
			dispatch({ type: 'CANCEL' });
		} else {
			dispatch({ type: 'SET_MODE', mode: 'probe' });
		}
		canvas?.focus();
	}

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;

	// Consolidated editor state
	let editorState: EditorState = $state(createInitialEditorState());

	// Drag tracking (screen coordinates, not part of editor state)
	let lastScreenPos: Point | null = null;

	const getDpr = () => (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;

	let resizeObserver: ResizeObserver | null = null;
	let container: HTMLDivElement;

	onMount(() => {
		ctx = canvas.getContext('2d');

		// Use ResizeObserver on the CONTAINER (not canvas) for accurate size tracking
		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === container) {
					resize(entry.contentRect.width, entry.contentRect.height);
				}
			}
		});
		resizeObserver.observe(container);

		// Initial size from container
		const rect = container.getBoundingClientRect();
		resize(rect.width, rect.height);

		return () => {
			resizeObserver?.disconnect();
		};
	});

	function resize(displayWidth: number, displayHeight: number) {
		if (!canvas || displayWidth <= 0 || displayHeight <= 0) return;
		const dpr = getDpr();

		// Set canvas internal resolution to match display size * dpr
		const newWidth = Math.floor(displayWidth * dpr);
		const newHeight = Math.floor(displayHeight * dpr);

		// Adjust view offset to keep the center point stable
		if (canvas.width > 0 && canvas.height > 0) {
			editorState.view.offsetX += (newWidth - canvas.width) / 2;
			editorState.view.offsetY += (newHeight - canvas.height) / 2;
		}

		canvas.width = newWidth;
		canvas.height = newHeight;

		render();
	}

	// Wrapper functions that use component state
	const screenToSchematic = (sx: number, sy: number): Point =>
		screenToSchematicUtil(sx, sy, editorState.view, getDpr());

	const snapToGrid = (p: Point): Point =>
		snapToGridUtil(p, editorState.grid.size, editorState.grid.snapEnabled);

	// Hit testing wrapper functions
	const findComponentAt = (pos: Point): Component | null =>
		findComponentAtUtil(pos, schematic.components);

	const findWireAt = (pos: Point, tolerance: number = 5): Wire | null =>
		findWireAtUtil(pos, schematic.wires, tolerance);

	const findJunctionAt = (pos: Point, tolerance: number = 8): import('./types').Junction | null =>
		findJunctionAtUtil(pos, schematic.junctions, tolerance);

	const findDirectiveAtPos = (pos: Point): import('./types').SpiceDirective | null => {
		if (!ctx) return null;
		return findDirectiveAtPosUtil(pos, schematic.directives, { ctx, viewScale: editorState.view.scale });
	};

	const findCommentAt = (pos: Point): TextComment | null =>
		ctx ? findCommentAtUtil(ctx, pos, schematic.comments) : null;

	// Perform hit test at position
	function performHitTest(pos: Point): HitTestResult & { comment?: TextComment } {
		return {
			comment: findCommentAt(pos) ?? undefined,
			component: findComponentAt(pos) ?? undefined,
			wire: findWireAt(pos) ?? undefined,
			junction: findJunctionAt(pos) ?? undefined,
			directive: findDirectiveAtPos(pos) ?? undefined
		};
	}

	// Dispatch an action through the reducer
	function dispatch(action: EditorAction): void {
		const prevMode = getEditorMode(editorState.modeState);
		const result = editorReducer(editorState, action, schematic);
		editorState = result.state;
		const newMode = getEditorMode(editorState.modeState);
		if (newMode !== prevMode) onmodechange?.(newMode);
		if (result.mutations.length > 0) {
			applyMutations(schematic, result.mutations);
		}
		render();
	}

	function render() {
		if (!ctx || !canvas) return;
		const w = canvas.width, h = canvas.height;
		const { view, grid, selection, modeState, schematicPos } = editorState;

		// Clear
		ctx.fillStyle = '#1a1a1a';
		ctx.fillRect(0, 0, w, h);

		// Apply transform
		ctx.save();
		ctx.translate(view.offsetX, view.offsetY);
		ctx.scale(view.scale, view.scale);

		// Draw grid
		if (grid.visible) drawGridLocal(w, h, view, grid.size);

		// Draw origin crosshair
		drawOriginLocal(view.scale);

		// Draw wires
		drawWiresLocal(view.scale, modeState, schematicPos, selection.wireIds);

		// Draw components
		drawComponentsLocal(view.scale, modeState, schematicPos, selection.componentIds);

		// Draw node labels (if available)
		drawNodeLabelsLocal(view.scale);

		// Draw SPICE directives
		drawDirectivesLocal(view.scale, selection.directiveIds);

		// Draw text comments
		drawCommentsUtil(ctx, view.scale, schematic.comments, selection.commentIds);

		// Draw probe cursor overlay in probe mode
		if (modeState.type === 'probing') {
			drawProbeCursorLocal(view.scale, modeState, schematicPos);
		}

		ctx.restore();
	}

	// Drawing functions using local parameters
	function drawGridLocal(w: number, h: number, view: import('./types').ViewTransform, gridSize: number) {
		if (!ctx) return;
		drawGridUtil({
			ctx,
			view,
			gridSize,
			width: w,
			height: h,
			screenToSchematic
		});
	}

	function drawOriginLocal(scale: number) {
		if (!ctx) return;
		drawOriginUtil(ctx, scale);
	}

	function drawWiresLocal(
		scale: number,
		modeState: import('./editor').ModeState,
		schematicPos: Point,
		selectedWireIds: Set<string>
	) {
		if (!ctx) return;
		const snapped = snapToGrid(schematicPos);
		const isDrawingWire = modeState.type === 'drawing-wire';
		const startPoint = isDrawingWire ? modeState.startPoint : null;
		const direction = isDrawingWire ? modeState.direction : 'horizontal-first';
		// Only show preview if first point has been placed (not at origin)
		const hasStartPoint = startPoint !== null && (startPoint.x !== 0 || startPoint.y !== 0);
		const previewSegments = hasStartPoint
			? getWireSegments(startPoint, snapped, direction)
			: [];

		drawWiresUtil({
			ctx,
			viewScale: scale,
			wires: schematic.wires,
			selectedWireIds,
			isDrawing: isDrawingWire && hasStartPoint,
			startPoint: hasStartPoint ? startPoint : null,
			previewSegments
		});

		// Draw junction dots where wires connect
		drawJunctionsLocal(scale);
	}

	function drawJunctionsLocal(scale: number) {
		if (!ctx) return;
		drawJunctionsUtil({
			ctx,
			viewScale: scale,
			junctions: schematic.junctions,
			wires: schematic.wires,
			components: schematic.components
		});
	}

	function drawComponentsLocal(
		scale: number,
		modeState: import('./editor').ModeState,
		schematicPos: Point,
		selectedIds: Set<string>
	) {
		if (!ctx) return;

		// Draw all placed components (rated parts are coloured by their ratings score)
		for (const comp of schematic.components) {
			const isSelected = selectedIds.has(comp.id);
			const score = stressScores[comp.id];
			renderComponent(ctx, comp, scale, isSelected, false, score !== undefined ? scoreColor(score) : undefined);
		}

		// Score badges: a small numbered circle at each rated part's top-right corner
		for (const comp of schematic.components) {
			const score = stressScores[comp.id];
			if (score === undefined) continue;
			const def = COMPONENT_DEFS[comp.type];
			const sideways = comp.rotation === 90 || comp.rotation === 270;
			const halfW = (sideways ? def.height : def.width) / 2;
			const halfH = (sideways ? def.width : def.height) / 2;
			const r = 9 / scale;
			const bx = comp.x + halfW + r * 0.4;
			const by = comp.y - halfH - r * 0.4;
			ctx.beginPath();
			ctx.arc(bx, by, r, 0, Math.PI * 2);
			ctx.fillStyle = scoreColor(score);
			ctx.fill();
			ctx.lineWidth = 1.5 / scale;
			ctx.strokeStyle = '#000000';
			ctx.stroke();
			ctx.fillStyle = '#000000';
			ctx.font = `bold ${(score >= 10 ? 9 : 11) / scale}px sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(score), bx, by + 0.5 / scale);
		}

		// Draw ghost component if placing
		if (modeState.type === 'placing') {
			const snapped = snapToGrid(schematicPos);
			const ghostComp: Component = {
				id: 'ghost',
				type: modeState.componentType,
				x: snapped.x,
				y: snapped.y,
				rotation: modeState.rotation,
				mirror: modeState.mirror,
				attributes: {},
				pins: []
			};
			renderComponent(ctx, ghostComp, scale, false, true);
		}
	}

	function drawNodeLabelsLocal(scale: number) {
		if (!ctx) return;
		drawNodeLabelsUtil(ctx, scale, schematic.nodeLabels);
	}

	function drawDirectivesLocal(scale: number, selectedDirectiveIds: Set<string>) {
		if (!ctx) return;
		drawDirectivesUtil(ctx, scale, schematic.directives, selectedDirectiveIds);
	}

	// Wrapper for probe drawing
	const drawVoltageProbeLocal = (x: number, y: number, color: string, label: string, scale: number): void => {
		if (!ctx) return;
		drawVoltageProbeUtil(ctx, x, y, color, label, scale);
	};

	/**
	 * Probe-mode overlay (LTspice style): the net under the cursor is highlighted
	 * and a red probe follows the mouse. While dragging from a first net, that net
	 * stays highlighted red with the red (+) probe on it, and the black (-) probe
	 * follows the cursor.
	 */
	function drawProbeCursorLocal(
		scale: number,
		modeState: import('./editor').ModeState,
		schematicPos: Point
	) {
		if (!ctx || modeState.type !== 'probing') return;
		const pos = schematicPos;
		const netUnder = findNetAt(pos, schematic);

		if (modeState.phase === 'holding-first' && modeState.firstNode) {
			const firstNet = findNetAt(modeState.firstNode, schematic);
			if (firstNet) drawNetHighlight(ctx, firstNet, '#ff3030', scale);
			if (netUnder && netUnder.name !== firstNet?.name) drawNetHighlight(ctx, netUnder, '#b0b0b0', scale);

			// Red (+) probe on the first node
			drawVoltageProbeLocal(modeState.firstNode.x, modeState.firstNode.y, '#ff0000', '+', scale);

			// Dashed line between probes
			ctx.strokeStyle = '#888888';
			ctx.lineWidth = 1 / scale;
			ctx.setLineDash([4 / scale, 4 / scale]);
			ctx.beginPath();
			ctx.moveTo(modeState.firstNode.x, modeState.firstNode.y);
			ctx.lineTo(pos.x, pos.y);
			ctx.stroke();
			ctx.setLineDash([]);

			// Black (-) probe at the cursor
			drawVoltageProbeLocal(pos.x, pos.y, '#000000', '-', scale);
		} else if (netUnder) {
			drawNetHighlight(ctx, netUnder, '#ff3030', scale);
			drawVoltageProbeLocal(pos.x, pos.y, '#ff0000', '+', scale);
		} else {
			// Not over a net: faded probe
			ctx.globalAlpha = 0.4;
			drawVoltageProbeLocal(pos.x, pos.y, '#888888', '?', scale);
			ctx.globalAlpha = 1.0;
		}
	}

	function getHudText(): string {
		const { view, modeState, schematicPos, selection } = editorState;
		const snapped = snapToGrid(schematicPos);
		let text = `(${snapped.x}, ${snapped.y}) | Zoom: ${(view.scale * 100).toFixed(0)}%`;

		// Show current mode
		const mode = getEditorMode(modeState);
		text += ` | ${getModeName(mode as import('./types').EditorMode)}`;

		if (modeState.type === 'placing') {
			const def = COMPONENT_DEFS[modeState.componentType];
			text += `: ${def.name}`;
			if (modeState.rotation !== 0) text += ` R${modeState.rotation}`;
			if (modeState.mirror) text += ' M';
			text += ' | Ctrl+R=rotate, Ctrl+E=mirror, Esc=cancel';
		} else if (modeState.type === 'drawing-wire') {
			text += ' | Click to place segment, Space=toggle direction, Esc=cancel';
		} else if (mode === 'delete') {
			text += ' | Click to delete (junctions/components/wires), Esc=exit';
		} else if (mode === 'duplicate') {
			text += ' | Click on item to duplicate, Esc=exit';
		} else if (modeState.type === 'placing-comment') {
			text += ' | Click to place a text comment, Esc=cancel';
		} else if (modeState.type === 'moving') {
			text += ' | Drag to move, Esc=exit';
		} else if (modeState.type === 'probing') {
			if (modeState.phase === 'holding-first') {
				text += ' | Release on another node for V(+)-V(-), or where you started for V(+)';
			} else {
				text += ' | Click a wire or pin to plot its voltage, drag between two nodes for the difference, Esc=exit';
			}
		} else if (hasSelection(selection)) {
			const total = getSelectionCount(selection);
			text += ` | Selected: ${total}`;
			text += ' | Ctrl+R=rotate, Ctrl+E=mirror, Del=delete';
		}

		// Always show mode shortcuts hint
		text += ' | 3=wire 5=del 6=dup 7=move P=probe T=text';

		return text;
	}

	function handleMouseDown(e: MouseEvent) {
		canvas.focus();
		const clickPos = screenToSchematic(e.offsetX, e.offsetY);
		const snapped = snapToGrid(clickPos);
		const hitTest = performHitTest(clickPos);
		const { modeState, selection } = editorState;

		lastScreenPos = { x: e.offsetX, y: e.offsetY };

		if (e.button === 0) { // Left click
			// Handle wire mode
			if (modeState.type === 'drawing-wire') {
				if (modeState.startPoint.x === 0 && modeState.startPoint.y === 0) {
					// Check if starting on existing wire - create junction
					maybeCreateJunctionOnWire(snapped);
					dispatch({ type: 'START_WIRE', point: snapped });
				} else {
					dispatch({ type: 'COMMIT_WIRE_SEGMENT', endPoint: snapped });
					maybeCreateJunctionOnWire(snapped);
				}
				return;
			}

			// Handle delete mode (idle with delete intent set via keyboard)
			if (getEditorMode(modeState) === 'delete') {
				handleDeleteClick(clickPos);
				return;
			}

			// Handle duplicate mode
			if (getEditorMode(modeState) === 'duplicate') {
				handleDuplicateClick(clickPos);
				return;
			}

			// Voltage probe mode: press on a net to put the red (+) probe there
			if (modeState.type === 'probing') {
				const net = findNetAt(clickPos, schematic);
				if (net) {
					dispatch({ type: 'PROBE_START', pos: clickPos, nodeName: net.name });
				}
				return;
			}

			// Handle text comment placement: open the editor for a new comment here
			if (modeState.type === 'placing-comment') {
				dispatch({ type: 'CANCEL' });
				oneditcomment?.({ id: crypto.randomUUID(), x: snapped.x, y: snapped.y, text: '' }, true);
				return;
			}

			// Handle component placement
			if (modeState.type === 'placing') {
				dispatch({ type: 'PLACE_COMPONENT' });
				return;
			}

			// Handle move mode
			if (modeState.type === 'moving') {
				if (hitTest.comment && !selection.commentIds.has(hitTest.comment.id)) {
					dispatch({ type: 'SELECT', target: { commentId: hitTest.comment.id }, additive: e.shiftKey });
				} else if (hitTest.directive && !selection.directiveIds.has(hitTest.directive.id)) {
					dispatch({ type: 'SELECT', target: { directiveId: hitTest.directive.id }, additive: e.shiftKey });
				} else if (hitTest.component && !selection.componentIds.has(hitTest.component.id)) {
					dispatch({ type: 'SELECT', target: { componentId: hitTest.component.id }, additive: e.shiftKey });
				} else if (hitTest.wire && !selection.wireIds.has(hitTest.wire.id)) {
					dispatch({ type: 'SELECT', target: { wireId: hitTest.wire.id }, additive: e.shiftKey });
				}
				dispatch({ type: 'START_MOVE', startPos: snapped });
				return;
			}

			// Select mode - check for selection
			if (hitTest.comment) {
				dispatch({ type: 'SELECT', target: { commentId: hitTest.comment.id }, additive: e.shiftKey });
			} else if (hitTest.directive) {
				dispatch({ type: 'SELECT', target: { directiveId: hitTest.directive.id }, additive: e.shiftKey });
			} else if (hitTest.component) {
				dispatch({ type: 'SELECT', target: { componentId: hitTest.component.id }, additive: e.shiftKey });
			} else if (hitTest.wire) {
				dispatch({ type: 'SELECT', target: { wireId: hitTest.wire.id }, additive: e.shiftKey });
			} else if (!e.shiftKey) {
				dispatch({ type: 'CLEAR_SELECTION' });
			}

			// Prepare for potential view drag
			dispatch({ type: 'START_VIEW_DRAG', screenPos: { x: e.offsetX, y: e.offsetY } });
		} else if (e.button === 1) { // Middle click - always pan
			dispatch({ type: 'START_VIEW_DRAG', screenPos: { x: e.offsetX, y: e.offsetY } });
		}
	}

	/** Create junction if point is on an existing wire (not at endpoint) */
	function maybeCreateJunctionOnWire(point: Point) {
		for (const wire of schematic.wires) {
			if (isPointOnWireSegment(point, wire)) {
				dispatch({ type: 'CREATE_JUNCTION', pos: point });
				return;
			}
		}
	}

	/** Handle click in delete mode - priority: junction > component > wire */
	function handleDeleteClick(clickPos: Point) {
		const comment = findCommentAt(clickPos);
		if (comment) {
			dispatch({
				type: 'DELETE_AT',
				target: { componentIds: [], wireIds: [], junctionIds: [], directiveIds: [], commentIds: [comment.id] }
			});
			return;
		}

		const junction = findJunctionAt(clickPos);
		if (junction) {
			dispatch({
				type: 'DELETE_AT',
				target: {
					componentIds: [],
					wireIds: [],
					junctionIds: [junction.id],
					directiveIds: []
				}
			});
			return;
		}

		const comp = findComponentAt(clickPos);
		if (comp) {
			dispatch({
				type: 'DELETE_AT',
				target: {
					componentIds: [comp.id],
					wireIds: [],
					junctionIds: [],
					directiveIds: []
				}
			});
			return;
		}

		const wire = findWireAt(clickPos);
		if (wire) {
			dispatch({
				type: 'DELETE_AT',
				target: {
					componentIds: [],
					wireIds: [wire.id],
					junctionIds: [],
					directiveIds: []
				}
			});
		}
	}

	/** Handle click in duplicate mode */
	function handleDuplicateClick(clickPos: Point) {
		const comment = findCommentAt(clickPos);
		if (comment) {
			dispatch({ type: 'DUPLICATE_AT', pos: clickPos, commentId: comment.id });
			return;
		}
		const comp = findComponentAt(clickPos);
		const wire = findWireAt(clickPos);
		dispatch({
			type: 'DUPLICATE_AT',
			pos: clickPos,
			componentId: comp?.id,
			wireId: wire?.id
		});
	}

	/** Add a probe (calls onprobe callback) */
	function addProbe(type: ProbeType, node1: string, componentId?: string, node2?: string) {
		const label = type === 'current'
			? `I(${node1})`
			: type === 'voltage-diff'
				? `V(${node1},${node2})`
				: `V(${node1})`;

		if (onprobe) {
			onprobe({ type, node1, node2, componentId, label });
		}
	}

	function handleMouseMove(e: MouseEvent) {
		const dpr = getDpr();
		const schematicPos = screenToSchematic(e.offsetX, e.offsetY);
		const snappedPos = snapToGrid(schematicPos);
		const { modeState } = editorState;

		// Update mouse position in state
		dispatch({ type: 'UPDATE_MOUSE_POS', screenPos: { x: e.offsetX, y: e.offsetY }, schematicPos });

		// Calculate screen delta for view dragging
		const screenDelta = lastScreenPos
			? { x: (e.offsetX - lastScreenPos.x) * dpr, y: (e.offsetY - lastScreenPos.y) * dpr }
			: { x: 0, y: 0 };

		// Handle view dragging
		if (modeState.type === 'dragging-view' && (e.buttons & 1 || e.buttons & 4)) {
			dispatch({ type: 'PAN', dx: screenDelta.x, dy: screenDelta.y });
			lastScreenPos = { x: e.offsetX, y: e.offsetY };
			return;
		}

		// Handle moving selected items
		if (modeState.type === 'moving' && modeState.startPos && (e.buttons & 1)) {
			dispatch({ type: 'MOVE_SELECTED', delta: { x: snappedPos.x - modeState.startPos.x, y: snappedPos.y - modeState.startPos.y } });
		}

		lastScreenPos = { x: e.offsetX, y: e.offsetY };
	}

	function handleMouseUp(e: MouseEvent) {
		const { modeState } = editorState;
		const clickPos = screenToSchematic(e.offsetX, e.offsetY);
		const snapped = snapToGrid(clickPos);

		// Voltage probe: release on a different net = V(first) - V(second),
		// release on the same net (a click) = V(first)
		if (modeState.type === 'probing' && modeState.phase === 'holding-first' && modeState.firstNode && modeState.firstNodeName) {
			const first = modeState.firstNodeName;
			const second = findNetAt(clickPos, schematic);
			if (second && second.name !== first) {
				if (second.name === '0') {
					addProbe('voltage', first);  // V(x) - V(ground) is just V(x)
				} else {
					addProbe('voltage-diff', first, undefined, second.name);
				}
			} else {
				addProbe('voltage', first);
			}
			dispatch({ type: 'PROBE_COMPLETE', pos: snapped, nodeName: second?.name ?? null });
		}

		// End view dragging or moving
		if (modeState.type === 'dragging-view') {
			dispatch({ type: 'END_VIEW_DRAG' });
		} else if (modeState.type === 'moving') {
			dispatch({ type: 'END_MOVE' });
		}

		lastScreenPos = null;
	}

	function handleDoubleClick(e: MouseEvent) {
		const clickPos = screenToSchematic(e.offsetX, e.offsetY);

		// Comments open the comment editor
		const comment = findCommentAt(clickPos);
		if (comment && oneditcomment) {
			oneditcomment(comment, false);
			return;
		}

		// Check if clicking on a directive first
		if (findDirectiveAtPos(clickPos) && oneditdirectives) {
			oneditdirectives();
			return;
		}

		// Find component at click position
		const comp = findComponentAt(clickPos);
		if (comp && oneditcomponent) {
			// Emit event to open component edit modal
			oneditcomponent(comp);
		}
	}

	function handleMouseLeave(e: MouseEvent) {
		// Leaving the canvas mid-drag cancels a probe instead of placing it
		if (editorState.modeState.type === 'probing' && editorState.modeState.phase === 'holding-first') {
			dispatch({ type: 'PROBE_COMPLETE', pos: editorState.schematicPos, nodeName: null });
			lastScreenPos = null;
			return;
		}
		handleMouseUp(e);
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const dpr = getDpr();
		const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
		dispatch({ type: 'ZOOM', factor: zoomFactor, center: { x: e.offsetX * dpr, y: e.offsetY * dpr } });
	}

	function handleKeyDown(e: KeyboardEvent) {
		const { modeState, selection } = editorState;

		// Escape cancels current operation and returns to select mode
		if (e.key === 'Escape') {
			dispatch({ type: 'CANCEL' });
			return;
		}

		// Mode shortcuts (number keys mapped from F-keys)
		if (!e.ctrlKey && !e.metaKey && !e.altKey) {
			const modeKey = MODE_SHORTCUTS[e.key];
			if (modeKey) {
				dispatch({ type: 'SET_MODE', mode: modeKey as 'select' | 'wire' | 'delete' | 'duplicate' | 'move' | 'probe' });
				return;
			}

			// W key also enters wire mode
			if (e.key === 'w' || e.key === 'W') {
				dispatch({ type: 'SET_MODE', mode: 'wire' });
				return;
			}

			// T places a text comment
			if (e.key === 't' || e.key === 'T') {
				dispatch({ type: 'SET_MODE', mode: 'comment' });
				return;
			}
		}

		// Space toggles wire direction while drawing
		if (e.key === ' ' && modeState.type === 'drawing-wire') {
			e.preventDefault();
			dispatch({ type: 'TOGGLE_WIRE_DIRECTION' });
			return;
		}

		// Component shortcuts
		if (!e.ctrlKey && !e.metaKey) {
			const compDef = getComponentByShortcut(e.key);
			if (compDef) {
				dispatch({ type: 'START_PLACING', componentType: compDef.type as ComponentType });
				return;
			}
		}

		// Ctrl+R to rotate
		if ((e.key === 'r' || e.key === 'R') && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			if (modeState.type === 'placing') {
				dispatch({ type: 'ROTATE_PLACING' });
			} else if (selection.componentIds.size > 0) {
				dispatch({ type: 'ROTATE_SELECTED' });
			}
			return;
		}

		// Ctrl+E to mirror
		if ((e.key === 'e' || e.key === 'E') && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			if (modeState.type === 'placing') {
				dispatch({ type: 'MIRROR_PLACING' });
			} else if (selection.componentIds.size > 0) {
				dispatch({ type: 'MIRROR_SELECTED' });
			}
			return;
		}

		// Delete selected
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (hasSelection(selection)) {
				dispatch({ type: 'DELETE_SELECTED' });
				return;
			}
		}

		// Grid toggle
		if ((e.key === 'g' || e.key === 'G') && (e.ctrlKey || e.shiftKey)) {
			e.preventDefault();
			dispatch({ type: 'TOGGLE_GRID' });
			return;
		}

		// View controls
		// F / Home: zoom to fit the whole circuit
		if (e.key === 'Home' || (e.key === 'f' && modeState.type !== 'placing')) {
			fitToContent();
			return;
		}
		if (e.key === '+' || e.key === '=') {
			dispatch({ type: 'ZOOM', factor: 1.2, center: { x: canvas.width / 2, y: canvas.height / 2 } });
			return;
		}
		if (e.key === '-' || e.key === '_') {
			dispatch({ type: 'ZOOM', factor: 1 / 1.2, center: { x: canvas.width / 2, y: canvas.height / 2 } });
			return;
		}
	}

	// Re-render when schematic changes
	$effect(() => {
		// Reading stressScores here makes new ratings-check results redraw the canvas too
		if (schematic && stressScores && ctx) {
			render();
		}
	});

	/** Get cursor style based on current mode */
	function getCursorStyle(): string {
		const { modeState } = editorState;
		if (modeState.type === 'dragging-view') return 'grabbing';
		switch (modeState.type) {
			case 'placing': return 'copy';
			case 'drawing-wire': return 'crosshair';
			case 'moving': return 'move';
			case 'probing': return 'crosshair';
			case 'placing-comment': return 'text';
			default:
				// Check for delete/duplicate in idle mode
				const mode = getEditorMode(modeState);
				if (mode === 'delete') return 'not-allowed';
				if (mode === 'duplicate') return 'copy';
				return 'default';
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="schematic-container" bind:this={container}>
	<canvas
		bind:this={canvas}
		class="schematic-canvas"
		style="cursor: {getCursorStyle()}"
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseLeave}
		ondblclick={handleDoubleClick}
		onwheel={handleWheel}
		onkeydown={handleKeyDown}
		tabindex="0"
	></canvas>
	<div class="hud">{getHudText()}</div>
</div>

<style>
	.schematic-container {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.schematic-canvas {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: block;
		outline: none;
	}

	.hud {
		position: absolute;
		bottom: 4px;
		left: 4px;
		background: rgba(0, 0, 0, 0.7);
		color: #888;
		font-family: monospace;
		font-size: 11px;
		padding: 2px 6px;
		pointer-events: none;
	}
</style>

