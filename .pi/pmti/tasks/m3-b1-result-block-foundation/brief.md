# M3-B1 — Result block foundation

**Milestone:** M3 — Consultation observability and budgets
**Covers:** M3-T1 only
**Status:** ready for implementation
**Oracle:** `context-build/oracle-m3-review.md`, approved with required edits applied to `.pi/pmti/milestones/M3.md`

## Goal

Improve the visible `pitaj` consultation result block so the answer remains first while compact metadata after the answer explains route/model/mode, context source, snapshot metadata, and the sidecar no-tools boundary.

## Scope in

- Move `formatResultForDisplay` or its successor out of `index.ts` into `helpers.ts` as a pure exported helper.
- Use the helper for both direct `pitaj` tool results and `/pitaj` slash-command `pi.sendMessage` results.
- Keep the displayed answer prominent and first.
- Render metadata compactly after the answer.
- Include route/model/mode metadata when available.
- Include auto-route reason when available.
- Include context source metadata: no context, manual context, or snapshot.
- Include snapshot included/omitted/truncated categories when `details.snapshot` is present.
- Include sidecar no-tools/no-file-access notice when context or snapshot wording could imply inspection.
- Design the helper with an explicit post-answer extension point, such as optional warnings with a safe empty default, so M3-T5 can add budget warnings without redesigning the helper.
- Add deterministic unit tests.

## Scope out

- No usage tracking or in-memory store.
- No budget thresholds or warning policy.
- No `/pitaj usage` command.
- No full-branch capture or new session scraping.
- No sidecar tools.
- No settings writes or config changes.
- No milestone close-out or durable PMTI completion edits.

## Acceptance criteria

- Existing explicit `pitaj`, `model: "auto"`, `/pitaj <alias> ...`, `/pitaj snapshot ...`, and `/pitaj config ...` behavior remains backward compatible except for richer result text.
- Direct tool calls return the improved formatted consultation text, not only the raw answer.
- Slash-command messages use the same formatter.
- Helper is exported from `helpers.ts` and testable without registering the extension.
- Helper handles partial/missing metadata gracefully.
- Metadata is after the answer, not before it.
- Formatting tests cover:
  - low-risk auto route;
  - high-risk or risk-check auto route;
  - explicit model with no auto-route;
  - no-context call;
  - manual-context call;
  - snapshot call with included/omitted categories;
  - snapshot call with truncated categories;
  - optional warning/post-answer extension slot with safe default.
- `npm test` passes.

## Likely files

- `helpers.ts` — exported formatting helper and related pure types if needed.
- `index.ts` — remove/private wrapper replacement; use helper for tool and slash results.
- `helpers.test.ts` — formatting coverage.

## Current code notes

- `index.ts` currently has private `formatResultForDisplay(answer, details)` around lines 418–421.
- Direct registered tool execution currently returns `content: [{ type: "text", text: result.answer }]`; Batch A should route this through the improved formatter so the tool response block improves.
- Slash commands already call `formatResultForDisplay(...)` before `pi.sendMessage`.
- `PitajResultDetails` is currently private to `index.ts`. The worker may define a pure formatter input type in `helpers.ts` that mirrors only the fields needed for rendering, then pass existing details structurally.
- `PitajSnapshotDetails` is exported from `index.ts`; avoid creating circular imports from `helpers.ts` to `index.ts`. Prefer a structural helper input type in `helpers.ts` with plain string category arrays.

## Verification

Run from `/home/quzma/.pi/agent/extensions/pi-pitaj`:

```bash
npm test
```

If TypeScript import shape changes are non-trivial, also run a strip import check:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning --input-type=module -e "import './helpers.ts'; import './index.ts'; console.log('strip-ok')"
```

## Durable PMTI notes

Do not mark M3 or Batch A complete. Report implementation summary, tests, and any reviewer-needed risks to the orchestrator. The orchestrator owns PMTI status updates and review routing.
