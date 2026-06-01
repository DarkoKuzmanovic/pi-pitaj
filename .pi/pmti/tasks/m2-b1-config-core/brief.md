# PMTI Task Packet — M2-B1 config core

## Identity

- **Milestone:** M2 — `/pitaj config` settings UI and safe persistence
- **Batch:** M2-B1-config-core
- **Logical tasks covered:** M2-T1, M2-T2, M2-T3
- **Status:** prepared 2026-06-01
- **Workspace strategy:** inherited project default `current-branch`
- **CWD:** `/home/quzma/.pi/agent/extensions/pi-pitaj`

## Goal

Implement the M2 config core foundation: durable settings contract/semantics, safe settings load/save helpers, runtime `maxOutputChars` semantics, configurable auto-route target aliases, and `/pitaj config` summary/non-interactive fallback.

Batch A must stop before any interactive settings update UI. Batch B owns interactive writes and final docs/close-out.

## Source of truth

Read before editing:

1. `.pi/pmti/project/charter.md`
2. `.pi/pmti/project/roadmap.md`
3. `.pi/pmti/project/decisions.md` — especially `M2-a`, `M2-b`, `M2-c`
4. `.pi/pmti/project/watch.md`
5. `.pi/pmti/milestones/M2.md`
6. `.pi/pmti/tasks/m2-b1-config-core/brief.md`
7. `.pi/pmti/tasks/m2-b1-config-core/handoff.md`
8. Product files: `helpers.ts`, `index.ts`, `helpers.test.ts`, `settings.json`, and `README.md` only if needed for references.

## In scope

### M2-T1 — Config contract and settings semantics

- Define exact M2 settings fields and defaults:
  - `defaultModel`
  - `defaultMode`
  - `defaultBrevity`
  - `maxContextChars`
  - `maxOutputChars`
  - `aliases`
  - low-risk auto-route alias field
  - high-risk auto-route alias field
- Store auto-route targets as alias names, not provider/model strings (`M2-a`). Defaults remain `gpt` for low/default and `opus` for high/risk-check.
- Widen `AutoRouteResult.alias` from hardcoded `"gpt" | "opus"` to `string`.
- Update auto-route resolution to use configured low/high route aliases while preserving current default behavior.
- Decide implementation shape for absent numeric settings fields according to `M2-b`: absent numeric fields remain undefined so precedence can fall through intentionally.
- Preserve backward compatibility with existing `settings.json` files and manual alias entries.

### M2-T2 — Safe settings helpers and runtime semantics

- Add or refactor pure helpers for normalizing, summarizing, validating, and serializing settings.
- Add a safe settings write path/helper, but do **not** expose interactive writes in Batch A.
- Model three file states for write safety:
  1. settings file does not exist — create is allowed later after validation/confirmation;
  2. settings file exists and parsed cleanly — write may overwrite only after validation/confirmation;
  3. settings file exists but malformed — refuse silent overwrite and report manual recovery path unless explicit confirmed recovery is implemented later.
- Preserve valid manual alias entries; do not silently drop alias keys.
- Cover malformed JSON, invalid fields, invalid numeric limits, blank aliases, and summary/write-result behavior in tests.
- Fix runtime output-limit semantics: `request.maxOutputChars` > explicit `settings.maxOutputChars` > brevity default.

### M2-T3 — `/pitaj config` summary and non-interactive fallback

- Add exact `config` recognition to command classification/routing without treating `config ...` as a normal question.
- Implement `/pitaj config` summary behavior that works without UI.
- Implement `/pitaj config show` or equivalent if useful for clear command routing.
- Summary should include effective settings, route aliases, aliases count/sample, numeric limits, and manual edit path.
- Preserve existing `/pitaj help`, `/pitaj aliases`, `/pitaj models`, `/pitaj check`, `/pitaj snapshot`, normal consult behavior, direct tool calls, and `model: "auto"`.

## Out of scope

Do not implement in Batch A:

- interactive config editing UI;
- actual user-facing settings writes from `/pitaj config`;
- `/pitaj advise`, `/pitaj escalate`, budgets, persistent consultation history;
- full-branch capture;
- sidecar tools;
- provider credential/API key management;
- Pi global provider/model config edits outside this extension's `settings.json`;
- direct `pitaj` tool schema changes for config or snapshot behavior;
- unrelated README/help final docs beyond minimal help needed for tests.

## Constraints and invariants

- Preserve existing explicit tool calls and `/pitaj <alias|provider/model> ...` behavior.
- Preserve `model: "auto"` behavior except for making route aliases configurable with defaults.
- Preserve `/pitaj snapshot ...` behavior.
- Do not hardcode secrets or credentials.
- TypeScript style: no `any`, no non-null assertions, `import type` for type-only imports.
- Prefer pure helpers in `helpers.ts` or a small focused settings module; avoid large UI code in Batch A.
- JSON serialization for settings should be formatted and manually editable.
- Malformed `settings.json` read fallback may remain, but write must not silently overwrite malformed files.
- Worker must not edit durable PMTI status files except if explicitly asked by orchestrator after review.

## Acceptance criteria

- Tests cover:
  - configured low/high auto-route aliases with defaults preserved;
  - `AutoRouteResult.alias` no longer restricted to `"gpt" | "opus"`;
  - absent vs invalid numeric settings fields;
  - `maxOutputChars` precedence: request > explicit settings > brevity default;
  - malformed settings file write refusal or write-state summary;
  - valid manual aliases preserved;
  - `/pitaj config` and optional `/pitaj config show` summary routing;
  - existing special commands and `/pitaj snapshot` routing unchanged.
- `npm test` passes.
- Strip syntax checks pass for changed TypeScript files.
- Biome check has no new errors/warnings; pre-existing info-level findings may be recorded.
- No interactive config writer is implemented in this batch.
- No `autoContext`, direct tool config fields, full-branch capture, `getBranch(`, or `getEntries(` additions.

## Verification commands

Run at minimum:

```bash
npm test
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
bunx --bun @biomejs/biome check helpers.ts index.ts helpers.test.ts
```

If adding a new TypeScript module, include it in strip and Biome checks.

## Stop conditions

Stop and report instead of improvising if:

- existing settings shapes conflict with the planned M2 contract;
- safe write-state modeling requires a tradeoff not already recorded in M2 decisions;
- `/pitaj config` summary would require interactive UI to be meaningful;
- validation requires changing Pi global config or provider credentials;
- tests indicate `/pitaj snapshot`, direct `pitaj`, or `model: "auto"` compatibility regressed;
- the current workspace does not match the handoff Workspace section.
