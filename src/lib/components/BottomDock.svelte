<script lang="ts" module>
	export interface DockTab {
		id: string;
		label: string;
		badge?: { text: string; color: string; title?: string };  // e.g. ratings score
	}
</script>

<script lang="ts">
	/**
	 * Bottom dock: a tab bar along the bottom edge. Closed, only the bar shows,
	 * so the panel above gets the space. The arrow (or clicking a tab) pops the
	 * dock up; one tab's content is visible at a time. Drag the top edge to
	 * change its height.
	 */
	import type { Snippet } from 'svelte';

	let {
		tabs,
		active = $bindable(),
		open = $bindable(false),
		height = $bindable(300),
		minHeight = 120,
		children,
		actions
	}: {
		tabs: DockTab[];
		active: string;
		open?: boolean;
		height?: number;
		minHeight?: number;
		children: Snippet<[string]>;   // Content for the active tab
		actions?: Snippet<[string]>;   // Extra buttons for the active tab (shown while open)
	} = $props();

	let dock: HTMLDivElement;
	let resizing = false;
	let startY = 0;
	let startHeight = 0;

	function selectTab(id: string) {
		if (open && active === id) {
			open = false;      // Clicking the open tab again tucks the dock away
		} else {
			active = id;
			open = true;
		}
	}

	function startResize(e: MouseEvent) {
		e.preventDefault();
		resizing = true;
		startY = e.clientY;
		startHeight = height;
		window.addEventListener('mousemove', onResize);
		window.addEventListener('mouseup', stopResize);
	}

	function onResize(e: MouseEvent) {
		if (!resizing) return;
		// Leave at least 150px for the panel above
		const maxHeight = (dock?.parentElement?.clientHeight ?? window.innerHeight) - 150;
		height = Math.max(minHeight, Math.min(maxHeight, startHeight + (startY - e.clientY)));
	}

	function stopResize() {
		resizing = false;
		window.removeEventListener('mousemove', onResize);
		window.removeEventListener('mouseup', stopResize);
	}
</script>

<div class="bottom-dock" class:open bind:this={dock} style={open ? `height: ${height}px` : ''}>
	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="resize-handle" onmousedown={startResize} title="Drag to resize"></div>
	{/if}

	<div class="dock-bar">
		<button
			class="toggle"
			onclick={() => (open = !open)}
			title={open ? 'Hide panel' : 'Show panel'}
			aria-label={open ? 'Hide panel' : 'Show panel'}
			aria-expanded={open}
		>
			{open ? '▼' : '▲'}
		</button>
		<div class="tabs" role="tablist">
			{#each tabs as tab}
				<button
					class="tab"
					class:active={open && active === tab.id}
					role="tab"
					aria-selected={open && active === tab.id}
					onclick={() => selectTab(tab.id)}
				>
					{tab.label}
					{#if tab.badge}
						<span class="badge" style="background: {tab.badge.color}" title={tab.badge.title}>{tab.badge.text}</span>
					{/if}
				</button>
			{/each}
		</div>
		{#if open && actions}
			<div class="actions">{@render actions(active)}</div>
		{/if}
	</div>

	{#if open}
		<div class="dock-content" role="tabpanel">
			{@render children(active)}
		</div>
	{/if}
</div>

<style>
	.bottom-dock {
		position: relative;
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border-primary);
	}

	.resize-handle {
		position: absolute;
		top: -3px;
		left: 0;
		right: 0;
		height: 6px;
		cursor: ns-resize;
		z-index: 10;
	}

	.resize-handle:hover {
		background: var(--btn-primary-bg);
	}

	.dock-bar {
		display: flex;
		align-items: stretch;
		height: 28px;
		flex: none;
		background: var(--bg-tertiary);
		border-bottom: 1px solid var(--border-primary);
	}

	.toggle {
		width: 32px;
		background: none;
		border: none;
		border-right: 1px solid var(--border-primary);
		color: var(--text-secondary);
		font-size: 11px;
		cursor: pointer;
	}

	.toggle:hover {
		color: var(--text-primary);
		background: var(--bg-secondary);
	}

	.tabs {
		display: flex;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 14px;
		background: none;
		border: none;
		border-right: 1px solid var(--border-primary);
		border-bottom: 2px solid transparent;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.tab:hover {
		color: var(--text-primary);
	}

	.tab.active {
		color: var(--text-primary);
		background: var(--bg-secondary);
		border-bottom-color: var(--btn-primary-hover);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 9px;
		color: #000;
		font-weight: 700;
		font-size: 11px;
		box-sizing: border-box;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
	}

	.dock-content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
</style>
