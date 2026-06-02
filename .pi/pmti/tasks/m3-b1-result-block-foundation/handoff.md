# Handoff — M3-B1 result block foundation

## Workspace

Workspace strategy: current-branch
Expected cwd: `/home/quzma/.pi/agent/extensions/pi-pitaj`
Expected branch/worktree: use the current project workspace; do not create or switch branches/worktrees. If this directory is not a git repository, record that fact and proceed only if cwd matches exactly.
Workspace owner: executor
Close-out owner: orchestrator/human via PMTI close-out and, if applicable, finishing-development-branch

## Executor prompt

Implement PMTI task packet `.pi/pmti/tasks/m3-b1-result-block-foundation/`.

Read first:

1. `.pi/pmti/tasks/m3-b1-result-block-foundation/brief.md`
2. `.pi/pmti/tasks/m3-b1-result-block-foundation/handoff.md`
3. `.pi/pmti/milestones/M3.md`
4. `context-build/oracle-m3-review.md`
5. `helpers.ts`, `index.ts`, `helpers.test.ts`

Before editing, confirm the current working directory is `/home/quzma/.pi/agent/extensions/pi-pitaj`. If git metadata exists, report the current branch/worktree and stay on it. If git metadata does not exist, report `not a git repository` and proceed only if the cwd matches. If the workspace is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.

Task goal: improve the visible `pitaj` consultation result block for Batch A only. The answer must remain first. Compact metadata and the sidecar no-tools/no-file-access boundary notice should render after the answer. The same pure formatter must be used for direct `pitaj` tool results and slash-command `pi.sendMessage` results.

Required implementation shape:

- Move `formatResultForDisplay` or its successor into `helpers.ts` as an exported pure helper.
- Avoid importing `index.ts` from `helpers.ts`; use a structural formatter input type in `helpers.ts` if needed.
- Include an explicit post-answer extension point, such as `warnings?: string[]` with a safe empty default, so M3-T5 can add budget warnings without redesigning the helper.
- Update `index.ts` so direct registered tool execution returns the formatted result block, not raw `result.answer` only.
- Update `/pitaj` and `/pitaj snapshot` slash-command paths to use the same helper.
- Add unit tests in `helpers.test.ts` for low-risk auto route, high-risk/risk-check route, explicit model, no-context, manual-context, snapshot with categories, snapshot truncation, and warning extension default behavior.

Do not implement:

- usage tracking;
- budget thresholds;
- `/pitaj usage`;
- warning policy beyond the inert extension parameter;
- full-branch/session scraping;
- sidecar tools;
- settings/config writes;
- PMTI status close-out edits.

Verification required:

```bash
npm test
```

If import/export changes are non-trivial, also run:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
```

Report exact verification output. Do not mark M3 complete.

## Recovery discipline

If the same file or same test fails twice, stop incremental patching. Re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly.

After an edit warning, re-read before the next edit.

After a syntax error, inspect the whole edited file before running more tests.

If acceptance criteria, dependencies, or target files conflict, stop and report the ambiguity.
