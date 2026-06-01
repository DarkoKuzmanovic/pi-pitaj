# Handoff — M1-T3 runtime snapshot collection seam

## Workspace

- Workspace strategy: `current-branch`
- Expected branch/worktree: current CWD `/home/quzma/.pi/agent/extensions/pi-pitaj`; this CWD may not be a git repository, so verify project markers instead of creating a branch silently.
- Workspace owner: orchestrator/executor in current workspace
- Close-out owner: orchestrator/human via PMTI close-out; git branch finishing is separate if applicable.

Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files. In this project, if `git status` reports the CWD is not a git repository, verify `package.json`, `.pi/pmti/`, and the task packet path are present and continue only within this directory.

## Executor prompt

Implement PMTI task `M1-T3` from `.pi/pmti/tasks/m1-t3-runtime-snapshot-seam/`.

Read first:

1. `.pi/pmti/tasks/m1-t3-runtime-snapshot-seam/brief.md`
2. `.pi/pmti/milestones/M1.md`
3. `.pi/pmti/project/decisions.md`
4. `.pi/pmti/project/watch.md`
5. `snapshot.ts`
6. `index.ts`
7. `helpers.test.ts`
8. Pi extension docs relevant to event hooks and `ExtensionContext`

Stay in scope:

- Implement runtime collection seam and tests only.
- Do not wire `/pitaj snapshot <question>` to consultation yet.
- Do not change `PitajParams`, add `autoContext`, or alter normal `/pitaj` behavior.
- Do not call `ctx.sessionManager.getBranch()` or unbounded `getEntries()`.
- Use TDD: write failing tests first, verify RED, then implement minimal code and verify GREEN.

Recovery discipline:

```text
If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.

After an edit warning, re-read before the next edit.
After a syntax error, inspect the whole edited file before running more tests.
```

## Verification required

- `npm test`
- `node --experimental-strip-types --check index.ts && node --experimental-strip-types --check snapshot.ts && node --experimental-strip-types --check helpers.test.ts`
- `bunx --bun @biomejs/biome check .` as extension lint signal; record any pre-existing info-level findings separately from new errors.

## Stop conditions

Stop and report before editing if:

- Pi docs/source do not support safe `tool_execution_end` registration.
- Implementing recent-user capture would require broad/full branch session reads.
- The task appears to require command wiring or public tool schema changes.
- Tests require major test runner changes not described by the packet.
