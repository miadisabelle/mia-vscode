/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');

let miaApi = null;
let statusBarItem = null;
let pdeExplorerProvider = null;

// allow-any-unicode-next-line
// Four Directions mapping for PDE → STC conversion
const DIRECTION_MAP = {
	east: 'desired_outcome',
	south: 'current_reality',
	north: 'action_steps',
	west: 'validation',
};

const DIRECTION_LABELS = {
	east: { emoji: '\u{1F305}', name: 'East \u2014 Vision & Inquiry', color: '#FFD700' },
	south: { emoji: '\u{1F525}', name: 'South \u2014 Planning & Consent', color: '#FF6B35' },
	west: { emoji: '\u{1F30A}', name: 'West \u2014 Experience & Action', color: '#4A9EFF' },
	north: { emoji: '\u{2744}\u{FE0F}', name: 'North \u2014 Reflection & Wisdom', color: '#E0E0E0' },
};

function activate(context) {
	const coreExt = vscode.extensions.getExtension('mia.three-universe');
	if (coreExt) {
		miaApi = coreExt.exports;
	}

	pdeExplorerProvider = new PdeExplorerProvider();
	vscode.window.registerTreeDataProvider('mia.pdeExplorer', pdeExplorerProvider);

	// Status bar: PDE count
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 35);
	statusBarItem.command = 'mia.pdeBridge.refresh';
	context.subscriptions.push(statusBarItem);
	updateStatusBar();

	// Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('mia.pdeBridge.preview', async (item) => {
			const pdeId = item?.pdeId;
			if (!pdeId) {
				vscode.window.showInformationMessage('Select a PDE decomposition to preview.');
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
				// Fall back to JSON if .md not found
				const jsonUri = vscode.Uri.joinPath(folders[0].uri, '.pde', `${pdeId}.json`);
				try {
					const doc = await vscode.workspace.openTextDocument(jsonUri);
					await vscode.window.showTextDocument(doc, { preview: true });
				} catch {
					vscode.window.showWarningMessage(`PDE file not found: .pde/${pdeId}`);
				}
			}
		}),

		vscode.commands.registerCommand('mia.pdeBridge.createChart', async (item) => {
			const pdeId = item?.pdeId;
			if (!pdeId) {
				vscode.window.showInformationMessage('Select a PDE decomposition to create an STC chart.');
				return;
			}
			await createStcFromPde(pdeId);
		}),

		vscode.commands.registerCommand('mia.pdeBridge.refresh', () => {
			pdeExplorerProvider.refresh();
			updateStatusBar();
		}),

		vscode.commands.registerCommand('mia.pdeBridge.openJson', async (item) => {
			const pdeId = item?.pdeId;
			if (!pdeId) { return; }
			const folders = vscode.workspace.workspaceFolders;
			if (!folders) { return; }
			const jsonUri = vscode.Uri.joinPath(folders[0].uri, '.pde', `${pdeId}.json`);
			try {
				const doc = await vscode.workspace.openTextDocument(jsonUri);
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch {
				vscode.window.showWarningMessage(`PDE JSON not found: .pde/${pdeId}.json`);
			}
		}),
	);

	// Watch .pde/ directory
	const folders = vscode.workspace.workspaceFolders;
	if (folders) {
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folders[0], '.pde/*.json')
		);
		watcher.onDidCreate(() => { pdeExplorerProvider.refresh(); updateStatusBar(); });
		watcher.onDidChange(() => { pdeExplorerProvider.refresh(); updateStatusBar(); });
		watcher.onDidDelete(() => { pdeExplorerProvider.refresh(); updateStatusBar(); });
		context.subscriptions.push(watcher);
	}

	// Auto-detect: when .pde/ exists, set context for view visibility
	detectPdeDirectory().then(hasPde => {
		vscode.commands.executeCommand('setContext', 'mia.pdeExplorer.hasDecompositions', hasPde);
		if (hasPde) {
			statusBarItem.show();
			updateStatusBar();
		}
	});

	// Auto-detect on workspace folder change
	vscode.workspace.onDidChangeWorkspaceFolders(() => {
		detectPdeDirectory().then(hasPde => {
			vscode.commands.executeCommand('setContext', 'mia.pdeExplorer.hasDecompositions', hasPde);
			if (hasPde) { statusBarItem.show(); }
			else { statusBarItem.hide(); }
			pdeExplorerProvider.refresh();
			updateStatusBar();
		});
	});
}

function deactivate() {}

// allow-any-unicode-next-line
// ─── Auto-detect ────────────────────────────────────────────────

async function detectPdeDirectory() {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return false; }

	const config = vscode.workspace.getConfiguration('mia.pdeBridge');
	if (!config.get('autoDetect', true)) { return false; }

	const pdeDir = vscode.Uri.joinPath(folders[0].uri, '.pde');
	try {
		const stat = await vscode.workspace.fs.stat(pdeDir);
		return (stat.type & vscode.FileType.Directory) !== 0;
	} catch {
		return false;
	}
}

// allow-any-unicode-next-line
// ─── Status Bar ─────────────────────────────────────────────────

async function updateStatusBar() {
	if (!statusBarItem) { return; }
	const decomps = await loadPdeDecompositions();
	const count = decomps.length;
	if (count > 0) {
		statusBarItem.text = `\u{1F305} ${count} PDE${count !== 1 ? 's' : ''}`;
		statusBarItem.tooltip = `${count} PDE decomposition${count !== 1 ? 's' : ''} in workspace\nClick to refresh`;
		statusBarItem.show();
	} else {
		statusBarItem.text = '\u{1F305} 0 PDEs';
		statusBarItem.tooltip = 'No PDE decompositions found';
		statusBarItem.hide();
	}
}

// allow-any-unicode-next-line
// ─── Tree Data Provider ─────────────────────────────────────────

class PdeExplorerProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	refresh() { this._onDidChangeTreeData.fire(); }

	getTreeItem(element) { return element; }

	async getChildren(element) {
		// Direction children under a decomposition
		if (element && element.pdeData) {
			return buildDirectionItems(element.pdeData, element.pdeId);
		}

		// Root: list decompositions
		const decomps = await loadPdeDecompositions();

		if (decomps.length === 0) {
			const empty = new vscode.TreeItem('No PDE decompositions found', vscode.TreeItemCollapsibleState.None);
			empty.tooltip = 'Run mcp-pde to create decompositions in .pde/';
			return [empty];
		}

		return decomps.map(d => {
			const title = d.data?.originalPrompt
				? d.data.originalPrompt.substring(0, 60) + (d.data.originalPrompt.length > 60 ? '...' : '')
				: d.id;

			const actionCount = d.data?.decompositionResult?.actions?.length || 0;
			const item = new vscode.TreeItem(
				`\u{1F4CB} ${title}`,
				vscode.TreeItemCollapsibleState.Collapsed
			);
			item.contextValue = 'pdeDecomposition';
			item.pdeId = d.id;
			item.pdeData = d.data;
			item.description = `${actionCount} actions`;
			item.tooltip = `PDE: ${d.id}\nPrompt: ${d.data?.originalPrompt || 'unknown'}\nActions: ${actionCount}\nCreated: ${d.data?.metadata?.createdAt || 'unknown'}`;
			return item;
		});
	}
}

/**
 * Build tree items for the Four Directions of a PDE decomposition.
 * East = Vision (desired outcome), South = Planning (current reality),
 * West = Action (experience), North = Wisdom (reflection)
 */
function buildDirectionItems(pdeData, pdeId) {
	const items = [];
	const result = pdeData?.decompositionResult;
	if (!result) { return items; }

	// allow-any-unicode-next-line
	// East — Vision & Inquiry (desired outcome / primary intent)
	const eastLabel = DIRECTION_LABELS.east;
	const primaryIntent = result.primaryIntent || result.desiredOutcome || '';
	const eastItem = new vscode.TreeItem(
		`${eastLabel.emoji} East: ${primaryIntent.substring(0, 50) || 'Vision'}`,
		vscode.TreeItemCollapsibleState.None
	);
	eastItem.tooltip = `${eastLabel.name}\nPrimary Intent: ${primaryIntent}`;
	items.push(eastItem);

	// allow-any-unicode-next-line
	// South — Planning & Consent (implicit intents / context)
	const southLabel = DIRECTION_LABELS.south;
	const implicitIntents = result.implicitIntents || result.context || [];
	const southDesc = Array.isArray(implicitIntents)
		? implicitIntents.map(i => typeof i === 'string' ? i : i.intent || i.description || '').join('; ')
		: String(implicitIntents);
	const southItem = new vscode.TreeItem(
		`${southLabel.emoji} South: ${(southDesc || 'Planning').substring(0, 50)}`,
		vscode.TreeItemCollapsibleState.None
	);
	southItem.tooltip = `${southLabel.name}\nImplicit Intents: ${southDesc}`;
	items.push(southItem);

	// allow-any-unicode-next-line
	// West — Experience & Action (explicit actions)
	const westLabel = DIRECTION_LABELS.west;
	const actions = result.actions || result.explicitActions || [];
	if (actions.length > 0) {
		for (const action of actions) {
			const desc = typeof action === 'string' ? action : action.description || action.action || '';
			const westChild = new vscode.TreeItem(
				`${westLabel.emoji} ${desc.substring(0, 60)}`,
				vscode.TreeItemCollapsibleState.None
			);
			westChild.tooltip = `${westLabel.name}\nAction: ${desc}`;
			items.push(westChild);
		}
	} else {
		const westEmpty = new vscode.TreeItem(
			`${westLabel.emoji} West: No explicit actions`,
			vscode.TreeItemCollapsibleState.None
		);
		items.push(westEmpty);
	}

	// allow-any-unicode-next-line
	// North — Reflection & Wisdom (dependencies / validation)
	const northLabel = DIRECTION_LABELS.north;
	const deps = result.dependencies || result.validation || [];
	const northDesc = Array.isArray(deps)
		? deps.map(d => typeof d === 'string' ? d : d.description || d.from || '').join('; ')
		: String(deps);
	const northItem = new vscode.TreeItem(
		`${northLabel.emoji} North: ${(northDesc || 'Wisdom').substring(0, 50)}`,
		vscode.TreeItemCollapsibleState.None
	);
	northItem.tooltip = `${northLabel.name}\nDependencies/Validation: ${northDesc}`;
	items.push(northItem);

	// Link to preview and create chart
	const previewItem = new vscode.TreeItem('$(open-preview) Preview Markdown', vscode.TreeItemCollapsibleState.None);
	previewItem.command = { command: 'mia.pdeBridge.preview', title: 'Preview', arguments: [{ pdeId }] };
	items.push(previewItem);

	const chartItem = new vscode.TreeItem('$(graph) Create STC Chart', vscode.TreeItemCollapsibleState.None);
	chartItem.command = { command: 'mia.pdeBridge.createChart', title: 'Create Chart', arguments: [{ pdeId }] };
	items.push(chartItem);

	return items;
}

// allow-any-unicode-next-line
// ─── File Operations ────────────────────────────────────────────

async function loadPdeDecompositions() {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return []; }

	const pdeDir = vscode.Uri.joinPath(folders[0].uri, '.pde');
	try {
		const entries = await vscode.workspace.fs.readDirectory(pdeDir);
		const decomps = [];
		for (const [name] of entries) {
			if (name.endsWith('.json')) {
				try {
					const uri = vscode.Uri.joinPath(pdeDir, name);
					const content = await vscode.workspace.fs.readFile(uri);
					const data = JSON.parse(Buffer.from(content).toString());
					decomps.push({
						id: name.replace('.json', ''),
						data,
					});
				} catch { /* skip malformed */ }
			}
		}
		// Sort by creation date, newest first
		return decomps.sort((a, b) => {
			const dateA = a.data?.metadata?.createdAt || '';
			const dateB = b.data?.metadata?.createdAt || '';
			return dateB.localeCompare(dateA);
		});
	} catch {
		return [];
	}
}

// allow-any-unicode-next-line
// ─── PDE → STC Chart Creation ───────────────────────────────────

/**
 * Create an STC chart from a PDE decomposition.
 * Mapping:
 *   East  -> desired_outcome (primary intent / vision)
 *   South -> current_reality (context / implicit intents)
 *   North -> action_steps (dependencies mapped as steps)
 *   West  -> validation (actions become the work itself)
 */
async function createStcFromPde(pdeId) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return; }

	// Load PDE JSON
	const jsonUri = vscode.Uri.joinPath(folders[0].uri, '.pde', `${pdeId}.json`);
	let pdeData;
	try {
		const content = await vscode.workspace.fs.readFile(jsonUri);
		pdeData = JSON.parse(Buffer.from(content).toString());
	} catch {
		vscode.window.showErrorMessage(`Failed to read PDE decomposition: .pde/${pdeId}.json`);
		return;
	}

	const result = pdeData.decompositionResult || {};
	const chartId = `chart_${pdeId.substring(0, 12)}`;
	const now = new Date().toISOString();

	// allow-any-unicode-next-line
	// East → Desired Outcome
	const desiredOutcome = result.primaryIntent || result.desiredOutcome || pdeData.originalPrompt || 'Unnamed vision';

	// allow-any-unicode-next-line
	// South → Current Reality
	const implicitIntents = result.implicitIntents || result.context || [];
	const currentReality = Array.isArray(implicitIntents)
		? implicitIntents.map(i => typeof i === 'string' ? i : i.intent || i.description || '').filter(Boolean).join('. ')
		: String(implicitIntents || 'No context captured');

	// allow-any-unicode-next-line
	// North → Action Steps (from dependencies)
	const actions = result.actions || result.explicitActions || [];
	const deps = result.dependencies || [];
	const actionSteps = actions.map((action, i) => ({
		id: `${chartId}_action_${i + 1}`,
		description: typeof action === 'string' ? action : action.description || action.action || '',
		completed: false,
		order: i + 1,
	}));

	// allow-any-unicode-next-line
	// West → Validation observations
	const validation = result.validation || result.westValidation || [];
	const validationNotes = Array.isArray(validation)
		? validation.map(v => typeof v === 'string' ? v : v.description || '').filter(Boolean)
		: [];

	// Build COAIA JSONL entities
	const entities = [];
	const relations = [];

	// Chart entity
	entities.push({
		type: 'entity',
		name: `${chartId}_chart`,
		entityType: 'structural_tension_chart',
		observations: [`Master chart for: ${pdeData.originalPrompt || desiredOutcome}`],
		metadata: {
			chartId,
			phase: 'germination',
			pdeId,
			direction: vscode.workspace.getConfiguration('mia.pdeBridge').get('defaultDirection', 'east'),
			createdAt: now,
			updatedAt: now,
		},
	});

	// Desired outcome entity
	entities.push({
		type: 'entity',
		name: `${chartId}_desired_outcome`,
		entityType: 'desired_outcome',
		observations: [desiredOutcome],
		metadata: { chartId },
	});
	relations.push({
		type: 'relation',
		from: `${chartId}_chart`,
		to: `${chartId}_desired_outcome`,
		relationType: 'has_desired_outcome',
	});

	// Current reality entity
	entities.push({
		type: 'entity',
		name: `${chartId}_current_reality`,
		entityType: 'current_reality',
		observations: [currentReality || 'No current reality captured from PDE context'],
		metadata: { chartId },
	});
	relations.push({
		type: 'relation',
		from: `${chartId}_chart`,
		to: `${chartId}_current_reality`,
		relationType: 'has_current_reality',
	});

	// Action step entities
	for (const step of actionSteps) {
		entities.push({
			type: 'entity',
			name: step.id,
			entityType: 'action_step',
			observations: [step.description],
			metadata: { chartId, status: 'pending', order: step.order },
		});
		relations.push({
			type: 'relation',
			from: `${chartId}_chart`,
			to: step.id,
			relationType: 'has_action_step',
		});
	}

	// Validation observations on the chart entity
	if (validationNotes.length > 0) {
		entities[0].observations.push(`Validation: ${validationNotes.join('; ')}`);
	}

	// Write JSONL to .coaia/pde/
	const coaiaDir = vscode.Uri.joinPath(folders[0].uri, '.coaia', 'pde');
	await vscode.workspace.fs.createDirectory(coaiaDir);

	const jsonlLines = [...entities, ...relations].map(obj => JSON.stringify(obj)).join('\n');
	const jsonlUri = vscode.Uri.joinPath(coaiaDir, `${chartId}.jsonl`);
	await vscode.workspace.fs.writeFile(jsonlUri, Buffer.from(jsonlLines));

	vscode.window.showInformationMessage(`Created STC chart from PDE: ${chartId}`);

	// Refresh the STC Charts explorer if available
	try {
		await vscode.commands.executeCommand('mia.stcCharts.refresh');
	} catch { /* STC Charts extension may not be active */ }

	pdeExplorerProvider.refresh();
	updateStatusBar();

	// Log narrative event
	if (miaApi && miaApi.isConnected()) {
		const log = miaApi.getOutputChannel('narrative');
		if (log) { log.info(`[PDE Bridge] Created STC chart ${chartId} from PDE ${pdeId}`); }
	}
}

module.exports = { activate, deactivate };
