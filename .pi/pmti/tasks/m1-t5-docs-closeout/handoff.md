# Handoff — M1-T5 docs close-out

## Workspace

- Workspace strategy: current-branch
- Expected branch/worktree: current `/home/quzma/.pi/agent/extensions/pi-pitaj` workspace; this directory may not be a git repository
- Workspace owner: orchestrator/executor
- Close-out owner: orchestrator/human via PMTI close-out; git close-out is separate if needed

Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.

## Executor prompt

Implement PMTI task M1-T5 from `.pi/pmti/tasks/m1-t5-docs-closeout/`.

Read first:

- `.pi/pmti/tasks/m1-t5-docs-closeout/brief.md`
- `.pi/pmti/milestones/M1.md`
- `.pi/pmti/project/charter.md`
- `.pi/pmti/project/roadmap.md`
- `.pi/pmti/project/decisions.md`
- `.pi/pmti/project/watch.md`
- `README.md`
- `index.ts`
- `helpers.test.ts`
- `snapshot.ts`
- `snapshot-runtime.ts`

Stay in scope:

- Update README and `/pitaj help` for `/pitaj snapshot`.
- Keep snapshot described as bounded, tool-less sidecar context, not a full-branch/default transcript review.
- Do not add direct tool schema fields, `autoContext`, `/pitaj advise`, config UI, budgets, persistent history, or full-branch capture.
- Do not introduce `getBranch()` or `getEntries()` usage.

Verification:

- `npm test`
- `node --experimental-strip-types --check index.ts`
- `node --experimental-strip-types --check snapshot-runtime.ts`
- `node --experimental-strip-types --check snapshot.ts`
- `node --experimental-strip-types --check helpers.test.ts`
- `bunx --bun @biomejs/biome check .`
- Documentation/schema sanity check for no tool-enabled or full-branch-by-default snapshot wording.

Recovery discipline:

If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.

After an edit warning, re-read before the next edit.

After a syntax error, inspect the whole edited file before running more tests.

Stop conditions:

- Acceptance criteria conflict with current implementation.
- README would need to promise behavior not present in code.
- The implementation appears to require new runtime capture or tool schema behavior beyond M1-T5 docs/help.
- Verification or reviewer returns Critical/Important findings after two fix-back rounds.
