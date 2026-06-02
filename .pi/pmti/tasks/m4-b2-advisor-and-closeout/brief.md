# M4-B2: `/pitaj advise` zero-flag shortcut + close-out

**Milestone:** M4 — Advisor-style shortcut polish
**Bundle:** Batch B (M4-T2 + M4-T4)
**Lane:** Oracle (T2: new advisor affordance, oracle Q2 resolved) · Fast (T4: docs)
**Depends on:** M4 oracle review **completed**, M4-B1 **completed and reviewed**
**Blocks:** M4 close-out
**Can run in parallel with:** nothing (M4-B1 must finish first — same files touched)

## Goal

Deliver a zero-option `/pitaj advise [question]` shortcut that wraps the M1 curated snapshot builder and clearly labels results as advisory, plus close-out documentation.

## Scope

### In (M4-T2)
- Extend `classifySpecialCommand()` in `helpers.ts` to return `"advise"` when normalized input is `"advise"` or starts with `"advise "`. Use the same `startsWith` guard pattern as `config` and `auto` (add BEFORE switch, not as switch case).
- Update the `SpecialCommand` type union to include `"advise"`.
- **Zero-flag rejection:** If the input after `"advise"` contains any of `--mode`, `-m`, `--brevity`, `-b`, `--context`, `-c`, or a provider/model first token (detected via `/` check or alias lookup), reject with a clear error message. The ONLY valid input forms are `/pitaj advise` (editor fallback) and `/pitaj advise <bare question text>`.
- Add dispatch branch in `index.ts`: after `usage` block, before `parseSnapshotCommandArgs`. Must come AFTER the `auto` dispatch so `advise` doesn't accidentally match as `auto`.
- Build context via the existing `buildSnapshotCommandRequest()` path (reuses `buildSnapshotContext()` + ring buffer).
- **STOP-ON-VIOLATION:** If `buildSnapshotContext` returns empty or sparse context text, do NOT add synthetic fallback content. Omit silently with provenance metadata (M1-a). Do not add new capture sources.
- Output: clearly labeled advisory (`"advisory snapshot"` in footer), same answer-first formatter, sidecar no-tools/no-file-access notice.
- Usage recording: MUST set `hasSnapshot: true` so advisory consults count toward the existing M3 snapshot threshold (5 warns).
- Error message for flag usage: `"pitaj advise accepts only a bare question — no --mode, --brevity, -c, or model arguments. Use /pitaj snapshot for full options."`
- Update `usageText()`: add `/pitaj advise [question]` entry with note about zero-flag constraint.
- Editor fallback: when `ctx.hasUI` is true and no question provided, open editor like other subcommands.

### Out
- No `PitajParams` changes.
- No new routing, context sources, or capture.
- No model/brevity/mode overrides allowed.
- No changes to `/pitaj snapshot` behavior.

### In (M4-T4)
- Update `usageText()` final state: add both `auto` and `advise` entries if not already done by M4-B1.
- Update README.md: add `auto` and `advise` to `/pitaj` subcommand documentation, note reserved alias names.
- Update `AGENTS.md` managed PMTI block: record M4 close-out.
- Verify all tests pass.
- Mark M4 complete in milestone + session log.

### Out (M4-T4)
- No implementation changes.
- No PMTI process changes.

## Acceptance criteria

### Batch-level
- [ ] All tests pass (`npm test` and all test files).
- [ ] M4 milestones close-out recorded.

### M4-T2: `/pitaj advise`
- [ ] `classifySpecialCommand("advise")` returns `"advise"`.
- [ ] `classifySpecialCommand("advise is this a good idea?")` returns `"advise"` (prefix guard).
- [ ] `/pitaj advise --mode plan test?` rejected with clear error.
- [ ] `/pitaj advise opus test?` rejected (model first token detected).
- [ ] `/pitaj advise -c context test?` rejected with clear error.
- [ ] `/pitaj advise is this safe?` routes through snapshot builder, answers, shows advisory label.
- [ ] Empty context consult still works (provenance metadata shows omissions).
- [ ] `hasSnapshot: true` in usage recording.
- [ ] Advisory footer shows "advisory snapshot" label.
- [ ] Tests: advisory path acceptance, flag rejection, empty/omitted category handling.

### M4-T4: Close-out
- [ ] `usageText()` has both `auto` and `advise` entries.
- [ ] README.md updated with new subcommands.
- [ ] AGENTS.md PMTI block updated with M4 completion.
- [ ] Session log created.
- [ ] All tests green.

## Constraints / invariants

- **Zero-flag lock (oracle Q2):** `/pitaj advise` accepts only a bare question. Any flag or model argument → error. No scope creep.
- **No new capture (oracle Q1):** Reuse `buildSnapshotContext()` + ring buffer only. No fallback content when context is sparse.
- **`hasSnapshot: true` (oracle Q3):** Usage recording must classify advisory as snapshot for threshold sharing.
- **Re-read before edit (oracle Q4):** Read `index.ts` and `helpers.ts` in full before any edit. T1 shifted line anchors.
- **classifySpecialCommand pattern:** Use `startsWith` guard BEFORE switch, same as `config` and `auto`.
- **`auto` and `advise` are reserved subcommand names** — already documented by M4-B1.
- **Workspace:** current-branch (project default). Do not change branches.

## Execution order

1. Read `index.ts` and `helpers.ts` in full (post-T1 state).
2. Implement M4-T2 (`/pitaj advise`) in `helpers.ts` + `index.ts`.
3. Write and run tests for M4-T2.
4. Run full test suite; fix any issues.
5. Commit and request review (Oracle lane requires reviewer).
6. After review approval → M4-T4 close-out (docs, session log).
7. Mark M4 complete.

## Next steps after completion

- Reviewer sign-off on T2.
- Close-out docs (T4).
- Git close-out via `finishing-development-branch`.
