# M3-B3 final reviewer report

## Verdict: Changes requested

M3-B3 is functionally close, and the code paths for inline warnings meet the requested behavior. One documentation accuracy issue should be fixed before M3 close-out because README examples do not match the actual `/pitaj usage` and result block formats.

## Critical findings

None.

## Important findings

1. **README usage/result examples are stale relative to actual output.**
   - `README.md:166-175` says `/pitaj usage` shows one-line fields such as `by route: ...`, `by context: ...`, `by model: ...`, and `warnings reached: low-risk threshold`.
   - Actual `/pitaj usage` output is rendered by `formatUsageSummaryText()` as sectioned output: `pitaj usage (current session)`, `routes:`, `models:`, `context source:`, `budget:`, and `warnings reached: low-risk` (`helpers.ts:955-1008`; tests assert this at `helpers.test.ts:1534-1551` and `helpers.test.ts:1576-1578`).
   - `README.md:214-216` also shows `route: auto-low`, but result block route metadata is built from mode/brevity/auto-routing reason rather than usage route-kind labels (`helpers.ts:598-610`). Warning lines are prefixed as `warning: ...` by the formatter (`helpers.ts:633-636`), while the README warning example omits that prefix (`README.md:194-198`, `README.md:219`).
   - This violates the review focus that README be accurate. Fix by aligning README examples with actual formatter output, or make the examples clearly illustrative and structurally consistent.

## Minor notes

- Test coverage for the new warning contract is adequate and not excessive: under-threshold, low-risk threshold, high-risk threshold, snapshot threshold, multi-warning, pluralization, and summary status cases are covered in `helpers.test.ts:85-180` and `helpers.test.ts:1598-1648`.

## Correct / verified

- Threshold policy matches requirements: low-risk and high-risk warn at 3, snapshot warns at 5 (`helpers.ts:695-699`), and successful non-snapshot events increment low/high counters while snapshot events increment the snapshot counter (`helpers.ts:744-764`). Snapshot warning wording includes bounded/context-heavy guidance (`helpers.ts:926-929`).
- Under-threshold results produce no inline warning when no warning flags are set (`helpers.ts:914-931`; tested at `helpers.test.ts:86-105` and `helpers.test.ts:1608-1612`).
- Result blocks remain answer-first: `formatResultForDisplay()` pushes the answer before the divider/footer (`helpers.ts:595-596`, `helpers.ts:648-654`), with metadata/warnings after the answer.
- Warnings are advisory only. I found no hard blocking at thresholds; warning text directs users to `/pitaj usage` or `/pitaj usage reset` (`helpers.ts:917-929`).
- Success paths record usage before formatting warnings:
  - direct tool: `recordUsageFromDetails()` before snapshot/warning build and `formatResultForDisplay()` (`index.ts:600-605`),
  - normal `/pitaj`: same ordering (`index.ts:738-744`),
  - `/pitaj snapshot`: same ordering with snapshot details/truncation (`index.ts:689-696`).
- Error paths preserve M3-B2 behavior: direct tool failures record usage, notify, then throw (`index.ts:608-612`); slash-command failures record and notify without inventing result blocks (`index.ts:749-753`, `index.ts:701-705`).
- `/pitaj usage` and `/pitaj usage reset` remain routed and intact (`helpers.ts:252-267`, `index.ts:652-660`).
- Direct tool schema does not add warning/budget fields; `PitajParams` remains model/question/mode/risk/context/brevity/max chars (`index.ts:493-537`).
- `/pitaj help` documents usage commands, reset, thresholds, and sidecar limitations without claiming sidecar file/tools access (`index.ts:132-158`).
- Guardrail audit of `helpers.ts`, `usage.ts`, `index.ts`, and `README.md` found no implementation of persistence, pricing/cost estimation, token-accurate accounting, task detection, hard budget blocking, sidecar tools, direct tool snapshot schema, or full-branch/session scraping. Matches were existing settings config behavior or explicit documentation of limitations.
- Verification rerun passed:
  - `npm test`: 108 tests, 18 suites, 108 pass, 0 fail.
  - Strip import check: `strip-ok` for `helpers.ts`, `usage.ts`, and `index.ts`.

## Close-out status

M3 should **not** proceed to final close-out until the README accuracy issue above is fixed. After that documentation-only fix, a targeted re-check of README plus the existing test/strip verification should be sufficient unless product code changes.
