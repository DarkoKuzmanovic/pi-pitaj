# AGENTS.md — pi-pitaj

Guidance for AI agents and contributors working on this extension.

## What this project is

`pi-pitaj` is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that registers a `pitaj` tool and `/pitaj` command for in-process model consultations. It lets you ask another configured model for fast input without leaving the active Pi session.

## Architecture

Extension entrypoint (`index.ts`) with shared pure logic in `helpers.ts`, Oracle evidence policy/runtime in `oracle-policy.ts`/`oracle.ts`, the snapshot subsystem in `snapshot.ts`/`snapshot-runtime.ts`, and usage accounting in `usage.ts`.

```text
index.ts                ← Extension entrypoint
├─ loadSettings()        ← Reads settings.json (safe fallback + auto-route validation warning)
├─ pitaj tool registration← Agent tool: `pitaj`
├─ /pitaj command        ← Slash command with subcommands (auto, advise, snapshot, config, usage, check)
└─ consultModel()        ← Resolves model, validates auth, streams via `stream()`, finalizes the answer

helpers.ts              ← Pure logic: settings, parsing, prompts, formatting, usage accounting
├─ settingsFromUnknown() / mergeSettings() / validateAutoRouteAliases()
├─ resolveModelRef() / resolveAutoRoute()
├─ parseCommandArgs() / classifySpecialCommand() / isAdviseFlagViolation()
├─ buildConsultSystemPrompt() / buildConsultUserText() / truncateText()
├─ finalizeConsultAnswer() ← stopReason policy: error/aborted throw, length is marked truncated
├─ formatResultForDisplay() / formatUsageSummaryText()
└─ createUsageStore() / buildUsageSummary()

oracle-policy.ts        ← Pure Oracle request, path, budget, truncation, secret-refusal, and host-action policy
oracle.ts               ← Approved-root validation, bounded evidence adapter, and serial Oracle tool loop

snapshot.ts             ← Pure bounded session-snapshot context builder
snapshot-runtime.ts     ← Runtime collection seam (session tree, tool-result buffer)
usage.ts                ← createUsageRecorder() bridging usage store to tool/command call sites
settings.json           ← Runtime model aliases / defaults
```

### Runtime flow

1. User invokes `/pitaj ...` or calls the tool directly.
2. `settings.json` is loaded and merged with defaults; malformed files fall back to defaults with a warning. Auto-route aliases (`autoRouteLow`/`autoRouteHigh`) are validated at load time — a missing alias produces a settings warning immediately, not on the first `/pitaj auto` call.
3. Input is parsed as:
   - `pitaj <alias|provider/model> <question>`
   - or bare question using `defaultModel`.
4. `resolveModelRef()` maps aliases to provider/model IDs.
5. Model is resolved through `ctx.modelRegistry` and API credentials are loaded.
6. A compact prompt is built (mode + brevity, optional context, optional truncation).
7. `stream()` runs each consultation round; Oracle tool rounds are serially mediated by the host.
8. After each completed `streamResponse.result()` round, real `AssistantMessage.usage` is accumulated once and returned as nested tool `usage` when available.
9. Oracle request/character exhaustion → one bounded refusal, then exactly one final round with tools omitted; `details.oracle.exhausted` is set and the display footer warns the caller.
10. `finalizeConsultAnswer()` turns the terminal stream outcome into a final answer or a loud failure:
   - `stopReason: "error"` / `"aborted"` → throw (a dead stream is never returned as a normal answer; the error carries the provider message and partial-text size)
   - `stopReason: "length"` → answer returned but visibly marked as provider-truncated, `truncated` recorded in details
11. Answer is returned and displayed by Pi; coarse in-memory usage counters remain separate from nested provider token/cost usage.

## Configuration

`settings.json` supports:

- `defaultModel` (alias or `provider/model`)
- `defaultMode` (`answer` | `critique` | `debug` | `plan` | `risk-check`)
- `defaultBrevity` (`short` | `normal` | `detailed`)
- `maxContextChars`
- `maxOutputChars`
- `aliases` map (e.g., `opus`, `deepseek`, `glm`)
- `autoRouteLow` / `autoRouteHigh` (alias names used by `model: "auto"` routing; validated at load time)

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

### Oracle root, evidence, and budget invariants

Oracle mode requires an explicit `oracleRoot` that equals the canonical Git top-level containing `ctx.cwd`; a different valid Git repository is rejected before the first provider request, and there is no cwd fallback or interactive approval gate. Every Git subprocess removes repository-selection variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES`) while preserving normal runtime environment such as `PATH`. Evidence stays limited to host-mediated `read_file`, `search`, `list_files`, and `git_diff`. `search` enumerates candidates through Git (`git ls-files -co --exclude-standard -z`, optionally narrowed to a root-relative directory), skips binary candidates, counts unreadable/unsafe/oversized candidates without disclosing their paths or causes, and reports candidate/match bounds or partial search instead of a bare no-match. `git_diff` means staged plus unstaged changes to tracked files: committed repositories use `git diff HEAD --no-ext-diff --no-textconv`, while unborn repositories combine cached and unstaged tracked diffs. Untracked files are excluded, all Git output shares a finite aggregate host buffer, and an oversized result becomes an explicit refusal. Its hard budget is 9 evidence requests, 4,000 characters per result, and 18,000 aggregate evidence characters per consultation; the first reached limit stops further requests. `maxEvidenceRequests` may set the request cap to a whole number from 1 through 9, never above the hard maximum; fractional and non-finite values are rejected at the schema and runtime boundaries rather than expanded. Invalid/refused requests still consume a request slot, while all existing root, traversal/symlink, sensitive-path, redaction, and read-only protections remain mandatory.

## Testing

Run focused tests or the repeatable verification gate:

```bash
npm test
npm run typecheck
npm run check
```

- `npm test` runs the focused Node test suite.
- `npm run typecheck` checks every root product and test `.ts` file with the strict NodeNext, no-emit configuration in `tsconfig.json`.
- `npm run check` runs typecheck first, then the focused test suite.

Tests cover parsing/routing, settings writes, prompt and result shaping, consultation stream behavior, snapshots, usage accounting, and Oracle policy/adapter/tool-loop boundaries.

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

### Preserve lexical provenance until syntax is consumed

When parsing command text, do not flatten quote-aware tokens into plain strings before deciding which tokens are syntax. Carry metadata such as `quoted` through flag extraction so a quoted literal like `"--risk"` cannot be mistaken for a top-level option; flatten only after syntax-consuming stages are complete.

## Crew project state

This repository uses Crew’s root-file convention:

- `ROADMAP.md` — release-oriented strategic milestones.
- `DECISIONS.md` — durable product and architecture rationale.
- `IDEAS.md` — uncommitted candidates.
- `docs/specs/*.md` — design and specification documents; each file’s status states whether it is a candidate, approved design, or shipped history.
- `PLAN.md` — transient execution state for an explicitly authorized active Crew run only.

### Session orientation

1. Read `ROADMAP.md` and `DECISIONS.md`.
2. If `PLAN.md` exists, resume only that active Crew run and reconstruct the current wave into `todo_write`.
3. If no `PLAN.md` exists, treat planned roadmap entries and specifications as candidates rather than authorization.
4. Read the relevant specification before grilling, scope classification, or implementation.

Do not recreate PMTI task packets, milestone manifests, session logs, or a state directory. Completed implementation detail belongs in `CHANGELOG.md` and Git history. Future work follows Crew’s spec → grill offer → scope decision → outcome waves → risk-dominant review → close-out loop.

### Product planning guardrails

- Keep `pitaj` an explicit, bounded sidecar consultation tool rather than a delegation system.
- Do not add full active-conversation forwarding without a new decision backed by a concrete unmet use case.
- Snapshot conveniences must reuse the curated bounded snapshot path and remain advisory.
- Oracle changes affecting root scope, evidence disclosure, or secret handling are protected-risk work and require the corresponding deep Crew gate.