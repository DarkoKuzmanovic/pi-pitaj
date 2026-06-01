# Handoff — M1-T1 snapshot contract

## Workspace

Workspace strategy: current-branch
Expected branch/worktree: n/a; work in `/home/quzma/.pi/agent/extensions/pi-pitaj` as the existing extension workspace. If this directory is not a git repo, do not create a branch; verify cwd, `package.json`, and `.pi/pmti/` instead.
Workspace owner: executor
Close-out owner: orchestrator/human via PMTI close-out / finishing-development-branch if a branch exists

Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.

## Executor prompt

Implement PMTI task `M1-T1 — Define snapshot contract and data model` for `pi-pitaj`.

Read first:

1. `.pi/pmti/tasks/m1-t1-snapshot-contract/brief.md`
2. `.pi/pmti/milestones/M1.md`
3. `context-build/oracle-m1-review.md`
4. `.pi/pmti/project/decisions.md`
5. `helpers.ts`
6. `helpers.test.ts`
7. `index.ts` only for command-flow context; do not wire snapshot behavior yet

Task scope:

- Lock the snapshot contract/data model for M1.
- Add the `snapshot` special-command dispatch case in `helpers.ts`.
- Add tests for `classifySpecialCommand("snapshot")` and for not classifying `"snapshot this"` as a special command.
- Add/export strongly typed snapshot contract definitions matching the brief, preferably in `snapshot.ts` if that keeps later builder work isolated.
- Keep `PitajParams` unchanged; do not add `autoContext` or any snapshot parameter to the `pitaj` tool schema.
- Do not implement the full builder, runtime collection, ring buffer, or `/pitaj snapshot <question>` consult wiring.
- Do not call or introduce `ctx.sessionManager.getBranch()`.

Locked decisions:

1. `active-plan` and `risks` are caller-provided/custom-entry-only and omitted by default.
2. `tool-results` will later use a pre-registered `pi.on("tool_execution_end", ...)` ring buffer.
3. The sidecar remains tool-less and sees only supplied context.
4. Full-branch capture belongs to M5, not M1.

Verification:

- Run `npm test`.
- If TypeScript syntax is changed in `index.ts`, `helpers.ts`, or a new `.ts` file, run `node --experimental-strip-types --check <changed-file>` for changed source files where practical.
- Report changed files, tests run, and whether any new durable decision was recorded.

Recovery discipline:

If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.

After an edit warning, re-read before the next edit.
After a syntax error, inspect the whole edited file before running more tests.

## Stop conditions

Stop and return to the orchestrator if:

- The workspace/cwd does not match the Workspace section.
- The task seems to require `PitajParams` changes or `/pitaj snapshot` runtime wiring.
- The task seems to require session branch scanning, `getBranch()`, or unbounded `getEntries()`.
- Existing tests fail in a way unrelated to M1-T1 and cannot be explained quickly.
