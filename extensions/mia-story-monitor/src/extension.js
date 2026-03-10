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
};

const MAX_EVENTS = 500;
const recentSessions = []; // { id, intent, phase, startTime, endTime, beatCount }

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

	function updateAmbientBars() {
		const config = vscode.workspace.getConfiguration('mia');
		const ambient = config.get('storyMonitor.ambient', false);

		if (ambient) {
			const elapsed = formatElapsed(Date.now() - sessionState.startTime);
// allow-any-unicode-next-line
			const phaseIcon = { germination: '🌱', assimilation: '🔄', completion: '✨' }[sessionState.phase] || '📖';
			phaseStatusBar.text = `${phaseIcon} ${sessionState.phase} ${elapsed}`;
			phaseStatusBar.tooltip = `Session: ${sessionState.intent || 'No intent set'}\nPhase: ${sessionState.phase}\nElapsed: ${elapsed}`;
			phaseStatusBar.show();

			beatCountBar.text = `$(pulse) ${sessionState.beatCount} beats`;
			beatCountBar.tooltip = 'Click to log a new beat';
			beatCountBar.show();
		} else {
			phaseStatusBar.hide();
			beatCountBar.hide();
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
				],
				{ placeHolder: 'Beat type' }
			);
			if (!type) { return; }

			const beat = {
				id: generateId(),
				type: type.value,
				description,
				timestamp: new Date().toISOString(),
				significance: type.value === 'milestone' ? 4 : 2,
				universe: type.value === 'engineering' ? 'engineer' : type.value === 'relational' ? 'ceremony' : 'story',
			};

			sessionState.beats.push(beat);
			sessionState.beatCount++;
			processEvent({ type: 'beat.created', payload: beat, timestamp: beat.timestamp, universe: beat.universe, significance: beat.significance });

			// Send to server if connected
			if (miaApi && miaApi.isConnected()) {
				try {
					const httpClient = miaApi.getHttpClient();
					if (httpClient) { await httpClient.createBeat(beat); }
				} catch { /* local beat succeeded */ }
			}

			updateAmbientBars();
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

	if (enriched.type === 'beat.created') {
		sessionState.beatCount++;
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
	if (event.type?.includes('analysis')) { return 'engineer'; }
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

	dashboardPanel.webview.html = getDashboardHtml();

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
		},
		events: sessionState.events.slice(0, 50),
		beats: sessionState.beats.slice().reverse().slice(0, 30),
	});
}

function getDashboardHtml() {
	return `<!DOCTYPE html>
<html><head>
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
	.event-feed { max-height: 400px; overflow-y: auto; }
	.event { display: flex; align-items: flex-start; gap: 8px; padding: 8px 4px; border-bottom: 1px solid #1E1F2E; font-size: 0.9em; transition: background 0.2s; }
	.event:hover { background: #1E1F2E; }
	.event-icon { font-size: 1.1em; flex-shrink: 0; }
	.event-sig { color: #E0AF68; font-size: 0.7em; flex-shrink: 0; min-width: 40px; }
	.event-desc { flex: 1; line-height: 1.4; }
	.event-time { color: #565F89; font-size: 0.8em; flex-shrink: 0; }
	.event.high { background: #A78BFA0A; border-left: 2px solid #A78BFA; }
	.empty { color: #565F89; font-style: italic; padding: 20px; text-align: center; }

	/* Beat Log Button */
	.log-beat-btn { background: #A78BFA33; border: 1px solid #A78BFA; color: #A78BFA; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 0.9em; margin: 8px 0; }
	.log-beat-btn:hover { background: #A78BFA55; }

	/* Animations */
	@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
	.pulsing { animation: pulse 2s infinite; }
</style>
</head><body>
// allow-any-unicode-next-line
	<h1>📖 Story Monitor</h1>

	<div class="session-header">
		<div class="session-intent" onclick="setIntent()" id="intent">Loading...</div>
		<div class="session-meta">
// allow-any-unicode-next-line
			<span id="elapsed">—</span>
			<span id="beat-count">0 beats</span>
			<span id="phase-display">germination</span>
		</div>
		<div class="phase-pills">
// allow-any-unicode-next-line
			<span class="phase-pill" data-phase="germination" onclick="setPhase('germination')">🌱 Germination</span>
// allow-any-unicode-next-line
			<span class="phase-pill" data-phase="assimilation" onclick="setPhase('assimilation')">🔄 Assimilation</span>
// allow-any-unicode-next-line
			<span class="phase-pill" data-phase="completion" onclick="setPhase('completion')">✨ Completion</span>
		</div>
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
// allow-any-unicode-next-line
			<div class="gauge-label">🔧 Engineer</div>
		</div>
		<div class="gauge">
			<svg viewBox="0 0 80 80">
				<circle class="gauge-bg" cx="40" cy="40" r="34" />
				<circle class="gauge-fg cer" cx="40" cy="40" r="34" id="gauge-cer"
					stroke-dasharray="213.6" stroke-dashoffset="106.8" />
				<text class="gauge-text" x="40" y="40" id="gauge-cer-text">50%</text>
			</svg>
// allow-any-unicode-next-line
			<div class="gauge-label">🌿 Ceremony</div>
		</div>
		<div class="gauge">
			<svg viewBox="0 0 80 80">
				<circle class="gauge-bg" cx="40" cy="40" r="34" />
				<circle class="gauge-fg sto" cx="40" cy="40" r="34" id="gauge-sto"
					stroke-dasharray="213.6" stroke-dashoffset="106.8" />
				<text class="gauge-text" x="40" y="40" id="gauge-sto-text">50%</text>
			</svg>
// allow-any-unicode-next-line
			<div class="gauge-label">📖 Story</div>
		</div>
	</div>

	<h2>Session Arc</h2>
	<div class="arc-container">
		<div class="arc-bar">
			<div class="arc-fill" id="arc-fill" style="width:33%;background:linear-gradient(90deg,#4ADE80,#A78BFA);"></div>
		</div>
		<div class="arc-labels">
// allow-any-unicode-next-line
			<span>🌱 Germination</span>
// allow-any-unicode-next-line
			<span>🔄 Assimilation</span>
// allow-any-unicode-next-line
			<span>✨ Completion</span>
		</div>
	</div>

	<h2>Event Feed <button class="log-beat-btn" onclick="logBeat()">+ Log Beat</button></h2>
	<div class="event-feed" id="events">
		<div class="empty">Waiting for narrative events...</div>
	</div>

<script>
	const vscode = acquireVsCodeApi();
	const circumference = 2 * Math.PI * 34;

	// Request initial data
	vscode.postMessage({ command: 'ready' });

	window.addEventListener('message', (e) => {
		const msg = e.data;
		if (msg.command === 'update') {
			updateDashboard(msg);
		}
	});

	function updateDashboard(data) {
		const { session, events, beats } = data;

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

		// Events
		const eventsEl = document.getElementById('events');
		if (events.length === 0) {
			eventsEl.innerHTML = '<div class="empty">Waiting for narrative events...</div>';
		} else {
			eventsEl.innerHTML = events.map(e => {
// allow-any-unicode-next-line
				const icon = { engineer: '🔧', ceremony: '🌿', story: '📖' }[e.universe] || '📌';
				const sig = e.significance || 1;
// allow-any-unicode-next-line
				const dots = '●'.repeat(Math.min(sig, 5)) + '○'.repeat(5 - Math.min(sig, 5));
				const high = sig >= 4 ? ' high' : '';
				const desc = e.payload?.description || e.type || 'Event';
				const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
				return '<div class="event' + high + '"><span class="event-icon">' + icon +
					'</span><span class="event-sig">' + dots +
					'</span><span class="event-desc">' + escapeHtml(String(desc).slice(0, 120)) +
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

function formatElapsed(ms) {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) { return `${h}h ${m}m`; }
	if (m > 0) { return `${m}m`; }
	return '<1m';
}

module.exports = { activate, deactivate };
