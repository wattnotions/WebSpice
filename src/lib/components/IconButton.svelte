<script lang="ts" module>
	/**
	 * Built-in icons, drawn on a 16x16 grid with stroke="currentColor".
	 * Add new ones here as needed.
	 */
	export const ICONS = {
		// Counter-clockwise arrow: start over / fresh start
		reset: '<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M2.5 2v3h3"/>',
		// Trash can
		trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>',
		// Plus
		plus: '<path d="M8 3v10M3 8h10"/>'
	} as const;

	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	/**
	 * Small square icon button with a hover tooltip (title + optional description).
	 * The tooltip is position: fixed so panels with overflow: hidden don't clip it.
	 */
	let {
		icon,
		label,
		description = '',
		onclick,
		disabled = false,
		danger = false
	}: {
		icon: IconName;
		label: string;          // Short name, also used as the accessible label
		description?: string;   // Longer explanation shown under the label
		onclick: () => void;
		disabled?: boolean;
		danger?: boolean;       // Red hover, for destructive actions
	} = $props();

	let wrapper: HTMLSpanElement;
	let tip = $state<{ x: number; y: number; above: boolean } | null>(null);
	let showTimer: ReturnType<typeof setTimeout> | undefined;

	function show() {
		clearTimeout(showTimer);
		showTimer = setTimeout(() => {
			const r = wrapper.getBoundingClientRect();
			// Prefer below the button; flip above if too close to the bottom of the window
			const above = r.bottom + 90 > window.innerHeight;
			tip = { x: Math.min(r.left, window.innerWidth - 280), y: above ? r.top - 6 : r.bottom + 6, above };
		}, 350);
	}

	function hide() {
		clearTimeout(showTimer);
		tip = null;
	}

	function handleClick() {
		hide();
		onclick();
	}
</script>

<!-- Wrapper catches hover even when the button is disabled -->
<span
	class="icon-button-wrapper"
	bind:this={wrapper}
	onmouseenter={show}
	onmouseleave={hide}
	onfocusin={show}
	onfocusout={hide}
	role="presentation"
>
	<button class="icon-button" class:danger {disabled} aria-label={label} onclick={handleClick}>
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			{@html ICONS[icon]}
		</svg>
	</button>
</span>

{#if tip}
	<div
		class="tooltip"
		class:above={tip.above}
		style="left: {tip.x}px; top: {tip.y}px"
		role="tooltip"
	>
		<div class="tooltip-label">{label}{disabled ? ' (nothing to do)' : ''}</div>
		{#if description}
			<div class="tooltip-description">{description}</div>
		{/if}
	</div>
{/if}

<style>
	.icon-button-wrapper {
		display: inline-flex;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		background: none;
		border: 1px solid transparent;
		border-radius: 3px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.icon-button:hover:not(:disabled) {
		color: var(--text-primary);
		background: var(--bg-secondary);
		border-color: var(--border-primary);
	}

	.icon-button.danger:hover:not(:disabled) {
		color: #f88;
		border-color: #844;
	}

	.icon-button:focus-visible {
		outline: 1px solid var(--btn-primary-hover);
	}

	.icon-button:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.tooltip {
		position: fixed;
		z-index: 2000;
		max-width: 260px;
		padding: 6px 8px;
		background: #111;
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
		pointer-events: none;
		font-family: var(--font-sans);
	}

	.tooltip.above {
		transform: translateY(-100%);
	}

	.tooltip-label {
		color: var(--text-primary);
		font-size: var(--font-size-sm);
		font-weight: 600;
	}

	.tooltip-description {
		margin-top: 2px;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		line-height: 1.4;
	}
</style>
