# STCGOAL — Structural Tension Chart: mia-vscode Vision

> *Every invocation is a spiral, not a loop. Every change is a stone in the living ledger.*

## Desired Outcome

A developer opens **Mia Code** and inhabits a narrative development environment from the first moment. The Welcome page orients them through the Three Universes (Engineer/Ceremony/Story). Walkthroughs guide them into Structural Tension Chart creation, server connection, and story beat logging. "Generate New Workspace" scaffolds a narrative-ready project with `.stc/`, `.pde/`, `.coaia/`, and `.mia-vscode/` directories pre-populated. The PDE-to-STC bridge seamlessly transforms prompt decompositions into creative advancement charts. When a consolidation directory is opened, every artifact — STC charts, PDE decompositions, Mino sessions, medicine wheel topology — renders as living, navigable structure. The IDE is not a tool; it is a ceremonial space for narrative-driven development.

## Current Reality

mia-vscode is a fork of microsoft/vscode (Code - OSS v1.112.0) with `product.json` customized for Mia Code identity (`nameShort: "Mia Code"`, `applicationName: "mcode"`, `urlProtocol: "mcode"`). Seven built-in extensions exist in `extensions/mia-*` directories (three-universe-core, stc-charts, story-monitor, agent-panel, terminal, editor-intelligence, chat-participant). The extension gallery points to Open VSX. Sixteen RISE specifications define the full vision across foundation (5), extensions (8), and integration (3) layers. The Welcome page still shows the stock VS Code getting-started flow. Walkthroughs are not yet narrative-aware. Workspace generation uses default VS Code scaffolding. No PDE bridge exists. Consolidation directory rendering is not implemented.

---

## Welcome Experience

*Reference: `rispecs/foundation/03-welcome-experience.spec.md`*

### Desired Outcome

A developer opening Mia Code for the first time is greeted with a walkthrough that introduces three-universe intelligence, connects them to their mia-code-server instance, and lets them choose their preferred universe focus — resulting in a personalized, ready-to-use narrative IDE. The "Next Up" section feeds from our own narrative distribution channel (not Microsoft news), surfacing recent STC chart activity, community story beats, and Three Universe orientation tips served by mia-code-server's `/api/narrative/feed` endpoint.

### Natural Progression

1. **Replace the stock Welcome tab** — The `MiaWalkthrough` contribution registered in `mia.three-universe` extension replaces the default getting-started flow. The Welcome page opens with Three Universe color circles (🔧 Engineer Blue, 🌿 Ceremony Green, 📖 Story Purple) and the philosophy: *"Engineer precision. Ceremony accountability. Story coherence."*

2. **"Next Up" becomes narrative feed** — Instead of Microsoft's product news, the "Next Up" section connects to the mia-code-server feed endpoint. When offline or disconnected, it falls back to locally cached narrative tips and STC methodology reminders. Content includes: recent charts in the workspace, community story beats, and walkthrough suggestions based on universe affinity.

3. **Recent STCs on the Welcome page** — Below the walkthrough, the Welcome page shows a "Your Active Charts" widget — a compact view of open Structural Tension Charts with their progress arcs. Clicking any chart opens the `ChartDetailWebview`. If no charts exist, the widget shows a "Create Your First Chart" call-to-action.

4. **ServerConnectionWidget** — A text input for server URL (default: `http://localhost:8080`). The "Connect" button tests `/api/health`. Success shows server version and available universes. Connection saved to `mia.serverUrl` setting.

5. **UniverseAffinitySelector** — Three clickable cards for Engineer/Ceremony/Story. Selection sets `mia.primaryUniverse`, influencing default sidebar view, theme accent, and suggestion weighting. Default: balanced (no primary).

6. **"Ready to Create" summary** — Keyboard shortcuts, documentation links, and the option to open a sample narrative project.

---

## Walkthroughs

*Reference: `rispecs/foundation/03-welcome-experience.spec.md` (walkthrough steps), `rispecs/extensions/02-three-universe-core.spec.md`*

### Desired Outcome

Four narrative-driven walkthroughs guide developers from curiosity to engaged practice. Each walkthrough is a ceremony of orientation — not a feature tour, but a relational introduction to the creative process methodology.

### Natural Progression

1. **"Meet the Three Universes"** — The foundational walkthrough. Introduces Engineer (precision, technical clarity), Ceremony (relational accountability, process integrity), and Story (narrative coherence, meaning-making). Interactive: the developer clicks each universe card to see how the activity bar, sidebar, and theme accent shift. Culminates in choosing a primary affinity or staying balanced.

2. **"Create Your First STC Chart"** — Guided creation of a Structural Tension Chart via `mia.createChart` command. The developer defines a desired outcome ("What do you want to create?"), assesses current reality ("Where are you now?"), and adds at least one action step. The chart appears in the STC Dashboard sidebar with a progress arc. This walkthrough teaches the fundamental creative orientation: *advance toward a vision, don't oscillate against problems.*

3. **"Connect to mia-code-server"** — Server connection walkthrough for platform users. Input server URL, authenticate, verify connection to `/api/health`. Once connected: real-time narrative events via WebSocket (`/api/ws/narrative`), MCP tool discovery via `/api/mcp`, and three-universe analysis from the server intelligence layer. Skippable for standalone use.

4. **"Log Your First Story Beat"** — The Story Monitor walkthrough. Introduces the live narrative dashboard (`mia.story-monitor` extension). The developer creates a story beat — a narrative event anchoring a moment of technical significance. Demonstrates how story beats connect to STC charts, forming a living ledger of creative work.

Each walkthrough is registered as a VS Code `walkthroughs` contribution in the built-in `mia.three-universe` extension. Media assets live in each extension's `media/` directory.

---

## Generate New Workspace

*Reference: `rispecs/extensions/02-three-universe-core.spec.md`, consolidation context*

### Desired Outcome

"Generate New Workspace" creates a **narrative-ready project** — not just a directory with source files, but a ceremonial space pre-populated with the dot-structures that enable three-universe intelligence from the first commit.

### Natural Progression

1. **Command: `mia.generateWorkspace`** — Prompts for project name, primary universe affinity, and optional mia-code-server URL. Creates the project directory.

2. **Dot-structure scaffolding** — The following directories are created and initialized:

   | Directory | Purpose | Initial Contents |
   |-----------|---------|------------------|
   | `.stc/charts/` | Structural Tension Chart storage | Empty — first chart created via walkthrough |
   | `.pde/` | Prompt Decomposition Engine artifacts | README explaining PDE workflow |
   | `.coaia/` | Narrative planning JSONL (STC entities, relations) | Empty session template |
   | `.mia-vscode/` | Extension workspace configuration | `settings.json` with universe affinity, theme preference |
   | `.mino/sessions/` | Mino session archives | `sessions-index.json` initialized |

3. **CLAUDE.md template** — A project-level `CLAUDE.md` is generated with:
   - Project identity and narrative context
   - Three-universe orientation (which universe is primary)
   - MCP tool references for the narrative stack
   - Workspace conventions and coding guidelines
   - Pointers to `.stc/`, `.pde/`, `.coaia/` as operational directories

4. **Medicine-wheel-aware directory structure** — The workspace scaffolding optionally includes a medicine wheel topology:
   ```
   project/
   ├── east/      # Vision & inquiry — specs, proposals, research
   ├── south/     # Growth & practice — implementation, prototypes
   ├── west/      # Reflection & truth — reviews, retrospectives
   ├── north/     # Wisdom & synthesis — documentation, archives
   ├── .stc/
   ├── .pde/
   ├── .coaia/
   ├── .mia-vscode/
   └── CLAUDE.md
   ```

5. **First-chart prompt** — After workspace generation, the developer is prompted to create their first STC chart for the project. The desired outcome they set becomes the narrative North Star visible in the STC Dashboard sidebar and status bar.

---

## PDE-to-STC Bridge

*Reference: `rispecs/extensions/03-stc-charts.spec.md`, mcp-pde tool specification*

### Desired Outcome

When a developer opens a directory containing `.pde/` files (stored PDE decompositions), the STC Charts extension detects them and offers to create Structural Tension Charts from the decomposition results. The bridge transforms the analytical output of prompt decomposition into the creative orientation of structural tension — turning "what was asked" into "what we want to create."

### Natural Progression

1. **Detection** — The `mia.stc-charts` extension registers a `FileSystemWatcher` for `.pde/*.json` files. When PDE decompositions are detected (either pre-existing or newly created via `pde_decompose` → `pde_parse_response`), a notification appears: *"PDE decompositions found. Create STC charts?"*

2. **Mapping** — Each PDE `DecompositionResult` maps to an STC chart:
   - PDE `explicit_intents` → STC `desiredOutcome` (synthesized into a creative vision)
   - PDE `implicit_intents` (extracted from hedging language) → STC `actionSteps` (the unspoken requirements that become strategic secondary choices)
   - PDE `dependencies` → STC action step ordering
   - PDE `original_prompt` → STC chart context metadata

3. **Creation** — Charts are written to `.stc/charts/` as JSON, following the `ChartFileStorage` schema. The `FileWatcher` in the STC Charts extension detects new files and refreshes the `ChartExplorer` tree view.

4. **Coaia integration** — The bridge also invokes `coaia-pde` tools (`import_pde_decomposition` or `create_stc_from_pde`) to generate `.coaia/pde/<UUID>.jsonl` session files, ensuring the narrative planning layer stays synchronized.

5. **Bidirectional flow** — When an STC chart is updated (action steps completed, current reality revised), the changes can be exported back to a PDE-compatible format via `coaia-planning` sync tools, maintaining coherence between decomposition and creative advancement.

---

## Consolidation Directory Experience

*Reference: consolidation workspace context, `.coaia/`, `.pde/`, `.mino/`, `.mia-vscode/` dot-structures*

### Desired Outcome

When a developer opens a consolidation directory (e.g., `north--consolidation--mia-vscode-fork-completion/`), the mia-vscode extensions render a comprehensive, navigable view of all narrative artifacts — STC charts, PDE decompositions, Mino session history, and medicine wheel topology. The consolidation directory is not a folder of files; it is a **living archive** where the entire creative journey is visible.

### Natural Progression

1. **Directory detection** — On workspace open, `mia.three-universe` scans for the presence of `.coaia/`, `.pde/`, `.mino/`, and `.mia-vscode/` directories. If multiple are found, the workspace is recognized as a narrative-rich directory and the Three Universe activity bar activates automatically.

2. **STC Charts from `.coaia/`** — The STC Charts extension reads `.coaia/*.jsonl` files (NDJSON format containing `chart_created`, `observation_added`, `action_step_added` entities). These are rendered in the `ChartExplorer` tree view with full history — not just current state, but the progression of observations and reality updates over time. The `ChartDetailWebview` shows the structural tension arc for each chart.

3. **PDE Decompositions from `.pde/`** — Stored decompositions (JSON files with `DecompositionResult` schema) are rendered in a dedicated "Decompositions" section of the Three Universe sidebar. Each decomposition shows: original prompt, explicit intents, implicit intents (the hidden requirements), dependencies between actions, and confidence scores. The PDE-to-STC bridge offers conversion for any unlinked decomposition.

4. **Session History from `.mino/`** — Mino session archives (`.mino/sessions/<gist_id>/`) are rendered as a timeline in the Story Monitor panel. Each session shows: title, summary, perspectives (mia_miette, tushell_journal, the_council), and relations to other sessions. Session exports (`mino-session-export.md`) are viewable as rich markdown in the editor.

5. **Medicine Wheel Topology from `.mia-vscode/`** — Workspace configuration in `.mia-vscode/settings.json` includes medicine wheel direction mappings. The Three Universe sidebar shows a "Directions" section: East (vision/inquiry), South (growth/practice), West (reflection/truth), North (wisdom/synthesis). Files and directories can be tagged with direction metadata, enabling ceremonial navigation of the workspace.

6. **Cross-artifact linking** — The consolidation experience enables navigation between artifacts: an STC chart references a PDE decomposition that was discussed in a Mino session that resulted in a story beat in the West direction. The Three Universe extensions maintain these relational links.

---

## Action Steps

Strategic secondary choices that advance toward the full vision:

1. **Implement Welcome page replacement** — Register `MiaWalkthrough` in `mia.three-universe` extension's `package.json` as a `walkthroughs` contribution. Replace stock VS Code getting-started with six-step narrative walkthrough. *(Advances: Welcome Experience)*

2. **Build narrative feed endpoint client** — Implement `NarrativeFeedService` in `mia.three-universe` extension that fetches from `/api/narrative/feed` with offline fallback to local cache. Wire to Welcome page "Next Up" section. *(Advances: Welcome Experience)*

3. **Create four walkthrough contributions** — Implement "Meet the Three Universes", "Create Your First STC Chart", "Connect to mia-code-server", and "Log Your First Story Beat" as VS Code walkthrough steps with media assets. *(Advances: Walkthroughs)*

4. **Implement `mia.generateWorkspace` command** — Scaffold narrative-ready projects with dot-structure directories, CLAUDE.md template, and optional medicine wheel topology. *(Advances: Generate New Workspace)*

5. **Build PDE FileSystemWatcher** — In `mia.stc-charts` extension, detect `.pde/*.json` files, parse `DecompositionResult` schema, and offer STC chart creation. Wire to `coaia-pde` import tools. *(Advances: PDE-to-STC Bridge)*

6. **Implement consolidation directory scanner** — In `mia.three-universe`, detect presence of multiple dot-structures on workspace open. Activate narrative rendering for `.coaia/`, `.pde/`, `.mino/` contents. *(Advances: Consolidation Directory Experience)*

7. **Wire `ChartExplorer` to `.coaia/` JSONL** — Extend `ChartFileStorage` to read from both `.stc/charts/` (JSON) and `.coaia/` (JSONL entity format). Render historical progression in `ChartDetailWebview`. *(Advances: Consolidation Directory Experience, STC Charts)*

8. **Resolve five integration errors** — Address the five known issues documented in STCERRORS.md (argv.json, Copilot Chat auth, WorkIQ plugin, secondary panel loading, Source Control). These block testing of narrative extensions. *(Advances: All goals — unblocks extension development)*

---

*RISE Framework Compliance: ✅ Creative Orientation | ✅ Structural Dynamics | ✅ Advancing Patterns | ✅ Desired Outcomes*
