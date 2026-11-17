<script lang="ts" module>
	/** A clickable menu entry */
	export interface MenuItem {
		label: string;
		shortcut?: string;       // Shown on the right, e.g. "Ctrl+O" (display only)
		action: () => void;
		disabled?: boolean;
	}

	/** A top-level menu: its label and entries ('separator' draws a divider) */
	export interface Menu {
		label: string;
		items: (MenuItem | 'separator')[];
	}
</script>

<script lang="ts">
	/**
	 * Desktop-style menu bar (File, Edit, ...).
	 * Click a menu to open it; while one is open, hovering another switches to it.
	 * Closes on item click, Escape, or a click anywhere else.
	 * Keyboard: Up/Down move through items, Left/Right switch menus, Enter activates.
	 */
	let { menus }: { menus: Menu[] } = $props();

	let openIndex = $state<number | null>(null);
	let bar: HTMLElement;
	let itemEls: HTMLButtonElement[] = $state([]);

	function enabledItems(menu: Menu): MenuItem[] {
		return menu.items.filter((i): i is MenuItem => i !== 'separator' && !i.disabled);
	}

	function open(index: number, focusFirst = false) {
		openIndex = index;
		if (focusFirst) {
			queueMicrotask(() => itemEls.find((el) => el && !el.disabled)?.focus());
		}
	}

	function close() {
		openIndex = null;
	}

	function activate(item: MenuItem) {
		if (item.disabled) return;
		close();
		item.action();
	}

	function handleWindowMouseDown(e: MouseEvent) {
		if (openIndex !== null && bar && !bar.contains(e.target as Node)) close();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (openIndex === null) return;
		const focusable = itemEls.filter((el) => el && !el.disabled);
		const current = focusable.indexOf(document.activeElement as HTMLButtonElement);

		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				close();
				break;
			case 'ArrowDown':
				e.preventDefault();
				focusable[(current + 1) % focusable.length]?.focus();
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusable[(current - 1 + focusable.length) % focusable.length]?.focus();
				break;
			case 'ArrowRight':
				e.preventDefault();
				open((openIndex + 1) % menus.length, true);
				break;
			case 'ArrowLeft':
				e.preventDefault();
				open((openIndex - 1 + menus.length) % menus.length, true);
				break;
		}
	}
</script>

<svelte:window onmousedown={handleWindowMouseDown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="menu-bar" bind:this={bar} onkeydown={handleKeyDown} aria-label="Main menu">
	{#each menus as menu, i}
		<div class="menu">
			<button
				class="menu-title"
				class:open={openIndex === i}
				aria-haspopup="menu"
				aria-expanded={openIndex === i}
				onclick={() => (openIndex === i ? close() : open(i))}
				onmouseenter={() => openIndex !== null && openIndex !== i && open(i)}
				onkeydown={(e) => {
					if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						open(i, true);
					}
				}}
			>
				{menu.label}
			</button>

			{#if openIndex === i}
				<div class="dropdown" role="menu" aria-label={menu.label}>
					{#each menu.items as item, j}
						{#if item === 'separator'}
							<div class="separator" role="separator"></div>
						{:else}
							<button
								class="item"
								role="menuitem"
								disabled={item.disabled}
								bind:this={itemEls[j]}
								onclick={() => activate(item)}
							>
								<span class="item-label">{item.label}</span>
								{#if item.shortcut}
									<span class="item-shortcut">{item.shortcut}</span>
								{/if}
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</nav>

<style>
	.menu-bar {
		display: flex;
		align-items: stretch;
		height: 100%;
	}

	.menu {
		position: relative;
		display: flex;
	}

	.menu-title {
		background: none;
		border: none;
		color: var(--text-primary);
		font-size: var(--font-size-md);
		padding: 0 var(--spacing-sm);
		border-radius: 3px;
		cursor: pointer;
	}

	.menu-title:hover,
	.menu-title.open {
		background: var(--bg-tertiary);
	}

	.menu-title:focus-visible {
		outline: 1px solid var(--btn-primary-hover);
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 240px;
		padding: var(--spacing-xs) 0;
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
		z-index: 500;
		display: flex;
		flex-direction: column;
	}

	.item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing-md);
		background: none;
		border: none;
		color: var(--text-primary);
		font-size: var(--font-size-md);
		text-align: left;
		padding: 6px var(--spacing-md);
		cursor: pointer;
	}

	.item:hover:not(:disabled),
	.item:focus-visible:not(:disabled) {
		background: var(--bg-selected);
		outline: none;
	}

	.item:disabled {
		color: var(--text-muted);
		cursor: default;
	}

	.item-shortcut {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}

	.item:disabled .item-shortcut {
		color: var(--text-muted);
	}

	.separator {
		height: 1px;
		margin: var(--spacing-xs) 0;
		background: var(--border-primary);
	}
</style>
