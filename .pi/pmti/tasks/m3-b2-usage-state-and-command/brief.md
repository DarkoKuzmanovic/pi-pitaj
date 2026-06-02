# M3-B2 — Usage state and command

**Milestone:** M3 — Consultation observability and budgets
**Covers:** M3-T2, M3-T3, M3-T4
**Status:** ready for implementation
**Depends on:** M3-B1 result block foundation implemented and tests passing
**Review gate after completion:** fresh-context reviewer required before Batch C

## Goal

Add a lightweight, in-memory, current-session usage accounting slice for `pitaj`, including consult events, advisory budget policy, `/pitaj usage`, and `/pitaj usage reset`. This batch does not surface warnings inside result blocks yet; Batch C wires warnings into the formatter.

## Scope in

- Define a small structured usage event for each consult.
- Add an in-memory session-scoped usage store owned by the extension runtime and initialized once per `pitaj()` setup, not per command call.
- Record successful consults and handled consult errors for direct tool, `/pitaj`, and `/pitaj snapshot` paths.
- Classify events into categories aligned with Batch A formatter vocabulary: model/alias, auto route vs explicit route, context source `none` / `manual` / `snapshot`, low-risk/GPT-style, high-risk/Opus-style, snapshot, manual context.
- Define advisory thresholds:
  - GPT-style/low-risk consults: warn after 3 in the current session/reset window.
  - Opus-style/high-risk consults: warn after 3 in the current session/reset window.
  - Snapshot consults: warn after >= 5 snapshot calls in the current session/reset window.
- Add pure/tested summary and warning-policy helpers.
- Add `/pitaj usage` special command showing compact current-session totals, group counts, context-source counts, warning status, and reset guidance.
- Add `/pitaj usage reset`, explicitly resetting all in-memory counters and confirming with `pitaj usage counters reset` or equivalent.

## Scope out

- No inline warning integration into result blocks; that is M3-B3/M3-T5.
- No persistent usage history or disk writes.
- No pricing/cost estimation or token-accurate accounting.
- No hard budget blocking.
- No automatic task detection.
- No full-branch/session scraping.
- No sidecar tools.
- No new direct `pitaj` tool schema fields for budgets.
- No README/help docs beyond the command help text needed for `/pitaj usage`; final docs are Batch C.
- No PMTI close-out edits.

## Acceptance criteria

- `classifySpecialCommand()` recognizes `usage` and `usage reset` without treating either as a consult question.
- `/pitaj usage` displays: total consults, route/model group counts, snapshot/manual/no-context counts, warnings reached, and current budget status.
- `/pitaj usage reset` clears only the in-memory usage store and confirms; summary text notes counters also reset when the Pi session ends.
- Consult successes and handled errors are recorded without storing prompt/context content.
- Event model includes timestamp, requested model, resolved model/alias, route type, mode, brevity, risk where available, context source, approximate context chars, max output chars, success/error, and truncation flags where available.
- Usage categories align with Batch A formatter vocabulary (`model:`, `route:`, `context: none/manual/snapshot`) instead of inventing parallel labels.
- Pure helper tests cover event creation/classification, summaries, reset behavior, under-threshold, at-threshold, over-threshold, and snapshot threshold `>= 5` cases.
- Existing `/pitaj help`, `/pitaj aliases`, `/pitaj models`, `/pitaj check`, `/pitaj snapshot`, `/pitaj config`, direct tool execution, and normal consult behavior remain backward compatible.
- `npm test` passes.

## Likely files

- `helpers.ts` — pure usage event, summary, command classification, and warning-policy helpers unless a focused `usage.ts` is cleaner.
- `index.ts` — own the in-memory store once per extension setup; record events in direct tool, normal slash, snapshot slash, and error paths; route `/pitaj usage` and `/pitaj usage reset`.
- `helpers.test.ts` — unit tests for helper behavior and command classification.

## Coordination notes from oracle/reviewer

- Batch B must align usage category definitions with the Batch A metadata model; avoid using one vocabulary in result blocks and another in `/pitaj usage`.
- The in-memory store pattern is new in this codebase. Keep it small and explicit. A closure-local store inside `pitaj()` is preferred unless a separate module-level singleton is cleaner and testable.
- Direct tool result details now include the answer text in `details.answer` for stable machine consumption; do not remove it.
- Batch A formatter exposes a warnings extension point but Batch B must not populate it yet.

## Verification

Run from `/home/quzma/.pi/agent/extensions/pi-pitaj`:

```bash
npm test
```

Because this batch changes command routing and helper exports, also run:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
```

## Durable PMTI notes

Do not mark M3 or Batch B complete. Report implementation summary, exact verification output, and any reviewer-needed risks. The orchestrator owns review routing and PMTI close-out updates.
