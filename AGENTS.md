# AGENTS.md — pi-pitaj

Guidance for AI agents and contributors working on this extension.

## What this project is

`pi-pitaj` is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that registers a `pitaj` tool and `/pitaj` command for in-process model consultations. It lets you ask another configured model for fast input without leaving the active Pi session.

## Architecture

Single-file extension (`index.ts`) with shared helper logic in `helpers.ts`.

```text
index.ts                ← Extension entrypoint
├─ loadSettings()        ← Reads settings.json (with safe fallback)
├─ parseCommandArgs()    ← Detects optional model token vs. default question
├─ pitaj tool registration← Agent tool: `pitaj`
├─ /pitaj command        ← User slash command bridge with optional editor fallback
└─ consultModel()        ← Resolves model, validates auth, calls `complete()`

helpers.ts              ← Validation + settings normalization + prompt builders
├─ DEFAULT_SETTINGS
├─ settingsFromUnknown()
├─ mergeSettings()
├─ resolveModelRef()
├─ buildConsultSystemPrompt()
├─ buildConsultUserText()
└─ truncateText()

settings.json           ← Runtime model aliases / defaults
```

### Runtime flow

1. User invokes `/pitaj ...` or calls the tool directly.
2. `settings.json` is loaded and merged with defaults; malformed files fall back to defaults with a warning.
3. Input is parsed as:
   - `pitaj <alias|provider/model> <question>`
   - or bare question using `defaultModel`.
4. `resolveModelRef()` maps aliases to provider/model IDs.
5. Model is resolved through `ctx.modelRegistry` and API credentials are loaded.
6. A compact prompt is built (mode + brevity, optional context, optional truncation).
7. `complete()` runs the consultation and returns text.
8. Answer is returned and displayed by Pi.

## Configuration

`settings.json` supports:

- `defaultModel` (alias or `provider/model`)
- `defaultMode` (`answer` | `critique` | `debug` | `plan` | `risk-check`)
- `defaultBrevity` (`short` | `normal` | `detailed`)
- `maxContextChars`
- `maxOutputChars`
- `aliases` map (e.g., `opus`, `deepseek`, `mimo`, `glm`)

Example:

```json
{
  "defaultModel": "opus",
  "defaultMode": "answer",
  "defaultBrevity": "short",
  "maxContextChars": 12000,
  "maxOutputChars": 4000,
  "aliases": {
    "opus": "anthropic/claude-opus-4-8",
    "deepseek": "deepseek/deepseek-v4-pro"
  }
}
```

## Testing

Run:

```bash
npm test
```

Tests focus on argument parsing, model resolution, and prompt-shaping behavior.

## Extension conventions

- Peer dependency on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`.
- TypeScript ESM module.
- Keep output short, focused, and evidence-based.
- For configuration/behavior changes, preserve safe defaults and backward compatibility.

### Executor edit discipline

For any executor working in this repo (any model), keep edits structurally safe. Make one logical edit per file, then re-read before the next edit to that file — sequential anchored edits (`replace_lines`/`set_line`) reuse line anchors that shift under prior edits and can silently produce duplicate or orphaned code. For any code file needing more than one change, or a function/block add or remove, rewrite the whole file with `write` instead of stacking anchored edits. After editing, confirm no duplicate declarations, balanced braces/parens, and matching closers; this is a TypeScript ESM module, so use `import` and never `require`. Stop and report after two failed edits on the same file instead of carrying a corrupt file forward.

## Lessons learned

### Adjust snapshot metadata after final context bounding

For snapshot/context builders, final whole-context truncation can invalidate per-section metadata computed earlier. Compute or adjust included/truncated/omitted metadata after the final bounding pass so sidecars never see metadata claiming a category was included when its rendered section was cut.

### Validate raw user input before fallback helpers

When a helper intentionally falls back from blank input to defaults, do not use that helper as proof that raw user input is valid for persistence. Validate the submitted value first, then call fallback-aware resolution only after the input has passed the stricter boundary check.

<!-- BEGIN PMTI MANAGED BLOCK -->
## PMTI project state

Canonical PMTI state lives in `.pi/pmti/`.

- Project context: `.pi/pmti/project/`
- Roadmap: `.pi/pmti/project/roadmap.md`
- Milestones: `.pi/pmti/milestones/MN.md`
- Task packets: `.pi/pmti/tasks/<mn-tn-slug>/` (scratch by default)
- Workspace strategy: see `.pi/pmti/project/decisions.md` and milestone manifests

### Session orientation

1. Read `.pi/pmti/project/roadmap.md`.
2. Read the current milestone file under `.pi/pmti/milestones/`.
3. Read the most recent `.pi/pmti/project/session-log/` entry.
4. If a milestone was just closed, verify reviewer verdict and full tests before starting the next one.

### PMTI routing

- Fresh project setup or repair → `pmti-project`.
- Milestone planning/decomposition → `pmti-milestone`.
- Executor-ready task packet → `pmti-task`.
- Trivial direct edits bypass PMTI.
- If `.pi/project/` exists without `.pi/pmti/`, this is legacy state; do not mix PMTI files in automatically.

### Mandatory PMTI preflight

Before PMTI writes, delegation, or handoff, classify: CWD, project state, intent, whether PMTI writes are allowed, and the next required action. Use `ask_user` when scope, migration permission, executor choice, or overwrite behavior is ambiguous. Use `todo_write` for non-trivial PMTI work.

### Milestone close-out

A milestone is not done until:

1. Documentation hygiene is checked.
2. Implementation is committed as a checkpoint.
3. `reviewer` reviews the committed diff unless the documented low-risk skip clause applies.
4. Blocker findings are fixed before the next milestone.
5. Full tests are rerun after fixes.
6. Final reviewer verdict and test result are recorded in `.pi/pmti/project/session-log/`.

Oracle is pre-code advisory. Reviewer is post-code. Executor fixes blockers. Automated fix-back is bounded to two rounds before human/orchestrator escalation.

### M4 milestone

**Status:** completed 2026-06-02

M4 added three features:
- `/pitaj auto` slash command with optional `--risk low|high` (M4-T1)
- Test split of monolithic `helpers.test.ts` into focused suites (M4-T3)
- `/pitaj advise` zero-flag advisory shortcut wrapping the curated snapshot builder (M4-T2)
- Close-out docs and session log (M4-T4)

Guardrail audit confirms M4 added no new capture sources, no persistence, no token/cost accounting, no sidecar tools, and no full-branch capture.
<!-- END PMTI MANAGED BLOCK -->