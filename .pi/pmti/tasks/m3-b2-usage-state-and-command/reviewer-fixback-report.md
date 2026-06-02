I did not write `reviewer-fixback-report.md` because the task also says READ-ONLY / do not edit or modify files.

## Review

**Verdict: Changes requested**

- **Correct:** The five previous fix-back items are addressed:
  - Direct tool catch now records usage and rethrows instead of returning `isError` (`index.ts:603-610`); no `isError` remains in `index.ts`.
  - Usage classification now treats default auto as low-risk, risk-check/high as high-risk, and infers explicit GPT/Opus-style models (`helpers.ts:813-831`).
  - `UsageSummary.byModel` and `models:` output are present (`helpers.ts:717-723`, `helpers.ts:949-955`).
  - Snapshot success now passes `truncated: snapshotRequest.snapshot.truncated` into usage recording (`index.ts:687-689`), and recorder stores it (`usage.ts:65-80`).
  - Stored `UsageEvent` has no `errorMessage` field (`helpers.ts:678-693`), and `usage.ts` does not store raw error text.
- **Correct:** Batch C warning wiring remains untouched: `formatResultForDisplay` calls in `index.ts:600`, `index.ts:692`, and `index.ts:742` do not pass warning options.
- **Correct:** Verification passed locally: `npm test`; strip import check returned `strip-ok`.

### Important findings

- **Snapshot consult errors are recorded with the wrong context source.** The snapshot success path attaches `snapshotRequest.snapshot` before recording (`index.ts:687-689`), but the snapshot error path records `buildErrorDetails(snapshotRequest.request, loaded)` without snapshot details (`index.ts:699-702`). `recordUsageFromDetails()` derives `hasSnapshot` only from `details.snapshot !== undefined` (`index.ts:572`), so a failed `/pitaj snapshot` consult with generated snapshot context will be counted as `manual` context instead of `snapshot`. This breaks the M3-B2 usage acceptance for accurate snapshot/manual/no-context counts on handled errors.

### Minor notes

- The error-message sanitization test does not exercise the production call shape: `recordFromRequest()` accepts a single input object (`usage.ts:15-28`), but the test passes `outcome` as a second ignored argument (`helpers.test.ts:1145-1160`). Implementation is still safe because `UsageEvent`/`usage.ts` do not store `errorMessage`; this is only a coverage weakness.