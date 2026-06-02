# Handoff — M3-B2 usage state and command

## Workspace

Workspace strategy: current-branch
Expected cwd: `/home/quzma/.pi/agent/extensions/pi-pitaj`
Expected branch/worktree: use the current project workspace; do not create or switch branches/worktrees. If this directory is not a git repository, record that fact and proceed only if cwd matches exactly.
Workspace owner: executor
Close-out owner: orchestrator/human via PMTI close-out and, if applicable, finishing-development-branch

## Executor prompt

Implement PMTI task packet `.pi/pmti/tasks/m3-b2-usage-state-and-command/`.

Read first:

1. `.pi/pmti/tasks/m3-b2-usage-state-and-command/brief.md`
2. `.pi/pmti/tasks/m3-b2-usage-state-and-command/handoff.md`
3. `.pi/pmti/milestones/M3.md`
4. `context-build/oracle-m3-review.md`
5. `.pi/pmti/tasks/m3-b1-result-block-foundation/reviewer-report.md`
6. `helpers.ts`, `index.ts`, `helpers.test.ts`

Before editing, confirm the current branch/worktree matches the Workspace section. If it is missing or mismatched, stop and report the mismatch instead of creating branches or editing product files.

Task goal: add the in-memory usage event model, advisory budget policy, `/pitaj usage`, and `/pitaj usage reset` for Batch B only. Do not wire warnings into result blocks yet.

Required implementation shape:

- Add a usage event model that stores metadata only; never store the consult prompt or context text.
- Include event fields for timestamp, requested model, resolved model/alias, route type, mode, brevity, risk where available, context source, approximate context chars, max output chars, success/error, and truncation flags where available.
- Add a session-scoped in-memory usage store owned once by the extension runtime. Prefer a closure-local store inside `pitaj()` unless a separate testable usage module is clearly cleaner.
- Record events for direct tool consult success/error, normal `/pitaj` consult success/error, and `/pitaj snapshot` success/error.
- Classify context source exactly in line with Batch A vocabulary: `none`, `manual`, `snapshot`.
- Classify route/model groups consistently with Batch A metadata: model/alias, auto-routed vs explicit, low-risk/GPT-style, high-risk/Opus-style.
- Implement advisory policy only: low-risk/GPT-style threshold 3, high-risk/Opus-style threshold 3, snapshot threshold >= 5. No blocking.
- Add `/pitaj usage` and `/pitaj usage reset` routing without breaking existing special commands.
- Keep Batch A formatter warning slot inert; Batch C will populate it.
- Keep direct tool `details.answer`; do not remove the Batch A stable raw-answer mitigation.

Do not implement:

- inline result-block warning integration;
- persistent history or file writes;
- pricing/cost estimation;
- hard budget blocking;
- automatic task detection;
- full-branch/session scraping;
- sidecar tools;
- new direct `pitaj` tool schema fields for budget controls;
- README/docs close-out beyond concise `/pitaj help` usage line if needed;
- PMTI status close-out edits.

Required tests:

- `classifySpecialCommand("usage")` and `classifySpecialCommand("usage reset")` route as usage.
- Regular questions containing usage-like words do not route accidentally.
- Event creation/classification for low-risk auto, high-risk auto/risk-check, explicit model, no-context, manual-context, snapshot, success, and handled error.
- Summary formatting includes total consults, route/model groups, context counts, warnings reached, budget status, and session/reset wording.
- Reset clears the store.
- Warning policy tests include under-threshold, at-threshold, over-threshold for low-risk and high-risk, plus snapshot threshold >= 5.
- Existing command and config tests remain green.

Verification required:

```bash
npm test
```

Also run:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
```

Report exact verification output. Do not mark M3 complete.

## Edit discipline (every file you touch)

- One logical edit per file, then re-read that file before the next edit to it. Never stack multiple anchored edits on the same file without re-reading — stale line anchors cause duplicate or orphaned code.
- For any structured/code file where you must change more than one location, or add/remove a function or block, prefer rewriting the whole file with `write` over stacking `replace_lines`/`set_line` edits.
- After an edit, re-read the changed region and confirm structure is intact: no duplicate declaration/function bodies, balanced braces/parens, and every block you opened has its matching closer.
- Respect the workspace's module system and file conventions (import style, strict-mode rules). Do not introduce a foreign style.

## Failure handling

- After an edit warning or anchor mismatch, re-read before the next edit.
- After a syntax/parse error, inspect the whole edited file before running more tests.
- If the same file or same test fails twice, stop incremental patching: re-read the affected file and the failing assertion, then make one deliberate fix or rewrite the small file cleanly. If that still fails, stop and report the file, the error, and the intended change instead of continuing with a corrupt file.

## Minimax improvement watch

This is the first worker task after `/reload` picked up the updated `minimax-m3.md`. Pay extra attention to literal acceptance criteria. If the packet says a label/value must be present, test exactly that label/value rather than testing an invented nearby interpretation.
