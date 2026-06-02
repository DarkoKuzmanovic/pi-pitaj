# M3-B2 reviewer fix-back

**Status:** Fix-back approved by final targeted reviewer.

## Reviewer findings addressed

- Critical: direct tool handled errors returned `isError: true`, which is not part of Pi's core tool result contract. Fixed by recording the usage error event and rethrowing the original error for the direct tool path.
- Important: budget classification treated default auto calls as high-risk and did not classify explicit GPT/Opus-style calls. Fixed `classifyUsageEvent()` so default auto is low-risk, `risk-check`/high hints remain high-risk, and explicit GPT/Opus aliases/models classify into low/high buckets.
- Important: `/pitaj usage` lacked model/alias group counts. Added `UsageSummary.byModel` and a `models:` section to `formatUsageSummaryText()`.
- Minor: snapshot truncation metadata was not recorded. Snapshot success recording now passes `truncated: snapshotRequest.snapshot.truncated`.
- Minor: raw provider error messages could be stored in usage events. Removed `errorMessage` from stored `UsageEvent` and from `usage.ts` storage.
- Second-pass Important: failed `/pitaj snapshot` consults were counted as manual context. Fixed by attaching the generated snapshot summary to synthesized error details and passing snapshot truncation metadata on failure.

## Tests added/updated

- Default auto route classification as low-risk.
- Explicit GPT-style and Opus-style classification without risk hints.
- Usage recorder output does not retain provider error text.
- Summary includes model/alias counts.
- Failed snapshot consults count as `context: snapshot`.
- Error-message sanitization test now uses the production single-object `recordFromRequest()` call shape.

## Verification

- `npm test` passed after second fix-back: 98 tests, 17 suites, 98 pass, 0 fail.
- Strip import check passed with `strip-ok`:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './usage.ts'; import './index.ts'; console.log('strip-ok')"
```

## Final targeted reviewer

- Verdict: Approved.
- Artifact: `.pi/pmti/tasks/m3-b2-usage-state-and-command/reviewer-final-report.md`.
- Blockers: none.