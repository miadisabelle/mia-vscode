/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-next-line
// STC Charts extension — Structural Tension Chart management
// Implements: mia-vscode/rispecs/extensions/03-stc-charts.spec.md
// Enhanced: COAIA JSONL support, PDE links, Medicine Wheel direction badges
const vscode = require('vscode');

let miaApi = null;
let activeChartId = null;
let chartCache = [];
let statusBarItem = null;
let chartExplorerProvider = null;

// allow-any-unicode-next-line
// Medicine Wheel direction emoji map
const DIRECTION_BADGES = {
	// allow-any-unicode-next-line
	east: '\u{1F305}',   // 🌅
	// allow-any-unicode-next-line
	south: '\u{1F525}',  // 🔥
	// allow-any-unicode-next-line
	west: '\u{1F30A}',   // 🌊
	// allow-any-unicode-next-line
	north: '\u{2744}\u{FE0F}',    // ❄️
};

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
		vscode.commands.registerCommand('mia.stcCharts.createChart', async () => {
			const title = await vscode.window.showInputBox({ prompt: 'Chart title', placeHolder: 'e.g. Refactor Auth Module' });
			if (!title) { return; }
			const desiredOutcome = await vscode.window.showInputBox({ prompt: 'Desired Outcome', placeHolder: 'What does success look like?' });
			if (!desiredOutcome) { return; }
			const currentReality = await vscode.window.showInputBox({ prompt: 'Current Reality', placeHolder: 'Where are things right now?' });
			if (!currentReality) { return; }
			const dirPick = await vscode.window.showQuickPick(
				['east', 'south', 'west', 'north'],
				{ placeHolder: 'Medicine Wheel direction (optional)', canPickMany: false }
			);
			const chartId = 'chart-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
			const now = new Date().toISOString();
			const chart = {
				id: chartId,
				title,
				desiredOutcome,
				currentReality,
				actionSteps: [],
				metadata: { direction: dirPick || undefined },
				created: now,
				modified: now,
				_source: 'stc',
			};
			await saveChart(chart);
			activeChartId = chartId;
			chartExplorerProvider.refresh();
			updateStatusBar();
			openChartWebview(context, chart);
		}),
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
		vscode.commands.registerCommand('mia.stcCharts.viewPdeSource', async (item) => {
			const chart = item?.chart;
			const pdeId = chart?.metadata?.pdeId;
			if (!pdeId) {
				vscode.window.showInformationMessage('This chart has no linked PDE decomposition.');
				return;
			}
			const folders = vscode.workspace.workspaceFolders;
			if (!folders) { return; }
			const mdUri = vscode.Uri.joinPath(folders[0].uri, '.pde', `${pdeId}.md`);
			try {
				await vscode.workspace.fs.stat(mdUri);
				const doc = await vscode.workspace.openTextDocument(mdUri);
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch {
				vscode.window.showWarningMessage(`PDE source not found: .pde/${pdeId}.md`);
			}
		}),
	);

	// Watch .stc/ and .coaia/ directories for file changes
	const folders = vscode.workspace.workspaceFolders;
	if (folders) {
		const stcWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folders[0], '.stc/charts/*.json')
		);
		stcWatcher.onDidCreate(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		stcWatcher.onDidChange(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		stcWatcher.onDidDelete(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		context.subscriptions.push(stcWatcher);

		const coaiaWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folders[0], '.coaia/pde/*.jsonl')
		);
		coaiaWatcher.onDidCreate(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		coaiaWatcher.onDidChange(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		coaiaWatcher.onDidDelete(() => { chartExplorerProvider.refresh(); updateStatusBar(); });
		context.subscriptions.push(coaiaWatcher);
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
	loadAllCharts().then(charts => {
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
		const dirBadge = getDirectionBadge(chart);
		statusBarItem.text = `$(graph) ${dirBadge}${chart.title} ${completed}/${total}`;
		statusBarItem.tooltip = `STC: ${chart.title}\n${chart.desiredOutcome}\n${pct}% complete`;
		statusBarItem.color = color;
	} else {
		statusBarItem.text = '$(graph) No active chart';
		statusBarItem.tooltip = 'Click to review a chart, or create one with Ctrl+Shift+M C';
		statusBarItem.color = undefined;
	}
}

// allow-any-unicode-next-line
// ─── Direction Badge Helper ─────────────────────────────────────

function getDirectionBadge(chart) {
	const dir = chart.metadata?.direction;
	if (dir && DIRECTION_BADGES[dir]) {
		return DIRECTION_BADGES[dir] + ' ';
	}
	return '';
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
			const desired = new vscode.TreeItem(`\u{1F3AF} ${chart.desiredOutcome}`, vscode.TreeItemCollapsibleState.None);
			desired.tooltip = `Desired Outcome: ${chart.desiredOutcome}`;
			items.push(desired);

			// Current Reality
// allow-any-unicode-next-line
			const reality = new vscode.TreeItem(`\u{1F4CD} ${chart.currentReality}`, vscode.TreeItemCollapsibleState.None);
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
					item.tooltip = step.completed ? 'Click to reopen' : 'Right-click \u2192 Complete';
					item.command = {
						command: 'mia.stcCharts.completeStep',
						title: 'Toggle Step',
						arguments: [{ chartId: chart.id, stepId: step.id }]
					};
					items.push(item);
				}
			} else {
// allow-any-unicode-next-line
				const empty = new vscode.TreeItem('No action steps \u2014 right-click chart to add', vscode.TreeItemCollapsibleState.None);
				empty.tooltip = 'Right-click the chart title to add action steps';
				items.push(empty);
			}

			// PDE Source link if metadata.pdeId exists
			if (chart.metadata?.pdeId) {
				const pdeItem = new vscode.TreeItem('$(link-external) View PDE Source', vscode.TreeItemCollapsibleState.None);
				pdeItem.tooltip = `Open PDE decomposition: .pde/${chart.metadata.pdeId}.md`;
				pdeItem.contextValue = 'pdeLink';
				pdeItem.chart = chart;
				pdeItem.command = {
					command: 'mia.stcCharts.viewPdeSource',
					title: 'View PDE Source',
					arguments: [{ chart }]
				};
				items.push(pdeItem);
			}

			return items;
		}

		// Root: load charts from both .stc/charts/ and .coaia/pde/
		const charts = await loadAllCharts();
		chartCache = charts;

		if (charts.length === 0) {
// allow-any-unicode-next-line
			const empty = new vscode.TreeItem('No charts yet \u2014 Ctrl+Shift+M C to create', vscode.TreeItemCollapsibleState.None);
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
			const prefix = isActive ? '\u25CF ' : '';
			const dirBadge = getDirectionBadge(chart);
			const sourceTag = chart._source === 'coaia' ? ' [COAIA]' : '';

			const item = new vscode.TreeItem(
				`${prefix}${dirBadge}${progressIcon} ${chart.title} (${completed}/${total})${sourceTag}`,
				vscode.TreeItemCollapsibleState.Collapsed
			);
			item.contextValue = 'stcChart';
			item.chart = chart;
			item.description = `${pct}%`;
// allow-any-unicode-next-line
			item.tooltip = `${chart.title}\n\u{1F3AF} ${chart.desiredOutcome}\n\u{1F4CD} ${chart.currentReality}\nProgress: ${pct}%${chart.metadata?.direction ? '\nDirection: ' + chart.metadata.direction : ''}${chart.metadata?.pdeId ? '\nPDE: ' + chart.metadata.pdeId : ''}`;
			return item;
		});
	}
}

// allow-any-unicode-next-line
// ─── File Operations ────────────────────────────────────────────

/**
 * Load charts from both .stc/charts/ JSON and .coaia/pde/ JSONL sources,
 * merged and sorted by modification date (newest first).
 */
async function loadAllCharts() {
	const [stcCharts, coaiaCharts] = await Promise.all([
		loadLocalCharts(),
		loadCoaiaCharts(),
	]);
	const all = [...stcCharts, ...coaiaCharts];
	return all.sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
}

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
					const raw = await vscode.workspace.fs.readFile(uri);
					const chart = JSON.parse(new TextDecoder().decode(raw));
					normalizeStcChart(chart);
					charts.push(chart);
				} catch { /* skip malformed files */ }
			}
		}
		return charts.sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
	} catch {
		return [];
	}
}

/**
 * Normalize an STC chart loaded from JSON so internal code can use
 * a single field naming convention regardless of file format.
 * STC JSON uses: createdAt/updatedAt, top-level direction/phase,
 * and action steps with title/status fields.
 */
function normalizeStcChart(chart) {
	chart._source = 'stc';
	// Timestamp normalization
	if (!chart.modified) { chart.modified = chart.updatedAt || chart.createdAt || new Date().toISOString(); }
	if (!chart.created) { chart.created = chart.createdAt || new Date().toISOString(); }
	// Metadata normalization — promote top-level fields
	if (!chart.metadata) { chart.metadata = {}; }
	if (chart.direction && !chart.metadata.direction) { chart.metadata.direction = chart.direction; }
	if (chart.phase && !chart.metadata.phase) { chart.metadata.phase = chart.phase; }
	// Action step normalization: title→description, status→completed
	for (const step of (chart.actionSteps || [])) {
		if (step.title && !step.description) { step.description = step.title; }
		if (!step.description) { step.description = step.title || ''; }
		if (step.completed === undefined && step.status !== undefined) {
			step.completed = (step.status === 'complete' || step.status === 'completed');
		}
		if (step.completed === undefined) { step.completed = false; }
	}
}

/**
 * Parse COAIA JSONL files from .coaia/pde/ directory.
 * Each JSONL file contains entity and relation lines.
 * Entity types: structural_tension_chart, desired_outcome, current_reality, action_step
 */
async function loadCoaiaCharts() {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return []; }

	const coaiaDir = vscode.Uri.joinPath(folders[0].uri, '.coaia', 'pde');
	try {
		const entries = await vscode.workspace.fs.readDirectory(coaiaDir);
		const charts = [];
		for (const [name] of entries) {
			if (name.endsWith('.jsonl')) {
				try {
					const uri = vscode.Uri.joinPath(coaiaDir, name);
					const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
					const parsed = parseCoaiaJsonl(content, name);
					if (parsed) { charts.push(parsed); }
				} catch { /* skip malformed JSONL files */ }
			}
		}
		return charts;
	} catch {
		return [];
	}
}

/**
 * Parse a single COAIA JSONL file into an STC chart object.
 * Entities and relations are linked by name references.
 */
function parseCoaiaJsonl(content, filename) {
	const lines = content.split('\n').filter(l => l.trim());
	const entities = {};
	const relations = [];

	for (const line of lines) {
		try {
			const obj = JSON.parse(line);
			if (obj.type === 'entity') {
				entities[obj.name] = obj;
			} else if (obj.type === 'relation') {
				relations.push(obj);
			}
		} catch { /* skip malformed lines */ }
	}

	// Find the main structural_tension_chart entity
	const chartEntity = Object.values(entities).find(e => e.entityType === 'structural_tension_chart');
	if (!chartEntity) { return null; }

	const chartId = chartEntity.metadata?.chartId || filename.replace('.jsonl', '');

	// Resolve desired_outcome via relations or direct entity lookup
	let desiredOutcome = '';
	const doRelation = relations.find(r => r.from === chartEntity.name && r.relationType === 'has_desired_outcome');
	if (doRelation && entities[doRelation.to]) {
		desiredOutcome = (entities[doRelation.to].observations || []).join(' ');
	} else {
		const doEntity = Object.values(entities).find(e => e.entityType === 'desired_outcome' && e.metadata?.chartId === chartId);
		if (doEntity) { desiredOutcome = (doEntity.observations || []).join(' '); }
	}

	// Resolve current_reality
	let currentReality = '';
	const crRelation = relations.find(r => r.from === chartEntity.name && r.relationType === 'has_current_reality');
	if (crRelation && entities[crRelation.to]) {
		currentReality = (entities[crRelation.to].observations || []).join(' ');
	} else {
		const crEntity = Object.values(entities).find(e => e.entityType === 'current_reality' && e.metadata?.chartId === chartId);
		if (crEntity) { currentReality = (crEntity.observations || []).join(' '); }
	}

	// Resolve action_steps
	const actionSteps = [];
	const stepRelations = relations.filter(r => r.from === chartEntity.name && r.relationType === 'has_action_step');
	for (const rel of stepRelations) {
		const stepEntity = entities[rel.to];
		if (stepEntity && stepEntity.entityType === 'action_step') {
			actionSteps.push({
				id: stepEntity.name,
				description: (stepEntity.observations || []).join(' '),
				completed: stepEntity.metadata?.status === 'completed' || stepEntity.metadata?.status === 'complete',
				direction: stepEntity.metadata?.direction,
				order: stepEntity.metadata?.order || actionSteps.length + 1,
			});
		}
	}
	// Also pick up action_step entities linked by chartId metadata
	for (const entity of Object.values(entities)) {
		if (entity.entityType === 'action_step' && entity.metadata?.chartId === chartId) {
			if (!actionSteps.find(s => s.id === entity.name)) {
				actionSteps.push({
					id: entity.name,
					description: (entity.observations || []).join(' '),
					completed: entity.metadata?.status === 'completed' || entity.metadata?.status === 'complete',
					direction: entity.metadata?.direction,
					order: entity.metadata?.order || actionSteps.length + 1,
				});
			}
		}
	}
	actionSteps.sort((a, b) => a.order - b.order);

	const title = (chartEntity.observations || [])[0] || `Chart ${chartId}`;

	return {
		id: chartId,
		title: title.replace(/^Master\s+(?:structural\s+tension\s+)?chart\s+(?:for[:\s]\s*)?(?:the\s+)?/i, '').substring(0, 80),
		desiredOutcome,
		currentReality,
		actionSteps,
		metadata: chartEntity.metadata || {},
		created: chartEntity.metadata?.createdAt || new Date().toISOString(),
		modified: chartEntity.metadata?.updatedAt || new Date().toISOString(),
		_source: 'coaia',
		_sourceFile: filename,
	};
}

async function saveChart(chart) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return; }

	// COAIA-sourced charts are read-only in this extension
	if (chart._source === 'coaia') {
		vscode.window.showInformationMessage('COAIA charts are read-only. Use the PDE bridge to modify.');
		return;
	}

	const chartsDir = vscode.Uri.joinPath(folders[0].uri, '.stc', 'charts');
	await vscode.workspace.fs.createDirectory(chartsDir);
	const fileUri = vscode.Uri.joinPath(chartsDir, `${chart.id}.json`);
	const content = new TextEncoder().encode(JSON.stringify(chart, null, 2));
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
	await vscode.workspace.fs.writeFile(destUri, new TextEncoder().encode(JSON.stringify(chart, null, 2)));

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
	const dirBadge = getDirectionBadge(chart);

	const lines = [
		`# STC: ${dirBadge}${chart.title}`,
		'',
		`> Progress: ${pct}% (${completed}/${total} steps)`,
		`> Source: ${chart._source === 'coaia' ? 'COAIA JSONL' : 'Local .stc/'}`,
	];

	if (chart.metadata?.direction) {
		lines.push(`> Direction: ${chart.metadata.direction}`);
	}
	if (chart.metadata?.pdeId) {
		lines.push(`> PDE Source: .pde/${chart.metadata.pdeId}.md`);
	}

	lines.push(
		'',
// allow-any-unicode-next-line
		'## \u{1F3AF} Desired Outcome',
		'',
		chart.desiredOutcome,
		'',
// allow-any-unicode-next-line
		'## \u{1F4CD} Current Reality',
		'',
		chart.currentReality,
		'',
// allow-any-unicode-next-line
		'## \u{1F4CB} Action Steps',
		'',
	);

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
		await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(markdown));
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
			case 'openPdeSource': {
				vscode.commands.executeCommand('mia.stcCharts.viewPdeSource', { chart: current });
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
	const dirBadge = getDirectionBadge(chart);
	const isReadOnly = chart._source === 'coaia';

	// Structural tension path: action steps as connecting nodes between desired outcome (top) and current reality (bottom)
	const stepsHtml = (chart.actionSteps || []).map((s, i) => {
		const stepPct = total > 0 ? Math.round(((i + 1) / total) * 100) : 0;
		const nodeColor = s.completed ? '#4ADE80' : '#E0AF68';
		return `
		<div class="tension-step ${s.completed ? 'done' : ''}" style="--step-color: ${nodeColor};">
			<div class="tension-connector"></div>
			<div class="tension-node">
				<button class="step-toggle" onclick="toggleStep('${s.id}')" title="${s.completed ? 'Reopen' : 'Complete'}"${isReadOnly ? ' disabled' : ''}>${s.completed ? '\u2705' : '\u2B1C'}</button>
			</div>
			<div class="step-content">
				<span class="step-num">${i + 1}.</span>
				<span class="step-desc">${escapeHtml(s.description)}</span>
				${!isReadOnly ? `<button class="step-delete" onclick="deleteStep('${s.id}')" title="Remove step">\u2715</button>` : ''}
			</div>
		</div>
	`;
	}).join('');

	const pdeLink = chart.metadata?.pdeId
		? `<div class="pde-link"><button onclick="openPdeSource()" title="Open PDE decomposition source">\u{1F517} View PDE Source (.pde/${escapeHtml(chart.metadata.pdeId)}.md)</button></div>`
		: '';

	const directionMeta = chart.metadata?.direction
		? `<div class="direction-badge">${DIRECTION_BADGES[chart.metadata.direction] || ''} Direction: ${escapeHtml(chart.metadata.direction)}</div>`
		: '';

	const sourceLabel = chart._source === 'coaia' ? '<span class="source-tag coaia">COAIA</span>' : '<span class="source-tag stc">Local</span>';
	const readOnlyBanner = isReadOnly ? '<div class="readonly-banner">Read-only \u2014 COAIA charts are managed by the PDE bridge</div>' : '';

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

	/* Structural Tension Visualization */
	.tension-container { position: relative; padding: 0 0 0 24px; margin: 16px 0; }
	.tension-pole { padding: 12px 16px; border-radius: 8px; position: relative; }
	.tension-pole.desired { background: rgba(74, 222, 128, 0.08); border: 1px solid rgba(74, 222, 128, 0.3); }
	.tension-pole.reality { background: rgba(224, 175, 104, 0.08); border: 1px solid rgba(224, 175, 104, 0.3); }
	.tension-pole-label { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
	.tension-pole.desired .tension-pole-label { color: #4ADE80; }
	.tension-pole.reality .tension-pole-label { color: #E0AF68; }
	.tension-spine { border-left: 2px dashed #363B54; margin-left: 18px; padding: 4px 0; }
	.tension-step { display: flex; align-items: flex-start; position: relative; padding: 4px 0; }
	.tension-connector { width: 18px; border-bottom: 2px solid var(--step-color, #565F89); margin-top: 12px; flex-shrink: 0; margin-left: -19px; }
	.tension-node { width: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
	.step-content { display: flex; align-items: center; gap: 8px; flex: 1; padding: 4px 8px; border-radius: 4px; }
	.step-content:hover { background: var(--vscode-list-hoverBackground); }
	.tension-step.done .step-desc { text-decoration: line-through; opacity: 0.55; }
	.step-toggle { background: none; border: none; cursor: pointer; font-size: 1.1em; padding: 0; }
	.step-toggle:disabled { cursor: default; opacity: 0.7; }
	.step-num { color: #565F89; font-size: 0.85em; min-width: 20px; }
	.step-desc { flex: 1; }
	.step-delete { background: none; border: none; cursor: pointer; color: #565F89; font-size: 0.85em; opacity: 0; transition: opacity 0.2s; }
	.step-content:hover .step-delete { opacity: 1; }
	.step-delete:hover { color: #F7768E; }

	.editable { cursor: text; min-height: 24px; padding: 4px; border-radius: 3px; }
	.editable:hover { background: var(--vscode-editor-hoverHighlightBackground); }
	.editable:focus { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-input-background); }
	.add-step { display: flex; gap: 8px; margin-top: 12px; }
	.add-step input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: inherit; }
	.add-step input:focus { outline: none; border-color: var(--vscode-focusBorder); }
	.add-step button { background: #4A9EFF; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-family: inherit; }
	.add-step button:hover { background: #3A8EEF; }
	.meta { color: #565F89; font-size: 0.8em; margin-top: 24px; }
	.pde-link { margin-top: 12px; }
	.pde-link button { background: none; border: 1px solid #4A9EFF; color: #4A9EFF; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 0.85em; }
	.pde-link button:hover { background: rgba(74, 158, 255, 0.1); }
	.direction-badge { font-size: 1.2em; margin-bottom: 8px; }
	.source-tag { font-size: 0.7em; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: middle; }
	.source-tag.coaia { background: rgba(74, 158, 255, 0.15); color: #4A9EFF; }
	.source-tag.stc { background: rgba(74, 222, 128, 0.15); color: #4ADE80; }
	.readonly-banner { background: rgba(224, 175, 104, 0.1); border: 1px solid rgba(224, 175, 104, 0.3); color: #E0AF68; padding: 6px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 16px; }
</style>
</head><body>
	${readOnlyBanner}
	<div class="header">
		<div>
			<h1>\u{1F4D0} ${dirBadge}<span class="${isReadOnly ? '' : 'editable'}" ${isReadOnly ? '' : 'contenteditable="true"'} data-field="title" onblur="updateField('title', this.textContent)">${escapeHtml(chart.title)}</span> ${sourceLabel}</h1>
			${directionMeta}
			<div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
			<span style="color: #565F89; font-size: 0.85em;">${pct}% complete \u2014 ${completed} of ${total} steps</span>
		</div>
		<svg class="progress-ring" viewBox="0 0 80 80">
			<circle class="progress-bg" cx="40" cy="40" r="34" />
			<circle class="progress-fg" cx="40" cy="40" r="34"
				stroke-dasharray="${2 * Math.PI * 34}"
				stroke-dashoffset="${2 * Math.PI * 34 * (1 - pct / 100)}" />
			<text class="progress-text" x="40" y="40">${pct}%</text>
		</svg>
	</div>

	<!-- Structural Tension Visualization: Desired Outcome (top) → Action Steps (path) → Current Reality (bottom) -->
	<div class="tension-container">
		<div class="tension-pole desired">
			<div class="tension-pole-label">\u{1F3AF} Desired Outcome</div>
			<div class="${isReadOnly ? '' : 'editable'}" ${isReadOnly ? '' : 'contenteditable="true"'} data-field="desiredOutcome" onblur="updateField('desiredOutcome', this.textContent)">${escapeHtml(chart.desiredOutcome)}</div>
		</div>

		<div class="tension-spine">
			${stepsHtml || '<div style="color:#565F89;padding:8px 24px;">No steps yet \u2014 add one below</div>'}
		</div>

		<div class="tension-pole reality">
			<div class="tension-pole-label">\u{1F4CD} Current Reality</div>
			<div class="${isReadOnly ? '' : 'editable'}" ${isReadOnly ? '' : 'contenteditable="true"'} data-field="currentReality" onblur="updateField('currentReality', this.textContent)">${escapeHtml(chart.currentReality)}</div>
		</div>
	</div>

	${!isReadOnly ? `<div class="add-step">
		<input id="newStep" type="text" placeholder="New action step..." onkeydown="if(event.key==='Enter')addStep()" />
		<button onclick="addStep()">+ Add</button>
	</div>` : ''}

	${pdeLink}

	<div class="meta">
		Source: ${chart._source === 'coaia' ? 'COAIA JSONL' : 'Local .stc/'}<br>
		Created: ${chart.created ? new Date(chart.created).toLocaleString() : 'unknown'}<br>
		Modified: ${chart.modified ? new Date(chart.modified).toLocaleString() : 'unknown'}
		${chart.metadata?.pdeId ? '<br>PDE: ' + escapeHtml(chart.metadata.pdeId) : ''}
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
		if (!input) return;
		const desc = input.value.trim();
		if (desc) {
			vscode.postMessage({ command: 'addStep', description: desc });
			input.value = '';
		}
	}

	function updateField(field, value) {
		vscode.postMessage({ command: 'updateField', field, value: value.trim() });
	}

	function openPdeSource() {
		vscode.postMessage({ command: 'openPdeSource' });
	}
</script>
</body></html>`;
}

function escapeHtml(str) {
	return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { activate, deactivate };
