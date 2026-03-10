/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-next-line
// STC Charts extension — Structural Tension Chart management
// Implements: mia-vscode/rispecs/extensions/03-stc-charts.spec.md
const vscode = require('vscode');

let miaApi = null;
let activeChartId = null;
let chartCache = [];
let statusBarItem = null;
let chartExplorerProvider = null;

function activate(context) {
	const coreExt = vscode.extensions.getExtension('mia.three-universe');
	if (coreExt) {
		miaApi = coreExt.exports;
	}

	chartExplorerProvider = new ChartExplorerProvider();
	vscode.window.registerTreeDataProvider('mia.chartExplorer', chartExplorerProvider);

	// Status bar item for active chart
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
	statusBarItem.command = 'mia.stcCharts.review';
	updateStatusBar();
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('mia.stcCharts.review', (item) => {
			if (item && item.chart) {
				activeChartId = item.chart.id;
				openChartWebview(context, item.chart);
			} else if (activeChartId) {
				const chart = chartCache.find(c => c.id === activeChartId);
				if (chart) { openChartWebview(context, chart); }
			} else {
				vscode.window.showInformationMessage('No active chart. Create one with Mia: Create STC Chart');
			}
		}),
		vscode.commands.registerCommand('mia.stcCharts.addStep', async (item) => {
			const chart = item?.chart || chartCache.find(c => c.id === activeChartId);
			if (!chart) { return; }
			const desc = await vscode.window.showInputBox({ prompt: 'Action step description', placeHolder: 'What needs to happen next?' });
			if (!desc) { return; }
			const stepId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
			chart.actionSteps = chart.actionSteps || [];
			chart.actionSteps.push({ id: stepId, description: desc, completed: false, order: chart.actionSteps.length + 1 });
			chart.modified = new Date().toISOString();
			await saveChart(chart);
			chartExplorerProvider.refresh();
			updateStatusBar();
		}),
		vscode.commands.registerCommand('mia.stcCharts.completeStep', async (item) => {
			if (!item || !item.stepId || !item.chartId) { return; }
			const chart = chartCache.find(c => c.id === item.chartId);
			if (!chart) { return; }
			const step = (chart.actionSteps || []).find(s => s.id === item.stepId);
			if (step) {
				step.completed = !step.completed;
				chart.modified = new Date().toISOString();
				await saveChart(chart);
				chartExplorerProvider.refresh();
				updateStatusBar();
				const action = step.completed ? 'Completed' : 'Reopened';
				vscode.window.showInformationMessage(`${action}: ${step.description}`);
				// Fire narrative event if connected
				if (miaApi && miaApi.isConnected()) {
					const log = miaApi.getOutputChannel('narrative');
					if (log) { log.info(`[STC] ${action} action step: ${step.description}`); }
				}
			}
		}),
		vscode.commands.registerCommand('mia.stcCharts.archive', async (item) => {
			const chart = item?.chart;
			if (!chart) { return; }
			const confirm = await vscode.window.showWarningMessage(
				`Archive "${chart.title}"? It will be moved to .stc/archived/`,
				{ modal: true }, 'Archive'
			);
			if (confirm !== 'Archive') { return; }
			await archiveChart(chart);
			if (activeChartId === chart.id) { activeChartId = null; }
			chartExplorerProvider.refresh();
			updateStatusBar();
			vscode.window.showInformationMessage(`Archived: ${chart.title}`);
		}),
		vscode.commands.registerCommand('mia.stcCharts.deleteChart', async (item) => {
			const chart = item?.chart;
			if (!chart) { return; }
			const confirm = await vscode.window.showWarningMessage(
				`Delete "${chart.title}" permanently?`,
				{ modal: true }, 'Delete'
			);
			if (confirm !== 'Delete') { return; }
			await deleteChart(chart);
			if (activeChartId === chart.id) { activeChartId = null; }
			chartExplorerProvider.refresh();
			updateStatusBar();
		}),
		vscode.commands.registerCommand('mia.stcCharts.export', async (item) => {
			const chart = item?.chart;
			if (!chart) { return; }
			await exportChartMarkdown(chart);
		}),
		vscode.commands.registerCommand('mia.stcCharts.refresh', () => {
			chartExplorerProvider.refresh();
			updateStatusBar();
		}),
	);

	// Watch .stc/ directory for file changes
	const folders = vscode.workspace.workspaceFolders;
	if (folders) {
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folders[0], '.stc/charts/*.json')
		);
		watcher.onDidCreate(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		watcher.onDidChange(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		watcher.onDidDelete(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		context.subscriptions.push(watcher);
	}

	// Subscribe to server chart events
	if (miaApi) {
		miaApi.onNarrativeEvent((event) => {
			if (event.type === 'chart.progress' || event.type === 'chart.created') {
				chartExplorerProvider.refresh();
				updateStatusBar();
			}
		});
	}

	// Auto-select most recent chart as active
	loadLocalCharts().then(charts => {
		if (charts.length > 0 && !activeChartId) {
			activeChartId = charts[0].id;
			updateStatusBar();
		}
	});
}

function deactivate() {}

// allow-any-unicode-next-line
// ─── Status Bar ─────────────────────────────────────────────────

function updateStatusBar() {
	if (!statusBarItem) { return; }
	const chart = chartCache.find(c => c.id === activeChartId);
	if (chart) {
		const completed = (chart.actionSteps || []).filter(s => s.completed).length;
		const total = (chart.actionSteps || []).length;
		const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
		const color = pct < 33 ? '#F7768E' : pct < 66 ? '#E0AF68' : '#4ADE80';
		statusBarItem.text = `$(graph) ${chart.title} ${completed}/${total}`;
		statusBarItem.tooltip = `STC: ${chart.title}\n${chart.desiredOutcome}\n${pct}% complete`;
		statusBarItem.color = color;
	} else {
		statusBarItem.text = '$(graph) No active chart';
		statusBarItem.tooltip = 'Click to review a chart, or create one with Ctrl+Shift+M C';
		statusBarItem.color = undefined;
	}
}

// allow-any-unicode-next-line
// ─── Tree Data Provider ─────────────────────────────────────────

class ChartExplorerProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	refresh() { this._onDidChangeTreeData.fire(); }

	getTreeItem(element) { return element; }

	async getChildren(element) {
		if (element && element.chart) {
			const chart = element.chart;
			const items = [];

			// Desired Outcome
// allow-any-unicode-next-line
			const desired = new vscode.TreeItem(`🎯 ${chart.desiredOutcome}`, vscode.TreeItemCollapsibleState.None);
			desired.tooltip = `Desired Outcome: ${chart.desiredOutcome}`;
			items.push(desired);

			// Current Reality
// allow-any-unicode-next-line
			const reality = new vscode.TreeItem(`📍 ${chart.currentReality}`, vscode.TreeItemCollapsibleState.None);
			reality.tooltip = `Current Reality: ${chart.currentReality}`;
			items.push(reality);

// allow-any-unicode-next-line
			// Action Steps — each interactive
			if (chart.actionSteps && chart.actionSteps.length > 0) {
				for (const step of chart.actionSteps) {
					const icon = step.completed ? '$(check)' : '$(circle-outline)';
					const item = new vscode.TreeItem(`${icon} ${step.description}`, vscode.TreeItemCollapsibleState.None);
					item.contextValue = 'actionStep';
					item.chartId = chart.id;
					item.stepId = step.id;
// allow-any-unicode-next-line
					item.tooltip = step.completed ? 'Click to reopen' : 'Right-click → Complete';
					item.command = {
						command: 'mia.stcCharts.completeStep',
						title: 'Toggle Step',
						arguments: [{ chartId: chart.id, stepId: step.id }]
					};
					items.push(item);
				}
			} else {
// allow-any-unicode-next-line
				const empty = new vscode.TreeItem('No action steps — right-click chart to add', vscode.TreeItemCollapsibleState.None);
				empty.tooltip = 'Right-click the chart title to add action steps';
				items.push(empty);
			}

			return items;
		}

		// Root: load charts
		const charts = await loadLocalCharts();
		chartCache = charts;

		if (charts.length === 0) {
// allow-any-unicode-next-line
			const empty = new vscode.TreeItem('No charts yet — Ctrl+Shift+M C to create', vscode.TreeItemCollapsibleState.None);
			empty.tooltip = 'Create your first Structural Tension Chart';
			return [empty];
		}

		return charts.map((chart) => {
			const completed = (chart.actionSteps || []).filter(s => s.completed).length;
			const total = (chart.actionSteps || []).length;
			const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
			const progressIcon = pct === 100 ? '$(check-all)' : pct > 0 ? '$(tasklist)' : '$(circle-outline)';
			const isActive = chart.id === activeChartId;
// allow-any-unicode-next-line
			const prefix = isActive ? '● ' : '';

			const item = new vscode.TreeItem(
				`${prefix}${progressIcon} ${chart.title} (${completed}/${total})`,
				vscode.TreeItemCollapsibleState.Collapsed
			);
			item.contextValue = 'stcChart';
			item.chart = chart;
			item.description = `${pct}%`;
// allow-any-unicode-next-line
			item.tooltip = `${chart.title}\n🎯 ${chart.desiredOutcome}\n📍 ${chart.currentReality}\nProgress: ${pct}%`;
			return item;
		});
	}
}

// allow-any-unicode-next-line
// ─── File Operations ────────────────────────────────────────────

async function loadLocalCharts() {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return []; }

	const chartsDir = vscode.Uri.joinPath(folders[0].uri, '.stc', 'charts');
	try {
		const entries = await vscode.workspace.fs.readDirectory(chartsDir);
		const charts = [];
		for (const [name] of entries) {
			if (name.endsWith('.json')) {
				try {
					const uri = vscode.Uri.joinPath(chartsDir, name);
					const content = await vscode.workspace.fs.readFile(uri);
					charts.push(JSON.parse(Buffer.from(content).toString()));
				} catch { /* skip malformed files */ }
			}
		}
		return charts.sort((a, b) => new Date(b.modified) - new Date(a.modified));
	} catch {
		return [];
	}
}

async function saveChart(chart) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return; }

	const chartsDir = vscode.Uri.joinPath(folders[0].uri, '.stc', 'charts');
	await vscode.workspace.fs.createDirectory(chartsDir);
	const fileUri = vscode.Uri.joinPath(chartsDir, `${chart.id}.json`);
	const content = Buffer.from(JSON.stringify(chart, null, 2));
	await vscode.workspace.fs.writeFile(fileUri, content);

	// Sync to server if connected
	if (miaApi && miaApi.isConnected()) {
		try {
			const httpClient = miaApi.getHttpClient();
			if (httpClient) { await httpClient.createChart(chart); }
		} catch { /* local save succeeded, server sync optional */ }
	}
}

async function archiveChart(chart) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return; }

	const sourceUri = vscode.Uri.joinPath(folders[0].uri, '.stc', 'charts', `${chart.id}.json`);
	const archiveDir = vscode.Uri.joinPath(folders[0].uri, '.stc', 'archived');
	await vscode.workspace.fs.createDirectory(archiveDir);

	chart.archivedAt = new Date().toISOString();
	const destUri = vscode.Uri.joinPath(archiveDir, `${chart.id}.json`);
	await vscode.workspace.fs.writeFile(destUri, Buffer.from(JSON.stringify(chart, null, 2)));

	try { await vscode.workspace.fs.delete(sourceUri); } catch { /* already gone */ }
}

async function deleteChart(chart) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return; }

	const fileUri = vscode.Uri.joinPath(folders[0].uri, '.stc', 'charts', `${chart.id}.json`);
	try { await vscode.workspace.fs.delete(fileUri); } catch { /* already gone */ }
}

async function exportChartMarkdown(chart) {
	const completed = (chart.actionSteps || []).filter(s => s.completed).length;
	const total = (chart.actionSteps || []).length;
	const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

	const lines = [
		`# STC: ${chart.title}`,
		'',
		`> Progress: ${pct}% (${completed}/${total} steps)`,
		'',
// allow-any-unicode-next-line
		'## 🎯 Desired Outcome',
		'',
		chart.desiredOutcome,
		'',
// allow-any-unicode-next-line
		'## 📍 Current Reality',
		'',
		chart.currentReality,
		'',
// allow-any-unicode-next-line
		'## 📋 Action Steps',
		'',
	];

	for (const step of (chart.actionSteps || [])) {
		lines.push(`- [${step.completed ? 'x' : ' '}] ${step.description}`);
	}

	lines.push('', '---', `Created: ${chart.created}`, `Modified: ${chart.modified}`);

	const markdown = lines.join('\n');

	const folders = vscode.workspace.workspaceFolders;
	if (folders) {
		const stcDir = vscode.Uri.joinPath(folders[0].uri, '.stc');
		await vscode.workspace.fs.createDirectory(stcDir);
		const fileUri = vscode.Uri.joinPath(stcDir, `${chart.id}.md`);
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(markdown));
		const doc = await vscode.workspace.openTextDocument(fileUri);
		await vscode.window.showTextDocument(doc, { preview: true });
		vscode.window.showInformationMessage(`Exported: ${chart.title}.md`);
	}
}

// allow-any-unicode-next-line
// ─── Interactive Chart Webview ──────────────────────────────────

function openChartWebview(context, chart) {
	if (!chart) { return; }
	activeChartId = chart.id;
	updateStatusBar();

	const panel = vscode.window.createWebviewPanel(
		'stcChart', `STC: ${chart.title}`, vscode.ViewColumn.One,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	function renderWebview() {
		const freshChart = chartCache.find(c => c.id === chart.id) || chart;
		panel.webview.html = getChartWebviewHtml(freshChart);
	}

	renderWebview();

	// Handle messages from webview
	panel.webview.onDidReceiveMessage(async (msg) => {
		const current = chartCache.find(c => c.id === chart.id) || chart;

		switch (msg.command) {
			case 'toggleStep': {
				const step = (current.actionSteps || []).find(s => s.id === msg.stepId);
				if (step) {
					step.completed = !step.completed;
					current.modified = new Date().toISOString();
					await saveChart(current);
					chartExplorerProvider.refresh();
					updateStatusBar();
					renderWebview();
				}
				break;
			}
			case 'addStep': {
				if (msg.description) {
					current.actionSteps = current.actionSteps || [];
					const stepId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
					current.actionSteps.push({ id: stepId, description: msg.description, completed: false, order: current.actionSteps.length + 1 });
					current.modified = new Date().toISOString();
					await saveChart(current);
					chartExplorerProvider.refresh();
					updateStatusBar();
					renderWebview();
				}
				break;
			}
			case 'deleteStep': {
				current.actionSteps = (current.actionSteps || []).filter(s => s.id !== msg.stepId);
				current.modified = new Date().toISOString();
				await saveChart(current);
				chartExplorerProvider.refresh();
				updateStatusBar();
				renderWebview();
				break;
			}
			case 'updateField': {
				if (msg.field === 'desiredOutcome' || msg.field === 'currentReality' || msg.field === 'title') {
					current[msg.field] = msg.value;
					current.modified = new Date().toISOString();
					await saveChart(current);
					chartExplorerProvider.refresh();
					updateStatusBar();
					if (msg.field === 'title') {
						panel.title = `STC: ${msg.value}`;
					}
				}
				break;
			}
		}
	}, undefined, context.subscriptions);
}

function getChartWebviewHtml(chart) {
	const completed = (chart.actionSteps || []).filter(s => s.completed).length;
	const total = (chart.actionSteps || []).length;
	const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
	const arcColor = pct < 33 ? '#F7768E' : pct < 66 ? '#E0AF68' : '#4ADE80';

	const stepsHtml = (chart.actionSteps || []).map((s, i) => `
		<div class="step ${s.completed ? 'done' : ''}">
// allow-any-unicode-next-line
			<button class="step-toggle" onclick="toggleStep('${s.id}')" title="${s.completed ? 'Reopen' : 'Complete'}">${s.completed ? '✅' : '⬜'}</button>
			<span class="step-num">${i + 1}.</span>
			<span class="step-desc">${escapeHtml(s.description)}</span>
// allow-any-unicode-next-line
			<button class="step-delete" onclick="deleteStep('${s.id}')" title="Remove step">✕</button>
		</div>
	`).join('');

	return `<!DOCTYPE html>
<html><head>
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; line-height: 1.6; }
	h1 { color: #4A9EFF; font-size: 1.5em; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
	h2 { color: #A9B1D6; font-size: 1em; margin-top: 24px; margin-bottom: 8px; }
	.header { display: flex; justify-content: space-between; align-items: flex-start; }
	.progress-ring { width: 80px; height: 80px; flex-shrink: 0; }
	.progress-ring circle { fill: none; stroke-width: 6; }
	.progress-bg { stroke: #1E1F2E; }
	.progress-fg { stroke: ${arcColor}; stroke-linecap: round; transition: stroke-dashoffset 0.5s ease; transform: rotate(-90deg); transform-origin: center; }
	.progress-text { font-size: 16px; fill: var(--vscode-foreground); text-anchor: middle; dominant-baseline: central; }
	.progress-bar { height: 6px; background: #1E1F2E; border-radius: 3px; margin: 12px 0 4px; }
	.progress-fill { height: 100%; background: linear-gradient(90deg, #4A9EFF, ${arcColor}); border-radius: 3px; transition: width 0.5s; }
	.section { border-left: 3px solid; padding: 8px 12px; margin: 8px 0; border-radius: 0 4px 4px 0; background: var(--vscode-editor-inactiveSelectionBackground); }
	.section.desired { border-color: #4ADE80; }
	.section.reality { border-color: #F7768E; }
	.editable { cursor: text; min-height: 24px; padding: 4px; border-radius: 3px; }
	.editable:hover { background: var(--vscode-editor-hoverHighlightBackground); }
	.editable:focus { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-input-background); }
	.step { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 4px; }
	.step:hover { background: var(--vscode-list-hoverBackground); }
	.step.done .step-desc { text-decoration: line-through; opacity: 0.55; }
	.step-toggle { background: none; border: none; cursor: pointer; font-size: 1.1em; padding: 0; }
	.step-num { color: #565F89; font-size: 0.85em; min-width: 20px; }
	.step-desc { flex: 1; }
	.step-delete { background: none; border: none; cursor: pointer; color: #565F89; font-size: 0.85em; opacity: 0; transition: opacity 0.2s; }
	.step:hover .step-delete { opacity: 1; }
	.step-delete:hover { color: #F7768E; }
	.add-step { display: flex; gap: 8px; margin-top: 12px; }
	.add-step input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: inherit; }
	.add-step input:focus { outline: none; border-color: var(--vscode-focusBorder); }
	.add-step button { background: #4A9EFF; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-family: inherit; }
	.add-step button:hover { background: #3A8EEF; }
	.meta { color: #565F89; font-size: 0.8em; margin-top: 24px; }
</style>
</head><body>
	<div class="header">
		<div>
// allow-any-unicode-next-line
			<h1>📐 <span class="editable" contenteditable="true" data-field="title" onblur="updateField('title', this.textContent)">${escapeHtml(chart.title)}</span></h1>
			<div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
// allow-any-unicode-next-line
			<span style="color: #565F89; font-size: 0.85em;">${pct}% complete — ${completed} of ${total} steps</span>
		</div>
		<svg class="progress-ring" viewBox="0 0 80 80">
			<circle class="progress-bg" cx="40" cy="40" r="34" />
			<circle class="progress-fg" cx="40" cy="40" r="34"
				stroke-dasharray="${2 * Math.PI * 34}"
				stroke-dashoffset="${2 * Math.PI * 34 * (1 - pct / 100)}" />
			<text class="progress-text" x="40" y="40">${pct}%</text>
		</svg>
	</div>

// allow-any-unicode-next-line
	<h2>🎯 Desired Outcome</h2>
	<div class="section desired">
		<div class="editable" contenteditable="true" data-field="desiredOutcome" onblur="updateField('desiredOutcome', this.textContent)">${escapeHtml(chart.desiredOutcome)}</div>
	</div>

// allow-any-unicode-next-line
	<h2>📍 Current Reality</h2>
	<div class="section reality">
		<div class="editable" contenteditable="true" data-field="currentReality" onblur="updateField('currentReality', this.textContent)">${escapeHtml(chart.currentReality)}</div>
	</div>

// allow-any-unicode-next-line
	<h2>📋 Action Steps</h2>
// allow-any-unicode-next-line
	<div id="steps">${stepsHtml || '<div style="color:#565F89;padding:8px;">No steps yet — add one below</div>'}</div>

	<div class="add-step">
		<input id="newStep" type="text" placeholder="New action step..." onkeydown="if(event.key==='Enter')addStep()" />
		<button onclick="addStep()">+ Add</button>
	</div>

	<div class="meta">
		Created: ${chart.created ? new Date(chart.created).toLocaleString() : 'unknown'}<br>
		Modified: ${chart.modified ? new Date(chart.modified).toLocaleString() : 'unknown'}
	</div>

<script>
	const vscode = acquireVsCodeApi();

	function toggleStep(stepId) {
		vscode.postMessage({ command: 'toggleStep', stepId });
	}

	function deleteStep(stepId) {
		vscode.postMessage({ command: 'deleteStep', stepId });
	}

	function addStep() {
		const input = document.getElementById('newStep');
		const desc = input.value.trim();
		if (desc) {
			vscode.postMessage({ command: 'addStep', description: desc });
			input.value = '';
		}
	}

	function updateField(field, value) {
		vscode.postMessage({ command: 'updateField', field, value: value.trim() });
	}
</script>
</body></html>`;
}

function escapeHtml(str) {
	return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { activate, deactivate };
