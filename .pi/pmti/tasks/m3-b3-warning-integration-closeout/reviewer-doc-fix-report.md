## Review

**Verdict: Changes requested**

- **Correct:** The main stale-format issues are fixed:
  - `/pitaj usage` now uses the sectioned format matching `formatUsageSummaryText()` (`README.md:169-195`, `helpers.ts:955-1008`).
  - Result block is answer-first with divider and metadata (`README.md:230-237`, `helpers.ts:595-654`).
  - Warning example now includes the formatter’s `warning: ...` prefix (`README.md:217`, `helpers.ts:633-637`).

- **Note: Remaining documentation accuracy issues:**
  1. `README.md:174-193` shows an internally inconsistent usage summary. Routes total 4 consults, with `auto (low-risk): 2`, `explicit (high-risk): 1`, and `snapshot: 1`, but budget shows `low-risk/GPT-style: 3`, `high-risk/Opus-style: 1`, `snapshot: 1`. In code, snapshot consults increment only `snapshot` and return before low/high budget counting (`helpers.ts:746-763`), so this example cannot be produced as written.
  2. `README.md:235` shows `reason=low-risk/default route`, but actual auto routing reasons are built as `auto: <routeLabel> → <alias>` (`helpers.ts:243-245`) and rendered verbatim by `formatResultForDisplay()` (`helpers.ts:600-610`). Example should use something like `reason=auto: default → gpt` or `reason=auto: risk=low → gpt`.

- **Verification:** `npm test` passed, and strip import check returned `strip-ok`.

**M3 close-out:** Not yet. The prior broad stale-format issue is mostly fixed, but README still has two concrete accuracy mismatches that should be corrected before close-out.

I did not write `/home/quzma/.pi/agent/extensions/pi-pitaj/.pi/pmti/tasks/m3-b3-warning-integration-closeout/reviewer-doc-fix-report.md` because the task also explicitly said read-only / do not edit files.