# M3-B3 — Warning integration and close-out

**Milestone:** M3 — Consultation observability and budgets
**Batch:** C
**Covers:** M3-T5 and M3-T6
**Lane:** Review lane (final fresh-context reviewer required before M3 is marked complete)
**Status:** ready for implementation
**Workspace strategy:** current-branch in `/home/quzma/.pi/agent/extensions/pi-pitaj`

## Goal

Integrate M3-B2's in-session usage warning policy into the M3-B1 result presentation surface, then finish documentation and verification for M3. Result blocks should stay answer-first and concise under budget, but when usage thresholds are reached or exceeded they should show compact post-answer guidance.

## Preconditions

- M3 oracle is approved with required edits applied in `.pi/pmti/milestones/M3.md`.
- M3-B1 result block foundation is implemented and approved.
- M3-B2 usage state and `/pitaj usage` are implemented and finally approved in `.pi/pmti/tasks/m3-b2-usage-state-and-command/reviewer-final-report.md`.
- PMTI execution lanes are recorded in `.pi/pmti/project/execution-lanes.md`; this batch is Review lane.

## Scope in

1. **Inline warning integration**
   - Add a small pure helper or recorder method that converts current usage state into post-answer warning lines.
   - Wire warning lines into `formatResultForDisplay(..., { warnings })` or the existing Batch A extension point.
   - Apply warnings to direct `pitaj` tool results, normal `/pitaj` consults, and `/pitaj snapshot` results after successful consult recording.
   - Keep failed consults recorded for usage accounting, but do not invent result blocks for failures beyond existing error behavior.

2. **Warning semantics**
   - Show no inline warning while under thresholds.
   - Show compact guidance when low-risk/GPT-style consults reach or exceed 3 in the current session/reset window.
   - Show compact guidance when high-risk/Opus-style consults reach or exceed 3 in the current session/reset window.
   - Show compact guidance when snapshot consults reach or exceed 5 in the current session/reset window.
   - Phrase warnings as advisory guidance, not failures or hard blocks.
   - Distinguish low-risk/GPT-style, high-risk/Opus-style, and snapshot/context-heavy warnings.
   - Mention that `/pitaj usage` shows details and `/pitaj usage reset` resets current-session counters when useful.

3. **Documentation/help**
   - Update `README.md` for:
     - improved answer-first result block with metadata footer,
     - `/pitaj usage`,
     - `/pitaj usage reset`,
     - advisory warning thresholds,
     - sidecar no-tools/no-file-access boundary.
   - Update `/pitaj help` / `usageText()` so usage commands and warning semantics are discoverable.

4. **Verification and audits**
   - Add deterministic tests for no-warning, just-reached warning, exceeded warning, high-risk warning, low-risk warning, and snapshot warning output.
   - Ensure existing M3-B1 answer-first formatter tests and M3-B2 usage summary tests still pass.
   - Run `npm test`.
   - Run strip import check for changed TypeScript files, including `helpers.ts`, `usage.ts`, and `index.ts`.
   - Run a product-source guardrail audit confirming M3 did not add full-branch capture, sidecar tools, provider credential persistence, hard budget blocking, pricing/cost estimation, or persistent usage history.

## Scope out

- Do not add persistent usage history.
- Do not add pricing or cost estimation.
- Do not block consults at thresholds.
- Do not add token-accurate accounting.
- Do not add automatic task detection.
- Do not add full-branch/session scraping.
- Do not give sidecar models tools or claim they can inspect files unless caller-provided context/snapshot contains excerpts.
- Do not change direct tool schema fields.
- Do not mark M3 complete or write final milestone close-out before the required final reviewer verdict.

## Likely files

Allowed/expected source/docs files:

- `helpers.ts`
- `usage.ts`
- `index.ts`
- `helpers.test.ts`
- `README.md`
- `.pi/pmti/tasks/m3-b3-warning-integration-closeout/worker-report.md`

Do not edit unrelated project files. If another file appears necessary, stop and report why.

## Implementation notes

- Preserve the answer-first contract: the answer must remain the first line/body of the displayed result. Metadata and warnings belong after the answer, not before it.
- Prefer pure helpers in `helpers.ts` or focused recorder helpers in `usage.ts` to keep tests deterministic.
- B2's `createUsageStore.record()` already updates warning flags at threshold. For inline warnings, the result path should record the consult first, then render warnings from the updated current-session state.
- Warnings should be compact. Avoid dumping full usage summaries into every result block.
- Use the same vocabulary already used in result metadata and `/pitaj usage`: `model:`, `route:`, `context: none/manual/snapshot`, low-risk/GPT-style, high-risk/Opus-style, snapshot.
- Direct tool errors should continue to throw after recording usage; do not reintroduce `isError` returns.

## Acceptance checklist

- [ ] Under-threshold consult result has no usage warning.
- [ ] Third low-risk/GPT-style consult includes advisory low-risk/GPT-style warning.
- [ ] Fourth+ low-risk/GPT-style consult still includes advisory warning.
- [ ] Third high-risk/Opus-style consult includes advisory high-risk/Opus-style warning.
- [ ] Fifth snapshot consult includes advisory snapshot/context-heavy warning.
- [ ] `/pitaj usage` and `/pitaj usage reset` still work.
- [ ] Existing explicit `pitaj`, `model: "auto"`, `/pitaj <alias> ...`, `/pitaj snapshot ...`, and `/pitaj config ...` behavior remains backward compatible.
- [ ] README and `/pitaj help` document result blocks, usage commands, reset behavior, warning semantics, and sidecar no-tools boundary.
- [ ] `npm test` passes.
- [ ] Strip import check passes.
- [ ] Guardrail audit finds no full-branch capture, sidecar tools, provider credential persistence, hard budget blocking, pricing/cost estimation, or persistent usage history.
- [ ] Worker report records changed files, exact verification summary, audit result, and any open risks.

## Review gate

After implementation and orchestrator verification, request a fresh-context reviewer. Fix Critical and Important findings before marking M3 complete or recording final close-out.
