# Worker report — M3-B1 result block foundation

**Task packet:** `.pi/pmti/tasks/m3-b1-result-block-foundation/`
**Status:** implemented; tests green; ready for review
**Workspace:** current-branch (on `main`); cwd `/home/quzma/.pi/agent/extensions/pi-pitaj`
**Date:** 2026-06-01

## Workspace verification

- `pwd` = `/home/quzma/.pi/agent/extensions/pi-pitaj` (matches expected cwd).
- `git status` reports `On branch main` and `Your branch is up to date with 'origin/main'.`
- Pre-existing `AGENTS.md` modification was left untouched (unrelated, in-scope untouched).
- Pre-existing untracked `.pi/pmti/milestones/M3.md` and `.pi/pmti/tasks/m3-b1-result-block-foundation/` were the expected PMTI inputs.
- No branches or worktrees were created or switched.

## Implementation summary

1. **`helpers.ts`**
   - Added structural input type `PitajResultDisplaySnapshot` and `PitajResultDisplayDetails` plus `FormatResultOptions` (no `index.ts` import; helpers.ts remains Pi-runtime-free).
   - Added exported pure helper `formatResultForDisplay(answer, details, options?)`.
   - Helper always renders the answer as the first body line and pushes compact metadata after a `---` separator so the answer remains visually prominent.
   - Helper renders route/model/mode metadata, optional `autoRouted` + `routingReason`, context source (`none` / `manual, N chars` / snapshot with `+`/`~`/`-` category markers), and an explicit sidecar no-tools/no-file-access line scoped to the context source.
   - Helper accepts an optional `warnings?: readonly string[]` slot, defaulting to empty. Warnings render as compact `warning: ...` lines after metadata. This is the inert post-answer extension point for M3-T5 budget warnings.

2. **`index.ts`**
   - Imported `formatResultForDisplay` from `./helpers.ts`.
   - Removed the previously private `formatResultForDisplay(answer, details)` (3-line string-join function) so the pure helper is the single source of truth.
   - Direct registered tool execution now returns `content: [{ type: "text", text: formatResultForDisplay(result.answer, result.details) }]` instead of the raw `result.answer`. This is the change that improves the visible `pitaj` tool response block.
   - Slash-command `/pitaj` and `/pitaj snapshot` paths already routed through the formatter; they now use the shared helper from `helpers.ts` automatically.

3. **`helpers.test.ts`**
   - Imported `formatResultForDisplay` from `./helpers.ts`.
   - Added a new `describe("pitaj M3 result block foundation", ...)` block with 13 deterministic tests covering:
     - low-risk auto route with answer first and metadata after;
     - high-risk/risk-check auto route reason;
     - explicit model call without auto-routed metadata bloat;
     - no-context call with sidecar boundary notice;
     - manual context call with char count and sidecar boundary;
     - snapshot call with included and omitted categories;
     - snapshot call with truncated categories and overall truncation flag;
     - warning extension slot rendered when warnings are supplied;
     - warning extension slot omitted when warnings array is empty (safe default);
     - warning extension slot omitted when no options object is passed (safe default);
     - missing alias rendered gracefully;
     - missing model rendered gracefully;
     - empty answer replaced with `(pitaj returned no text)` placeholder.

## Verification

```bash
npm test
```

Result:

```text
ℹ tests 84
ℹ suites 16
ℹ pass 84
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 392.365567
```

All 70 pre-existing tests pass. All 13 new formatting tests pass.

Strip import check (run because import structure was modified non-trivially):

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
```

Result:

```text
strip-ok
```

## Files touched

- `helpers.ts` — added structural types and pure `formatResultForDisplay` helper.
- `index.ts` — imported the helper, removed the private copy, routed direct tool execution through the helper.
- `helpers.test.ts` — added `formatResultForDisplay` to imports and 13 new deterministic tests.

## Out of scope (not implemented)

- No usage tracking / in-memory store.
- No budget thresholds or warning policy.
- No `/pitaj usage` command.
- No full-branch capture, session scraping, or `getBranch( / getEntries(` additions.
- No sidecar tools.
- No settings/config writes.
- No PMTI status close-out edits to `.pi/pmti/milestones/M3.md` or the project session log.
- No README/help text changes (Batch C scope).

## Open risks / reviewer-needed items

- The formatter intentionally groups route/mode/brevity on one `route:` line. If a reviewer prefers route broken into multiple lines (one per attribute), it is a small follow-up and would not require reopening the structural type.
- The `warnings` extension slot is wired but inert. M3-T5 is expected to populate it from the budget policy; no shape changes are anticipated.
- The `pitaj` direct tool execution change means the answer text shown to the orchestrator/parent agent is now the full formatted block, not just the raw answer. This is the intended user-visible change and is consistent with the brief and the milestone acceptance criteria. Reviewers may want to confirm the parent agent does not need the raw answer for any reason — current orchestrator code in `index.ts` only uses `result.answer` for the formatter, and `result.details` for telemetry.

## PMTI close-out note

M3 status is not changed by this report. The orchestrator should mark M3-T1 implementation complete in `.pi/pmti/milestones/M3.md` and request a fresh-context reviewer for Batch A. Reviewer verdict and final test result should be recorded in `.pi/pmti/project/session-log/`.
