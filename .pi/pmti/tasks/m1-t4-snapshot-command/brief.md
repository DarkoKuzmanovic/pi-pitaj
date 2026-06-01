# M1-T4 — Wire `/pitaj snapshot` through existing consult path

## Preflight

- CWD: `/home/quzma/.pi/agent/extensions/pi-pitaj`
- Project state: PMTI
- Intent: implementation task packet
- PMTI write allowed: yes; user said “Let’s do it!” after M1-T3 close-out and next-step summary
- Depends on: completed M1-T3 runtime snapshot seam (`snapshot-runtime.ts` and session log `2026-06-01-008.md`)
- Workspace strategy: `current-branch`

## Goal

Make `/pitaj snapshot <question>` build a curated snapshot with the M1-T2/M1-T3 helpers and pass it as `context` into the existing `consultModel()` path.

## In scope

- Add command parsing/wiring for `/pitaj snapshot` and `/pitaj snapshot <alias|provider/model> [--mode <mode>] [--brevity <level>] <question>`.
- Reuse existing `parseCommandArgs()` for the text after the `snapshot` token where practical.
- Build runtime snapshot input with `buildRuntimeSnapshotInput()` using the current command question, loaded `maxContextChars`, `ctx.sessionManager`, and the existing `SnapshotToolResultBuffer`.
- Build snapshot context with `buildSnapshotContext()` and call `consultModel()` with `context` set to the generated snapshot.
- Preserve default model/mode/brevity behavior unless an alias or supported flags are explicitly supplied.
- Preserve empty-question behavior: use the editor when UI is available; otherwise show usage/help.
- Add details/display metadata that identifies snapshot usage plus included/omitted categories and truncation state.
- Add tests proving snapshot command parsing/request construction and no `PitajParams`/`autoContext` tool-schema changes.

## Out of scope

- Do not add `autoContext`, `snapshot`, or similar fields to the `pitaj` tool schema.
- Do not wire snapshot mode into direct `pitaj` tool calls.
- Do not add `/pitaj advise`, `/pitaj escalate`, `/pitaj config`, budgets, persistent consultation history, or full-branch capture.
- Do not call `ctx.sessionManager.getBranch()` or `getEntries()`.
- Do not give sidecar models tools.
- Defer README and `/pitaj help` documentation polish to M1-T5 except for any minimal help text required by command behavior tests.

## Acceptance criteria

- `/pitaj snapshot <question>` generates a snapshot and calls the same `consultModel()` path used by normal `/pitaj` commands.
- `/pitaj snapshot opus --mode risk-check --brevity detailed <question>` preserves explicit alias and flags in the consult request.
- Empty `/pitaj snapshot` follows existing empty-question behavior.
- Result details or message details include snapshot usage metadata: included categories, omitted categories, and truncation state.
- Existing `/pitaj <alias> ...`, `/pitaj aliases`, `/pitaj models`, `/pitaj check`, direct `pitaj` tool calls, and `model: "auto"` behavior stay unchanged.
- Tests pass with `npm test`.
- Strip-type checks pass for `index.ts`, `snapshot-runtime.ts`, `snapshot.ts`, and `helpers.test.ts`.
- Biome has no new warnings/errors beyond the known existing optional-chain info in `helpers.ts:182`.

## Suggested TDD sequence

1. Add tests for a pure snapshot command/request helper that should fail before implementation.
2. Verify RED with `npm test`.
3. Implement minimal helper and command branch in `index.ts`.
4. Verify GREEN with `npm test`.
5. Run strip checks and Biome.
6. Request fresh read-only reviewer.
