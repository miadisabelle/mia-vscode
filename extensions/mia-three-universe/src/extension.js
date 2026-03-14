/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');
const { MiaHttpClientImpl } = require('./api/httpClient');
const { NarrativeWebSocket } = require('./ws/narrativeWebSocket');
const { MCPClientService } = require('./mcp/mcpClient');
const {
	DOT_STRUCTURES,
	getPdeDecompositions,
	getCoaiaCharts,
	getDotStructures,
	getMedicineWheelDirection,
	createDotStructureWatchers,
} = require('./dotStructures');

/** @type {Map<string, import('vscode').LogOutputChannel>} */
const outputChannels = new Map();

/** @type {string} */
let connectionState = 'disconnected';

/** @type {import('vscode').EventEmitter<any>} */
let narrativeEventEmitter;

/** @type {import('vscode').EventEmitter<string>} */
let connectionStateEmitter;

/** @type {import('vscode').EventEmitter<{type: string, uri: import('vscode').Uri, dotStructure: string}>} */
let dotStructureEventEmitter;

/** @type {MiaHttpClientImpl | null} */
let httpClient = null;

/** @type {NarrativeWebSocket | null} */
let wsClient = null;

/** @type {MCPClientService | null} */
let mcpClient = null;

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
	const config = vscode.workspace.getConfiguration('mia');

	if (!config.get('enabled', true)) {
		return;
	}

	narrativeEventEmitter = new vscode.EventEmitter();
	connectionStateEmitter = new vscode.EventEmitter();
	dotStructureEventEmitter = new vscode.EventEmitter();

	const serverUrl = config.get('serverUrl', '');

	// Initialize HTTP client
	httpClient = new MiaHttpClientImpl(serverUrl, context);

	// Initialize WebSocket if server configured
	if (serverUrl) {
		wsClient = new NarrativeWebSocket(serverUrl, context);
		wsClient.onEvent((event) => narrativeEventEmitter.fire(event));
		wsClient.onStateChanged((state) => {
			connectionState = state;
			connectionStateEmitter.fire(state);
		});
		wsClient.connect();
	}

	// Initialize MCP client
	mcpClient = new MCPClientService(serverUrl, context);

	// Initialize dot-structure file watchers
	const dotWatcherDisposables = createDotStructureWatchers(dotStructureEventEmitter);
	context.subscriptions.push(...dotWatcherDisposables);

	// Log dot-structure changes to PDE/STC channels
	dotStructureEventEmitter.event((event) => {
		if (event.dotStructure === '.pde') {
			getLog('pde').info(`[${event.type}] ${event.uri.fsPath}`);
		} else if (event.dotStructure === '.coaia' || event.dotStructure === '.stc') {
			getLog('stc').info(`[${event.type}] ${event.uri.fsPath}`);
		}
	});

	// Register tree data providers
	const universeExplorerProvider = new UniverseExplorerProvider(dotStructureEventEmitter);
	const beatTimelineProvider = new BeatTimelineProvider();

	vscode.window.registerTreeDataProvider('mia.universeExplorer', universeExplorerProvider);
	vscode.window.registerTreeDataProvider('mia.beatTimeline', beatTimelineProvider);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('mia.analyzeFile', () => analyzeCurrentFile()),
		vscode.commands.registerCommand('mia.showPanel', () => showAgentPanel(context)),
		vscode.commands.registerCommand('mia.createChart', () => createChart()),
		vscode.commands.registerCommand('mia.createBeat', () => createBeat()),
		vscode.commands.registerCommand('mia.switchUniverse', () => switchUniverse()),
		vscode.commands.registerCommand('mia.showDashboard', () => showDashboard()),
		vscode.commands.registerCommand('mia.decompose', () => decomposePrompt()),
		vscode.commands.registerCommand('mia.quickAnalysis', () => quickAnalysis()),
		vscode.commands.registerCommand('mia.refreshDotStructures', () => universeExplorerProvider.refresh()),
		vscode.commands.registerCommand('mia.showDotStructures', () => showDotStructuresInventory()),
	);

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('mia.serverUrl')) {
				const newUrl = vscode.workspace.getConfiguration('mia').get('serverUrl', '');
				if (httpClient) {
					httpClient.setServerUrl(newUrl);
				}
				if (wsClient) {
					wsClient.reconnect(newUrl);
				}
			}
		})
	);

	// Status bar item showing connection state
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	statusBar.text = '$(circle-slash) Mia';
	// allow-any-unicode-next-line
	statusBar.tooltip = 'Mia Three Universe — disconnected';
	statusBar.command = 'mia.showPanel';
	statusBar.show();
	context.subscriptions.push(statusBar);

	connectionStateEmitter.event((state) => {
		switch (state) {
			case 'connected':
				statusBar.text = '$(circle-filled) Mia';
				// allow-any-unicode-next-line
				statusBar.tooltip = 'Mia Three Universe — connected';
				break;
			case 'connecting':
			case 'reconnecting':
				statusBar.text = '$(loading~spin) Mia';
				// allow-any-unicode-next-line
				statusBar.tooltip = `Mia Three Universe — ${state}`;
				break;
			default:
				statusBar.text = '$(circle-slash) Mia';
				// allow-any-unicode-next-line
				statusBar.tooltip = 'Mia Three Universe — disconnected';
		}
	});

	getLog('server').info('Mia Three Universe extension activated');
	if (serverUrl) {
		getLog('server').info(`Server URL: ${serverUrl}`);
	} else {
		getLog('server').info('No server URL configured. Set mia.serverUrl to connect.');
	}

	// Export the public API for other mia extensions
	return {
		getServerUrl: () => vscode.workspace.getConfiguration('mia').get('serverUrl', ''),
		isConnected: () => connectionState === 'connected',
		getConnectionState: () => connectionState,
		analyzeFile: (uri) => analyzeFileByUri(uri),
		onNarrativeEvent: (handler) => narrativeEventEmitter.event(handler),
		onConnectionStateChanged: (handler) => connectionStateEmitter.event(handler),
		getOutputChannel: (universe) => getLog(universe),
		getHttpClient: () => httpClient,
		getMCPClient: () => mcpClient,

		// Dot-structure API (PDE-to-STC bridge / inter-extension communication)
		getPdeDecompositions: (workspaceFolder) => {
			const folderUri = workspaceFolder?.uri || vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!folderUri) { return Promise.resolve([]); }
			return getPdeDecompositions(folderUri);
		},
		getCoaiaCharts: (workspaceFolder) => {
			const folderUri = workspaceFolder?.uri || vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!folderUri) { return Promise.resolve([]); }
			return getCoaiaCharts(folderUri);
		},
		getDotStructures: (workspaceFolder) => {
			const folderUri = workspaceFolder?.uri || vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!folderUri) { return Promise.resolve([]); }
			return getDotStructures(folderUri);
		},
		onDotStructureChanged: (handler) => dotStructureEventEmitter.event(handler),
		getMedicineWheelDirection: (filePath) => getMedicineWheelDirection(filePath),
	};
}

function deactivate() {
	if (wsClient) {
		wsClient.disconnect();
	}
	for (const channel of outputChannels.values()) {
		channel.dispose();
	}
	outputChannels.clear();
}

// allow-any-unicode-next-line
// --- Output Channels ---------------------------------------------------------

const CHANNEL_NAMES = {
	// allow-any-unicode-next-line
	engineer: 'Mia: Engineer \uD83D\uDD27',
	// allow-any-unicode-next-line
	ceremony: 'Mia: Ceremony \uD83C\uDF3F',
	// allow-any-unicode-next-line
	story: 'Mia: Story \uD83D\uDCD6',
	// allow-any-unicode-next-line
	lake: 'Mia: Lake \uD83C\uDF0A',
	narrative: 'Mia: Narrative',
	server: 'Mia: Server',
	// allow-any-unicode-next-line
	pde: 'Mia: PDE \uD83C\uDF05',
	// allow-any-unicode-next-line
	stc: 'Mia: STC \uD83D\uDCCA',
};

function getLog(universe) {
	if (!outputChannels.has(universe)) {
		const name = CHANNEL_NAMES[universe] || `Mia: ${universe}`;
		outputChannels.set(universe, vscode.window.createOutputChannel(name, { log: true }));
	}
	return outputChannels.get(universe);
}

// allow-any-unicode-next-line
// --- Commands ----------------------------------------------------------------

async function analyzeCurrentFile() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No active file to analyze.');
		return;
	}
	return analyzeFileByUri(editor.document.uri.toString());
}

async function analyzeFileByUri(uri) {
	if (!httpClient) {
		return null;
	}

	const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
	const content = doc.getText();

	try {
		const result = await httpClient.analyzeThreeUniverse(uri, content);
		getLog('engineer').info(`Analysis: ${result.engineer.summary}`);
		getLog('ceremony').info(`Analysis: ${result.ceremony.summary}`);
		getLog('story').info(`Analysis: ${result.story.summary}`);
		// allow-any-unicode-next-line
		vscode.window.showInformationMessage(`Analysis complete — significance: ${result.overallSignificance}/5`);
		return result;
	} catch (err) {
		getLog('server').error(`Analysis failed: ${err.message}`);
		vscode.window.showErrorMessage(`Mia analysis failed: ${err.message}`);
		return null;
	}
}

async function showAgentPanel(_context) {
	// allow-any-unicode-next-line
	vscode.window.showInformationMessage('Agent Panel — coming in mia.agent-panel extension');
}

async function createChart() {
	const title = await vscode.window.showInputBox({ prompt: 'Chart title', placeHolder: 'What are you creating?' });
	if (!title) {
		return;
	}

	const desiredOutcome = await vscode.window.showInputBox({ prompt: 'Desired Outcome', placeHolder: 'What does success look like?' });
	if (!desiredOutcome) {
		return;
	}

	const currentReality = await vscode.window.showInputBox({ prompt: 'Current Reality', placeHolder: 'Where are you now?' });
	if (!currentReality) {
		return;
	}

	if (httpClient) {
		try {
			const chart = await httpClient.createChart({ title, desiredOutcome, currentReality });
			vscode.window.showInformationMessage(`Created chart: ${chart.title}`);
		} catch (err) {
			getLog('server').error(`Failed to create chart: ${err.message}`);
			// Fallback: create locally
			await saveChartLocally({ title, desiredOutcome, currentReality });
		}
	} else {
		await saveChartLocally({ title, desiredOutcome, currentReality });
	}
}

async function saveChartLocally(chartData) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return;
	}

	const stcDir = vscode.Uri.joinPath(folders[0].uri, '.stc', 'charts');
	const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	const chart = {
		id,
		...chartData,
		actionSteps: [],
		created: new Date().toISOString(),
		modified: new Date().toISOString(),
	};

	const fileUri = vscode.Uri.joinPath(stcDir, `${id}.json`);
	await vscode.workspace.fs.createDirectory(stcDir);
	const content = Buffer.from(JSON.stringify(chart, null, 2));
	await vscode.workspace.fs.writeFile(fileUri, content);
	vscode.window.showInformationMessage(`Chart saved locally: ${chartData.title}`);
}

async function createBeat() {
	const description = await vscode.window.showInputBox({ prompt: 'Beat description', placeHolder: 'What just happened?' });
	if (!description) {
		return;
	}

	const type = await vscode.window.showQuickPick(
		['engineering', 'relational', 'narrative', 'transition', 'milestone'],
		{ placeHolder: 'Beat type' }
	);
	if (!type) {
		return;
	}

	if (httpClient) {
		try {
			const beat = await httpClient.createBeat({ type, description });
			vscode.window.showInformationMessage(`Beat logged: ${beat.description}`);
		} catch (err) {
			getLog('server').warn(`Failed to send beat to server: ${err.message}`);
			vscode.window.showInformationMessage(`Beat logged locally: ${description}`);
		}
	} else {
		getLog('narrative').info(`[BEAT:${type}] ${description}`);
		vscode.window.showInformationMessage(`Beat logged locally: ${description}`);
	}
}

async function switchUniverse() {
	const choice = await vscode.window.showQuickPick(
		['balanced', 'engineer', 'ceremony', 'story'],
		{ placeHolder: 'Select primary universe focus' }
	);
	if (!choice) {
		return;
	}

	const config = vscode.workspace.getConfiguration('mia');
	await config.update('primaryUniverse', choice, vscode.ConfigurationTarget.Global);
	vscode.window.showInformationMessage(`Universe focus: ${choice}`);
}

async function showDashboard() {
	vscode.commands.executeCommand('workbench.view.extension.mia-stc-dashboard');
}

async function decomposePrompt() {
	const editor = vscode.window.activeTextEditor;
	const selection = editor?.selection;
	const text = selection && !selection.isEmpty
		? editor.document.getText(selection)
		: await vscode.window.showInputBox({ prompt: 'Enter prompt to decompose', placeHolder: 'Complex prompt...' });

	if (!text) {
		return;
	}

	if (httpClient) {
		try {
			const result = await httpClient.decompose(text);
			const actionCount = result.action_stack?.length ?? 0;
			const implicitCount = result.implicit_intents?.length ?? 0;
			getLog('narrative').info(`Decomposed into ${actionCount} actions, ${implicitCount} implicit intents`);
			vscode.window.showInformationMessage(`Mia: Decomposed into ${actionCount} actions, ${implicitCount} implicit intents`);
		} catch (err) {
			getLog('server').error(`Decomposition failed: ${err.message}`);
			vscode.window.showErrorMessage(`Mia decomposition failed: ${err.message}`);
		}
	}
}

async function quickAnalysis() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	const selection = editor.selection;
	const text = !selection.isEmpty
		? editor.document.getText(selection)
		: editor.document.lineAt(editor.selection.active.line).text;

	getLog('narrative').info(`Quick analysis: "${text.slice(0, 80)}..."`);
	vscode.window.showInformationMessage(`Quick analysis of: "${text.slice(0, 50)}..."`);
}

// allow-any-unicode-next-line
// --- Dot-Structure Inventory ------------------------------------------------

async function showDotStructuresInventory() {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		vscode.window.showInformationMessage('No workspace folder open.');
		return;
	}

	const inventory = await getDotStructures(folders[0].uri);
	const present = inventory.filter(s => s.exists);

	if (present.length === 0) {
		vscode.window.showInformationMessage('No dot-structures found in this workspace.');
		return;
	}

	// allow-any-unicode-next-line
	const lines = present.map(s => `${s.emoji} ${s.name} — ${s.fileCount} file(s)`);
	const channel = getLog('narrative');
	// allow-any-unicode-next-line
	channel.info('── Dot-Structure Inventory ──');
	for (const line of lines) {
		channel.info(line);
	}
	channel.show();
	vscode.window.showInformationMessage(`Found ${present.length} dot-structure(s): ${present.map(s => s.name).join(', ')}`);
}

// allow-any-unicode-next-line
// --- Tree Data Providers -----------------------------------------------------

class UniverseExplorerProvider {
	/**
	 * @param {import('vscode').EventEmitter<any>} [dotStructureEmitter]
	 */
	constructor(dotStructureEmitter) {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;

		// Auto-refresh when dot-structures change
		if (dotStructureEmitter) {
			dotStructureEmitter.event(() => this._onDidChangeTreeData.fire());
		}
	}

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element) {
		return element;
	}

	async getChildren(element) {
		if (!element) {
			const roots = [
				// allow-any-unicode-next-line
				new UniverseTreeItem('\uD83D\uDD27 Engineer', 'engineer', vscode.TreeItemCollapsibleState.Collapsed),
				// allow-any-unicode-next-line
				new UniverseTreeItem('\uD83C\uDF3F Ceremony', 'ceremony', vscode.TreeItemCollapsibleState.Collapsed),
				// allow-any-unicode-next-line
				new UniverseTreeItem('\uD83D\uDCD6 Story', 'story', vscode.TreeItemCollapsibleState.Collapsed),
				// allow-any-unicode-next-line
				new UniverseTreeItem('\uD83C\uDF0A Lake', 'lake', vscode.TreeItemCollapsibleState.Collapsed),
			];

			// Add dot-structure nodes if workspace has them
			const folders = vscode.workspace.workspaceFolders;
			if (folders && folders.length > 0) {
				try {
					const inventory = await getDotStructures(folders[0].uri);
					const present = inventory.filter(s => s.exists);
					if (present.length > 0) {
						roots.push(new DotStructureSectionItem());
						for (const struct of present) {
							roots.push(new DotStructureTreeItem(struct));
						}
					}
				} catch {
					// allow-any-unicode-next-line
					// Graceful degradation — just show universes
				}
			}

			return roots;
		}

		// Dot-structure children: list files
		if (element instanceof DotStructureTreeItem) {
			return this._getDotStructureChildren(element);
		}

		// Universe children
		return [
			new vscode.TreeItem('No analyses yet', vscode.TreeItemCollapsibleState.None),
		];
	}

	/**
	 * @param {DotStructureTreeItem} element
	 */
	async _getDotStructureChildren(element) {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) { return []; }

		const folderUri = folders[0].uri;
		const dirName = element.dotStructureName;

		if (dirName === '.pde') {
			const decomps = await getPdeDecompositions(folderUri);
			return decomps.map(d => {
				const label = d.prompt ? d.prompt.slice(0, 60) : d.name;
				const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
				item.description = d.name;
				item.tooltip = d.prompt || d.relativePath;
				item.command = { command: 'vscode.open', title: 'Open', arguments: [d.uri] };
				item.contextValue = 'pdeDecomposition';
				return item;
			});
		}

		if (dirName === '.coaia') {
			const charts = await getCoaiaCharts(folderUri);
			return charts.map(c => {
				const item = new vscode.TreeItem(c.name, vscode.TreeItemCollapsibleState.None);
				item.description = `${c.entityCount} entities`;
				item.tooltip = c.relativePath;
				item.command = { command: 'vscode.open', title: 'Open', arguments: [c.uri] };
				item.contextValue = 'coaiaChart';
				return item;
			});
		}

		// Generic listing for other dot-structures
		const { scanDotStructureDir } = require('./dotStructures');
		const meta = DOT_STRUCTURES[dirName];
		if (!meta) { return []; }

		const files = await scanDotStructureDir(folderUri, dirName, meta.pattern);
		return files.map(f => {
			const item = new vscode.TreeItem(f.name, vscode.TreeItemCollapsibleState.None);
			item.tooltip = f.relativePath;
			item.command = { command: 'vscode.open', title: 'Open', arguments: [f.uri] };
			item.contextValue = 'dotStructureFile';
			return item;
		});
	}
}

class UniverseTreeItem extends vscode.TreeItem {
	constructor(label, universe, collapsibleState) {
		super(label, collapsibleState);
		this.universe = universe;
		this.contextValue = 'universe';
		this.tooltip = `${label} Universe`;
	}
}

class DotStructureSectionItem extends vscode.TreeItem {
	constructor() {
		// allow-any-unicode-next-line
		super('\u2500\u2500 Dot Structures \u2500\u2500', vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'dotStructureSection';
		this.description = '';
	}
}

class DotStructureTreeItem extends vscode.TreeItem {
	/**
	 * @param {{ name: string, exists: boolean, fileCount: number, description: string, emoji: string, uri: import('vscode').Uri }} struct
	 */
	constructor(struct) {
		super(`${struct.emoji} ${struct.name}`, vscode.TreeItemCollapsibleState.Collapsed);
		this.dotStructureName = struct.name;
		this.description = `${struct.fileCount} file(s)`;
		// allow-any-unicode-next-line
		this.tooltip = `${struct.description} — ${struct.fileCount} file(s)`;
		this.contextValue = 'dotStructure';
		this.resourceUri = struct.uri;
	}
}

class BeatTimelineProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element) {
		return element;
	}

	getChildren(element) {
		if (!element) {
			return [
				new vscode.TreeItem('No beats recorded yet', vscode.TreeItemCollapsibleState.None),
			];
		}
		return [];
	}
}

module.exports = { activate, deactivate };
