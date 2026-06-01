# PMTI Task Packet — M2-B2 config UI close-out

## Identity

- **Milestone:** M2 — `/pitaj config` settings UI and safe persistence
- **Batch:** M2-B2-config-ui-closeout
- **Logical tasks covered:** M2-T4, M2-T5
- **Status:** prepared 2026-06-01
- **Workspace strategy:** inherited project default `current-branch`
- **CWD:** `/home/quzma/.pi/agent/extensions/pi-pitaj`

## Goal

Implement the remaining M2 behavior: interactive `/pitaj config` update flow with safe confirmed settings writes, documentation/help updates, final verification, fresh review, and M2 close-out evidence.

Batch B starts only because Batch A (`M2-B1-config-core`) passed verification and fix-back review. Do not reopen the Batch A settings contract unless a blocker makes the UI write path impossible.

## Source of truth

Read before editing:

1. `.pi/pmti/project/charter.md`
2. `.pi/pmti/project/roadmap.md`
3. `.pi/pmti/project/decisions.md` — especially `M2-a`, `M2-b`, `M2-c`
4. `.pi/pmti/project/watch.md`
5. `.pi/pmti/milestones/M2.md`
6. `.pi/pmti/project/session-log/2026-06-01-015.md`
7. `.pi/pmti/tasks/m2-b1-config-core/worker-report.md`
8. `.pi/pmti/tasks/m2-b1-config-core/reviewer-fixback-report.md`
9. Product files: `helpers.ts`, `index.ts`, `helpers.test.ts`, `README.md`, and `settings.json` only as needed.

## In scope

### M2-T4 — Interactive config update flow

- Verify Pi UI dialog API signatures before implementation from installed docs/types.
- In `ctx.hasUI` mode, `/pitaj config` offers a guided way to edit common settings.
- Common settings supported:
  - `defaultModel`
  - `autoRouteLow`
  - `autoRouteHigh`
  - `defaultMode`
  - `defaultBrevity`
  - `maxContextChars`
  - `maxOutputChars`
- Validate inputs before saving:
  - alias-name route targets must be non-empty and present in `settings.aliases`;
  - model/default model values must resolve as alias or provider/model-shaped string where possible;
  - mode and brevity must be known enum values;
  - numeric limits must be positive finite integers or explicitly cleared when supported.
- Require explicit confirmation before writing changes.
- Show a concise before/after or changed-fields summary before confirmation.
- Use the three-state write-safety model from Batch A:
  1. `not-found` — allow create after validation and confirmation;
  2. `loaded` — allow overwrite after validation and confirmation;
  3. `malformed` — refuse overwrite and show warning/manual recovery path unless an explicit recovery/replace flow is implemented and confirmed.
- Alias editing is deferred in M2 unless it can be implemented safely without scope creep. If deferred, show aliases count/sample and manual edit instructions.

### M2-T5 — Docs, verification, and close-out

- Update `README.md` to document `/pitaj config`, supported fields, UI/non-UI behavior, malformed-file safety, and manual-edit compatibility.
- Update `index.ts` `usageText()` so `/pitaj help` mentions `/pitaj config` concisely.
- Add/update tests for pure helper behavior and source-level command/UI routing where live Pi UI is not available.
- Run final verification:
  - `npm test`
  - strip syntax checks for changed TypeScript files
  - Biome check for changed TypeScript/docs-adjacent files as applicable
- Request a fresh-context reviewer and fix Critical/Important findings.
- Record final M2 evidence in `.pi/pmti/project/session-log/` and update M2 status/project roadmap/changes-log only after verification and review pass.

## Out of scope

Do not implement in Batch B:

- budgets or usage tracking (M3);
- `/pitaj advise`, `/pitaj escalate`, or advisor shortcuts (M4);
- full-branch capture (M5);
- sidecar tools;
- direct `pitaj` tool schema fields for config/snapshot/autoContext;
- provider credential/API key persistence;
- edits to Pi global provider/model config outside this extension's `settings.json`;
- broad persistent consultation history;
- `ctx.sessionManager.getBranch()` or `getEntries()` usage.

## Constraints and invariants

- Preserve existing explicit `pitaj` tool calls, `/pitaj <alias|provider/model> ...`, `/pitaj snapshot ...`, `/pitaj aliases`, `/pitaj models`, `/pitaj check`, `/pitaj config show`, and `model: "auto"` behavior.
- Preserve Batch A defaults: auto-route aliases default to `gpt` and `opus`; absent numeric settings remain `undefined`; max output precedence remains request > explicit settings > brevity default.
- Settings writes must be formatted JSON and manually editable.
- Settings writes must preserve aliases and valid manual fields.
- Do not write secrets, auth headers, or provider credentials.
- TypeScript style: no `any`, no non-null assertions, use `import type` for type-only imports.
- UI must degrade gracefully when `ctx.hasUI` is false.
- Keep implementation surgical; prefer pure helpers in `helpers.ts` or a focused module when it keeps UI code testable.

## Acceptance criteria

- `/pitaj config` without UI remains a compact summary/manual-edit path and does not prompt incorrectly.
- `/pitaj config show` remains summary-only in all contexts.
- `/pitaj config` with UI can update supported common settings and writes only after confirmation.
- Malformed `settings.json` refuses overwrite and gives a manual recovery path.
- Not-found settings file can be created only after validation and confirmation.
- Loaded settings file can be overwritten only after validation and confirmation.
- Alias editing is either safely implemented or explicitly deferred with instructions.
- Existing consult, aliases/models/check/snapshot, direct tool, and auto-route behaviors remain compatible.
- Tests cover validation/write-planning/UI helper behavior and command routing enough to prevent regressions.
- README and `/pitaj help` document config behavior and limits.
- `npm test`, strip checks, and Biome pass.
- Fresh reviewer returns no Critical/Important findings before M2 close-out.

## Verification commands

Run at minimum:

```bash
npm test
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
bunx --bun @biomejs/biome check helpers.ts index.ts helpers.test.ts
```

If adding a new TypeScript module, include it in strip and Biome checks. If README changes, include a sanity grep/read check that the documented `/pitaj config` behavior matches implementation.

## Stop conditions

Stop and report instead of improvising if:

- Pi UI signatures are incompatible with a guided prompt flow and an editor fallback would create a different security model;
- safe writes require overwriting malformed settings without an explicit confirmed recovery path;
- preserving aliases conflicts with the chosen serialization/write flow;
- validation requires changing Pi global model/provider config;
- tests indicate `/pitaj snapshot`, direct `pitaj`, or `model: "auto"` compatibility regressed;
- the current workspace does not match the handoff Workspace section.
