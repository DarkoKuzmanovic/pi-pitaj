# Worker handoff — M3-B3 warning integration and close-out

You are implementing **M3-B3 — Warning integration and close-out** for `pi-pitaj`.

## Required workspace

- CWD: `/home/quzma/.pi/agent/extensions/pi-pitaj`
- Workspace strategy: current branch/worktree only.
- Do **not** create, switch, or assume any branch/worktree.
- Before editing, confirm CWD and inspect scoped git status.
- Preserve existing dirty/untracked PMTI state. Treat M3-B1 and M3-B2 implementation as baseline, not work to recreate.

If the baseline appears missing, inconsistent, or syntactically broken, **pause and report** instead of reconstructing earlier batches.

## Read first

Read these files before editing:

1. `.pi/pmti/milestones/M3.md`
2. `.pi/pmti/project/execution-lanes.md`
3. `.pi/pmti/tasks/m3-b3-warning-integration-closeout/brief.md`
4. `.pi/pmti/tasks/m3-b1-result-block-foundation/reviewer-report.md`
5. `.pi/pmti/tasks/m3-b2-usage-state-and-command/reviewer-final-report.md`
6. `helpers.ts`
7. `usage.ts`
8. `index.ts`
9. `helpers.test.ts`
10. `README.md`

## Implement only Batch C

Implement only M3-T5 and M3-T6 from the brief:

- Inline advisory usage warnings in consultation result blocks.
- README and `/pitaj help` documentation for result blocks, usage, reset, warning semantics, and sidecar no-tools/no-file-access boundary.
- Tests and verification.

Do not implement new persistence, pricing/costs, hard budget blocking, token-accurate accounting, automatic task detection, full-branch/session scraping, sidecar tools, or direct tool schema changes.

Do not mark M3 complete. The orchestrator will request the final fresh-context reviewer and record final milestone close-out after review.

## Expected file allowlist

Expected editable files:

- `helpers.ts`
- `usage.ts`
- `index.ts`
- `helpers.test.ts`
- `README.md`
- `.pi/pmti/tasks/m3-b3-warning-integration-closeout/worker-report.md`

If another file is needed, pause and explain why.

## Acceptance details

- Keep answer-first formatting. The answer remains first; metadata and usage warnings stay after the answer.
- No warning under threshold.
- Third low-risk/GPT-style consult warns.
- Fourth+ low-risk/GPT-style consult still warns.
- Third high-risk/Opus-style consult warns.
- Fifth snapshot consult warns with context-heavy wording.
- Warning wording must be advisory guidance, not a failure or block.
- `/pitaj usage` and `/pitaj usage reset` still work.
- Normal consults, explicit aliases, `model: "auto"`, `/pitaj snapshot`, and `/pitaj config` remain backward compatible.

## Verification required

Run and report exact summary output:

```bash
npm test
```

Run strip import check:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './usage.ts'; import './index.ts'; console.log('strip-ok')"
```

Run a source guardrail audit and report the result. At minimum, verify product source does not introduce:

- full-branch capture,
- sidecar tools,
- provider credential persistence,
- hard budget blocking,
- pricing/cost estimation,
- persistent usage history.

## Report

Write `.pi/pmti/tasks/m3-b3-warning-integration-closeout/worker-report.md` with:

- status,
- changed files,
- acceptance checklist results,
- exact verification summaries,
- guardrail audit result,
- any open risks.

Stop after reporting. Do not request the final reviewer yourself and do not mark M3 complete.
