# Handoff — M1-T2 snapshot builder

## Workspace

- Workspace strategy: `current-branch`
- Expected branch/worktree: current CWD `/home/quzma/.pi/agent/extensions/pi-pitaj`; this CWD may not be a git repository, so verify project markers instead of creating a branch silently.
- Workspace owner: orchestrator/executor in current workspace
- Close-out owner: orchestrator/human via PMTI close-out; git branch finishing is separate if applicable.

Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files. In this project, if `git status` reports the CWD is not a git repository, verify `package.json`, `.pi/pmti/`, and the task packet path are present and continue only within this directory.

## Executor prompt

Implement PMTI task `M1-T2` from `.pi/pmti/tasks/m1-t2-snapshot-builder/`.

Read first:

1. `.pi/pmti/tasks/m1-t2-snapshot-builder/brief.md`
2. `.pi/pmti/milestones/M1.md`
3. `.pi/pmti/project/decisions.md`
4. `.pi/pmti/project/charter.md`
5. `.pi/pmti/project/watch.md`
6. `snapshot.ts`
7. `helpers.test.ts`
8. `package.json`

Stay in scope:

- Implement only the pure snapshot builder and tests.
- Do not add runtime Pi session collection, ring-buffer hooks, command wiring, docs, config UI, or tool-schema changes.
- Do not introduce full-branch/session serialization.
- Use TDD: write failing tests first, verify RED, then implement minimal code and verify GREEN.

Recovery discipline:

```text
If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.

After an edit warning, re-read before the next edit.
After a syntax error, inspect the whole edited file before running more tests.
```

## Verification required

- `npm test`
- `node --experimental-strip-types --check snapshot.ts && node --experimental-strip-types --check helpers.test.ts`
- `bunx --bun @biomejs/biome check .` as extension lint signal; record any pre-existing info-level findings separately from new errors.

## Stop conditions

Stop and report before editing if:

- The task packet or M1 milestone conflicts with current source.
- Implementing the builder appears to require Pi runtime imports or session manager access.
- Acceptance seems to require changing `PitajParams`, adding `autoContext`, or wiring `/pitaj snapshot`.
- Tests require changing the test runner in a way not covered by the packet.
