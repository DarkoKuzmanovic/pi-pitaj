# Handoff — M1-T4 snapshot command wiring

## Workspace

- Workspace strategy: `current-branch`
- Expected cwd: `/home/quzma/.pi/agent/extensions/pi-pitaj`
- Expected branch/worktree: n/a; this directory may not be a git repository in this Pi extension setup
- Workspace owner: orchestrator/executor in current workspace
- Close-out owner: orchestrator/human via PMTI close-out; git close-out separate if applicable

Before editing, confirm the current workspace contains `package.json`, `.pi/pmti/`, `index.ts`, `helpers.ts`, `snapshot.ts`, and `snapshot-runtime.ts`. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.

## Executor prompt

Implement PMTI task `M1-T4` from `.pi/pmti/tasks/m1-t4-snapshot-command/`.

Read first:

1. `.pi/pmti/tasks/m1-t4-snapshot-command/brief.md`
2. `.pi/pmti/milestones/M1.md`
3. `.pi/pmti/project/decisions.md`
4. `index.ts`
5. `helpers.ts`
6. `snapshot.ts`
7. `snapshot-runtime.ts`
8. `helpers.test.ts`

Stay in scope:

- Wire only `/pitaj snapshot` command behavior.
- Use `buildRuntimeSnapshotInput()` and `buildSnapshotContext()` to generate context for `consultModel()`.
- Preserve existing normal `/pitaj` and direct tool behavior.
- Do not change `PitajParams` or add `autoContext`/snapshot fields to the tool schema.
- Do not use `getBranch()` or `getEntries()`.
- Do not implement docs beyond minimal help text, advisor aliases, config UI, budgets, or full-branch capture.

Use TDD:

- Write failing tests before production edits.
- Verify RED with `npm test`.
- Implement minimal code to pass.
- Rerun `npm test` plus strip checks and Biome.

Recovery discipline:

- If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.
- After an edit warning, re-read before the next edit.
- After a syntax error, inspect the whole edited file before running more tests.

Stop conditions:

- Any need to add public tool-schema fields.
- Any need for full-branch/session serialization.
- Any uncertainty about passing runtime context to `consultModel()` without leaking unbounded data.
- Any reviewer Critical or Important finding after two fix-back rounds.
