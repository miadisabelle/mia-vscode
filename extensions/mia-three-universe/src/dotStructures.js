/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');

// Known dot-structure directories and their scan patterns
const DOT_STRUCTURES = {
	// allow-any-unicode-next-line
	'.pde': { pattern: '**/*.json', description: 'PDE Decompositions', emoji: '🌅' },
	// allow-any-unicode-next-line
	'.coaia': { pattern: '**/*.jsonl', description: 'COAIA Charts', emoji: '📊' },
	// allow-any-unicode-next-line
	'.mino': { pattern: '**/*.{json,md}', description: 'Mino Sessions', emoji: '🔮' },
	// allow-any-unicode-next-line
	'.mia-vscode': { pattern: '**/*.{json,md}', description: 'Mia VS Code State', emoji: '🧠' },
	// allow-any-unicode-next-line
	'.stc': { pattern: '**/*.json', description: 'STC Charts', emoji: '📐' },
};

// Medicine Wheel direction classification based on file path patterns
const DIRECTION_PATTERNS = {
	east: {
		dirs: ['.pde'],
		keywords: ['decompos', 'inquiry', 'vision', 'prompt', 'question', 'explore'],
		// allow-any-unicode-next-line
		emoji: '🌅',
		// allow-any-unicode-next-line
		label: 'East — Inquiry & Vision',
	},
	south: {
		dirs: [],
		keywords: ['plan', 'consent', 'protocol', 'ethics', 'governance', 'youth', 'growth'],
		// allow-any-unicode-next-line
		emoji: '🔥',
		// allow-any-unicode-next-line
		label: 'South — Planning & Consent',
	},
	west: {
		dirs: ['.coaia', '.stc'],
		keywords: ['chart', 'tension', 'action', 'practice', 'session', 'execute', 'build'],
		// allow-any-unicode-next-line
		emoji: '🌊',
		// allow-any-unicode-next-line
		label: 'West — Experience & Action',
	},
	north: {
		dirs: ['.mino', '.mia-vscode'],
		keywords: ['archive', 'wisdom', 'reflect', 'narrative', 'story', 'chronicle', 'summary'],
		// allow-any-unicode-next-line
		emoji: '❄️',
		// allow-any-unicode-next-line
		label: 'North — Reflection & Wisdom',
	},
};

/**
 * Scan a workspace folder for files within a specific dot-structure directory.
 * @param {import('vscode').Uri} folderUri
 * @param {string} dotDir - e.g. '.pde'
 * @param {string} globPattern - e.g. '**\/*.json'
 * @returns {Promise<Array<{uri: import('vscode').Uri, name: string, relativePath: string}>>}
 */
async function scanDotStructureDir(folderUri, dotDir, globPattern) {
	const dirUri = vscode.Uri.joinPath(folderUri, dotDir);
	const results = [];

	try {
		await vscode.workspace.fs.stat(dirUri);
	} catch {
		// Directory does not exist
		return results;
	}

	try {
		const pattern = new vscode.RelativePattern(dirUri, globPattern);
		const files = await vscode.workspace.findFiles(pattern);

		for (const fileUri of files) {
			const relativePath = fileUri.path.slice(folderUri.path.length + 1);
			const segments = fileUri.path.split('/');
			const name = segments[segments.length - 1];
			results.push({ uri: fileUri, name, relativePath });
		}
	} catch {
		// allow-any-unicode-next-line
		// findFiles failed — graceful degradation
	}

	return results;
}

/**
 * Scan .pde/ directories for JSON decomposition files.
 * @param {import('vscode').Uri} workspaceFolderUri
 * @returns {Promise<Array<{uri: import('vscode').Uri, name: string, relativePath: string, id: string|null, prompt: string|null}>>}
 */
async function getPdeDecompositions(workspaceFolderUri) {
	const files = await scanDotStructureDir(workspaceFolderUri, '.pde', '**/*.json');
	const decompositions = [];

	for (const file of files) {
		let id = null;
		let prompt = null;
		try {
			const raw = await vscode.workspace.fs.readFile(file.uri);
			const parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
			id = parsed.id || parsed.decomposition_id || null;
			prompt = parsed.original_prompt || parsed.prompt || null;
		} catch {
			// allow-any-unicode-next-line
			// Could not parse — still include in listing
		}
		decompositions.push({ ...file, id, prompt });
	}

	return decompositions;
}

/**
 * Scan .coaia/ directories for JSONL chart files.
 * @param {import('vscode').Uri} workspaceFolderUri
 * @returns {Promise<Array<{uri: import('vscode').Uri, name: string, relativePath: string, entityCount: number}>>}
 */
async function getCoaiaCharts(workspaceFolderUri) {
	const files = await scanDotStructureDir(workspaceFolderUri, '.coaia', '**/*.jsonl');
	const charts = [];

	for (const file of files) {
		let entityCount = 0;
		try {
			const raw = await vscode.workspace.fs.readFile(file.uri);
			const lines = Buffer.from(raw).toString('utf8').split('\n').filter(l => l.trim());
			entityCount = lines.length;
		} catch {
			// allow-any-unicode-next-line
			// Could not read — still include in listing
		}
		charts.push({ ...file, entityCount });
	}

	return charts;
}

/**
 * Return an inventory of all dot-structures in a workspace folder.
 * @param {import('vscode').Uri} workspaceFolderUri
 * @returns {Promise<Array<{name: string, exists: boolean, fileCount: number, description: string, emoji: string, uri: import('vscode').Uri}>>}
 */
async function getDotStructures(workspaceFolderUri) {
	const inventory = [];

	for (const [dirName, meta] of Object.entries(DOT_STRUCTURES)) {
		const dirUri = vscode.Uri.joinPath(workspaceFolderUri, dirName);
		let exists = false;
		let fileCount = 0;

		try {
			await vscode.workspace.fs.stat(dirUri);
			exists = true;
			const files = await scanDotStructureDir(workspaceFolderUri, dirName, meta.pattern);
			fileCount = files.length;
		} catch {
			// Does not exist
		}

		inventory.push({
			name: dirName,
			exists,
			fileCount,
			description: meta.description,
			emoji: meta.emoji,
			uri: dirUri,
		});
	}

	return inventory;
}

/**
 * Classify a file path by Medicine Wheel direction.
 * @param {string} filePath
 * @returns {{ direction: string, emoji: string, label: string, confidence: number }}
 */
function getMedicineWheelDirection(filePath) {
	const normalized = filePath.replace(/\\/g, '/').toLowerCase();

	// Check directory-based classification first (high confidence)
	for (const [direction, config] of Object.entries(DIRECTION_PATTERNS)) {
		for (const dir of config.dirs) {
			if (normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)) {
				return {
					direction,
					emoji: config.emoji,
					label: config.label,
					confidence: 0.9,
				};
			}
		}
	}

	// Fall back to keyword matching (lower confidence)
	const scores = { east: 0, south: 0, west: 0, north: 0 };
	for (const [direction, config] of Object.entries(DIRECTION_PATTERNS)) {
		for (const keyword of config.keywords) {
			if (normalized.includes(keyword)) {
				scores[direction]++;
			}
		}
	}

	const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
	if (best[1] > 0) {
		const config = DIRECTION_PATTERNS[best[0]];
		return {
			direction: best[0],
			emoji: config.emoji,
			label: config.label,
			confidence: Math.min(0.3 + best[1] * 0.2, 0.8),
		};
	}

	// Default: balanced / no clear direction
	return {
		direction: 'balanced',
		// allow-any-unicode-next-line
		emoji: '⚖️',
		// allow-any-unicode-next-line
		label: 'Balanced — No clear direction',
		confidence: 0,
	};
}

/**
 * Create file system watchers for all known dot-structure directories.
 * @param {import('vscode').EventEmitter<{type: string, uri: import('vscode').Uri, dotStructure: string}>} emitter
 * @returns {import('vscode').Disposable[]}
 */
function createDotStructureWatchers(emitter) {
	const disposables = [];

	for (const dirName of Object.keys(DOT_STRUCTURES)) {
		const pattern = `**/${dirName}/**`;
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidCreate((uri) => {
			emitter.fire({ type: 'created', uri, dotStructure: dirName });
		});
		watcher.onDidChange((uri) => {
			emitter.fire({ type: 'changed', uri, dotStructure: dirName });
		});
		watcher.onDidDelete((uri) => {
			emitter.fire({ type: 'deleted', uri, dotStructure: dirName });
		});

		disposables.push(watcher);
	}

	return disposables;
}

module.exports = {
	DOT_STRUCTURES,
	DIRECTION_PATTERNS,
	scanDotStructureDir,
	getPdeDecompositions,
	getCoaiaCharts,
	getDotStructures,
	getMedicineWheelDirection,
	createDotStructureWatchers,
};
