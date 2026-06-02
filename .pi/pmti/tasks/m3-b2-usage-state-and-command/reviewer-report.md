I did not write `/home/quzma/.pi/agent/extensions/pi-pitaj/.pi/pmti/tasks/m3-b2-usage-state-and-command/reviewer-report.md` because the task also says READ-ONLY / do not modify any file.

## Review

**Verdict: Changes requested**

### Correct
- `npm test` passed, and the strip import check passed with `strip-ok`.
- No inline result-block usage warnings are wired into `formatResultForDisplay` calls; `index.ts:600`, `index.ts:695`, and `index.ts:745` call it without warning options.
- Usage store ownership is session-scoped/in-memory: `createUsageRecorder()` is created once inside `pitaj()` at `index.ts:557`.
- `/pitaj usage` and `/pitaj usage reset` are routed before normal consult handling at `index.ts:653-661`.
- Prompt/context text is not copied into normal usage events; `recordUsageFromDetails()` passes metadata only at `index.ts:563-577`, and `UsageEvent` has no prompt/context fields at `helpers.ts:678-694`.

### Critical findings
- **Direct tool handled errors are not actually marked as tool errors by the core runtime.** The catch path returns `{ content, isError: true }` at `index.ts:603-613`, but Pi’s core `AgentToolResult` contract requires throwing on failure and does not include `isError`; the core execute path treats any returned result as `isError: false`. Evidence: `pi-agent-core/dist/types.d.ts:305-309` defines result fields, `types.d.ts:327-328` says “Throw on failure…”, and `agent-loop.js:419-429` sets returned tool results to `isError: false`. This is a direct-tool contract regression.

### Important findings
- **Budget classification does not match the low-risk/GPT-style and high-risk/Opus-style policy.**
  - Auto default routing selects the low/GPT route when no risk/mode is supplied (`helpers.ts:233-235`), but `classifyUsageEvent()` counts auto calls with no risk hint as high-risk (`helpers.ts:802-812`).
  - Explicit/default GPT or Opus calls from slash usage do not carry `risk` (`index.ts:731-737`), so they classify as `explicit-other`/`unknown` (`helpers.ts:814-820`) and do not increment low/high counters (`helpers.ts:754-760`). This means normal `/pitaj` default Opus usage may never trigger the high-risk/Opus-style threshold.
- **`/pitaj usage` does not display model/alias group counts.** Events store `resolvedModel` and `resolvedAlias` (`helpers.ts:680-682`), but `UsageSummary` and `formatUsageSummaryText()` only summarize route kind, context, risk/errors, and budget (`helpers.ts:718-727`, `helpers.ts:923-950`). The packet asks for route/model group counts.

### Minor findings
- **Truncation metadata is not populated where it is available.** Snapshot details include `truncated` (`index.ts:477-484`), but successful snapshot recording passes only `{ success: true }` (`index.ts:690-692`), so `UsageEvent.truncated` falls back to `false` (`usage.ts:82`).
- **Potential leakage risk via raw error messages.** Usage events avoid prompt/context fields, but `recordFromRequest()` stores arbitrary `errorMessage` text in the event (`usage.ts:80-82`). If an upstream provider error ever echoes request text, the in-memory usage event would retain it.