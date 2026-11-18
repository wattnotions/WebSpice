<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { initSimulation, runSimulation, terminateSimulation, type SimulationResult, type RealDataType } from '$lib/simulation';
	import { TabbedWaveformViewer, type TraceData, type WaveformTab, getTraceColor, processAcResults } from '$lib/waveform';
	import { NetlistEditor } from '$lib/editor';
	import { SchematicCanvas, type Schematic, type Probe, type Component, type TextComment } from '$lib/schematic';
	import { ResizablePanel, HelpModal, LandingPage, DirectiveModal, ComponentEditModal, CommentEditModal, MenuBar, IconButton, BottomDock, type Menu, type DockTab } from '$lib/components';
	import { schematicToNetlist, generateNodeLabels, calculateComponentCurrent } from '$lib/netlist';
	import { computeStress, scoreColor, scoreLabel, formatSI, type StressReport } from '$lib/netlist/stress';

	let status = $state('Not initialized');
	let simResult = $state<SimulationResult | null>(null);
	let simInitInfo = $state<string>('');
	let timeData = $state<number[]>([]);
	let schematic = $state<Schematic>({ components: [], wires: [], junctions: [], directives: [], parameters: {}, models: [], comments: [] });
	let probes = $state<Probe[]>([]);

	// Ratings check after each run: per-part scores, 0 (lots of headroom) .. 10 (at the limit), 11 = over
	let stressReport = $state<StressReport | null>(null);
	const stressScores = $derived(
		Object.fromEntries((stressReport?.parts ?? []).map(p => [p.componentId, p.score]))
	);
	let showHelp = $state(false);
	let showLanding = $state(true);
	let showDirectives = $state(false);
	let showComponentEdit = $state(false);
	let editingComponent = $state<Component | null>(null);

	// Waveform tabs
	let waveformTabs = $state<WaveformTab[]>([{ id: 'default', name: 'Plot 1', traces: [] }]);
	let activeTabId = $state('default');

	// Schematic editor: component ref (for toolbar buttons) and its current mode
	let schematicCanvas: ReturnType<typeof SchematicCanvas> | undefined = $state();
	let schematicMode = $state('select');

	let netlistCollapsed = $state(true);  // Netlist panel starts collapsed; click ▶ to expand

	// Bottom dock (Waveform / Simulation Info): tucked away so the schematic gets the
	// space; pops up with the arrow, a tab click, or when a probe adds a trace
	let dockOpen = $state(false);
	let dockTab = $state('waveform');
	let dockHeight = $state(
		typeof window === 'undefined' ? 300 : Math.round((window.innerHeight - 64) * 0.4)
	);
	const dockTabs: DockTab[] = $derived([
		{
			id: 'waveform',
			label: 'Waveform',
			badge: getTotalTraceCount() > 0
				? { text: String(getTotalTraceCount()), color: '#9d9d9d', title: 'Traces plotted' }
				: undefined
		},
		{
			id: 'info',
			label: 'Simulation Info',
			badge: stressReport && stressReport.maxScore >= 0
				? { text: String(stressReport.maxScore), color: scoreColor(stressReport.maxScore), title: 'Worst part ratings score (0 = lots of headroom, 10 = at the limit, 11 = over)' }
				: undefined
		}
	]);

	/** Pop the dock up on the waveform tab (e.g. after probing) */
	function showWaveform() {
		dockTab = 'waveform';
		dockOpen = true;
	}

	// Ask the schematic to zoom to fit the circuit (bumped when a circuit is opened)
	let fitRequest = $state(0);
	let netlistInput = $state(`* Minimal RC Circuit Test
R1 in out 1k
C1 out 0 1u
Vin in 0 PULSE(0 5 0 1n 1n 0.5m 1m)
.tran 1u 5m
.end`);

	onMount(async () => {
		status = 'Initializing NGSpice...';
		try {
			simInitInfo = await initSimulation();
			status = 'NGSpice ready';
		} catch (err) {
			status = `Init failed: ${err}`;
		}

		// Show help modal on first visit
		const hasSeenHelp = localStorage.getItem('webspice-help-seen');
		if (!hasSeenHelp) {
			showHelp = true;
			localStorage.setItem('webspice-help-seen', 'true');
		}
	});

	onDestroy(() => {
		terminateSimulation();
	});

	async function runSim() {
		// Auto-generate netlist from schematic if there are components
		if (schematic.components.length > 0) {
			generateNetlistFromSchematic();
		}

		status = 'Running simulation...';
		simResult = null;
		stressReport = null;
		// Clear all tabs' traces
		waveformTabs = waveformTabs.map(tab => ({ ...tab, traces: [] }));
		timeData = [];
		try {
			const result = await runSimulation(netlistInput);
			simResult = result;
			status = `Simulation complete: ${result.numPoints} points, ${result.numVariables} variables`;

			if (result.dataType === 'complex') {
				// AC analysis - create magnitude and phase tabs
				handleAcResults();
				showWaveform();
			} else {
				// Transient analysis - extract time data
				for (const data of result.data) {
					if (data.type === 'time') {
						timeData = data.values as number[];
						break;
					}
				}
				// Check every part that has datasheet ratings against what the run did to it
				if (schematic.components.length > 0) {
					stressReport = computeStress(schematic, result.data as RealDataType[]);
				}

				if (schematic.components.length === 0) {
					// Netlist typed by hand (nothing to probe): show every signal
					addAllSimulationTracesToActiveTab();
					showWaveform();
				} else if (probes.length > 0) {
					// LTspice style: re-plot whatever was probed before this run
					for (const probe of probes) addProbeTracesToActiveTab(probe);
					showWaveform();
				} else {
					status += ' | Press P (or the probe button) and click a wire to plot it';
				}
				if (stressReport && stressReport.parts.length > 0) {
					status += ` | ${stressSummary(stressReport)}`;
				}
			}
		} catch (err) {
			status = `Simulation error: ${err}`;
		}
	}

	/** Handle AC analysis results - create magnitude and phase tabs */
	function handleAcResults() {
		if (!simResult || simResult.dataType !== 'complex') return;

		const { frequencyData, magnitudeTraces, phaseTraces } = processAcResults(simResult.data);

		if (frequencyData.length === 0) {
			status = 'AC analysis error: No frequency data found';
			return;
		}

		// Use frequency data as the X-axis (stored in timeData for compatibility)
		timeData = frequencyData;

		// Create or update tabs for magnitude and phase
		const magTabId = 'ac-magnitude';
		const phaseTabId = 'ac-phase';

		const newTabs: WaveformTab[] = [
			{
				id: magTabId,
				name: 'Magnitude (dB)',
				traces: magnitudeTraces,
				xAxisType: 'frequency'
			},
			{
				id: phaseTabId,
				name: 'Phase (°)',
				traces: phaseTraces,
				xAxisType: 'frequency'
			}
		];

		waveformTabs = newTabs;
		activeTabId = magTabId;

		status = `AC analysis complete: ${simResult.numPoints} points, ${magnitudeTraces.length} traces`;
	}

	/** Add all simulation variables as traces to the active tab */
	function addAllSimulationTracesToActiveTab() {
		if (!simResult || simResult.dataType !== 'real') return;

		const activeTab = waveformTabs.find(t => t.id === activeTabId);
		if (!activeTab) return;

		const traces: TraceData[] = [];
		let colorIndex = 0;

		// Add all data except 'time' type
		for (const data of simResult.data) {
			if (data.type === 'time') continue; // Skip time axis

			traces.push({
				id: data.name,
				name: data.name,
				type: data.type,
				values: data.values as number[],
				color: getTraceColor(colorIndex++),
				visible: true
			});
		}

		// Update the active tab with all traces
		waveformTabs = waveformTabs.map(tab =>
			tab.id === activeTabId ? { ...tab, traces } : tab
		);
	}

	/** Check if a simulation data entry matches a specific probe (for voltage and current, not voltage-diff) */
	function dataMatchesProbe(dataName: string, probe: Probe): boolean {
		const dataNameLower = dataName.toLowerCase();
		const node1Lower = probe.node1.toLowerCase();

		if (probe.type === 'voltage') {
			return dataNameLower === `v(${node1Lower})`;
		} else if (probe.type === 'current') {
			return dataNameLower === `i(${node1Lower})` ||
				   dataNameLower.includes(`(${node1Lower})`) ||
				   dataNameLower.includes(`@${node1Lower}`);
		}
		// voltage-diff is handled separately - we need to compute the difference
		return false;
	}

	/** Helper to find voltage data for a node */
	function findVoltageData(nodeName: string): number[] | null {
		if (!simResult || simResult.dataType !== 'real') return null;
		if (nodeName === '0') return new Array(timeData.length).fill(0);
		const data = simResult.data.find(d => d.name.toLowerCase() === `v(${nodeName.toLowerCase()})`);
		return data ? data.values as number[] : null;
	}

	/** Add traces for a specific probe to the active tab */
	function addProbeTracesToActiveTab(probe: Probe) {
		if (!simResult || simResult.dataType !== 'real') return;

		const activeTab = waveformTabs.find(t => t.id === activeTabId);
		if (!activeTab) return;

		const traces: TraceData[] = [];
		let colorIndex = activeTab.traces.length;

		// Ensure we have time data
		for (const data of simResult.data) {
			if (data.type === 'time' && timeData.length === 0) {
				timeData = data.values as number[];
				break;
			}
		}

		// Handle voltage-diff probe specially - compute V(node1) - V(node2)
		if (probe.type === 'voltage-diff' && probe.node2) {
			const traceId = `V(${probe.node1},${probe.node2})`;
			const alreadyExists = activeTab.traces.some(t => t.id === traceId);
			if (!alreadyExists) {
				const v1 = findVoltageData(probe.node1);
				const v2 = findVoltageData(probe.node2);
				if (v1 && v2 && v1.length === v2.length) {
					const diffValues = v1.map((v, i) => v - v2[i]);
					traces.push({
						id: traceId,
						name: traceId,
						type: 'voltage',
						values: diffValues,
						color: getTraceColor(colorIndex++),
						visible: true
					});
				}
			}
		} else {
			// For voltage and current probes, try to find matching data in simulation results
			let foundInSimData = false;
			for (const data of simResult.data) {
				if (dataMatchesProbe(data.name, probe)) {
					const alreadyExists = activeTab.traces.some(t => t.id === data.name);
					if (!alreadyExists) {
						traces.push({
							id: data.name,
							name: data.name,
							type: data.type,
							values: data.values as number[],
							color: getTraceColor(colorIndex++),
							visible: true
						});
						foundInSimData = true;
					}
				}
			}

			// If current probe not found in sim data, try to calculate it
			if (!foundInSimData && probe.type === 'current' && probe.componentId && timeData.length > 0) {
				const comp = schematic.components.find(c => c.id === probe.componentId);
				if (comp) {
					const calculatedCurrent = calculateComponentCurrent(
						comp,
						schematic,
						simResult.data as RealDataType[],
						timeData
					);
					if (calculatedCurrent) {
						const alreadyExists = activeTab.traces.some(t => t.id === calculatedCurrent.name);
						if (!alreadyExists) {
							traces.push({
								id: calculatedCurrent.name,
								name: `${calculatedCurrent.name} (calc)`,
								type: calculatedCurrent.type,
								values: calculatedCurrent.values,
								color: getTraceColor(colorIndex++),
								visible: true
							});
						}
					}
				}
			}
		}

		if (traces.length > 0) {
			waveformTabs = waveformTabs.map(tab =>
				tab.id === activeTabId
					? { ...tab, traces: [...tab.traces, ...traces] }
					: tab
			);
		}
	}

	/** Handle trace deletion from waveform panel */
	function handleDeleteTrace(tabId: string, traceId: string) {
		waveformTabs = waveformTabs.map(tab =>
			tab.id === tabId
				? { ...tab, traces: tab.traces.filter(t => t.id !== traceId) }
				: tab
		);
	}

	/** One-line ratings summary for the status bar */
	function stressSummary(report: StressReport): string {
		const over = report.parts.flatMap(p => p.items.filter(i => i.score >= 11).map(i => ({ p, i })));
		if (over.length > 0) {
			return 'WARNING over rating: ' + over
				.map(({ p, i }) => `${p.instName} ${i.label} ${formatSI(i.value, i.unit)} > ${formatSI(i.limit, i.unit)}`)
				.join(', ');
		}
		const worst = report.parts.reduce((a, b) => (b.score > a.score ? b : a));
		return `Ratings: worst ${worst.instName} ${worst.score}/10 (${worst.worst.label} ${Math.round(worst.worst.ratio * 100)}% of max)`;
	}

	/**
	 * Clear the plot: remove every probe and trace and go back to a single
	 * empty "Plot 1" tab. Simulation results are kept, so probing again
	 * shows traces straight away without re-running.
	 */
	function clearPlot() {
		probes = [];
		waveformTabs = [{ id: 'default', name: 'Plot 1', traces: [] }];
		activeTabId = 'default';
		status = 'Cleared all probes and traces';
	}

	/** Get total trace count across all tabs */
	function getTotalTraceCount(): number {
		return waveformTabs.reduce((sum, tab) => sum + tab.traces.length, 0);
	}

	/** Handle probe event from schematic canvas */
	function handleProbe(event: { type: string; node1: string; node2?: string; componentId?: string; label: string }) {
		const { type, node1, node2, componentId, label } = event;

		// Create the probe object
		const newProbe: Probe = {
			id: crypto.randomUUID(),
			type: type as Probe['type'],
			node1,
			node2,
			componentId,
			label
		};

		if (type === 'voltage' && node1 === '0') {
			status = 'That node is ground (0 V)';
			return;
		}

		// Remember the probe so it is re-plotted on the next run
		if (!probes.some(p => p.label === label)) {
			probes = [...probes, newProbe];
		}

		if (simResult) {
			addProbeTracesToActiveTab(newProbe);
			showWaveform();
			status = `Plotted ${label}`;
		} else {
			status = `Probe added: ${label} (it will be plotted when you run the simulation)`;
		}
	}

	function generateNetlistFromSchematic() {
		if (schematic.components.length === 0) {
			status = 'No components in schematic';
			return;
		}
		const netlistText = schematicToNetlist(schematic, 'Generated from Schematic');
		netlistInput = netlistText;

		// Generate and attach node labels for display on schematic
		schematic.nodeLabels = generateNodeLabels(schematic);

		status = `Generated netlist: ${schematic.components.length} components, ${schematic.wires.length} wires, ${schematic.nodeLabels.length} nodes`;
	}

	/** Top menu bar. Shortcuts shown here are handled in handleKeyDown below. */
	const menus: Menu[] = $derived([
		{
			label: 'File',
			items: [
				{ label: 'Open…', shortcut: 'Ctrl+O', action: openSchematicDialog },
				{
					label: 'Save',
					shortcut: 'Ctrl+S',
					action: saveSchematic,
					disabled: schematic.components.length === 0 && schematic.wires.length === 0
				},
				'separator',
				{
					label: 'Generate Netlist',
					shortcut: 'Ctrl+N',
					action: generateNetlistFromSchematic,
					disabled: schematic.components.length === 0
				},
				{
					label: 'Run Simulation',
					shortcut: 'Ctrl+B',
					action: runSim,
					disabled: status.includes('Initializing') || status.includes('Running')
				}
			]
		}
	]);

	function handleKeyDown(e: KeyboardEvent) {
		// Don't handle shortcuts if typing in a text input
		const target = e.target as HTMLElement;
		const isTextInput = target.tagName === 'TEXTAREA' ||
			(target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') ||
			target.isContentEditable;

		// H key to show help (only when not in text input)
		if (!isTextInput && (e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			showHelp = true;
			return;
		}

		// Ctrl+B to run simulation
		if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
			e.preventDefault();
			runSim();
		}
		// Ctrl+N to generate netlist from schematic
		if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
			e.preventDefault();
			generateNetlistFromSchematic();
		}
		// Ctrl+S to save schematic
		if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			saveSchematic();
		}
		// Ctrl+O to open schematic
		if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
			e.preventDefault();
			openSchematicDialog();
		}
	}

	/** Save schematic to JSON file */
	function saveSchematic() {
		if (schematic.components.length === 0 && schematic.wires.length === 0) {
			status = 'Nothing to save';
			return;
		}

		// Create a clean copy without nodeLabels (they're regenerated)
		const saveData = {
			version: 1,
			schematic: {
				components: schematic.components,
				wires: schematic.wires,
				junctions: schematic.junctions,
				directives: schematic.directives,
				parameters: schematic.parameters,
				models: schematic.models,
				comments: schematic.comments
			},
			netlist: netlistInput,
			savedAt: new Date().toISOString()
		};

		const json = JSON.stringify(saveData, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = `schematic-${Date.now()}.json`;
		a.click();

		URL.revokeObjectURL(url);
		status = `Saved schematic: ${schematic.components.length} components, ${schematic.wires.length} wires`;
	}

	/** Open file dialog to load schematic */
	function openSchematicDialog() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (file) {
				loadSchematicFile(file);
			}
		};
		input.click();
	}

	/** Load schematic from file */
	async function loadSchematicFile(file: File) {
		try {
			const text = await file.text();
			const data = JSON.parse(text);

			if (!data.schematic) {
				status = 'Invalid schematic file: missing schematic data';
				return;
			}

			// Load schematic including directives, parameters, and models
			schematic = {
				components: data.schematic.components || [],
				wires: data.schematic.wires || [],
				junctions: data.schematic.junctions || [],
				directives: data.schematic.directives || [],
				parameters: data.schematic.parameters || {},
				models: data.schematic.models || [],
				comments: data.schematic.comments || []
			};

			// Load netlist if present
			if (data.netlist) {
				netlistInput = data.netlist;
			}

			// Clear probes and old ratings results
			probes = [];
			stressReport = null;
			fitRequest++;

			status = `Loaded: ${schematic.components.length} components, ${schematic.wires.length} wires`;
			showLanding = false;
		} catch (err) {
			status = `Failed to load schematic: ${err}`;
		}
	}

	/** Handle new project from landing page */
	function handleNewProject() {
		showLanding = false;
		status = 'NGSpice ready';
	}

	/** Handle open file from landing page */
	function handleOpenFile() {
		openSchematicDialog();
	}

	/** Return to landing page */
	function returnToLanding() {
		// Clear current work
		schematic = { components: [], wires: [], junctions: [], directives: [], parameters: {}, models: [], comments: [] };
		probes = [];
		simResult = null;
		stressReport = null;
		timeData = [];
		waveformTabs = [{ id: 'default', name: 'Plot 1', traces: [] }];
		activeTabId = 'default';
		netlistInput = `* Minimal RC Circuit Test
R1 in out 1k
C1 out 0 1u
Vin in 0 PULSE(0 5 0 1n 1n 0.5m 1m)
.tran 1u 5m
.end`;
		showLanding = true;
		status = 'NGSpice ready';
	}

	/** Handle load example from landing page */
	async function handleLoadExample(example: { id: string; name: string; schematicFile: string; netlistFile: string | null }) {
		try {
			status = `Loading ${example.name}...`;

			// Load schematic JSON
			const schematicResponse = await fetch(`${base}${example.schematicFile}`);
			if (!schematicResponse.ok) {
				throw new Error(`Failed to load schematic: ${schematicResponse.statusText}`);
			}
			const schematicData = await schematicResponse.json();

			// Results from a previous circuit don't apply to this one
			stressReport = null;

			// Update state with defaults for directive fields
			schematic = {
				components: schematicData.schematic.components || [],
				wires: schematicData.schematic.wires || [],
				junctions: schematicData.schematic.junctions || [],
				directives: schematicData.schematic.directives || [],
				parameters: schematicData.schematic.parameters || {},
				models: schematicData.schematic.models || [],
				comments: schematicData.schematic.comments || []
			};

			// Load netlist from file, or use embedded netlist, or generate from schematic
			if (example.netlistFile) {
				const netlistResponse = await fetch(`${base}${example.netlistFile}`);
				if (!netlistResponse.ok) {
					throw new Error(`Failed to load netlist: ${netlistResponse.statusText}`);
				}
				netlistInput = await netlistResponse.text();
			} else if (schematicData.netlist) {
				// Use netlist embedded in schematic JSON
				netlistInput = schematicData.netlist;
			} else {
				// Generate netlist from schematic
				generateNetlistFromSchematic();
			}

			showLanding = false;
			fitRequest++;
			status = `Loaded example: ${example.name}`;
		} catch (err) {
			status = `Failed to load example: ${err}`;
		}
	}

	/** Handle double-click on component to open edit modal */
	function handleEditComponent(component: Component) {
		editingComponent = component;
		showComponentEdit = true;
	}

	/** Text comment editing */
	let editingComment = $state<TextComment | null>(null);
	let editingCommentIsNew = $state(false);
	let showCommentEdit = $state(false);

	function handleEditComment(comment: TextComment, isNew: boolean) {
		editingComment = comment;
		editingCommentIsNew = isNew;
		showCommentEdit = true;
	}

	function handleSaveComment(comment: TextComment) {
		const comments = schematic.comments ?? [];
		schematic = {
			...schematic,
			comments: comments.some(c => c.id === comment.id)
				? comments.map(c => (c.id === comment.id ? comment : c))
				: [...comments, comment]
		};
	}

	function handleDeleteComment(comment: TextComment) {
		schematic = {
			...schematic,
			comments: (schematic.comments ?? []).filter(c => c.id !== comment.id)
		};
	}

	/** Handle saving component edits */
	function handleSaveComponent(updatedComponent: Component) {
		schematic = {
			...schematic,
			components: schematic.components.map(c =>
				c.id === updatedComponent.id ? updatedComponent : c
			)
		};
		status = `Updated component: ${updatedComponent.attributes.InstName || updatedComponent.type}`;
	}
</script>

<svelte:head>
	<title>WebSpice</title>
</svelte:head>

<svelte:window onkeydown={handleKeyDown} />

<div class="app">
	{#if showLanding}
		<LandingPage
			onnewproject={handleNewProject}
			onopenfile={handleOpenFile}
			onloadexample={handleLoadExample}
		/>
	{:else}
		<header class="toolbar">
			<span class="app-title" onclick={returnToLanding} title="Return to landing page" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && returnToLanding()}>WebSpice</span>
			<MenuBar {menus} />
			{#if getTotalTraceCount() > 0}
				<span class="trace-count">{getTotalTraceCount()} traces</span>
			{/if}
			<div class="toolbar-spacer"></div>
			<button class="help-btn" onclick={() => showHelp = true} title="Show keyboard shortcuts (H)">
				?
			</button>
		</header>
		<main class="workspace">
		<ResizablePanel title="Netlist" direction="horizontal" initialSize={300} minSize={200} bind:collapsed={netlistCollapsed}>
			<div class="panel-fill">
				<NetlistEditor bind:value={netlistInput} />
			</div>
		</ResizablePanel>
		<div class="right-panel">
			<ResizablePanel title="Schematic" direction="vertical" fill>
				{#snippet titleActions()}
					<IconButton
						icon="probe"
						label="Voltage probe (P)"
						description="Click a wire or component pin to plot its voltage. Click and drag from one node to another to plot the difference: red (+) where you press, black (-) where you release. Esc to stop."
						active={schematicMode === 'probe'}
						onclick={() => schematicCanvas?.toggleProbeMode()}
					/>
				{/snippet}
				{#snippet headerActions()}
					<button class="panel-action-btn" onclick={() => showDirectives = true} title="Edit SPICE directives">
						Directives
					</button>
				{/snippet}
				<div class="panel-fill dark">
					<SchematicCanvas bind:this={schematicCanvas} bind:schematic {stressScores} {fitRequest} onmodechange={(m) => schematicMode = m} onprobe={handleProbe} oneditcomponent={handleEditComponent} oneditdirectives={() => showDirectives = true} oneditcomment={handleEditComment} />
				</div>
			</ResizablePanel>
			<BottomDock tabs={dockTabs} bind:active={dockTab} bind:open={dockOpen} bind:height={dockHeight}>
				{#snippet actions(tab)}
					{#if tab === 'waveform'}
						<IconButton
							icon="reset"
							label="Clear plot"
							description="Removes all probes and traces and resets to a single empty plot tab. Simulation results are kept, so you can probe again without re-running."
							onclick={clearPlot}
							disabled={probes.length === 0 && getTotalTraceCount() === 0 && waveformTabs.length === 1}
						/>
					{/if}
				{/snippet}
				{#snippet children(tab)}
					{#if tab === 'waveform'}
						<div class="panel-fill dark">
							<TabbedWaveformViewer
								bind:tabs={waveformTabs}
								bind:activeTabId={activeTabId}
								{timeData}
								ondeletetrace={handleDeleteTrace}
							/>
						</div>
					{:else}
						<div class="info-panel">
							<div class="result-info">
							{#if stressReport && stressReport.parts.length > 0}
								<div class="ratings">
									<div class="ratings-title">
										Part ratings check
										<span class="ratings-key">0 = lots of headroom, 10 = at the limit, 11 = over</span>
									</div>
									<table>
										<tbody>
											{#each stressReport.parts as part}
												<tr class="part-row">
													<td><span class="score-badge" style="background: {scoreColor(part.score)}">{part.score}</span></td>
													<td colspan="4">
														<strong>{part.instName}</strong> {part.part}: {scoreLabel(part.score)}
														{#if part.tjEstimate !== undefined}
															<span class="tj">(junction about {Math.round(part.tjEstimate)} °C of {part.tjMax} °C max, at 25 °C ambient)</span>
														{/if}
													</td>
												</tr>
												{#each part.items as item}
													<tr title={item.note}>
														<td><span class="score-badge small" style="background: {scoreColor(item.score)}">{item.score}</span></td>
														<td>{item.label}</td>
														<td class="num">{formatSI(item.value, item.unit)} / {formatSI(item.limit, item.unit)}</td>
														<td class="num">{Math.round(item.ratio * 100)}%</td>
														<td class="bar-cell">
															<div class="bar"><div class="bar-fill" style="width: {Math.min(100, item.ratio * 100)}%; background: {scoreColor(item.score)}"></div></div>
														</td>
													</tr>
												{/each}
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
							{#if simInitInfo}
								<pre class="init-info">{simInitInfo}</pre>
							{/if}
							{#if simResult}
								<p><strong>Variables:</strong> {simResult.variableNames.join(', ')}</p>
								<p><strong>Points:</strong> {simResult.numPoints}</p>
							{/if}
						</div>
						</div>
					{/if}
				{/snippet}
			</BottomDock>
		</div>
	</main>
	<footer class="statusbar">
		<span>{status}</span>
		<a href="https://github.com/jwt625/WebSpice" target="_blank" rel="noopener noreferrer" class="github-link" title="View on GitHub">
			<svg viewBox="0 0 24 24" fill="currentColor" class="github-icon">
				<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
			</svg>
		</a>
	</footer>

	<HelpModal bind:visible={showHelp} />
	<DirectiveModal
		bind:visible={showDirectives}
		bind:parameters={schematic.parameters}
		bind:models={schematic.models}
		bind:directives={schematic.directives}
	/>
	<CommentEditModal
		bind:visible={showCommentEdit}
		comment={editingComment}
		isNew={editingCommentIsNew}
		onsave={handleSaveComment}
		ondelete={handleDeleteComment}
	/>
	<ComponentEditModal
		bind:visible={showComponentEdit}
		bind:component={editingComponent}
		models={schematic.models}
		onsave={handleSaveComponent}
	/>
	{/if}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

	.toolbar {
		background: var(--toolbar-bg);
		border-bottom: 1px solid var(--border-primary);
		padding: var(--spacing-sm) var(--spacing-md);
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		height: 40px;
	}

	.toolbar button {
		background: var(--btn-primary-bg);
		color: var(--text-primary);
		border: none;
		padding: var(--spacing-xs) var(--spacing-md);
		border-radius: 3px;
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.toolbar button:hover:not(:disabled) {
		background: var(--btn-primary-hover);
	}

	.toolbar button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.app-title {
		font-weight: 600;
		color: var(--text-primary);
		cursor: pointer;
	}

	.app-title:hover {
		opacity: 0.8;
	}

	.toolbar-spacer {
		flex: 1;
	}

	.trace-count {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	.help-btn {
		background: var(--accent-blue) !important;
		color: white !important;
		font-weight: bold;
		font-size: 16px;
		width: 28px;
		height: 28px;
		padding: 0 !important;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
	}

	.help-btn:hover:not(:disabled) {
		background: var(--accent-green) !important;
	}

	.panel-action-btn {
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		color: var(--text-secondary);
		cursor: pointer;
		padding: 2px 8px;
		font-size: 11px;
		border-radius: 3px;
	}

	.panel-action-btn:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.workspace {
		flex: 1;
		display: flex;
		flex-direction: row;
		overflow: hidden;
	}

	.right-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.panel-fill {
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.panel-fill.dark {
		background: #1a1a1a;
		position: relative;
	}

	.info-panel {
		flex: 1;
		min-height: 0;
		background: var(--bg-secondary);
		overflow: auto;
	}

	.result-info {
		padding: var(--spacing-sm) var(--spacing-md);
		overflow: auto;
	}

	.result-info p {
		margin: var(--spacing-xs) 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	.ratings {
		margin-bottom: var(--spacing-sm);
		font-size: var(--font-size-sm);
		color: var(--text-primary);
	}

	.ratings-title {
		font-weight: 600;
		margin-bottom: var(--spacing-xs);
	}

	.ratings-key {
		font-weight: normal;
		color: var(--text-secondary);
		margin-left: var(--spacing-sm);
		font-size: var(--font-size-xs);
	}

	.ratings table {
		border-collapse: collapse;
		width: 100%;
		max-width: 640px;
	}

	.ratings td {
		padding: 2px 6px;
		vertical-align: middle;
	}

	.ratings .part-row td {
		padding-top: 6px;
	}

	.ratings .num {
		text-align: right;
		font-family: var(--font-mono);
		white-space: nowrap;
	}

	.ratings .tj {
		color: var(--text-secondary);
		margin-left: var(--spacing-xs);
	}

	.score-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		padding: 0 4px;
		border-radius: 11px;
		color: #000;
		font-weight: 700;
		font-size: 12px;
		box-sizing: border-box;
	}

	.score-badge.small {
		min-width: 18px;
		height: 18px;
		font-size: 11px;
	}

	.bar-cell {
		width: 40%;
	}

	.bar {
		height: 8px;
		background: var(--bg-tertiary);
		border-radius: 4px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
	}

	.result-info .init-info {
		margin: 0 0 var(--spacing-sm) 0;
		padding: var(--spacing-xs);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		background: var(--bg-tertiary);
		border-radius: 3px;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 120px;
		overflow-y: auto;
	}

	.statusbar {
		background: var(--statusbar-bg);
		color: var(--statusbar-text);
		padding: var(--spacing-xs) var(--spacing-md);
		font-size: var(--font-size-sm);
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
	}

	.statusbar .github-link {
		display: flex;
		align-items: center;
		color: var(--statusbar-text);
		text-decoration: none;
		opacity: 0.7;
		transition: opacity 0.2s ease;
	}

	.statusbar .github-link:hover {
		opacity: 1;
	}

	.statusbar .github-icon {
		width: 16px;
		height: 16px;
	}
</style>
