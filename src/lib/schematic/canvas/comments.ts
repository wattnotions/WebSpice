/**
 * Text comments: free-form notes drawn on the schematic.
 * They are not part of the circuit and never reach the netlist.
 *
 * Text size is in schematic units, so comments scale with the drawing
 * when zooming (unlike directives and labels, which stay a fixed screen size).
 */

import type { Point, TextComment } from '../types';

/** Font size in schematic units (one grid square is 10 units) */
export const COMMENT_FONT_SIZE = 12;
const LINE_HEIGHT = COMMENT_FONT_SIZE * 1.3;
const FONT = `${COMMENT_FONT_SIZE}px sans-serif`;
const PADDING = 3;

/** Bounding box of a comment (top-left anchored at comment.x, comment.y) */
export function measureComment(
	ctx: CanvasRenderingContext2D,
	comment: TextComment
): { x: number; y: number; width: number; height: number } {
	ctx.save();
	ctx.font = FONT;
	const lines = comment.text.split('\n');
	const width = Math.max(COMMENT_FONT_SIZE, ...lines.map((l) => ctx.measureText(l).width));
	ctx.restore();
	return {
		x: comment.x - PADDING,
		y: comment.y - PADDING,
		width: width + PADDING * 2,
		height: lines.length * LINE_HEIGHT + PADDING * 2
	};
}

/** Draw all comments; selected ones get a dashed outline */
export function drawComments(
	ctx: CanvasRenderingContext2D,
	viewScale: number,
	comments: TextComment[] | undefined,
	selectedIds: Set<string>
): void {
	if (!comments || comments.length === 0) return;

	for (const comment of comments) {
		const isSelected = selectedIds.has(comment.id);

		if (isSelected) {
			const box = measureComment(ctx, comment);
			ctx.strokeStyle = '#ffff00';
			ctx.lineWidth = 1 / viewScale;
			ctx.setLineDash([4 / viewScale, 3 / viewScale]);
			ctx.strokeRect(box.x, box.y, box.width, box.height);
			ctx.setLineDash([]);
		}

		ctx.font = FONT;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillStyle = isSelected ? '#ffff88' : '#c8c8c8';
		comment.text.split('\n').forEach((line, i) => {
			ctx.fillText(line, comment.x, comment.y + i * LINE_HEIGHT);
		});
	}
}

/** Find the topmost comment under a point */
export function findCommentAt(
	ctx: CanvasRenderingContext2D,
	pos: Point,
	comments: TextComment[] | undefined
): TextComment | null {
	if (!comments) return null;
	for (let i = comments.length - 1; i >= 0; i--) {
		const box = measureComment(ctx, comments[i]);
		if (pos.x >= box.x && pos.x <= box.x + box.width && pos.y >= box.y && pos.y <= box.y + box.height) {
			return comments[i];
		}
	}
	return null;
}
