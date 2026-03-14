/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-next-line
// Story Monitor extension — Live narrative event dashboard
// Implements: mia-vscode/rispecs/extensions/04-story-monitor.spec.md
const vscode = require('vscode');

let miaApi = null;
let sessionExplorerProvider = null;

// allow-any-unicode-next-line
// ─── Session State ──────────────────────────────────────────────

const sessionState = {
	id: generateId(),
	intent: '',
// allow-any-unicode-next-line
	phase: 'germination', // germination → assimilation → completion
	startTime: Date.now(),
	beatCount: 0,
	coherence: { engineer: 0.5, ceremony: 0.5, story: 0.5 },
	beats: [],
	events: [],
// allow-any-unicode-next-line
	// Medicine Wheel direction tracking: 🌅 East, 🔥 South, 🌊 West, ❄️ North
	medicineWheelDirection: 'east',
	directionCounts: { east: 0, south: 0, west: 0, north: 0 },
	directionBeats: { east: [], south: [], west: [], north: [] },
	// STC chart progress tracking
	chartProgress: { total: 0, completed: 0, percentage: 0 },
};

const MAX_EVENTS = 500;
const recentSessions = []; // { id, intent, phase, startTime, endTime, beatCount }

// allow-any-unicode-next-line
// ─── Medicine Wheel Direction Constants ─────────────────────────
const MEDICINE_WHEEL = {
// allow-any-unicode-next-line
	east:  { icon: '🌅', label: 'East — Vision/Inquiry',   color: '#F59E0B' },
// allow-any-unicode-next-line
	south: { icon: '🔥', label: 'South — Analysis/Growth',  color: '#EF4444' },
// allow-any-unicode-next-line
	west:  { icon: '🌊', label: 'West — Reflection/Validation', color: '#3B82F6' },
// allow-any-unicode-next-line
	north: { icon: '❄️', label: 'North — Action/Wisdom',    color: '#8B5CF6' },
};

// allow-any-unicode-next-line
// ─── Dashboard Panel ────────────────────────────────────────────

let dashboardPanel = null;

function activate(context) {
	const coreExt = vscode.extensions.getExtension('mia.three-universe');
	if (coreExt) {
		miaApi = coreExt.exports;
	}

	sessionExplorerProvider = new SessionExplorerProvider();
	vscode.window.registerTreeDataProvider('mia.sessionExplorer', sessionExplorerProvider);

// allow-any-unicode-next-line
	// ─── Subscribe to narrative events ──────────────────────────
	if (miaApi) {
		miaApi.onNarrativeEvent((event) => {
			processEvent(event);
		});
	}

// allow-any-unicode-next-line
	// ─── Ambient Status Bar ─────────────────────────────────────
	const phaseStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 36);
	phaseStatusBar.command = 'mia.storyMonitor.open';
	context.subscriptions.push(phaseStatusBar);

	const beatCountBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 35);
	beatCountBar.command = 'mia.storyMonitor.logBeat';
	context.subscriptions.push(beatCountBar);

	const medicineWheelBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 34);
	medicineWheelBar.command = 'mia.storyMonitor.open';
	context.subscriptions.push(medicineWheelBar);

	function updateAmbientBars() {
		const config = vscode.workspace.getConfiguration('mia');
		const ambient = config.get('storyMonitor.ambient', false);

		if (ambient) {
			const elapsed = formatElapsed(Date.now() - sessionState.startTime);
// allow-any-unicode-next-line
			const phaseIcon = { germination: '🌱', assimilation: '🔄', completion: '✨' }[sessionState.phase] || '📖';
			const mwDir = sessionState.medicineWheelDirection;
			const mwInfo = MEDICINE_WHEEL[mwDir];
			phaseStatusBar.text = `${mwInfo.icon} ${mwInfo.label} ${elapsed}`;
			phaseStatusBar.tooltip = `Medicine Wheel: ${mwInfo.label}\nSession Phase: ${phaseIcon} ${sessionState.phase}\nIntent: ${sessionState.intent || 'No intent set'}\nElapsed: ${elapsed}`;
			phaseStatusBar.show();

			beatCountBar.text = `$(pulse) ${sessionState.beatCount} beats`;
			beatCountBar.tooltip = 'Click to log a new beat';
			beatCountBar.show();

			// Show Medicine Wheel direction bar
			if (medicineWheelBar) {
				const dc = sessionState.directionCounts;
// allow-any-unicode-next-line
				medicineWheelBar.text = `🌅${dc.east} 🔥${dc.south} 🌊${dc.west} ❄️${dc.north}`;
				// allow-any-unicode-next-line
				medicineWheelBar.tooltip = `Medicine Wheel Beat Counts\n🌅 East (Vision): ${dc.east}\n🔥 South (Growth): ${dc.south}\n🌊 West (Reflection): ${dc.west}\n❄️ North (Wisdom): ${dc.north}`;
				medicineWheelBar.show();
			}
		} else {
			phaseStatusBar.hide();
			beatCountBar.hide();
			if (medicineWheelBar) { medicineWheelBar.hide(); }
		}
	}

	updateAmbientBars();

	// Refresh ambient bars every 30 seconds
	const ambientInterval = setInterval(updateAmbientBars, 30000);
	context.subscriptions.push({ dispose: () => clearInterval(ambientInterval) });

	vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('mia.storyMonitor.ambient')) {
			updateAmbientBars();
		}
	});

// allow-any-unicode-next-line
	// ─── PDE File Watcher (Vision Beats — 🌅 East) ────────────
	const pdeWatcher = vscode.workspace.createFileSystemWatcher('**/.pde/*.json');
	pdeWatcher.onDidCreate(async (uri) => {
		try {
			const raw = await vscode.workspace.fs.readFile(uri);
			const pdeData = JSON.parse(Buffer.from(raw).toString('utf8'));
			const primaryIntent = pdeData.result?.primaryIntent || pdeData.primaryIntent || 'PDE decomposition';
			const confidence = pdeData.result?.confidence || pdeData.confidence || 0;
			const fileName = uri.path.split('/').pop();

			const beat = {
				id: generateId(),
				type: 'pde.decomposition',
// allow-any-unicode-next-line
				description: `🌅 Vision Beat: ${primaryIntent}`,
				timestamp: new Date().toISOString(),
				significance: confidence >= 0.8 ? 3 : 2,
				universe: 'ceremony',
				direction: 'east',
				confidence,
				source: fileName,
			};

			sessionState.beats.push(beat);
			sessionState.beatCount++;
			sessionState.directionCounts.east++;
			sessionState.directionBeats.east.push(beat);
			updateMedicineWheelDirection('east');
			processEvent({ type: 'pde.decomposition', payload: beat, timestamp: beat.timestamp, universe: 'ceremony', significance: beat.significance });
			updateAmbientBars();
			persistSession();
		} catch { /* PDE file parse failed silently */ }
	});
	context.subscriptions.push(pdeWatcher);

// allow-any-unicode-next-line
	// ─── COAIA File Watcher (Advancement Beats — ❄️ North) ────
	const coaiaWatcher = vscode.workspace.createFileSystemWatcher('**/.coaia/**/*.jsonl');
	const coaiaPdeWatcher = vscode.workspace.createFileSystemWatcher('**/.coaia/pde/*.jsonl');

	function handleCoaiaChange(uri) {
		readCoaiaFile(uri).then(chartData => {
			if (!chartData) { return; }

			// Track chart progress
			const actions = chartData.actions || [];
			const completed = actions.filter(a => a.status === 'complete' || a.completed).length;
			const total = actions.length || 1;
			const percentage = Math.round((completed / total) * 100);

			const prevCompleted = sessionState.chartProgress.completed;
			sessionState.chartProgress = { total, completed, percentage };

			// Fire advancement beat when new action steps complete
			if (completed > prevCompleted) {
				const beat = {
					id: generateId(),
					type: 'stc.advancement',
// allow-any-unicode-next-line
					description: `❄️ Advancement: ${completed}/${total} actions complete (${percentage}%)`,
					timestamp: new Date().toISOString(),
					significance: percentage === 100 ? 4 : 2,
					universe: 'engineer',
					direction: 'north',
					chartProgress: percentage,
				};

				sessionState.beats.push(beat);
				sessionState.beatCount++;
				sessionState.directionCounts.north++;
				sessionState.directionBeats.north.push(beat);
				updateMedicineWheelDirection('north');
				processEvent({ type: 'stc.advancement', payload: beat, timestamp: beat.timestamp, universe: 'engineer', significance: beat.significance });
				updateAmbientBars();
				persistSession();
			}

			sendDashboardUpdate();
		}).catch(() => { /* COAIA parse failed silently */ });
	}

	coaiaWatcher.onDidChange(handleCoaiaChange);
	coaiaWatcher.onDidCreate(handleCoaiaChange);
	coaiaPdeWatcher.onDidChange(handleCoaiaChange);
	coaiaPdeWatcher.onDidCreate(handleCoaiaChange);
	context.subscriptions.push(coaiaWatcher, coaiaPdeWatcher);

// allow-any-unicode-next-line
	// ─── Commands ───────────────────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand('mia.storyMonitor.open', () => {
			openDashboard(context);
		}),
		vscode.commands.registerCommand('mia.storyMonitor.toggleAmbient', async () => {
			const config = vscode.workspace.getConfiguration('mia');
			const current = config.get('storyMonitor.ambient', false);
			await config.update('storyMonitor.ambient', !current, vscode.ConfigurationTarget.Global);
			updateAmbientBars();
			vscode.window.showInformationMessage(`Ambient story mode: ${!current ? 'ON' : 'OFF'}`);
		}),
		vscode.commands.registerCommand('mia.storyMonitor.logBeat', async () => {
			const description = await vscode.window.showInputBox({
				prompt: 'What just happened?',
				placeHolder: 'Describe the narrative beat...'
			});
			if (!description) { return; }

			const type = await vscode.window.showQuickPick(
				[
// allow-any-unicode-next-line
					{ label: '🔧 Engineering', value: 'engineering', description: 'Technical milestone or decision' },
// allow-any-unicode-next-line
					{ label: '🌿 Relational', value: 'relational', description: 'Relational shift or accountability moment' },
// allow-any-unicode-next-line
					{ label: '📖 Narrative', value: 'narrative', description: 'Story development or insight' },
// allow-any-unicode-next-line
					{ label: '🔄 Transition', value: 'transition', description: 'Phase transition or pivot' },
// allow-any-unicode-next-line
					{ label: '⭐ Milestone', value: 'milestone', description: 'Major achievement or completion' },
// allow-any-unicode-next-line
					{ label: '🌅 Vision (East)', value: 'vision', description: 'PDE decomposition or inquiry' },
// allow-any-unicode-next-line
					{ label: '🔥 Growth (South)', value: 'growth', description: 'Deep search or research' },
// allow-any-unicode-next-line
					{ label: '🌊 Reflection (West)', value: 'reflection', description: 'Review or validation' },
// allow-any-unicode-next-line
					{ label: '❄️ Wisdom (North)', value: 'wisdom', description: 'Execution or integration' },
				],
				{ placeHolder: 'Beat type' }
			);
			if (!type) { return; }

			const directionMap = { vision: 'east', growth: 'south', reflection: 'west', wisdom: 'north' };
			const beatDirection = directionMap[type.value] || null;

			const beat = {
				id: generateId(),
				type: type.value,
				description,
				timestamp: new Date().toISOString(),
				significance: type.value === 'milestone' ? 4 : 2,
				universe: type.value === 'engineering' ? 'engineer' : type.value === 'relational' ? 'ceremony' : 'story',
				direction: beatDirection,
			};

			sessionState.beats.push(beat);
			sessionState.beatCount++;

			// Track direction if this is a Medicine Wheel beat
			if (beatDirection) {
				sessionState.directionCounts[beatDirection]++;
				sessionState.directionBeats[beatDirection].push(beat);
				updateMedicineWheelDirection(beatDirection);
			}

			processEvent({ type: 'beat.created', payload: beat, timestamp: beat.timestamp, universe: beat.universe, significance: beat.significance });

			// Send to server if connected
			if (miaApi && miaApi.isConnected()) {
				try {
					const httpClient = miaApi.getHttpClient();
					if (httpClient) { await httpClient.createBeat(beat); }
				} catch { /* local beat succeeded */ }
			}

			updateAmbientBars();
			persistSession();
			vscode.window.showInformationMessage(`Beat logged: ${description}`);
		}),
		vscode.commands.registerCommand('mia.storyMonitor.setIntent', async () => {
			const intent = await vscode.window.showInputBox({
				prompt: 'Session intent',
				placeHolder: 'What are you working toward?',
				value: sessionState.intent,
			});
			if (intent !== undefined) {
				sessionState.intent = intent;
				sessionExplorerProvider.refresh();
				updateAmbientBars();
				sendDashboardUpdate();
			}
		}),
		vscode.commands.registerCommand('mia.storyMonitor.endSession', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'End current session and start a new one?',
				{ modal: true }, 'End Session'
			);
			if (confirm !== 'End Session') { return; }

			// Archive current session
			recentSessions.unshift({
				id: sessionState.id,
				intent: sessionState.intent,
				phase: sessionState.phase,
				startTime: sessionState.startTime,
				endTime: Date.now(),
				beatCount: sessionState.beatCount,
			});
			if (recentSessions.length > 10) { recentSessions.pop(); }

			// Start new session
			sessionState.id = generateId();
			sessionState.intent = '';
			sessionState.phase = 'germination';
			sessionState.startTime = Date.now();
			sessionState.beatCount = 0;
			sessionState.beats = [];
			sessionState.events = [];
			sessionState.coherence = { engineer: 0.5, ceremony: 0.5, story: 0.5 };
			sessionState.medicineWheelDirection = 'east';
			sessionState.directionCounts = { east: 0, south: 0, west: 0, north: 0 };
			sessionState.directionBeats = { east: [], south: [], west: [], north: [] };
			sessionState.chartProgress = { total: 0, completed: 0, percentage: 0 };

			sessionExplorerProvider.refresh();
			updateAmbientBars();
			sendDashboardUpdate();
			vscode.window.showInformationMessage('New session started');
		}),
		vscode.commands.registerCommand('mia.storyMonitor.exportSession', async () => {
			await exportSessionNarrative();
		}),
		// Phase transition (internal use or from server events)
		vscode.commands.registerCommand('mia.storyMonitor.setPhase', (phase) => {
			if (['germination', 'assimilation', 'completion'].includes(phase)) {
				sessionState.phase = phase;
				processEvent({ type: 'session.phase', payload: { phase }, timestamp: new Date().toISOString() });
				sessionExplorerProvider.refresh();
				updateAmbientBars();
			}
		}),
	);

	// Track file activity for automatic phase detection
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(() => {
			// Heuristic: after 5 saves and still in germination, suggest assimilation
			if (sessionState.phase === 'germination' && sessionState.beatCount >= 3) {
				sessionState.phase = 'assimilation';
				processEvent({ type: 'session.phase', payload: { phase: 'assimilation' }, timestamp: new Date().toISOString() });
				updateAmbientBars();
				sessionExplorerProvider.refresh();
			}
		})
	);
}

function deactivate() {
	if (dashboardPanel) { dashboardPanel.dispose(); }
}

// allow-any-unicode-next-line
// ─── Event Processing ───────────────────────────────────────────

function processEvent(event) {
	const enriched = {
		...event,
		timestamp: event.timestamp || new Date().toISOString(),
		universe: event.universe || guessUniverse(event),
		significance: event.significance || 1,
	};

	sessionState.events.unshift(enriched);
	if (sessionState.events.length > MAX_EVENTS) { sessionState.events.pop(); }

	// Update coherence based on event universe
	if (enriched.universe && sessionState.coherence[enriched.universe] !== undefined) {
		const delta = 0.05 * (enriched.significance || 1);
		sessionState.coherence[enriched.universe] = Math.min(1, sessionState.coherence[enriched.universe] + delta);
		// Decay others slightly
		for (const u of ['engineer', 'ceremony', 'story']) {
			if (u !== enriched.universe) {
				sessionState.coherence[u] = Math.max(0, sessionState.coherence[u] - 0.01);
			}
		}
	}

	sessionExplorerProvider?.refresh();
	sendDashboardUpdate();

	// Ambient notification for high-significance beats
	const config = vscode.workspace.getConfiguration('mia');
	if (config.get('storyMonitor.ambient', false) && enriched.significance >= 4) {
// allow-any-unicode-next-line
		const icon = { engineer: '🔧', ceremony: '🌿', story: '📖' }[enriched.universe] || '📌';
		vscode.window.showInformationMessage(`${icon} High-significance event: ${enriched.payload?.description || enriched.type}`);
	}
}

function guessUniverse(event) {
	if (event.type?.includes('analysis') || event.type?.includes('stc.')) { return 'engineer'; }
	if (event.type?.includes('pde.')) { return 'ceremony'; }
	if (event.type?.includes('beat') || event.type?.includes('story')) { return 'story'; }
	if (event.type?.includes('coherence') || event.type?.includes('ceremony')) { return 'ceremony'; }
	return 'story';
}

// allow-any-unicode-next-line
// ─── Session Explorer Tree ──────────────────────────────────────

class SessionExplorerProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	refresh() { this._onDidChangeTreeData.fire(); }

	getTreeItem(element) { return element; }

	getChildren(element) {
		if (!element) {
			const items = [];

			// Active session
// allow-any-unicode-next-line
			const phaseIcon = { germination: '🌱', assimilation: '🔄', completion: '✨' }[sessionState.phase] || '📖';
			const elapsed = formatElapsed(Date.now() - sessionState.startTime);
// allow-any-unicode-next-line
			const activeLabel = `${phaseIcon} Active Session — ${elapsed}`;
			const active = new vscode.TreeItem(activeLabel, vscode.TreeItemCollapsibleState.Expanded);
			active.contextValue = 'activeSession';
			active.description = sessionState.intent || 'No intent set';
			active.tooltip = `Phase: ${sessionState.phase}\nBeats: ${sessionState.beatCount}\nStarted: ${new Date(sessionState.startTime).toLocaleTimeString()}`;
			items.push(active);

			// Recent sessions
			if (recentSessions.length > 0) {
// allow-any-unicode-next-line
				const recent = new vscode.TreeItem('📚 Recent Sessions', vscode.TreeItemCollapsibleState.Collapsed);
				recent.contextValue = 'recentSessions';
				items.push(recent);
			}

			return items;
		}

		// Children of active session
		if (element.contextValue === 'activeSession') {
			const items = [];

// allow-any-unicode-next-line
			const intent = new vscode.TreeItem(`💭 ${sessionState.intent || 'Set intent...'}`, vscode.TreeItemCollapsibleState.None);
			intent.command = { command: 'mia.storyMonitor.setIntent', title: 'Set Intent' };
			intent.tooltip = 'Click to set session intent';
			items.push(intent);

			const phase = new vscode.TreeItem(`Phase: ${sessionState.phase}`, vscode.TreeItemCollapsibleState.None);
// allow-any-unicode-next-line
			phase.tooltip = 'germination → assimilation → completion';
			items.push(phase);

			// Medicine Wheel direction
			const mwDir = sessionState.medicineWheelDirection;
			const mwInfo = MEDICINE_WHEEL[mwDir];
			const mwItem = new vscode.TreeItem(`${mwInfo.icon} ${mwInfo.label}`, vscode.TreeItemCollapsibleState.None);
			const dc = sessionState.directionCounts;
// allow-any-unicode-next-line
			mwItem.tooltip = `Current Direction: ${mwInfo.label}\n🌅 East: ${dc.east}  🔥 South: ${dc.south}\n🌊 West: ${dc.west}  ❄️ North: ${dc.north}`;
			items.push(mwItem);

			// Chart progress
			if (sessionState.chartProgress.total > 0) {
				const cp = sessionState.chartProgress;
// allow-any-unicode-next-line
				const chartItem = new vscode.TreeItem(`📐 STC Chart: ${cp.percentage}% (${cp.completed}/${cp.total})`, vscode.TreeItemCollapsibleState.None);
				chartItem.tooltip = `Chart progress: ${cp.completed} of ${cp.total} action steps complete`;
				items.push(chartItem);
			}

			const beats = new vscode.TreeItem(`$(pulse) ${sessionState.beatCount} beats`, vscode.TreeItemCollapsibleState.Collapsed);
			beats.contextValue = 'beatList';
			items.push(beats);

			// Coherence summary
			const engPct = Math.round(sessionState.coherence.engineer * 100);
			const cerPct = Math.round(sessionState.coherence.ceremony * 100);
			const stoPct = Math.round(sessionState.coherence.story * 100);
// allow-any-unicode-next-line
			const coherence = new vscode.TreeItem(`🔧${engPct}% 🌿${cerPct}% 📖${stoPct}%`, vscode.TreeItemCollapsibleState.None);
			coherence.tooltip = 'Universe coherence scores';
			items.push(coherence);

			return items;
		}

		// Recent sessions children
		if (element.contextValue === 'recentSessions') {
			return recentSessions.map(s => {
				const elapsed = formatElapsed(s.endTime - s.startTime);
// allow-any-unicode-next-line
				const item = new vscode.TreeItem(`${s.intent || 'Untitled'} — ${elapsed}`, vscode.TreeItemCollapsibleState.None);
				item.description = `${s.beatCount} beats, ${s.phase}`;
				item.tooltip = `Started: ${new Date(s.startTime).toLocaleString()}\nEnded: ${new Date(s.endTime).toLocaleString()}`;
				return item;
			});
		}

		// Beat list children
		if (element.contextValue === 'beatList') {
			if (sessionState.beats.length === 0) {
// allow-any-unicode-next-line
				return [new vscode.TreeItem('No beats yet — click $(pulse) to log one', vscode.TreeItemCollapsibleState.None)];
			}
			return sessionState.beats.slice().reverse().slice(0, 20).map(b => {
// allow-any-unicode-next-line
				const icon = { engineer: '🔧', ceremony: '🌿', story: '📖' }[b.universe] || '📌';
// allow-any-unicode-next-line
				const sig = '●'.repeat(Math.min(b.significance || 1, 5));
				const item = new vscode.TreeItem(`${icon} ${b.description}`, vscode.TreeItemCollapsibleState.None);
				item.description = sig;
				item.tooltip = `Type: ${b.type}\nSignificance: ${b.significance}/5\nTime: ${b.timestamp}`;
				return item;
			});
		}

		return [];
	}
}

// allow-any-unicode-next-line
// ─── Dashboard Webview ──────────────────────────────────────────

function openDashboard(context) {
	if (dashboardPanel) {
		dashboardPanel.reveal();
		sendDashboardUpdate();
		return;
	}

	dashboardPanel = vscode.window.createWebviewPanel(
		'storyMonitor', 'Story Monitor', vscode.ViewColumn.Two,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	dashboardPanel.webview.html = getDashboardHtml(dashboardPanel.webview);

	dashboardPanel.webview.onDidReceiveMessage(async (msg) => {
		switch (msg.command) {
			case 'setIntent':
				vscode.commands.executeCommand('mia.storyMonitor.setIntent');
				break;
			case 'logBeat':
				vscode.commands.executeCommand('mia.storyMonitor.logBeat');
				break;
			case 'setPhase':
				if (msg.phase) { vscode.commands.executeCommand('mia.storyMonitor.setPhase', msg.phase); }
				break;
			case 'ready':
				sendDashboardUpdate();
				break;
		}
	}, undefined, context.subscriptions);

	dashboardPanel.onDidDispose(() => { dashboardPanel = null; }, null, context.subscriptions);

	// Send initial data after a short delay
	setTimeout(() => sendDashboardUpdate(), 200);
}

function sendDashboardUpdate() {
	if (!dashboardPanel) { return; }
	dashboardPanel.webview.postMessage({
		command: 'update',
		session: {
			id: sessionState.id,
			intent: sessionState.intent,
			phase: sessionState.phase,
			startTime: sessionState.startTime,
			beatCount: sessionState.beatCount,
			coherence: sessionState.coherence,
			medicineWheelDirection: sessionState.medicineWheelDirection,
			directionCounts: sessionState.directionCounts,
			chartProgress: sessionState.chartProgress,
		},
		events: sessionState.events.slice(0, 50),
		beats: sessionState.beats.slice().reverse().slice(0, 30),
	});
}

function getDashboardHtml(webview) {
	const nonce = getNonce();
	const cspSource = webview.cspSource;
	return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; overflow-y: auto; }
	h1 { color: #A78BFA; font-size: 1.4em; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
	h2 { color: #A9B1D6; font-size: 1em; margin: 20px 0 10px; display: flex; align-items: center; gap: 6px; }

	/* Session Header */
	.session-header { background: #1E1F2E; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
	.session-intent { color: #A9B1D6; font-style: italic; cursor: pointer; padding: 4px; border-radius: 4px; }
	.session-intent:hover { background: var(--vscode-list-hoverBackground); }
	.session-meta { display: flex; gap: 16px; margin-top: 8px; font-size: 0.85em; color: #565F89; }
	.phase-pills { display: flex; gap: 4px; margin-top: 8px; }
	.phase-pill { padding: 3px 10px; border-radius: 12px; font-size: 0.8em; border: 1px solid #363B54; cursor: pointer; transition: all 0.2s; }
	.phase-pill:hover { border-color: #A78BFA; }
	.phase-pill.active { background: #A78BFA33; border-color: #A78BFA; color: #A78BFA; }

	/* Medicine Wheel Indicator */
	.medicine-wheel { background: #1E1F2E; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
	.mw-compass { display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: auto auto auto; gap: 4px; text-align: center; max-width: 300px; margin: 0 auto 12px; }
	.mw-dir { padding: 8px 6px; border-radius: 6px; font-size: 0.85em; border: 1px solid #363B54; transition: all 0.3s; }
	.mw-dir.active { border-width: 2px; }
	.mw-dir.east { grid-column: 2; grid-row: 1; }
	.mw-dir.south { grid-column: 3; grid-row: 2; }
	.mw-dir.west { grid-column: 2; grid-row: 3; }
	.mw-dir.north { grid-column: 1; grid-row: 2; }
	.mw-dir.east.active { border-color: #F59E0B; background: #F59E0B18; color: #F59E0B; }
	.mw-dir.south.active { border-color: #EF4444; background: #EF444418; color: #EF4444; }
	.mw-dir.west.active { border-color: #3B82F6; background: #3B82F618; color: #3B82F6; }
	.mw-dir.north.active { border-color: #8B5CF6; background: #8B5CF618; color: #8B5CF6; }
	.mw-center { grid-column: 2; grid-row: 2; font-size: 1.2em; display: flex; align-items: center; justify-content: center; }
	.mw-counts { display: flex; gap: 16px; justify-content: center; font-size: 0.85em; color: #565F89; }
	.mw-count { display: flex; align-items: center; gap: 4px; }

	/* Chart Progress */
	.chart-progress { background: #1E1F2E; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
	.chart-bar { height: 8px; background: #363B54; border-radius: 4px; overflow: hidden; margin: 8px 0; }
	.chart-fill { height: 100%; background: linear-gradient(90deg, #4ADE80, #A78BFA); border-radius: 4px; transition: width 0.5s; }
	.chart-label { font-size: 0.85em; color: #565F89; }

	/* Gauges */
	.gauges { display: flex; gap: 24px; justify-content: center; margin: 16px 0; }
	.gauge { text-align: center; position: relative; }
	.gauge svg { width: 80px; height: 80px; }
	.gauge-bg { fill: none; stroke: #1E1F2E; stroke-width: 6; }
	.gauge-fg { fill: none; stroke-width: 6; stroke-linecap: round; transform: rotate(-90deg); transform-origin: center; transition: stroke-dashoffset 0.8s ease; }
	.gauge-text { font-size: 14px; fill: var(--vscode-foreground); text-anchor: middle; dominant-baseline: central; }
	.gauge-label { font-size: 0.8em; margin-top: 4px; }
	.eng { stroke: #4A9EFF; }
	.cer { stroke: #4ADE80; }
	.sto { stroke: #A78BFA; }

	/* Session Arc */
	.arc-container { background: #1E1F2E; border-radius: 8px; padding: 12px; margin: 12px 0; }
	.arc-bar { height: 6px; background: #363B54; border-radius: 3px; position: relative; overflow: hidden; }
	.arc-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
	.arc-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 0.75em; color: #565F89; }

	/* Event Feed */
	.event-feed { max-height: 300px; overflow-y: auto; }
	.event { display: flex; align-items: flex-start; gap: 8px; padding: 8px 4px; border-bottom: 1px solid #1E1F2E; font-size: 0.9em; transition: background 0.2s; }
	.event:hover { background: #1E1F2E; }
	.event-icon { font-size: 1.1em; flex-shrink: 0; }
	.event-sig { color: #E0AF68; font-size: 0.7em; flex-shrink: 0; min-width: 40px; }
	.event-desc { flex: 1; line-height: 1.4; }
	.event-time { color: #565F89; font-size: 0.8em; flex-shrink: 0; }
	.event.high { background: #A78BFA0A; border-left: 2px solid #A78BFA; }
	.empty { color: #565F89; font-style: italic; padding: 20px; text-align: center; }

	/* Direction Badge */
	.dir-badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.75em; margin-left: 4px; }
	.dir-badge.east { background: #F59E0B22; color: #F59E0B; border: 1px solid #F59E0B44; }
	.dir-badge.south { background: #EF444422; color: #EF4444; border: 1px solid #EF444444; }
	.dir-badge.west { background: #3B82F622; color: #3B82F6; border: 1px solid #3B82F644; }
	.dir-badge.north { background: #8B5CF622; color: #8B5CF6; border: 1px solid #8B5CF644; }

	/* Recent Beats */
	.recent-beats { max-height: 300px; overflow-y: auto; }
	.beat-item { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid #1E1F2E; font-size: 0.88em; }
	.beat-item:hover { background: #1E1F2E; }
	.beat-desc { flex: 1; line-height: 1.3; }
	.beat-time { color: #565F89; font-size: 0.8em; flex-shrink: 0; }

	/* Beat Log Button */
	.log-beat-btn { background: #A78BFA33; border: 1px solid #A78BFA; color: #A78BFA; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 0.9em; margin: 8px 0; }
	.log-beat-btn:hover { background: #A78BFA55; }

	/* Animations */
	@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
	.pulsing { animation: pulse 2s infinite; }
</style>
</head><body>
	<h1>&#x1F4D6; Story Monitor</h1>

	<div class="session-header">
		<div class="session-intent" onclick="setIntent()" id="intent">Loading...</div>
		<div class="session-meta">
			<span id="elapsed">&mdash;</span>
			<span id="beat-count">0 beats</span>
			<span id="phase-display">germination</span>
		</div>
		<div class="phase-pills">
			<span class="phase-pill" data-phase="germination" onclick="setPhase('germination')">&#x1F331; Germination</span>
			<span class="phase-pill" data-phase="assimilation" onclick="setPhase('assimilation')">&#x1F504; Assimilation</span>
			<span class="phase-pill" data-phase="completion" onclick="setPhase('completion')">&#x2728; Completion</span>
		</div>
	</div>

	<h2>Medicine Wheel</h2>
	<div class="medicine-wheel">
		<div class="mw-compass">
			<div class="mw-dir east" id="mw-east">&#x1F305; East<br><small>Vision</small><br><span class="mw-beat-num" id="mw-east-n">0</span></div>
			<div class="mw-dir north" id="mw-north">&#x2744;&#xFE0F; North<br><small>Wisdom</small><br><span class="mw-beat-num" id="mw-north-n">0</span></div>
			<div class="mw-center" id="mw-center">&#x1F305;</div>
			<div class="mw-dir south" id="mw-south">&#x1F525; South<br><small>Growth</small><br><span class="mw-beat-num" id="mw-south-n">0</span></div>
			<div class="mw-dir west" id="mw-west">&#x1F30A; West<br><small>Reflect</small><br><span class="mw-beat-num" id="mw-west-n">0</span></div>
		</div>
		<div class="mw-counts">
			<span class="mw-count" id="mw-total">Total beats by direction: 0</span>
		</div>
	</div>

	<div class="chart-progress" id="chart-section" style="display:none;">
		<h2 style="margin:0 0 4px;">&#x1F4D0; STC Chart Progress</h2>
		<div class="chart-bar"><div class="chart-fill" id="chart-fill" style="width:0%;"></div></div>
		<div class="chart-label" id="chart-label">0/0 actions complete (0%)</div>
	</div>

	<h2>Universe Coherence</h2>
	<div class="gauges">
		<div class="gauge">
			<svg viewBox="0 0 80 80">
				<circle class="gauge-bg" cx="40" cy="40" r="34" />
				<circle class="gauge-fg eng" cx="40" cy="40" r="34" id="gauge-eng"
					stroke-dasharray="213.6" stroke-dashoffset="106.8" />
				<text class="gauge-text" x="40" y="40" id="gauge-eng-text">50%</text>
			</svg>
			<div class="gauge-label">&#x1F527; Engineer</div>
		</div>
		<div class="gauge">
			<svg viewBox="0 0 80 80">
				<circle class="gauge-bg" cx="40" cy="40" r="34" />
				<circle class="gauge-fg cer" cx="40" cy="40" r="34" id="gauge-cer"
					stroke-dasharray="213.6" stroke-dashoffset="106.8" />
				<text class="gauge-text" x="40" y="40" id="gauge-cer-text">50%</text>
			</svg>
			<div class="gauge-label">&#x1F33F; Ceremony</div>
		</div>
		<div class="gauge">
			<svg viewBox="0 0 80 80">
				<circle class="gauge-bg" cx="40" cy="40" r="34" />
				<circle class="gauge-fg sto" cx="40" cy="40" r="34" id="gauge-sto"
					stroke-dasharray="213.6" stroke-dashoffset="106.8" />
				<text class="gauge-text" x="40" y="40" id="gauge-sto-text">50%</text>
			</svg>
			<div class="gauge-label">&#x1F4D6; Story</div>
		</div>
	</div>

	<h2>Session Arc</h2>
	<div class="arc-container">
		<div class="arc-bar">
			<div class="arc-fill" id="arc-fill" style="width:33%;background:linear-gradient(90deg,#4ADE80,#A78BFA);"></div>
		</div>
		<div class="arc-labels">
			<span>&#x1F331; Germination</span>
			<span>&#x1F504; Assimilation</span>
			<span>&#x2728; Completion</span>
		</div>
	</div>

	<h2>Recent Beats <button class="log-beat-btn" onclick="logBeat()">+ Log Beat</button></h2>
	<div class="recent-beats" id="beats-list">
		<div class="empty">No beats yet...</div>
	</div>

	<h2>Event Feed</h2>
	<div class="event-feed" id="events">
		<div class="empty">Waiting for narrative events...</div>
	</div>

<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const circumference = 2 * Math.PI * 34;
	const dirIcons = { east: '\\u{1F305}', south: '\\u{1F525}', west: '\\u{1F30A}', north: '\\u{2744}\\u{FE0F}' };
	const dirLabels = { east: 'East', south: 'South', west: 'West', north: 'North' };

	vscode.postMessage({ command: 'ready' });

	window.addEventListener('message', (e) => {
		const msg = e.data;
		if (msg.command === 'update') {
			updateDashboard(msg);
		}
	});

	function updateDashboard(data) {
		const { session, events, beats } = data;

		// Store startTime for auto-refresh
		window._startTime = session.startTime;

		// Intent
		document.getElementById('intent').textContent = session.intent || 'Click to set session intent...';

		// Elapsed
		const elapsed = formatElapsed(Date.now() - session.startTime);
		document.getElementById('elapsed').textContent = elapsed;
		document.getElementById('beat-count').textContent = session.beatCount + ' beats';
		document.getElementById('phase-display').textContent = session.phase;

		// Phase pills
		document.querySelectorAll('.phase-pill').forEach(pill => {
			pill.classList.toggle('active', pill.dataset.phase === session.phase);
		});

		// Arc
		const arcPct = { germination: 15, assimilation: 50, completion: 90 }[session.phase] || 15;
		document.getElementById('arc-fill').style.width = arcPct + '%';

		// Gauges
		updateGauge('eng', session.coherence.engineer);
		updateGauge('cer', session.coherence.ceremony);
		updateGauge('sto', session.coherence.story);

		// Medicine Wheel
		const mwDir = session.medicineWheelDirection || 'east';
		const dc = session.directionCounts || { east: 0, south: 0, west: 0, north: 0 };
		for (const dir of ['east', 'south', 'west', 'north']) {
			const el = document.getElementById('mw-' + dir);
			if (el) { el.classList.toggle('active', dir === mwDir); }
			const numEl = document.getElementById('mw-' + dir + '-n');
			if (numEl) { numEl.textContent = dc[dir] || 0; }
		}
		const centerEl = document.getElementById('mw-center');
		if (centerEl) { centerEl.textContent = dirIcons[mwDir] || '\\u{1F305}'; }
		const totalEl = document.getElementById('mw-total');
		if (totalEl) {
			const total = (dc.east || 0) + (dc.south || 0) + (dc.west || 0) + (dc.north || 0);
			totalEl.textContent = 'Total direction beats: ' + total;
		}

		// Chart Progress
		const cp = session.chartProgress || { total: 0, completed: 0, percentage: 0 };
		const chartSection = document.getElementById('chart-section');
		if (cp.total > 0) {
			chartSection.style.display = 'block';
			document.getElementById('chart-fill').style.width = cp.percentage + '%';
			document.getElementById('chart-label').textContent = cp.completed + '/' + cp.total + ' actions complete (' + cp.percentage + '%)';
		} else {
			chartSection.style.display = 'none';
		}

		// Recent Beats with direction badges
		const beatsEl = document.getElementById('beats-list');
		if (beats.length === 0) {
			beatsEl.innerHTML = '<div class="empty">No beats yet...</div>';
		} else {
			beatsEl.innerHTML = beats.map(b => {
				const icon = { engineer: '\\u{1F527}', ceremony: '\\u{1F33F}', story: '\\u{1F4D6}' }[b.universe] || '\\u{1F4CC}';
				const time = b.timestamp ? new Date(b.timestamp).toLocaleTimeString() : '';
				let badge = '';
				if (b.direction && dirLabels[b.direction]) {
					badge = ' <span class="dir-badge ' + b.direction + '">' + dirIcons[b.direction] + ' ' + dirLabels[b.direction] + '</span>';
				}
				return '<div class="beat-item"><span class="event-icon">' + icon +
					'</span><span class="beat-desc">' + escapeHtml(String(b.description || b.type).slice(0, 100)) + badge +
					'</span><span class="beat-time">' + time + '</span></div>';
			}).join('');
		}

		// Events
		const eventsEl = document.getElementById('events');
		if (events.length === 0) {
			eventsEl.innerHTML = '<div class="empty">Waiting for narrative events...</div>';
		} else {
			eventsEl.innerHTML = events.map(e => {
				const icon = { engineer: '\\u{1F527}', ceremony: '\\u{1F33F}', story: '\\u{1F4D6}' }[e.universe] || '\\u{1F4CC}';
				const sig = e.significance || 1;
				const dots = '\\u{25CF}'.repeat(Math.min(sig, 5)) + '\\u{25CB}'.repeat(5 - Math.min(sig, 5));
				const high = sig >= 4 ? ' high' : '';
				const desc = e.payload?.description || e.type || 'Event';
				const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
				let typeBadge = '';
				if (e.type === 'pde.decomposition') {
					typeBadge = ' <span class="dir-badge east">PDE</span>';
				} else if (e.type === 'stc.advancement') {
					typeBadge = ' <span class="dir-badge north">STC</span>';
				}
				return '<div class="event' + high + '"><span class="event-icon">' + icon +
					'</span><span class="event-sig">' + dots +
					'</span><span class="event-desc">' + escapeHtml(String(desc).slice(0, 120)) + typeBadge +
					'</span><span class="event-time">' + time + '</span></div>';
			}).join('');
		}
	}

	function updateGauge(id, value) {
		const pct = Math.round(value * 100);
		const offset = circumference * (1 - value);
		document.getElementById('gauge-' + id).setAttribute('stroke-dashoffset', offset);
		document.getElementById('gauge-' + id + '-text').textContent = pct + '%';
	}

	function formatElapsed(ms) {
		const s = Math.floor(ms / 1000);
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (h > 0) return h + 'h ' + m + 'm';
		if (m > 0) return m + 'm';
		return '<1m';
	}

	function escapeHtml(str) {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function setIntent() { vscode.postMessage({ command: 'setIntent' }); }
	function logBeat() { vscode.postMessage({ command: 'logBeat' }); }
	function setPhase(phase) { vscode.postMessage({ command: 'setPhase', phase }); }

	// Auto-refresh elapsed time
	setInterval(() => {
		const el = document.getElementById('elapsed');
		if (el && window._startTime) {
			el.textContent = formatElapsed(Date.now() - window._startTime);
		}
	}, 10000);
</script>
</body></html>`;
}

// allow-any-unicode-next-line
// ─── Export Session Narrative ────────────────────────────────────

async function exportSessionNarrative() {
	const elapsed = formatElapsed(Date.now() - sessionState.startTime);
	const lines = [
		`# Session Narrative`,
		'',
		`**Intent**: ${sessionState.intent || 'Not set'}`,
		`**Phase**: ${sessionState.phase}`,
		`**Duration**: ${elapsed}`,
		`**Beats**: ${sessionState.beatCount}`,
// allow-any-unicode-next-line
		`**Medicine Wheel Direction**: ${MEDICINE_WHEEL[sessionState.medicineWheelDirection].icon} ${MEDICINE_WHEEL[sessionState.medicineWheelDirection].label}`,
		'',
		'## Medicine Wheel Beat Counts',
		'',
// allow-any-unicode-next-line
		`- 🌅 East (Vision): ${sessionState.directionCounts.east}`,
// allow-any-unicode-next-line
		`- 🔥 South (Growth): ${sessionState.directionCounts.south}`,
// allow-any-unicode-next-line
		`- 🌊 West (Reflection): ${sessionState.directionCounts.west}`,
// allow-any-unicode-next-line
		`- ❄️ North (Wisdom): ${sessionState.directionCounts.north}`,
		'',
		'## Universe Coherence',
		'',
// allow-any-unicode-next-line
		`- 🔧 Engineer: ${Math.round(sessionState.coherence.engineer * 100)}%`,
// allow-any-unicode-next-line
		`- 🌿 Ceremony: ${Math.round(sessionState.coherence.ceremony * 100)}%`,
// allow-any-unicode-next-line
		`- 📖 Story: ${Math.round(sessionState.coherence.story * 100)}%`,
		'',
		'## Beat Timeline',
		'',
	];

	for (const beat of sessionState.beats) {
// allow-any-unicode-next-line
		const icon = { engineer: '🔧', ceremony: '🌿', story: '📖' }[beat.universe] || '📌';
// allow-any-unicode-next-line
		const sig = '●'.repeat(Math.min(beat.significance || 1, 5));
		lines.push(`- **${new Date(beat.timestamp).toLocaleTimeString()}** ${icon} ${sig} ${beat.description}`);
	}

	if (sessionState.beats.length === 0) {
		lines.push('*No beats recorded*');
	}

	lines.push('', '---', `Exported: ${new Date().toISOString()}`);

	const markdown = lines.join('\n');
	const folders = vscode.workspace.workspaceFolders;
	if (folders) {
		const narrativeDir = vscode.Uri.joinPath(folders[0].uri, '.stc', 'sessions');
		await vscode.workspace.fs.createDirectory(narrativeDir);
		const fileUri = vscode.Uri.joinPath(narrativeDir, `session-${sessionState.id}.md`);
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(markdown));
		const doc = await vscode.workspace.openTextDocument(fileUri);
		await vscode.window.showTextDocument(doc, { preview: true });
		vscode.window.showInformationMessage('Session narrative exported');
	}
}

// allow-any-unicode-next-line
// ─── Utilities ──────────────────────────────────────────────────

function generateId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getNonce() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}

function formatElapsed(ms) {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) { return `${h}h ${m}m`; }
	if (m > 0) { return `${m}m`; }
	return '<1m';
}

// allow-any-unicode-next-line
// ─── Medicine Wheel Direction Logic ─────────────────────────────

function updateMedicineWheelDirection(latestDirection) {
	// The current direction follows the most recent activity
	// with a bias toward the direction with the most recent beats
	sessionState.medicineWheelDirection = latestDirection;
}

// allow-any-unicode-next-line
// ─── COAIA File Reader ──────────────────────────────────────────

async function readCoaiaFile(uri) {
	try {
		const raw = await vscode.workspace.fs.readFile(uri);
		const text = Buffer.from(raw).toString('utf8');
		const lines = text.trim().split('\n').filter(l => l.trim());

		const entities = [];
		const actions = [];

		for (const line of lines) {
			try {
				const obj = JSON.parse(line);
				entities.push(obj);
				// Track action steps for progress
				if (obj.type === 'action_step' || obj.entityType === 'action_step') {
					actions.push({
						name: obj.name || obj.entityName || '',
						status: obj.status || (obj.completed ? 'complete' : 'pending'),
						completed: obj.status === 'complete' || obj.completed === true,
					});
				}
			} catch { /* skip malformed JSONL lines */ }
		}

		return { entities, actions };
	} catch {
		return null;
	}
}

// allow-any-unicode-next-line
// ─── Session Persistence (.mino/) ───────────────────────────────

async function persistSession() {
	try {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders) { return; }
		const minoDir = vscode.Uri.joinPath(folders[0].uri, '.mino', 'sessions', sessionState.id);
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(folders[0].uri, '.mino'));
		} catch {
			// .mino/ does not exist — skip persistence
			return;
		}
		await vscode.workspace.fs.createDirectory(minoDir);
		const sessionData = {
			id: sessionState.id,
			intent: sessionState.intent,
			phase: sessionState.phase,
			startTime: new Date(sessionState.startTime).toISOString(),
			direction: sessionState.medicineWheelDirection,
			directionCounts: sessionState.directionCounts,
			beatCount: sessionState.beatCount,
			coherence: sessionState.coherence,
			chartProgress: sessionState.chartProgress,
			beats: sessionState.beats,
		};
		const fileUri = vscode.Uri.joinPath(minoDir, 'session.json');
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(sessionData, null, 2)));
	} catch { /* persistence is best-effort */ }
}

module.exports = { activate, deactivate };
