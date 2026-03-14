/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');

let miaApi = null;
let statusBarItem = null;
let pdeExplorerProvider = null;

// allow-any-unicode-next-line
// Four Directions mapping for PDE -> STC conversion
const DIRECTION_MAP = {
	east: 'desired_outcome',
	south: 'current_reality',
	west: 'action_steps',
	north: 'validation',
};

const DIRECTION_LABELS = {
	east: { emoji: '\u{1F305}', name: 'East \u2014 Vision & Inquiry' },
	south: { emoji: '\u{1F525}', name: 'South \u2014 Planning & Consent' },
	west: { emoji: '\u{1F30A}', name: 'West \u2014 Experience & Action' },
	north: { emoji: '\u{2744}\u{FE0F}', name: 'North \u2014 Reflection & Wisdom' },
};

// --- Activation ---

function activate(context) {
	const coreExt = vscode.extensions.getExtension('mia.three-universe');
	if (coreExt) {
		miaApi = coreExt.exports;
	}

	pdeExplorerProvider = new PdeExplorerProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('mia.pdeExplorer', pdeExplorerProvider)
	);

	// Status bar: PDE count
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 35);
	statusBarItem.command = 'mia.pdeBridge.refresh';
	context.subscriptions.push(statusBarItem);
	updateStatusBar();

	// Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('mia.pdeBridge.preview', previewPde),
		vscode.commands.registerCommand('mia.pdeBridge.createChart', createChartFromItem),
		vscode.commands.registerCommand('mia.pdeBridge.refresh', () => {
			pdeExplorerProvider.refresh();
			updateStatusBar();
		}),
		vscode.commands.registerCommand('mia.pdeBridge.openJson', openPdeJson),
	);

	// Watch .pde/ for changes: flat and one-level nested
	const folders = vscode.workspace.workspaceFolders;
	if (folders) {
		const flatWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folders[0], '.pde/*.json')
		);
		const nestedWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folders[0], '.pde/*/.pde/*.json')
		);
		const onChanged = () => {
			pdeExplorerProvider.refresh();
			updateStatusBar();
		};
		flatWatcher.onDidCreate(onChanged);
		flatWatcher.onDidChange(onChanged);
		flatWatcher.onDidDelete(onChanged);
		nestedWatcher.onDidCreate(onChanged);
		nestedWatcher.onDidChange(onChanged);
		nestedWatcher.onDidDelete(onChanged);
		context.subscriptions.push(flatWatcher, nestedWatcher);
	}

	// Auto-detect: set context key when .pde/ exists
	detectPdeDirectory().then(hasPde => {
		vscode.commands.executeCommand('setContext', 'mia.pdeExplorer.hasDecompositions', hasPde);
		if (hasPde) {
			statusBarItem.show();
			updateStatusBar();
		}
	});

	// Re-detect on workspace folder change
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			detectPdeDirectory().then(hasPde => {
				vscode.commands.executeCommand('setContext', 'mia.pdeExplorer.hasDecompositions', hasPde);
				if (hasPde) {
					statusBarItem.show();
				} else {
					statusBarItem.hide();
				}
				pdeExplorerProvider.refresh();
				updateStatusBar();
			});
		})
	);
}

function deactivate() {}

// --- Command handlers ---

async function previewPde(item) {
	if (!item || !item.dirUri || !item.pdeId) {
		vscode.window.showInformationMessage('Select a PDE decomposition to preview.');
		return;
	}
	const mdUri = vscode.Uri.joinPath(item.dirUri, `${item.pdeId}.md`);
	try {
		await vscode.workspace.fs.stat(mdUri);
		const doc = await vscode.workspace.openTextDocument(mdUri);
		await vscode.window.showTextDocument(doc, { preview: true });
	} catch {
		// Fall back to JSON if .md not found
		try {
			const doc = await vscode.workspace.openTextDocument(item.jsonUri);
			await vscode.window.showTextDocument(doc, { preview: true });
		} catch {
			vscode.window.showWarningMessage(`PDE file not found for: ${item.pdeId}`);
		}
	}
}

async function createChartFromItem(item) {
	if (!item || !item.jsonUri || !item.pdeId) {
		vscode.window.showInformationMessage('Select a PDE decomposition to create an STC chart.');
		return;
	}
	await createStcFromPde(item.pdeId, item.jsonUri);
}

async function openPdeJson(item) {
	if (!item || !item.jsonUri) { return; }
	try {
		const doc = await vscode.workspace.openTextDocument(item.jsonUri);
		await vscode.window.showTextDocument(doc, { preview: true });
	} catch {
		vscode.window.showWarningMessage(`PDE JSON not found: ${item.pdeId}`);
	}
}

// --- Auto-detect ---

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

// --- Status Bar ---

async function updateStatusBar() {
	if (!statusBarItem) { return; }
	try {
		const decomps = await loadPdeDecompositions();
		const count = decomps.length;
		if (count > 0) {
			// allow-any-unicode-next-line
			statusBarItem.text = `\u{1F305} ${count} PDE${count !== 1 ? 's' : ''}`;
			statusBarItem.tooltip = `${count} PDE decomposition${count !== 1 ? 's' : ''} in workspace\nClick to refresh`;
			statusBarItem.show();
		} else {
			// allow-any-unicode-next-line
			statusBarItem.text = '\u{1F305} 0 PDEs';
			statusBarItem.tooltip = 'No PDE decompositions found';
			statusBarItem.hide();
		}
	} catch {
		statusBarItem.hide();
	}
}

// --- Tree Data Provider ---

class PdeExplorerProvider {
	constructor() {
		this._onDidChangeTreeData = new vscode.EventEmitter();
		this.onDidChangeTreeData = this._onDidChangeTreeData.event;
	}

	refresh() { this._onDidChangeTreeData.fire(); }

	getTreeItem(element) { return element; }

	async getChildren(element) {
		// Direction group children (individual items within a direction)
		if (element && element.contextValue === 'pdeDirectionGroup') {
			return element.directionChildren || [];
		}

		// Direction children under a decomposition node
		if (element && element.contextValue === 'pdeDecomposition') {
			return buildDirectionItems(element.pdeData, element.pdeId, element.jsonUri, element.dirUri);
		}

		// Root: list all decompositions
		const decomps = await loadPdeDecompositions();

		if (decomps.length === 0) {
			const empty = new vscode.TreeItem('No PDE decompositions found', vscode.TreeItemCollapsibleState.None);
			empty.tooltip = 'Run mcp-pde to create decompositions in .pde/';
			return [empty];
		}

		return decomps.map(d => {
			const title = extractTitle(d.data);
			const actionCount = countActions(d.data);
			// allow-any-unicode-next-line
			const item = new vscode.TreeItem(`\u{1F4CB} ${title}`, vscode.TreeItemCollapsibleState.Collapsed);
			item.contextValue = 'pdeDecomposition';
			item.pdeId = d.id;
			item.pdeData = d.data;
			item.jsonUri = d.jsonUri;
			item.dirUri = d.dirUri;
			item.description = actionCount > 0 ? `${actionCount} actions` : '';
			item.tooltip = buildDecompTooltip(d);
			return item;
		});
	}
}

/**
 * Extract a display title from PDE data, handling both format variants.
 * Format 1: result.primary.target | Format 2: primaryIntent | Fallback: prompt
 */
function extractTitle(data) {
	if (!data) { return 'Unknown'; }
	// Format 2: has primaryIntent
	if (data.primaryIntent) {
		const text = data.primaryIntent;
		return text.length > 60 ? text.substring(0, 60) + '...' : text;
	}
	// Format 1: has result.primary.target
	if (data.result && data.result.primary && data.result.primary.target) {
		const text = data.result.primary.target;
		return text.length > 60 ? text.substring(0, 60) + '...' : text;
	}
	// Fallback: originalPrompt or prompt
	const prompt = data.originalPrompt || data.prompt || '';
	if (prompt) {
		return prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt;
	}
	return data.id || 'Untitled';
}

/**
 * Count actions from PDE data (actionStack or result.secondary).
 */
function countActions(data) {
	if (!data) { return 0; }
	if (Array.isArray(data.actionStack)) { return data.actionStack.length; }
	if (data.result && Array.isArray(data.result.secondary)) { return data.result.secondary.length; }
	return 0;
}

/**
 * Build a rich tooltip string for a decomposition tree node.
 */
function buildDecompTooltip(decomp) {
	const d = decomp.data;
	const parts = [`PDE: ${decomp.id}`];
	if (d.primaryIntent) { parts.push(`Intent: ${d.primaryIntent}`); }
	if (d.originalPrompt || d.prompt) {
		parts.push(`Prompt: ${(d.originalPrompt || d.prompt).substring(0, 100)}`);
	}
	if (d.confidence !== undefined) { parts.push(`Confidence: ${Math.round(d.confidence * 100)}%`); }
	if (d.timestamp) { parts.push(`Created: ${d.timestamp}`); }
	if (d.metadata && d.metadata.createdAt) { parts.push(`Created: ${d.metadata.createdAt}`); }
	const count = countActions(d);
	if (count > 0) { parts.push(`Actions: ${count}`); }
	return parts.join('\n');
}

/**
 * Build tree items for the Four Directions of a PDE decomposition.
 * Handles Format 1 (result.primary/secondary) and Format 2 (fourDirections/actionStack).
 */
function buildDirectionItems(pdeData, pdeId, jsonUri, dirUri) {
	if (!pdeData) { return []; }
	const items = [];

	const hasFourDirections = pdeData.fourDirections && typeof pdeData.fourDirections === 'object';
	const hasResultFormat = pdeData.result && pdeData.result.primary;

	if (hasFourDirections) {
		items.push(...buildFourDirectionsTree(pdeData));
	} else if (hasResultFormat) {
		items.push(...buildResultFormatTree(pdeData));
	} else {
		items.push(...buildFallbackTree(pdeData));
	}

	// Quick-action links at bottom
	const previewItem = new vscode.TreeItem('$(open-preview) Preview Markdown', vscode.TreeItemCollapsibleState.None);
	previewItem.command = { command: 'mia.pdeBridge.preview', title: 'Preview', arguments: [{ pdeId, dirUri, jsonUri }] };
	previewItem.contextValue = 'pdeQuickAction';
	items.push(previewItem);

	const chartItem = new vscode.TreeItem('$(graph) Create STC Chart', vscode.TreeItemCollapsibleState.None);
	chartItem.command = { command: 'mia.pdeBridge.createChart', title: 'Create Chart', arguments: [{ pdeId, jsonUri }] };
	chartItem.contextValue = 'pdeQuickAction';
	items.push(chartItem);

	return items;
}

/**
 * Format 2 tree: explicit fourDirections with observations and actionStack items.
 */
function buildFourDirectionsTree(pdeData) {
	const groups = [];

	for (const dir of ['east', 'south', 'west', 'north']) {
		const dirData = pdeData.fourDirections[dir];
		const label = DIRECTION_LABELS[dir];
		if (!dirData) { continue; }

		const summary = dirData.summary || '';
		const observations = dirData.observations || dirData.items || [];
		const dirActions = (pdeData.actionStack || []).filter(a => a.direction === dir);

		const childItems = [];

		// Summary as first child
		if (summary) {
			const sumItem = new vscode.TreeItem(
				truncate(summary, 80),
				vscode.TreeItemCollapsibleState.None
			);
			sumItem.tooltip = summary;
			sumItem.contextValue = 'pdeSummary';
			childItems.push(sumItem);
		}

		// Observation items
		for (const obs of observations) {
			const text = typeof obs === 'string' ? obs : (obs.description || obs.action || JSON.stringify(obs));
			const obsItem = new vscode.TreeItem(
				truncate(text, 70),
				vscode.TreeItemCollapsibleState.None
			);
			obsItem.tooltip = text;
			obsItem.contextValue = 'pdeObservation';
			childItems.push(obsItem);
		}

		// Action items in this direction
		for (const act of dirActions) {
			const desc = act.description || act.action || '';
			const priority = act.priority ? ` [${act.priority}]` : '';
			const status = act.status ? ` (${act.status})` : '';
			const actItem = new vscode.TreeItem(
				`${truncate(desc, 55)}${priority}${status}`,
				vscode.TreeItemCollapsibleState.None
			);
			actItem.tooltip = `Action: ${desc}\nPriority: ${act.priority || 'unknown'}\nStatus: ${act.status || 'unknown'}`;
			actItem.contextValue = 'pdeAction';
			childItems.push(actItem);
		}

		const hasChildren = childItems.length > 0;
		const groupItem = new vscode.TreeItem(
			`${label.emoji} ${label.name}`,
			hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		groupItem.contextValue = 'pdeDirectionGroup';
		groupItem.description = hasChildren ? `${childItems.length} items` : '';
		groupItem.tooltip = `${label.name}\n${summary || ''}`;
		groupItem.directionChildren = childItems;
		groups.push(groupItem);
	}

	return groups;
}

/**
 * Format 1 tree: result.primary / result.secondary with implicit/explicit split.
 */
function buildResultFormatTree(pdeData) {
	const groups = [];
	const primary = pdeData.result.primary;
	const secondary = pdeData.result.secondary || [];

	// East - Vision: primary intent
	const eastLabel = DIRECTION_LABELS.east;
	const primaryText = `${primary.action}: ${primary.target}`;
	const eastChild = new vscode.TreeItem(truncate(primaryText, 70), vscode.TreeItemCollapsibleState.None);
	eastChild.tooltip = `Primary: ${primaryText}\nConfidence: ${Math.round((primary.confidence || 0) * 100)}%`;
	const eastGroup = new vscode.TreeItem(
		`${eastLabel.emoji} ${eastLabel.name}`,
		vscode.TreeItemCollapsibleState.Collapsed
	);
	eastGroup.contextValue = 'pdeDirectionGroup';
	eastGroup.description = '1 item';
	eastGroup.directionChildren = [eastChild];
	groups.push(eastGroup);

	// South - Planning: implicit secondary items
	const southLabel = DIRECTION_LABELS.south;
	const implicitItems = secondary.filter(s => s.implicit);
	const southChildren = implicitItems.map(s => {
		const text = `${s.action}: ${s.target}`;
		const sItem = new vscode.TreeItem(truncate(text, 70), vscode.TreeItemCollapsibleState.None);
		sItem.tooltip = `${text}\nConfidence: ${Math.round((s.confidence || 0) * 100)}%`;
		return sItem;
	});
	const southGroup = new vscode.TreeItem(
		`${southLabel.emoji} ${southLabel.name}`,
		southChildren.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
	);
	southGroup.contextValue = 'pdeDirectionGroup';
	southGroup.description = southChildren.length > 0 ? `${southChildren.length} items` : '';
	southGroup.directionChildren = southChildren;
	groups.push(southGroup);

	// West - Action: explicit secondary items
	const westLabel = DIRECTION_LABELS.west;
	const explicitItems = secondary.filter(s => !s.implicit);
	const westChildren = explicitItems.map(s => {
		const text = `${s.action}: ${s.target}`;
		const dep = s.dependency ? ` (dep: ${s.dependency})` : '';
		const wItem = new vscode.TreeItem(
			`${truncate(text, 60)}${dep}`,
			vscode.TreeItemCollapsibleState.None
		);
		wItem.tooltip = `${text}\nConfidence: ${Math.round((s.confidence || 0) * 100)}%${dep}`;
		return wItem;
	});
	const westGroup = new vscode.TreeItem(
		`${westLabel.emoji} ${westLabel.name}`,
		westChildren.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
	);
	westGroup.contextValue = 'pdeDirectionGroup';
	westGroup.description = westChildren.length > 0 ? `${westChildren.length} items` : '';
	westGroup.directionChildren = westChildren;
	groups.push(westGroup);

	// North - Reflection: items that declare dependencies
	const northLabel = DIRECTION_LABELS.north;
	const depsWithDep = secondary.filter(s => s.dependency);
	const northChildren = depsWithDep.map(s => {
		const text = `${s.action} depends on ${s.dependency}`;
		const nItem = new vscode.TreeItem(truncate(text, 70), vscode.TreeItemCollapsibleState.None);
		nItem.tooltip = text;
		return nItem;
	});
	const northGroup = new vscode.TreeItem(
		`${northLabel.emoji} ${northLabel.name}`,
		northChildren.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
	);
	northGroup.contextValue = 'pdeDirectionGroup';
	northGroup.description = northChildren.length > 0 ? `${northChildren.length} items` : '';
	northGroup.directionChildren = northChildren;
	groups.push(northGroup);

	return groups;
}

/**
 * Fallback tree: top-level fields only (primaryIntent, implicitIntents, actionStack).
 */
function buildFallbackTree(pdeData) {
	const items = [];

	if (pdeData.primaryIntent) {
		const eastLabel = DIRECTION_LABELS.east;
		const eastItem = new vscode.TreeItem(
			`${eastLabel.emoji} ${truncate(pdeData.primaryIntent, 60)}`,
			vscode.TreeItemCollapsibleState.None
		);
		eastItem.tooltip = `${eastLabel.name}\n${pdeData.primaryIntent}`;
		items.push(eastItem);
	}

	if (Array.isArray(pdeData.implicitIntents) && pdeData.implicitIntents.length > 0) {
		const southLabel = DIRECTION_LABELS.south;
		for (const intent of pdeData.implicitIntents) {
			const text = typeof intent === 'string' ? intent : (intent.intent || intent.description || '');
			if (text) {
				const sItem = new vscode.TreeItem(
					`${southLabel.emoji} ${truncate(text, 60)}`,
					vscode.TreeItemCollapsibleState.None
				);
				sItem.tooltip = `${southLabel.name}\n${text}`;
				items.push(sItem);
			}
		}
	}

	if (Array.isArray(pdeData.actionStack)) {
		const westLabel = DIRECTION_LABELS.west;
		for (const action of pdeData.actionStack) {
			const desc = action.description || action.action || '';
			if (desc) {
				const wItem = new vscode.TreeItem(
					`${westLabel.emoji} ${truncate(desc, 60)}`,
					vscode.TreeItemCollapsibleState.None
				);
				wItem.tooltip = `${westLabel.name}\n${desc}`;
				items.push(wItem);
			}
		}
	}

	return items;
}

// --- File Operations ---

/**
 * Read a file via vscode.workspace.fs and decode to string.
 */
async function readFileAsText(uri) {
	const raw = await vscode.workspace.fs.readFile(uri);
	return new TextDecoder('utf-8').decode(raw);
}

/**
 * Attempt to read and parse a JSON file. Returns null on any failure.
 */
async function tryParseJsonFile(uri) {
	try {
		const text = await readFileAsText(uri);
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Load all PDE decomposition JSON files from the workspace.
 * Scans both flat .pde/*.json and nested .pde/<subdir>/.pde/*.json patterns.
 */
async function loadPdeDecompositions() {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return []; }

	const pdeDir = vscode.Uri.joinPath(folders[0].uri, '.pde');
	const decomps = [];

	try {
		const entries = await vscode.workspace.fs.readDirectory(pdeDir);

		for (const [name, type] of entries) {
			if (name.endsWith('.json') && (type & vscode.FileType.File) !== 0) {
				// Flat: .pde/<name>.json
				const jsonUri = vscode.Uri.joinPath(pdeDir, name);
				const parsed = await tryParseJsonFile(jsonUri);
				if (parsed) {
					decomps.push({
						id: name.replace(/\.json$/, ''),
						data: parsed,
						jsonUri,
						dirUri: pdeDir,
					});
				}
			} else if ((type & vscode.FileType.Directory) !== 0) {
				// Nested: .pde/<subdir>/.pde/*.json
				const nestedPdeDir = vscode.Uri.joinPath(pdeDir, name, '.pde');
				try {
					const nestedEntries = await vscode.workspace.fs.readDirectory(nestedPdeDir);
					for (const [nestedName, nestedType] of nestedEntries) {
						if (nestedName.endsWith('.json') && (nestedType & vscode.FileType.File) !== 0) {
							const jsonUri = vscode.Uri.joinPath(nestedPdeDir, nestedName);
							const parsed = await tryParseJsonFile(jsonUri);
							if (parsed) {
								decomps.push({
									id: nestedName.replace(/\.json$/, ''),
									data: parsed,
									jsonUri,
									dirUri: nestedPdeDir,
								});
							}
						}
					}
				} catch {
					// Subdirectory may not contain a .pde/ folder
				}
			}
		}
	} catch {
		return [];
	}

	// Sort by timestamp, newest first
	return decomps.sort((a, b) => {
		const dateA = a.data.timestamp || (a.data.metadata && a.data.metadata.createdAt) || '';
		const dateB = b.data.timestamp || (b.data.metadata && b.data.metadata.createdAt) || '';
		return String(dateB).localeCompare(String(dateA));
	});
}

// --- PDE -> STC Chart Creation ---

/**
 * Create a COAIA JSONL structural tension chart from a PDE decomposition.
 * Maps Four Directions: East=desired_outcome, South=current_reality,
 * West=action_steps, North=validation/reflection.
 */
async function createStcFromPde(pdeId, jsonUri) {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) { return; }

	let pdeData;
	try {
		const text = await readFileAsText(jsonUri);
		pdeData = JSON.parse(text);
	} catch {
		vscode.window.showErrorMessage(`Failed to read PDE decomposition: ${pdeId}`);
		return;
	}

	const chartId = `chart_${pdeId.substring(0, 12)}`;
	const now = new Date().toISOString();

	const desiredOutcome = extractDesiredOutcome(pdeData);
	const currentReality = extractCurrentReality(pdeData);
	const actionSteps = extractActionSteps(pdeData, chartId);
	const validationNotes = extractValidation(pdeData);

	const entities = [];
	const relations = [];

	// Chart entity
	entities.push({
		type: 'entity',
		name: `${chartId}_chart`,
		entityType: 'structural_tension_chart',
		observations: [`Master chart for: ${pdeData.originalPrompt || pdeData.prompt || desiredOutcome}`],
		metadata: {
			chartId,
			phase: 'germination',
			pdeId,
			direction: vscode.workspace.getConfiguration('mia.pdeBridge').get('defaultDirection', 'east'),
			createdAt: now,
			updatedAt: now,
		},
	});

	// Desired outcome entity (East)
	entities.push({
		type: 'entity',
		name: `${chartId}_desired_outcome`,
		entityType: 'desired_outcome',
		observations: [desiredOutcome],
		metadata: { chartId, direction: 'east' },
	});
	relations.push({
		type: 'relation',
		from: `${chartId}_chart`,
		to: `${chartId}_desired_outcome`,
		relationType: 'has_desired_outcome',
	});

	// Current reality entity (South)
	entities.push({
		type: 'entity',
		name: `${chartId}_current_reality`,
		entityType: 'current_reality',
		observations: [currentReality || 'No current reality captured from PDE context'],
		metadata: { chartId, direction: 'south' },
	});
	relations.push({
		type: 'relation',
		from: `${chartId}_chart`,
		to: `${chartId}_current_reality`,
		relationType: 'has_current_reality',
	});

	// Action step entities (West)
	for (const step of actionSteps) {
		entities.push({
			type: 'entity',
			name: step.id,
			entityType: 'action_step',
			observations: [step.description],
			metadata: {
				chartId,
				status: step.status || 'pending',
				order: step.order,
				direction: step.direction || 'west',
			},
		});
		relations.push({
			type: 'relation',
			from: `${chartId}_chart`,
			to: step.id,
			relationType: 'has_action_step',
		});
	}

	// Dependency relations between action steps
	for (const step of actionSteps) {
		if (Array.isArray(step.dependencies)) {
			for (const depId of step.dependencies) {
				const depStep = actionSteps.find(s => s.sourceId === depId);
				if (depStep) {
					relations.push({
						type: 'relation',
						from: depStep.id,
						to: step.id,
						relationType: 'blocks',
					});
				}
			}
		}
	}

	// Validation notes on the chart entity (North)
	if (validationNotes.length > 0) {
		entities[0].observations.push(`Validation: ${validationNotes.join('; ')}`);
	}

	// Write JSONL to .coaia/pde/
	const coaiaDir = vscode.Uri.joinPath(folders[0].uri, '.coaia', 'pde');
	try {
		await vscode.workspace.fs.createDirectory(coaiaDir);
	} catch {
		// Directory may already exist
	}

	const jsonlLines = [...entities, ...relations].map(obj => JSON.stringify(obj)).join('\n');
	const jsonlUri = vscode.Uri.joinPath(coaiaDir, `${chartId}.jsonl`);
	await vscode.workspace.fs.writeFile(jsonlUri, new TextEncoder().encode(jsonlLines));

	vscode.window.showInformationMessage(`Created STC chart from PDE: ${chartId}`);

	// Refresh STC Charts explorer if available
	try {
		await vscode.commands.executeCommand('mia.stcCharts.refresh');
	} catch {
		// STC Charts extension may not be active
	}

	pdeExplorerProvider.refresh();
	updateStatusBar();

	// Log narrative event (best-effort)
	if (miaApi && typeof miaApi.isConnected === 'function' && miaApi.isConnected()) {
		try {
			const log = miaApi.getOutputChannel('narrative');
			if (log) { log.info(`[PDE Bridge] Created STC chart ${chartId} from PDE ${pdeId}`); }
		} catch {
			// Narrative logging is best-effort
		}
	}
}

// --- STC extraction helpers ---

/**
 * Extract desired outcome (East) from PDE data.
 */
function extractDesiredOutcome(data) {
	if (data.fourDirections && data.fourDirections.east) {
		return data.fourDirections.east.summary || data.primaryIntent || '';
	}
	if (data.primaryIntent) {
		return data.primaryIntent;
	}
	if (data.result && data.result.primary) {
		return `${data.result.primary.action}: ${data.result.primary.target}`;
	}
	return data.originalPrompt || data.prompt || 'Unnamed vision';
}

/**
 * Extract current reality (South) from PDE data.
 */
function extractCurrentReality(data) {
	if (data.fourDirections && data.fourDirections.south) {
		const south = data.fourDirections.south;
		const parts = [];
		if (south.summary) { parts.push(south.summary); }
		if (Array.isArray(south.observations)) {
			parts.push(...south.observations.map(o => typeof o === 'string' ? o : (o.description || '')));
		}
		return parts.filter(Boolean).join('. ');
	}
	if (Array.isArray(data.implicitIntents) && data.implicitIntents.length > 0) {
		return data.implicitIntents
			.map(i => typeof i === 'string' ? i : (i.intent || i.description || ''))
			.filter(Boolean).join('. ');
	}
	if (data.result && Array.isArray(data.result.secondary)) {
		const implicit = data.result.secondary.filter(s => s.implicit);
		if (implicit.length > 0) {
			return implicit.map(s => `${s.action}: ${s.target}`).join('. ');
		}
	}
	return '';
}

/**
 * Extract action steps from PDE data. Returns array of step objects.
 */
function extractActionSteps(data, chartId) {
	const steps = [];

	if (Array.isArray(data.actionStack)) {
		for (let i = 0; i < data.actionStack.length; i++) {
			const act = data.actionStack[i];
			steps.push({
				id: `${chartId}_action_${i + 1}`,
				sourceId: act.id || `action-${i + 1}`,
				description: act.description || act.action || '',
				status: act.status || 'pending',
				order: i + 1,
				direction: act.direction || 'west',
				dependencies: act.dependencies || [],
			});
		}
		return steps;
	}

	if (data.result && Array.isArray(data.result.secondary)) {
		const explicit = data.result.secondary.filter(s => !s.implicit);
		for (let i = 0; i < explicit.length; i++) {
			const s = explicit[i];
			steps.push({
				id: `${chartId}_action_${i + 1}`,
				sourceId: null,
				description: `${s.action}: ${s.target}`,
				status: 'pending',
				order: i + 1,
				direction: 'west',
				dependencies: s.dependency ? [s.dependency] : [],
			});
		}
	}

	return steps;
}

/**
 * Extract validation/reflection notes (North) from PDE data.
 */
function extractValidation(data) {
	if (data.fourDirections && data.fourDirections.north) {
		const north = data.fourDirections.north;
		const parts = [];
		if (north.summary) { parts.push(north.summary); }
		if (Array.isArray(north.observations)) {
			parts.push(...north.observations.map(o => typeof o === 'string' ? o : (o.description || '')));
		}
		return parts.filter(Boolean);
	}
	return [];
}

// --- Utility ---

function truncate(text, maxLen) {
	if (!text) { return ''; }
	return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

module.exports = { activate, deactivate };
