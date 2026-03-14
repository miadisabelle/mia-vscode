/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-next-line
// Editor Intelligence extension — CodeLens, hover, decorations, diagnostics, code actions
// Implements: mia-vscode/rispecs/extensions/07-editor-intelligence.spec.md
const vscode = require('vscode');

let miaApi = null;

// Analysis results cache: fileUri string -> ThreeUniverseResult
const analysisCache = new Map();
// Dismissed diagnostics: Set of "fileUri::insightId"
const dismissedDiagnostics = new Set();

let codeLensProvider = null;
let diagnosticCollection = null;

// Decoration types
let engineerGutterType = null;
let ceremonyGutterType = null;
let storyGutterType = null;
let significanceAnnotationType = null;
let blockHighlightType = null;

// Spec.md decoration types for Structural Tension
let desiredOutcomeGutterType = null;
let currentRealityGutterType = null;
let structuralTensionGutterType = null;

// PDE/COAIA CodeLens providers
let pdeCodeLensProvider = null;
let coaiaCodeLensProvider = null;

// PDE/COAIA diagnostics collection
let pdeDiagnosticCollection = null;

function activate(context) {
	const coreExt = vscode.extensions.getExtension('mia.three-universe');
	if (coreExt) {
		miaApi = coreExt.exports;
	}

// allow-any-unicode-next-line
	// ─── Decoration Types ───────────────────────────────────────
	engineerGutterType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: makeGutterSvgUri('#4A9EFF'),
		gutterIconSize: '60%',
		overviewRulerColor: '#4A9EFF33',
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	});

	ceremonyGutterType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: makeGutterSvgUri('#4ADE80'),
		gutterIconSize: '60%',
		overviewRulerColor: '#4ADE8033',
		overviewRulerLane: vscode.OverviewRulerLane.Center,
	});

	storyGutterType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: makeGutterSvgUri('#A78BFA'),
		gutterIconSize: '60%',
		overviewRulerColor: '#A78BFA33',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});

	significanceAnnotationType = vscode.window.createTextEditorDecorationType({
		after: {
			color: '#565F8966',
			fontStyle: 'italic',
			margin: '0 0 0 2em',
		},
		isWholeLine: true,
	});

	blockHighlightType = vscode.window.createTextEditorDecorationType({
		backgroundColor: '#4A9EFF08',
		isWholeLine: true,
	});

// allow-any-unicode-next-line
	// ─── Spec.md Structural Tension Decorations ────────────────
	desiredOutcomeGutterType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: makeGutterSvgUri('#4ADE80'),
		gutterIconSize: '70%',
		overviewRulerColor: '#4ADE8044',
		overviewRulerLane: vscode.OverviewRulerLane.Left,
		isWholeLine: true,
		backgroundColor: '#4ADE8008',
	});

	currentRealityGutterType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: makeGutterSvgUri('#F59E0B'),
		gutterIconSize: '70%',
		overviewRulerColor: '#F59E0B44',
		overviewRulerLane: vscode.OverviewRulerLane.Center,
		isWholeLine: true,
		backgroundColor: '#F59E0B08',
	});

	structuralTensionGutterType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: makeGutterSvgUri('#A78BFA'),
		gutterIconSize: '70%',
		overviewRulerColor: '#A78BFA44',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		isWholeLine: true,
		backgroundColor: '#A78BFA08',
	});

// allow-any-unicode-next-line
	// ─── CodeLens Provider ──────────────────────────────────────
	codeLensProvider = new NarrativeCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
	);

// allow-any-unicode-next-line
	// ─── PDE CodeLens Provider ─────────────────────────────────
	pdeCodeLensProvider = new PdeCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ scheme: 'file', pattern: '**/.pde/*.{json,md}' },
			pdeCodeLensProvider
		)
	);

// allow-any-unicode-next-line
	// ─── COAIA CodeLens Provider ───────────────────────────────
	coaiaCodeLensProvider = new CoaiaCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ scheme: 'file', pattern: '**/.coaia/**/*.jsonl' },
			coaiaCodeLensProvider
		)
	);

// allow-any-unicode-next-line
	// ─── PDE Diagnostics ───────────────────────────────────────
	pdeDiagnosticCollection = vscode.languages.createDiagnosticCollection('mia-pde');
	context.subscriptions.push(pdeDiagnosticCollection);

// allow-any-unicode-next-line
	// ─── Hover Provider ─────────────────────────────────────────
	const hoverProvider = new NarrativeHoverProvider();
	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider)
	);

// allow-any-unicode-next-line
	// ─── Diagnostics ────────────────────────────────────────────
	diagnosticCollection = vscode.languages.createDiagnosticCollection('mia');
	context.subscriptions.push(diagnosticCollection);

// allow-any-unicode-next-line
	// ─── Code Action Provider ───────────────────────────────────
	const codeActionProvider = new NarrativeCodeActionProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, codeActionProvider, {
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Source]
		})
	);

// allow-any-unicode-next-line
	// ─── Auto-analyze on save ───────────────────────────────────
	const config = vscode.workspace.getConfiguration('mia');
	if (config.get('autoAnalyze', false)) {
		context.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(async (doc) => {
				await analyzeAndCache(doc);
			})
		);
	}

// allow-any-unicode-next-line
	// ─── Apply decorations on editor change ─────────────────────
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor) {
				applyDecorations(editor);
				applySpecDecorations(editor);
				updatePdeDiagnostics(editor.document);
			}
		})
	);

// allow-any-unicode-next-line
	// ─── PDE/COAIA file save handler ───────────────────────────
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			const path = doc.uri.fsPath;
			if (path.includes('.pde/') || path.includes('.coaia/')) {
				updatePdeDiagnostics(doc);
				if (pdeCodeLensProvider) { pdeCodeLensProvider.refresh(); }
				if (coaiaCodeLensProvider) { coaiaCodeLensProvider.refresh(); }
			}
			// Refresh spec.md decorations on save
			if (path.endsWith('.spec.md')) {
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document.uri.toString() === doc.uri.toString()) {
					applySpecDecorations(editor);
				}
			}
		})
	);

// allow-any-unicode-next-line
	// ─── Subscribe to narrative events ──────────────────────────
	if (miaApi) {
		miaApi.onNarrativeEvent((event) => {
			if (event.type === 'analysis.complete' && event.payload) {
				const { fileUri, result } = event.payload;
				analysisCache.set(fileUri, result);
				codeLensProvider.refresh();

				// Update diagnostics for the file if open
				const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri);
				if (doc) {
					updateDiagnostics(doc, result);
				}

				// Update decorations for active editor
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document.uri.toString() === fileUri) {
					applyDecorations(editor);
				}
			}
		});
	}

// allow-any-unicode-next-line
	// ─── Commands ───────────────────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand('mia.editorIntelligence.refreshDecorations', () => {
			codeLensProvider.refresh();
			const editor = vscode.window.activeTextEditor;
			if (editor) { applyDecorations(editor); }
			vscode.window.showInformationMessage('Mia: Decorations refreshed');
		}),
		vscode.commands.registerCommand('mia.editorIntelligence.analyzeFile', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) { return; }
			await analyzeAndCache(editor.document);
		}),
		vscode.commands.registerCommand('mia.editorIntelligence.clearDiagnostics', () => {
			diagnosticCollection.clear();
			dismissedDiagnostics.clear();
			vscode.window.showInformationMessage('Mia: All diagnostics cleared');
		}),
		vscode.commands.registerCommand('mia.editorIntelligence.toggleDecorations', async () => {
			const config = vscode.workspace.getConfiguration('mia');
			const current = config.get('decorations.enabled', true);
			await config.update('decorations.enabled', !current, vscode.ConfigurationTarget.Global);
			codeLensProvider.refresh();
			const editor = vscode.window.activeTextEditor;
			if (editor) { applyDecorations(editor); }
			vscode.window.showInformationMessage(`Mia decorations: ${!current ? 'ON' : 'OFF'}`);
		}),
		vscode.commands.registerCommand('mia.editorIntelligence.dismissDiagnostic', (args) => {
			if (args && args.key) {
				dismissedDiagnostics.add(args.key);
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					const result = analysisCache.get(editor.document.uri.toString());
					if (result) { updateDiagnostics(editor.document, result); }
				}
			}
		}),
		vscode.commands.registerCommand('mia.editorIntelligence.createChartFromDiagnostic', async (args) => {
			if (args && args.description) {
				// Delegate to core createChart with pre-filled data
				const title = await vscode.window.showInputBox({
					prompt: 'Chart title',
					value: `Resolve: ${args.description.slice(0, 50)}`
				});
				if (title) {
					vscode.commands.executeCommand('mia.createChart');
				}
			}
		}),
		vscode.commands.registerCommand('mia.editorIntelligence.showFullAnalysis', (args) => {
			if (args && args.fileUri) {
				vscode.commands.executeCommand('mia.showPanel');
			}
		}),
	);

	// Apply decorations for already-open editor
	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		applyDecorations(activeEditor);
		applySpecDecorations(activeEditor);
		updatePdeDiagnostics(activeEditor.document);
	}
}

function deactivate() {}

// allow-any-unicode-next-line
// ─── Analysis Helper ────────────────────────────────────────────

async function analyzeAndCache(doc) {
	if (miaApi && miaApi.isConnected()) {
		try {
			const result = await miaApi.analyzeFile(doc.uri.toString());
			if (result) {
				analysisCache.set(doc.uri.toString(), result);
				updateDiagnostics(doc, result);
				codeLensProvider.refresh();
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document.uri.toString() === doc.uri.toString()) {
					applyDecorations(editor);
				}
			}
		} catch {
			// Silent failure for analysis
		}
	} else {
		// Generate lightweight local analysis for demonstration
		const localResult = generateLocalAnalysis(doc);
		if (localResult) {
			analysisCache.set(doc.uri.toString(), localResult);
			updateDiagnostics(doc, localResult);
			codeLensProvider.refresh();
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.uri.toString() === doc.uri.toString()) {
				applyDecorations(editor);
			}
		}
	}
}

// Lightweight local analysis when server is unavailable
function generateLocalAnalysis(doc) {
	const text = doc.getText();
	const lines = text.split('\n');
	const symbols = [];

	// Find functions, classes, and important code landmarks
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Function patterns (JS/TS/Python/Go/Rust)
		if (/^\s*(export\s+)?(async\s+)?function\s+\w+/m.test(line) ||
			/^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/.test(line) ||
			/^\s*def\s+\w+/.test(line) ||
			/^\s*func\s+\w+/.test(line) ||
			/^\s*(pub\s+)?fn\s+\w+/.test(line)) {
			symbols.push({ type: 'function', line: i + 1, text: line.trim().slice(0, 80) });
		}
		// Class patterns
		if (/^\s*(export\s+)?(abstract\s+)?class\s+\w+/.test(line) ||
			/^\s*class\s+\w+/.test(line) ||
			/^\s*type\s+\w+\s*struct/.test(line)) {
			symbols.push({ type: 'class', line: i + 1, text: line.trim().slice(0, 80) });
		}
		// TODO/FIXME patterns
		if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
			symbols.push({ type: 'todo', line: i + 1, text: line.trim().slice(0, 80) });
		}
	}

	if (symbols.length === 0) { return null; }

	const insights = {
		engineer: [],
		ceremony: [],
		story: [],
	};

	for (const sym of symbols) {
		if (sym.type === 'function') {
			insights.engineer.push({
				id: `eng-${sym.line}`,
// allow-any-unicode-next-line
				description: `Function at line ${sym.line} — analyze technical quality`,
				location: { line: sym.line },
				significance: 1,
			});
		}
		if (sym.type === 'class') {
			insights.story.push({
				id: `sto-${sym.line}`,
// allow-any-unicode-next-line
				description: `Class at line ${sym.line} — consider narrative role in codebase`,
				location: { line: sym.line },
				significance: 1,
			});
		}
		if (sym.type === 'todo') {
			insights.ceremony.push({
				id: `cer-${sym.line}`,
// allow-any-unicode-next-line
				description: `TODO at line ${sym.line} — relational accountability marker`,
				location: { line: sym.line },
				significance: 2,
			});
		}
	}

	return {
		engineer: {
			summary: `${symbols.filter(s => s.type === 'function').length} functions, ${symbols.filter(s => s.type === 'class').length} classes detected`,
			insights: insights.engineer,
		},
		ceremony: {
			summary: `${symbols.filter(s => s.type === 'todo').length} accountability markers found`,
			insights: insights.ceremony,
		},
		story: {
			summary: `${symbols.length} narrative landmarks in ${lines.length} lines`,
			insights: insights.story,
		},
		overallSignificance: Math.min(5, Math.ceil(symbols.length / 3)),
	};
}

// allow-any-unicode-next-line
// ─── Decoration Application ─────────────────────────────────────

function applyDecorations(editor) {
	const config = vscode.workspace.getConfiguration('mia');
	if (!config.get('decorations.enabled', true)) {
		clearAllDecorations(editor);
		return;
	}

	const fileUri = editor.document.uri.toString();
	const result = analysisCache.get(fileUri);
	if (!result) {
		clearAllDecorations(editor);
		return;
	}

	const engRanges = [];
	const cerRanges = [];
	const stoRanges = [];
	const sigRanges = [];
	const blockRanges = [];

	for (const [universe, decoType, ranges] of [
		['engineer', engineerGutterType, engRanges],
		['ceremony', ceremonyGutterType, cerRanges],
		['story', storyGutterType, stoRanges],
	]) {
		const analysis = result[universe];
		if (!analysis || !analysis.insights) { continue; }

		for (const insight of analysis.insights) {
			if (!insight.location || !insight.location.line) { continue; }
			const line = Math.max(0, insight.location.line - 1);
			const endLine = insight.location.endLine ? insight.location.endLine - 1 : line;

			// Gutter dot
			ranges.push(new vscode.Range(line, 0, line, 0));

			// Significance annotation at line end
// allow-any-unicode-next-line
			const sigText = '●'.repeat(Math.min(insight.significance || 1, 5));
// allow-any-unicode-next-line
			const icon = { engineer: '🔧', ceremony: '🌿', story: '📖' }[universe];
			sigRanges.push({
				range: new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
				renderOptions: {
					after: {
						contentText: ` ${icon} ${sigText}`,
						color: { engineer: '#4A9EFF55', ceremony: '#4ADE8055', story: '#A78BFA55' }[universe],
					}
				}
			});

			// Block highlight for multi-line insights
			if (endLine > line) {
				for (let l = line; l <= endLine; l++) {
					blockRanges.push(new vscode.Range(l, 0, l, Number.MAX_SAFE_INTEGER));
				}
			}
		}
	}

	editor.setDecorations(engineerGutterType, engRanges);
	editor.setDecorations(ceremonyGutterType, cerRanges);
	editor.setDecorations(storyGutterType, stoRanges);
	editor.setDecorations(significanceAnnotationType, sigRanges);
	editor.setDecorations(blockHighlightType, blockRanges);
}

function clearAllDecorations(editor) {
	editor.setDecorations(engineerGutterType, []);
	editor.setDecorations(ceremonyGutterType, []);
	editor.setDecorations(storyGutterType, []);
	editor.setDecorations(significanceAnnotationType, []);
	editor.setDecorations(blockHighlightType, []);
}

// allow-any-unicode-next-line
// ─── SVG Gutter Icon ────────────────────────────────────────────

function makeGutterSvgUri(color) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4" fill="${color}" opacity="0.8"/></svg>`;
	return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

// allow-any-unicode-next-line
// ─── CodeLens Provider ──────────────────────────────────────────

class NarrativeCodeLensProvider {
	constructor() {
		this._onDidChangeCodeLenses = new vscode.EventEmitter();
		this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
	}

	refresh() {
		this._onDidChangeCodeLenses.fire();
	}

	provideCodeLenses(document) {
		const fileUri = document.uri.toString();
		const result = analysisCache.get(fileUri);
		if (!result) { return []; }

		const config = vscode.workspace.getConfiguration('mia');
		if (!config.get('decorations.enabled', true)) { return []; }

		const lenses = [];
		const level = config.get('decorations.level', 'moderate');

		// File-level summary lenses at top of file
		const topRange = new vscode.Range(0, 0, 0, 0);

// allow-any-unicode-next-line
		for (const [universe, icon] of [['engineer', '🔧'], ['ceremony', '🌿'], ['story', '📖']]) {
			const analysis = result[universe];
			if (analysis && analysis.summary) {
				lenses.push(new vscode.CodeLens(topRange, {
					title: `${icon} ${analysis.summary.slice(0, 80)}`,
					command: 'mia.editorIntelligence.showFullAnalysis',
					arguments: [{ fileUri, universe }],
				}));
			}
		}

		// Per-insight lenses at symbol locations (moderate and rich modes)
		if (level !== 'minimal') {
			const placedLines = new Set();

// allow-any-unicode-next-line
			for (const [universe, icon] of [['engineer', '🔧'], ['ceremony', '🌿'], ['story', '📖']]) {
				const analysis = result[universe];
				if (!analysis || !analysis.insights) { continue; }

				for (const insight of analysis.insights) {
					if (!insight.location || !insight.location.line) { continue; }
					const line = Math.max(0, insight.location.line - 1);

					// In moderate mode, skip if we already have a lens at this line
					if (level === 'moderate' && placedLines.has(line)) { continue; }
					placedLines.add(line);

					const insightRange = new vscode.Range(line, 0, line, 0);
					lenses.push(new vscode.CodeLens(insightRange, {
						title: `${icon} ${insight.description.slice(0, 60)}`,
						command: 'mia.editorIntelligence.showFullAnalysis',
						arguments: [{ fileUri, universe, insightId: insight.id }],
					}));
				}
			}
		}

		return lenses;
	}
}

// allow-any-unicode-next-line
// ─── Hover Provider ─────────────────────────────────────────────

class NarrativeHoverProvider {
	provideHover(document, position) {
		const fileUri = document.uri.toString();
		const result = analysisCache.get(fileUri);
		if (!result) { return null; }

		const line = position.line + 1;
		const lineText = document.lineAt(position.line).text;

		// STC comment references: // STC: chart-id
		const stcMatch = lineText.match(/\/\/\s*STC:\s*([a-zA-Z0-9_-]+)/);
		if (stcMatch) {
			const chartId = stcMatch[1];
			const md = new vscode.MarkdownString();
			md.isTrusted = true;
// allow-any-unicode-next-line
			md.appendMarkdown(`**📐 STC Chart**: \`${chartId}\`\n\n`);
			md.appendMarkdown(`[Open Chart](command:mia.stcCharts.review)`);
			return new vscode.Hover(md);
		}

		// BEAT comment references: // BEAT: beat-id
		const beatMatch = lineText.match(/\/\/\s*BEAT:\s*([a-zA-Z0-9_-]+)/);
		if (beatMatch) {
			return new vscode.Hover(
// allow-any-unicode-next-line
				new vscode.MarkdownString(`**📖 Story Beat**: \`${beatMatch[1]}\`\n\n[Open Story Monitor](command:mia.storyMonitor.open)`)
			);
		}

		// Show relevant insights for this line
		const sections = [];

		for (const [universe, icon, color] of [
// allow-any-unicode-next-line
			['engineer', '🔧', '#4A9EFF'],
// allow-any-unicode-next-line
			['ceremony', '🌿', '#4ADE80'],
// allow-any-unicode-next-line
			['story', '📖', '#A78BFA'],
		]) {
			const analysis = result[universe];
			if (!analysis || !analysis.insights) { continue; }

			for (const insight of analysis.insights) {
				if (!insight.location) { continue; }
				const start = insight.location.line;
				const end = insight.location.endLine || start;
				if (line >= start && line <= end) {
// allow-any-unicode-next-line
					const sig = '●'.repeat(Math.min(insight.significance || 1, 5)) +
// allow-any-unicode-next-line
						'○'.repeat(5 - Math.min(insight.significance || 1, 5));
					sections.push(
						`### ${icon} ${universe.charAt(0).toUpperCase() + universe.slice(1)}\n` +
						`*Significance: ${sig}*\n\n${insight.description}`
					);
				}
			}
		}

		if (sections.length > 0) {
			const md = new vscode.MarkdownString(sections.join('\n\n---\n\n'));
			md.isTrusted = true;
			return new vscode.Hover(md);
		}

		return null;
	}
}

// allow-any-unicode-next-line
// ─── Code Action Provider ───────────────────────────────────────

class NarrativeCodeActionProvider {
	provideCodeActions(document, range) {
		const fileUri = document.uri.toString();
		const result = analysisCache.get(fileUri);
		if (!result) { return []; }

		const actions = [];
		const line = range.start.line + 1;

		for (const universe of ['engineer', 'ceremony', 'story']) {
			const analysis = result[universe];
			if (!analysis || !analysis.insights) { continue; }

			for (const insight of analysis.insights) {
				if (!insight.location) { continue; }
				const start = insight.location.line;
				const end = insight.location.endLine || start;
				if (line < start || line > end) { continue; }

				const dismissKey = `${fileUri}::${insight.id}`;
				if (dismissedDiagnostics.has(dismissKey)) { continue; }

// allow-any-unicode-next-line
				const icon = { engineer: '🔧', ceremony: '🌿', story: '📖' }[universe];

				// Show full analysis action
				const showAction = new vscode.CodeAction(
					`${icon} Show full ${universe} analysis`,
					vscode.CodeActionKind.Source
				);
				showAction.command = {
					command: 'mia.editorIntelligence.showFullAnalysis',
					title: 'Show Full Analysis',
					arguments: [{ fileUri, universe }],
				};
				actions.push(showAction);

				// Create chart from diagnostic
				if (insight.significance >= 2) {
					const chartAction = new vscode.CodeAction(
// allow-any-unicode-next-line
						`📐 Create STC Chart from this issue`,
						vscode.CodeActionKind.QuickFix
					);
					chartAction.command = {
						command: 'mia.editorIntelligence.createChartFromDiagnostic',
						title: 'Create Chart',
						arguments: [{ description: insight.description, universe }],
					};
					actions.push(chartAction);
				}

				// Dismiss diagnostic
				const dismissAction = new vscode.CodeAction(
					`Dismiss ${universe} insight`,
					vscode.CodeActionKind.QuickFix
				);
				dismissAction.command = {
					command: 'mia.editorIntelligence.dismissDiagnostic',
					title: 'Dismiss',
					arguments: [{ key: dismissKey }],
				};
				actions.push(dismissAction);
			}
		}

		return actions;
	}
}

// allow-any-unicode-next-line
// ─── Diagnostics ────────────────────────────────────────────────

function updateDiagnostics(document, result) {
	if (!diagnosticCollection) { return; }

	const diagnostics = [];
	const fileUri = document.uri.toString();

	for (const universe of ['engineer', 'ceremony', 'story']) {
		const analysis = result[universe];
		if (!analysis || !analysis.insights) { continue; }

		for (const insight of analysis.insights) {
			if (!insight.location) { continue; }

			const dismissKey = `${fileUri}::${insight.id}`;
			if (dismissedDiagnostics.has(dismissKey)) { continue; }

			const line = Math.max(0, (insight.location.line || 1) - 1);
			const endLine = insight.location.endLine ? insight.location.endLine - 1 : line;
			const range = new vscode.Range(line, 0, endLine, Number.MAX_SAFE_INTEGER);

			let severity;
			const sig = insight.significance || 1;
			if (sig >= 4) { severity = vscode.DiagnosticSeverity.Error; }
			else if (sig >= 2) { severity = vscode.DiagnosticSeverity.Warning; }
			else { severity = vscode.DiagnosticSeverity.Information; }

			const diagnostic = new vscode.Diagnostic(range, insight.description, severity);
			diagnostic.source = `mia-${universe}`;
			diagnostic.code = insight.id;
			diagnostics.push(diagnostic);
		}
	}

	diagnosticCollection.set(document.uri, diagnostics);
}

// allow-any-unicode-next-line
// ─── PDE CodeLens Provider ──────────────────────────────────────

const DIRECTION_HEADERS = {
// allow-any-unicode-next-line
	east:  { pattern: /(?:^|\n)\s*#+\s*.*(?:EAST|East|🌅|Waabinong|Vision|Inquiry)/i, icon: '🌅', label: 'East — Vision' },
// allow-any-unicode-next-line
	south: { pattern: /(?:^|\n)\s*#+\s*.*(?:SOUTH|South|🔥|Zhaawanong|Growth|Analysis)/i, icon: '🔥', label: 'South — Growth' },
// allow-any-unicode-next-line
	west:  { pattern: /(?:^|\n)\s*#+\s*.*(?:WEST|West|🌊|Epangishmok|Reflection|Validation)/i, icon: '🌊', label: 'West — Reflection' },
// allow-any-unicode-next-line
	north: { pattern: /(?:^|\n)\s*#+\s*.*(?:NORTH|North|❄️|Kiiwedinong|Wisdom|Action)/i, icon: '❄️', label: 'North — Wisdom' },
};

class PdeCodeLensProvider {
	constructor() {
		this._onDidChangeCodeLenses = new vscode.EventEmitter();
		this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
	}

	refresh() { this._onDidChangeCodeLenses.fire(); }

	provideCodeLenses(document) {
		const filePath = document.uri.fsPath;
		const isPde = filePath.includes('.pde/') || filePath.includes('.pde\\');
		if (!isPde) { return []; }

		const lenses = [];
		const text = document.getText();
		const lines = text.split('\n');
		const isJson = filePath.endsWith('.json');
		const isMd = filePath.endsWith('.md');

		if (isJson) {
			return this._provideJsonLenses(document, text, lines);
		}

		if (isMd) {
			return this._provideMdLenses(document, text, lines);
		}

		return lenses;
	}

	_provideJsonLenses(document, text, lines) {
		const lenses = [];

		try {
			const pdeData = JSON.parse(text);
			const result = pdeData.result || pdeData;

			// Top-of-file summary
			const topRange = new vscode.Range(0, 0, 0, 0);
			const primaryIntent = result.primaryIntent || result.primary_intent || 'PDE Decomposition';
			const confidence = result.confidence || 0;
			const actionCount = (result.actions || result.explicitActions || []).length;
			const implicitCount = (result.implicitIntents || result.implicit_intents || []).length;

// allow-any-unicode-next-line
			lenses.push(new vscode.CodeLens(topRange, {
				// allow-any-unicode-next-line
				title: `🌅 PDE: ${primaryIntent.slice(0, 60)}`,
				command: '',
			}));

// allow-any-unicode-next-line
			lenses.push(new vscode.CodeLens(topRange, {
				// allow-any-unicode-next-line
				title: `📐 Confidence: ${(confidence * 100).toFixed(0)}% | ${actionCount} actions | ${implicitCount} implicit`,
				command: '',
			}));

			// Direction-based counts from actions
			const dirCounts = { east: 0, south: 0, west: 0, north: 0 };
			const actions = result.actions || result.explicitActions || [];
			for (const action of actions) {
				const dir = action.direction || inferDirection(action.description || action.title || '');
				if (dir && dirCounts[dir] !== undefined) { dirCounts[dir]++; }
			}

			const dirSummary = Object.entries(dirCounts)
				.filter(([, c]) => c > 0)
				.map(([d, c]) => `${DIRECTION_HEADERS[d].icon} ${c}`)
				.join(' ');

			if (dirSummary) {
				lenses.push(new vscode.CodeLens(topRange, {
					title: `Directions: ${dirSummary}`,
					command: '',
				}));
			}
		} catch { /* malformed PDE JSON */ }

		return lenses;
	}

	_provideMdLenses(document, text, lines) {
		const lenses = [];

		// Find direction headers and show item counts
		for (const [dir, info] of Object.entries(DIRECTION_HEADERS)) {
			for (let i = 0; i < lines.length; i++) {
				if (info.pattern.test(lines[i])) {
					// Count items under this header until next header
					let itemCount = 0;
					for (let j = i + 1; j < lines.length; j++) {
						if (/^\s*#+\s/.test(lines[j])) { break; }
						if (/^\s*[-*]\s/.test(lines[j]) || /^\s*\d+\.\s/.test(lines[j])) { itemCount++; }
					}

					const range = new vscode.Range(i, 0, i, 0);
					lenses.push(new vscode.CodeLens(range, {
						title: `${info.icon} ${info.label}: ${itemCount} items`,
						command: '',
					}));
				}
			}
		}

		return lenses;
	}
}

// allow-any-unicode-next-line
// ─── COAIA JSONL CodeLens Provider ──────────────────────────────

class CoaiaCodeLensProvider {
	constructor() {
		this._onDidChangeCodeLenses = new vscode.EventEmitter();
		this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
	}

	refresh() { this._onDidChangeCodeLenses.fire(); }

	provideCodeLenses(document) {
		const filePath = document.uri.fsPath;
		const isCoaia = (filePath.includes('.coaia/') || filePath.includes('.coaia\\')) && filePath.endsWith('.jsonl');
		if (!isCoaia) { return []; }

		const lenses = [];
		const text = document.getText();
		const lines = text.split('\n').filter(l => l.trim());

		const entityCounts = {};
		let chartName = '';
		let desiredOutcome = '';
		let actionTotal = 0;
		let actionComplete = 0;

		for (const line of lines) {
			try {
				const obj = JSON.parse(line);
				const type = obj.type || obj.entityType || 'unknown';
				entityCounts[type] = (entityCounts[type] || 0) + 1;

				if (type === 'chart' || type === 'structural_tension_chart') {
					chartName = obj.name || obj.title || '';
					desiredOutcome = obj.desiredOutcome || obj.desired_outcome || '';
				}

				if (type === 'action_step') {
					actionTotal++;
					if (obj.status === 'complete' || obj.completed) { actionComplete++; }
				}
			} catch { /* skip malformed lines */ }
		}

		const topRange = new vscode.Range(0, 0, 0, 0);

		// Chart summary
		if (chartName || desiredOutcome) {
// allow-any-unicode-next-line
			lenses.push(new vscode.CodeLens(topRange, {
				// allow-any-unicode-next-line
				title: `📐 STC: ${(chartName || desiredOutcome).slice(0, 60)}`,
				command: '',
			}));
		}

		// Entity counts
		const countStr = Object.entries(entityCounts)
			.map(([t, c]) => `${t}: ${c}`)
			.join(', ');

		lenses.push(new vscode.CodeLens(topRange, {
			title: `Entities: ${countStr} (${lines.length} total)`,
			command: '',
		}));

		// Action progress
		if (actionTotal > 0) {
			const pct = Math.round((actionComplete / actionTotal) * 100);
// allow-any-unicode-next-line
			lenses.push(new vscode.CodeLens(topRange, {
				title: `Progress: ${actionComplete}/${actionTotal} actions (${pct}%)`,
				command: '',
			}));
		}

		return lenses;
	}
}

// allow-any-unicode-next-line
// ─── PDE Diagnostics ────────────────────────────────────────────

function updatePdeDiagnostics(document) {
	if (!pdeDiagnosticCollection) { return; }

	const filePath = document.uri.fsPath;
	const isPdeJson = (filePath.includes('.pde/') || filePath.includes('.pde\\')) && filePath.endsWith('.json');
	if (!isPdeJson) { return; }

	const diagnostics = [];
	const text = document.getText();

	try {
		const pdeData = JSON.parse(text);
		const result = pdeData.result || pdeData;

		// Check confidence score
		const confidence = result.confidence || 0;
		if (confidence < 0.5 && confidence > 0) {
			const range = findJsonKeyRange(text, 'confidence') || new vscode.Range(0, 0, 0, 0);
			diagnostics.push(new vscode.Diagnostic(
				range,
// allow-any-unicode-next-line
				`⚠️ Low confidence score: ${(confidence * 100).toFixed(0)}%. Consider re-decomposing with more specific intent.`,
				vscode.DiagnosticSeverity.Warning
			));
		}

		// Check for ambiguity flags
		const actions = result.actions || result.explicitActions || [];
		for (let i = 0; i < actions.length; i++) {
			const action = actions[i];
			if (action.ambiguous || action.ambiguity) {
				const range = findJsonKeyRange(text, 'ambiguous', i) || new vscode.Range(0, 0, 0, 0);
				diagnostics.push(new vscode.Diagnostic(
					range,
// allow-any-unicode-next-line
					`ℹ️ Ambiguous action: "${(action.description || action.title || '').slice(0, 60)}". Consider clarifying intent.`,
					vscode.DiagnosticSeverity.Information
				));
			}
		}

		// Check implicit intents
		const implicitIntents = result.implicitIntents || result.implicit_intents || [];
		for (const intent of implicitIntents) {
			const desc = typeof intent === 'string' ? intent : (intent.description || intent.text || '');
			const conf = typeof intent === 'object' ? (intent.confidence || 0) : 0;
			if (conf > 0 && conf < 0.5) {
				diagnostics.push(new vscode.Diagnostic(
					new vscode.Range(0, 0, 0, 0),
// allow-any-unicode-next-line
					`⚠️ Low-confidence implicit intent: "${desc.slice(0, 60)}". May need explicit confirmation.`,
					vscode.DiagnosticSeverity.Warning
				));
			}
		}
	// allow-any-unicode-next-line
	} catch { /* malformed PDE JSON — no diagnostics */ }

	pdeDiagnosticCollection.set(document.uri, diagnostics);
}

function findJsonKeyRange(text, key, nthOccurrence) {
	const lines = text.split('\n');
	let occurrence = 0;
	const target = nthOccurrence || 0;

	for (let i = 0; i < lines.length; i++) {
		const idx = lines[i].indexOf(`"${key}"`);
		if (idx !== -1) {
			if (occurrence === target) {
				return new vscode.Range(i, idx, i, lines[i].length);
			}
			occurrence++;
		}
	}
	return null;
}

// allow-any-unicode-next-line
// ─── Spec.md Structural Tension Decorations ─────────────────────

function applySpecDecorations(editor) {
	if (!editor) { return; }
	const doc = editor.document;
	const filePath = doc.uri.fsPath;

	// Only apply to .spec.md files
	if (!filePath.endsWith('.spec.md')) {
		clearSpecDecorations(editor);
		return;
	}

	const config = vscode.workspace.getConfiguration('mia');
	if (!config.get('decorations.enabled', true)) {
		clearSpecDecorations(editor);
		return;
	}

	const text = doc.getText();
	const lines = text.split('\n');

	const desiredOutcomeRanges = [];
	const currentRealityRanges = [];
	const tensionRanges = [];

	let currentSection = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Detect section headers
		if (/^\s*#+\s*.*(?:Desired\s+Outcome|Vision|Goal|Target|Objective)/i.test(line)) {
			currentSection = 'desired';
		} else if (/^\s*#+\s*.*(?:Current\s+Reality|Present\s+State|Status|Baseline|As-Is)/i.test(line)) {
			currentSection = 'current';
		} else if (/^\s*#+\s*.*(?:Structural\s+Tension|Tension|Gap|Action\s+Steps|Strategy)/i.test(line)) {
			currentSection = 'tension';
		} else if (/^\s*#+\s/.test(line)) {
			// Any other heading resets the section
			currentSection = null;
		}

		// Apply decorations based on current section
		if (currentSection === 'desired') {
			desiredOutcomeRanges.push(new vscode.Range(i, 0, i, 0));
		} else if (currentSection === 'current') {
			currentRealityRanges.push(new vscode.Range(i, 0, i, 0));
		} else if (currentSection === 'tension') {
			tensionRanges.push(new vscode.Range(i, 0, i, 0));
		}
	}

	editor.setDecorations(desiredOutcomeGutterType, desiredOutcomeRanges);
	editor.setDecorations(currentRealityGutterType, currentRealityRanges);
	editor.setDecorations(structuralTensionGutterType, tensionRanges);
}

function clearSpecDecorations(editor) {
	if (!editor) { return; }
	if (desiredOutcomeGutterType) { editor.setDecorations(desiredOutcomeGutterType, []); }
	if (currentRealityGutterType) { editor.setDecorations(currentRealityGutterType, []); }
	if (structuralTensionGutterType) { editor.setDecorations(structuralTensionGutterType, []); }
}

// allow-any-unicode-next-line
// ─── Direction Inference ────────────────────────────────────────

function inferDirection(text) {
	const lower = text.toLowerCase();
	if (/decompos|vision|inquir|pde|prompt|east/.test(lower)) { return 'east'; }
	if (/search|research|analy|growth|south/.test(lower)) { return 'south'; }
	if (/review|reflect|valid|test|west/.test(lower)) { return 'west'; }
	if (/execut|implement|integrat|build|north/.test(lower)) { return 'north'; }
	return null;
}

module.exports = { activate, deactivate };
