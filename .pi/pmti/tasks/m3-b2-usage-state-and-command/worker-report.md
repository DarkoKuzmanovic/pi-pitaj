# M3-B2 — Usage state and command

**Run:** `a51e87e3-48db-41ad-9e87-aeaa5dad8f50`
**Status:** implementation complete; ready for fresh-context reviewer before Batch C.

## Scope implemented

In scope only (M3-T2, M3-T3, M3-T4):

- `helpers.ts`
  - `classifySpecialCommand` now recognizes `usage` and `usage reset` (returns `"usage"`).
  - `SpecialCommand` union now includes `"usage"`.
  - New types: `UsageContextSource`, `UsageRouteKind`, `UsageRisk`, `UsageEvent`, `UsageBudgetState`, `UsageStoreSnapshot`, `UsageSummary`, `UsageBudgetGroup`.
  - New constants: `USAGE_BUDGET = { lowRisk: 3, highRisk: 3, snapshot: 5 }`.
  - New pure helpers: `createUsageStore`, `classifyUsageEvent`, `detectContextSource`, `buildUsageSummary`, `applyUsageWarningFlags`, `describeRouteKind`, `formatUsageSummaryText`.
  - `createUsageStore.record` applies warning flags immediately so summaries and `/pitaj usage` see the warned state.
- `usage.ts` (new file): focused `createUsageRecorder` that wraps `createUsageStore` with a `recordFromRequest` adapter.
- `index.ts`
  - Imports `createUsageRecorder`.
  - `pitaj()` owns a single `usageRecorder` and a `recordUsageFromDetails(params, details, outcome)` helper.
  - Recording added in three consult paths: direct tool execute, normal `/pitaj`, and `/pitaj snapshot`.
  - Error path is now wrapped in try/catch in all three paths; handled errors are recorded with `success: false`.
  - New special command routing: `usage` (renders summary) and `usage reset` (clears counters, confirms with `pitaj usage counters reset`).
  - `usageText()` documents `/pitaj usage` and `/pitaj usage reset`.
  - Added `buildErrorDetails(params, loaded)` for handled-error recording shape.
- `helpers.test.ts`
  - Added `pitaj M3-B2 usage accounting` describe block with tests for:
    - `classifySpecialCommand("usage")`, `classifySpecialCommand("usage reset")`, and non-usage negatives.
    - Non-regression of existing special commands.
    - Context source detection (`none` / `manual` / `snapshot`).
    - Route classification for low-risk auto, high-risk auto, auto risk-check, explicit high with manual context, snapshot, and handled errors.
    - Recording stores metadata only (no prompt/question/caller-provided string in JSON).
    - Budget threshold tests: low-risk/GPT-style at 3, high-risk/Opus-style at 3, snapshot at `>= 5`.
    - Errors do not count toward budget.
    - Reset clears events and warning flags.
    - Summary includes total, route/model groups, snapshot/manual/no-context counts, warnings reached, and budget status.
    - `formatUsageSummaryText` matches expected literal labels and includes reset-guidance wording.
    - Summary status flips to `warning` when threshold is reached.
    - `describeRouteKind` covers every route kind.
    - `applyUsageWarningFlags` pure-helper threshold transitions.

## Scope explicitly not implemented

Per the packet:

- No inline result-block warning integration (Batch C / M3-T5).
- No persistent usage history or disk writes.
- No pricing/cost estimation or token-accurate accounting.
- No hard budget blocking.
- No automatic task detection.
- No full-branch/session scraping.
- No sidecar tools.
- No new direct `pitaj` tool schema fields.
- No README close-out (only `usageText()` update for the new commands).
- No PMTI close-out edits; this worker does not mark M3 complete.

## Coordination notes honored

- Usage categories align with Batch A metadata vocabulary: `model:`, `route:`, `context: none/manual/snapshot`.
- In-memory store is owned once per extension setup inside `pitaj()`.
- `details.answer` from Batch A is preserved (not removed).
- Batch A formatter warning slot remains inert (Batch C will populate it).

## Verification

`npm test` — exact summary:

```text
ℹ tests 94
ℹ suites 17
ℹ pass 94
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 447.886799
```

Strip import check:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './usage.ts'; import './index.ts'; console.log('strip-ok')"
```

Output: `strip-ok`

## Changed files

- `helpers.ts` (modified)
- `helpers.test.ts` (modified)
- `index.ts` (modified)
- `usage.ts` (new)

## Open risks / reviewer-needed items

- The handler for `/pitaj usage` and `/pitaj usage reset` uses `ctx.ui.notify` to render the summary text. The TUI may wrap or truncate long output, but a fresh-context reviewer should verify the summary reads cleanly in the actual UI.
- `classifyUsageEvent` treats `mode: "risk-check"` as a high-risk signal even without an explicit `risk`. This is consistent with the auto-router behavior. Reviewer should confirm this matches project intent.
- Error path recording uses a synthesized `buildErrorDetails` because the consult was never completed. Reviewer should confirm that synthesized shape is acceptable and that `details.answer` is harmless when empty.
- The direct tool error path now returns `isError: true` instead of the previous unhandled-throw behavior. Reviewer should confirm this is the intended contract change.

## Recommended next step

Run a fresh-context reviewer on this diff before preparing the M3-B3 packet. Then prepare M3-B3 for M3-T5 (inline warning integration into result blocks) and M3-T6 (README + final close-out).
