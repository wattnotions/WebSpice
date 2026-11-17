<script lang="ts">
	import type { TextComment } from '$lib/schematic/types';

	let {
		visible = $bindable(false),
		comment = null,
		isNew = false,
		onsave,
		ondelete
	}: {
		visible: boolean;
		comment: TextComment | null;
		isNew?: boolean;
		onsave?: (comment: TextComment) => void;
		ondelete?: (comment: TextComment) => void;
	} = $props();

	let text = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	// Load the comment's text each time the dialog opens
	$effect(() => {
		if (visible && comment) {
			text = comment.text;
			queueMicrotask(() => textarea?.focus());
		}
	});

	function close() {
		visible = false;
	}

	function save() {
		if (!comment) return;
		const trimmed = text.replace(/\s+$/, '');
		if (trimmed === '') {
			// Saving an empty comment removes it (or just doesn't create it)
			if (!isNew) ondelete?.(comment);
		} else {
			onsave?.({ ...comment, text: trimmed });
		}
		close();
	}

	function remove() {
		if (comment) ondelete?.(comment);
		close();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			save();
		}
	}
</script>

{#if visible && comment}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={close} onkeydown={handleKeyDown}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-content" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h2>{isNew ? 'Add Comment' : 'Edit Comment'}</h2>
				<button class="close-btn" onclick={close} aria-label="Close">×</button>
			</div>
			<div class="modal-body">
				<label for="comment-text">Text</label>
				<textarea
					id="comment-text"
					bind:this={textarea}
					bind:value={text}
					rows="6"
					placeholder="Describe this part of the circuit..."
				></textarea>
				<span class="hint">Enter for a new line, Ctrl+Enter to save. Comments are not part of the netlist.</span>
			</div>
			<div class="modal-footer">
				{#if !isNew}
					<button class="delete-btn" onclick={remove}>Delete</button>
				{/if}
				<span class="spacer"></span>
				<button class="cancel-btn" onclick={close}>Cancel</button>
				<button class="save-btn" onclick={save}>Save</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(2px);
	}

	.modal-content {
		background: var(--bg-primary);
		border: 1px solid var(--border-primary);
		max-width: 480px;
		width: 90%;
		display: flex;
		flex-direction: column;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-md);
		border-bottom: 1px solid var(--border-primary);
		background: var(--bg-secondary);
	}

	.modal-header h2 {
		margin: 0;
		font-size: 16px;
		color: var(--text-primary);
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 28px;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.close-btn:hover {
		color: var(--text-primary);
		background: var(--bg-tertiary);
	}

	.modal-body {
		padding: var(--spacing-md);
	}

	.modal-body label {
		display: block;
		margin-bottom: var(--spacing-xs);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: var(--spacing-sm);
		background: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		color: var(--text-primary);
		font-family: sans-serif;
		font-size: 14px;
		resize: vertical;
	}

	textarea:focus {
		outline: none;
		border-color: var(--accent-blue);
	}

	.hint {
		display: block;
		margin-top: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	.modal-footer {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-md);
		border-top: 1px solid var(--border-primary);
		background: var(--bg-secondary);
	}

	.spacer {
		flex: 1;
	}

	.cancel-btn,
	.delete-btn {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		color: var(--text-primary);
		padding: var(--spacing-sm) var(--spacing-lg);
		cursor: pointer;
	}

	.delete-btn:hover {
		border-color: #c44;
		color: #f88;
	}

	.save-btn {
		background: var(--accent-blue);
		border: none;
		color: white;
		padding: var(--spacing-sm) var(--spacing-lg);
		cursor: pointer;
	}

	.save-btn:hover {
		background: var(--accent-green);
	}
</style>
