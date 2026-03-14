# STCERRORS — Known Issues and Resolution Paths

> *Errors are Managerial Moments of Truth — opportunities for relational learning, not performance failures.*

## Structural Tension

**Desired Outcome**: All integration points (auth, extensions, source control, runtime) function seamlessly in the Mia Code fork — enabling narrative extension development and testing without infrastructure friction.

**Current Reality**: Five integration issues observed during initial testing. All appear to stem from the fork configuration delta between upstream VS Code and the Mia Code customization layer — specifically `product.json` identity changes, extension gallery reconfiguration, and extension host initialization.

---

## Issue 1: argv.json Runtime Arguments

### Observation
```
The runtime arguments file 'argv.json' contains errors. Please correct them and restart.
```
The runtime arguments file (`argv.json`) located in the data folder fails validation at startup.

### Root Cause Analysis

When `product.json` changes the `dataFolderName` from `.vscode` to `.mcode`, the runtime creates a new `argv.json` in `~/.mcode/argv.json`. However, the upstream `argv.json` template may reference product-specific keys (e.g., `"enable-crash-reporter"`, `"crash-reporter-id"`) that are no longer valid when the product identity has been customized. Additionally, if a previous installation created `~/.mcode/argv.json` with incorrect defaults or if the file was manually edited with syntax errors, the runtime will reject it.

The validation logic lives in `src/vs/platform/environment/node/argvHelper.ts` and checks against a schema derived from `product.json` properties. Mismatches between the `argv.json` content and the expected schema cause this error.

### Resolution Path

1. **Inspect the active `argv.json`** — Check `~/.mcode/argv.json` for JSON syntax errors (trailing commas, missing quotes) and invalid keys.
2. **Verify the `argv.json` template** — In the build output, confirm that the default `argv.json` template matches the Mia Code product identity. The template is generated during `gulp vscode-linux-x64` (or equivalent) from `product.json` properties.
3. **Regenerate** — Delete `~/.mcode/argv.json` and let the runtime regenerate it from the product template on next launch.
4. **Long-term** — Ensure the build pipeline generates a correct `argv.json` template that accounts for all `product.json` customizations. Add a CI check that validates the generated `argv.json` against the runtime schema.

### Priority
🔴 **High** — Blocks application startup. Must resolve before any extension testing.

---

## Issue 2: Copilot Chat Authentication Failure

### Observation
```
copilot-chat ("getting chat ready" in status bar never finishes.)
From our copilot subscription not working. Expecting the browser to open for connection.
(trying to connect using github, google does not open a browser)
```
GitHub Copilot Chat extension shows "Getting Chat Ready..." indefinitely. The OAuth flow that should open a browser for GitHub authentication never triggers.

### Root Cause Analysis

Copilot Chat's authentication flow depends on the VS Code product identity to generate valid OAuth client credentials. When `product.json` changes `nameShort`, `applicationName`, and removes the Microsoft-specific `extensionsGallery` service URL, the Copilot extension's authentication handshake fails silently because:

1. **OAuth client ID mismatch** — The Copilot extension uses the product's registered OAuth client ID (from `product.json`'s `github-authentication` configuration) to initiate the GitHub auth flow. In a fork, this client ID is either absent or doesn't match GitHub's registered application.
2. **URI handler protocol change** — The `urlProtocol` changed from `vscode` to `mcode`. The OAuth callback URL expects `vscode://` URI scheme, but the fork registers `mcode://`. The browser redirects to a URI the OS cannot route.
3. **Extension gallery isolation** — With the gallery pointing to Open VSX instead of Microsoft's marketplace, the Copilot extension (which is not on Open VSX) may be side-loaded, missing its expected product context.

### Resolution Path

1. **Register a GitHub OAuth App for Mia Code** — Create a GitHub OAuth application with the callback URI matching the `mcode://` protocol. Configure the client ID and secret in `product.json` under `github-authentication`.
2. **Verify URI handler registration** — Confirm that the OS-level URI handler for `mcode://` is registered correctly during installation (`resources/linux/code.desktop` or equivalent).
3. **Check `product.json` authentication block** — Ensure `github-authentication` section exists with:
   ```json
   {
     "github-authentication": {
       "scopes": ["user:email"],
       "clientId": "<mia-code-oauth-client-id>"
     }
   }
   ```
4. **Consider Copilot compatibility layer** — If Copilot requires the `vscode://` URI scheme, consider keeping a dual-protocol handler or implementing a redirect proxy. Alternatively, document that Copilot Chat requires manual token configuration in fork environments.

### Priority
🟡 **Medium** — Copilot Chat is a valuable tool but not required for narrative extension development. The custom `mia.chat-participant` and `mia.agent-panel` extensions provide alternative agentic interfaces.

---

## Issue 3: WorkIQ Plugin Installation — `_git.cloneRepository` Not Found

### Observation
```
Failed to install plugin 'workiq': command '_git.cloneRepository' not found

* when installing extension "workiq — WorkIQ plugin for GitHub Copilot. github/copilot-plugins"
```
Attempting to install the WorkIQ Copilot plugin fails because the internal Git command `_git.cloneRepository` is not available.

### Root Cause Analysis

The `_git.cloneRepository` command is a **private internal command** registered by VS Code's built-in `git` extension (`extensions/git/`). This command is not part of the public API — it uses the underscore prefix convention indicating internal use. The failure has two possible causes:

1. **Git extension not activated** — The built-in `git` extension may not have activated yet when the WorkIQ plugin attempts to install. This can happen if the extension host initialization order changed due to fork customizations, or if the git extension's activation events are not being triggered.
2. **Extension host isolation** — The Mia Code fork's custom extensions (`mia.*`) are configured in `product.json`'s `extensionAllowedProposedApi`. If the extension host configuration inadvertently isolates the git extension's contribution, its internal commands become unavailable to other extensions.
3. **Git binary not found** — The `git` extension requires a `git` binary on PATH. If the fork's development or runtime environment doesn't have Git configured, the extension deactivates silently, unregistering all its commands.

### Resolution Path

1. **Verify Git extension activation** — Check the Output panel → "Git" channel for activation errors. Ensure `git.enabled` setting is `true` and `git.path` points to a valid Git binary.
2. **Check extension host logs** — Review `~/.mcode/logs/` for extension host errors related to the git extension.
3. **Test command availability** — Open Command Palette → "Git: Clone" to verify the git extension is functional. If this command is missing, the git extension itself is not loading.
4. **Verify `.gitattributes` and `.gitignore`** — Ensure the fork's repository metadata doesn't interfere with the built-in git extension's repository detection.
5. **Extension activation order** — If the custom `mia.three-universe` extension's `onStartupFinished` activation event runs before the git extension registers its commands, add a guard that waits for `git` extension activation before invoking internal git commands.

### Priority
🟡 **Medium** — WorkIQ is a third-party plugin. The core narrative extensions do not depend on it. However, git extension health affects Source Control (Issue 5).

---

## Issue 4: Claude-Code Extension — Secondary Panel Not Loading

### Observation
```
Extension like claude-code does not load the chat "secondary panel" that it should be.
* Is our integration of the upstream well completed?
```
The Claude Code extension installs but does not render its secondary chat panel (the sidebar webview that provides Claude's conversational interface).

### Root Cause Analysis

The Claude Code extension registers a webview-based panel that requires specific VS Code API surface. In the Mia Code fork, several factors can prevent panel rendering:

1. **Proposed API access** — The Claude Code extension may use proposed VS Code APIs that require explicit allowlisting in `product.json`'s `extensionAllowedProposedApi`. Currently, only `mia.*` extensions are listed. If Claude Code uses proposed APIs (e.g., `chatParticipant`, `languageModelAccess`), it will fail silently.
2. **Webview content security policy** — The fork's webview CSP configuration may block the Claude Code extension's webview resources. If the extension loads remote resources from Anthropic's servers, the CSP needs to allow those origins.
3. **Extension host process limits** — If the extension host hits memory limits or process caps (configured in the fork's build), complex extensions like Claude Code may fail to initialize their webview panels.
4. **Activity bar container conflict** — The Mia Code fork adds custom activity bar containers (Three Universe, STC Dashboard, Story Monitor). If the Claude Code extension expects specific viewContainer IDs that collide or if the activity bar contribution order is affected, its panel may not render.

### Resolution Path

1. **Check extension logs** — Open Output panel → "Claude Code" (or "Extension Host") for error messages. Look for `proposed API` rejection or CSP violations.
2. **Add Claude Code to proposed API allowlist** — In `product.json`, add the Claude Code extension ID to `extensionAllowedProposedApi`:
   ```json
   "extensionAllowedProposedApi": [
     "mia.three-universe",
     "mia.stc-charts",
     "mia.story-monitor",
     "mia.agent-panel",
     "mia.chat-participant",
     "anthropic.claude-code"
   ]
   ```
3. **Verify webview rendering** — Test with a minimal webview extension to confirm the fork's webview infrastructure works. If minimal webviews render but Claude Code doesn't, the issue is extension-specific.
4. **Check extension compatibility** — Verify the Claude Code extension's `engines.vscode` constraint is satisfied by the fork's version (currently 1.112.0).

### Priority
🟡 **Medium** — The fork provides its own agentic interfaces (`mia.agent-panel`, `mia.chat-participant`). Claude Code compatibility is valuable for developer experience but not structurally required.

---

## Issue 5: Source Control — Repository Never Loads

### Observation
```
SOURCE Control when opening a directory never loads the repository in the current directory...
```
The Source Control panel remains empty when opening a directory that contains a Git repository. No repository is detected or displayed.

### Root Cause Analysis

This issue is closely related to Issue 3 (git extension health) and likely shares the same root cause. The Source Control panel is populated by the built-in `git` extension, which must:

1. **Detect Git repositories** — The extension scans the workspace for `.git/` directories. If `git.autoRepositoryDetection` is set to `false` or `"subFolders"` and the workspace structure doesn't match expectations, detection fails.
2. **Execute `git` binary** — The extension shells out to the system `git` binary for all operations. If `git` is not on PATH, or if the fork's shell environment doesn't inherit PATH correctly, all git operations fail silently.
3. **Extension activation** — The git extension activates on `*` (all workspace types) and on SCM-related commands. If activation fails (see Issue 3 analysis), no repositories are registered with the Source Control API.
4. **Product configuration** — The `product.json` change may affect how the git extension discovers its bundled `git` binary. Some VS Code distributions bundle a specific git version; the fork may not have completed this bundling step.

### Resolution Path

1. **Verify Git binary** — Run `which git` and `git --version` in the integrated terminal. If git is not available, install it or configure `git.path` in settings.
2. **Check git extension status** — Run command `"Developer: Show Running Extensions"` and verify `vscode.git` appears as active. If it shows errors, the extension host log will have details.
3. **Manual repository registration** — Run `"Git: Initialize Repository"` or `"Git: Open Repository"` to manually trigger repository detection. If this works, the issue is with auto-detection configuration.
4. **Verify `git.enabled` and `git.autoRepositoryDetection`** — Ensure these settings are `true` and `"openEditors"` (or `true`) respectively.
5. **Check fork's built-in extensions** — Confirm the `extensions/git/` directory is included in the build output. If the build process excludes built-in extensions, the git extension won't be available.

### Priority
🔴 **High** — Source Control is essential for development workflow. Without it, developers cannot commit, branch, or review changes from within the IDE. This is foundational infrastructure.

---

## Cross-Cutting Analysis

### Common Theme: Fork Configuration Delta

All five issues trace to the **configuration delta** between upstream VS Code and the Mia Code fork. The pattern is consistent:

| Issue | Configuration Layer | Delta |
|-------|-------------------|-------|
| argv.json | Runtime | `dataFolderName` → `.mcode` (new argv.json location) |
| Copilot Chat | Authentication | `urlProtocol` → `mcode`, missing OAuth client |
| WorkIQ Plugin | Extension Host | Internal command availability / activation order |
| Claude Code Panel | Extension Host | `extensionAllowedProposedApi` incomplete |
| Source Control | Built-in Extension | Git extension activation / binary discovery |

### The Structural Pattern

The fork has correctly customized the **identity layer** (`product.json`: name, protocol, gallery) but has not yet completed the **integration layer** — the secondary configurations that depend on the identity change. Each identity change cascades:

```
product.json identity change
  → dataFolderName change → new runtime paths → argv.json regeneration needed
  → urlProtocol change → OAuth callback URI change → auth flow broken
  → extensionsGallery change → extension resolution change → side-loaded extensions lose context
  → extensionAllowedProposedApi → only mia.* listed → third-party proposed API blocked
```

### The Resolution Principle

Rather than fixing issues individually, the resolution strategy should address the **cascade systematically**:

1. Complete the `product.json` integration layer (auth, proposed APIs, extension allowances)
2. Verify the runtime path chain (data folder → argv.json → logs → extension host)
3. Confirm built-in extension health (git, terminal, markdown) before testing custom extensions
4. Validate extension host initialization order with custom + stock extensions co-existing

---

## Action Steps

Ordered resolution strategy following dependency chain:

### Phase 1: Runtime Foundation (Unblocks everything)
1. **Fix argv.json generation** — Delete `~/.mcode/argv.json`, verify build template, restart. Confirm clean startup. *(Resolves Issue 1)*
2. **Verify Git binary and extension** — Confirm `git` on PATH, check `vscode.git` extension activation in extension host logs, verify `extensions/git/` in build output. *(Resolves Issues 3 & 5)*

### Phase 2: Extension Host Configuration
3. **Expand `extensionAllowedProposedApi`** — Add third-party extension IDs (Claude Code, Copilot) to the allowlist in `product.json`. *(Resolves Issue 4)*
4. **Verify extension activation order** — Confirm `mia.three-universe` (onStartupFinished) does not interfere with built-in extension activation. Check extension host process limits.

### Phase 3: Authentication Infrastructure
5. **Register GitHub OAuth App** — Create `mcode://` OAuth application on GitHub. Add client ID to `product.json` `github-authentication` block. *(Resolves Issue 2)*
6. **Verify URI handler** — Confirm `mcode://` protocol is registered with the OS. Test OAuth callback round-trip.

### Phase 4: Validation
7. **Integration smoke test** — Verify all five issues are resolved: clean startup, Source Control loads, Copilot Chat authenticates, Claude Code panel renders, WorkIQ installs.
8. **Document fork configuration requirements** — Create a `docs/fork-configuration.md` capturing all `product.json` fields that require cascading changes, preventing recurrence in future upstream merges.

---

*RISE Framework Compliance: ✅ Creative Orientation (desired outcomes, not blame) | ✅ Structural Dynamics (cascade analysis) | ✅ Advancing Patterns (phased resolution) | ✅ Managerial Moment of Truth (honest assessment)*
