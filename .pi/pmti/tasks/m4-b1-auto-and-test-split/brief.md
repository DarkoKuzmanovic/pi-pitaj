# M4-B1: `/pitaj auto` subcommand + test file split

**Milestone:** M4 — Advisor-style shortcut polish
**Bundle:** Batch A (M4-T1 + M4-T3)
**Lane:** Review (T1: command routing) · Fast (T3: test split)
**Depends on:** M4 oracle review **completed** (2026-06-02)
**Blocks:** M4-B2 (T2: `/pitaj advise` — same `index.ts`/`helpers.ts` files)
**Can run in parallel with:** nothing (sole Batch A; Batch B follows)

## Goal

Deliver a working `/pitaj auto [--risk low|high] [existing flags] <question>` slash-command and a clean test layout with no new routing logic.

## Scope

### In (M4-T1)
- Extend `classifySpecialCommand()` in `helpers.ts` to return `"auto"` when the normalized input is `"auto"` or starts with `"auto "`. Use the `startsWith` guard pattern from `config` (add BEFORE the switch, not as a switch case).
- Update the `SpecialCommand` type union to include `"auto"`.
- Add the dispatch branch in `index.ts`'s `/pitaj` command handler: after `usage` block, before `parseSnapshotCommandArgs`. Parse the rest of the input with `parseCommandArgs()` to extract `--risk low|high`, `-m`, `-b`, `-c`, and the question.
- Route through `resolveAutoRoute()` → `consultModel()` — no new routing logic.
- Surface model/alias/routing-reason metadata (same as `model: "auto"` tool call — autoRouted, routingReason, autoSuggestedMode).
- Invalid `--risk` must fail with a clear error message (not silently fall through to question text).
- Update `usageText()`: add `/pitaj auto [--risk low|high] [existing flags] <question>` entry and list `auto`/`advise` as reserved subcommand names.
- Output: answer-first via `formatResultForDisplay()`, `pi.sendMessage()` with `customType: "pitaj"`, status bar update.
- Usage recording: `recordUsageFromDetails()` with auto-routed classification.

### Out
- No `PitajParams` changes.
- No new routing logic beyond wiring the existing `resolveAutoRoute()`.
- No advisor/snapshot integration (that's M4-T2).
- No docs/README outside `usageText()`.

### In (M4-T3)
- Extract auto-routing test cases from `helpers.test.ts` into new `auto-routing.test.ts`.
- Extract settings test cases into `settings.test.ts`.
- Extract parsing test cases into `parsing.test.ts`.
- Remove extracted test code from `helpers.test.ts`.
- Each new test file runs with the same `node --experimental-strip-types --test <file>` command.
- All existing tests must pass in their new files. No tests removed or changed — pure file split.

### Out (M4-T3)
- No new test cases.
- No test runner/config changes.
- No test assertion changes.

## Acceptance criteria

### Batch-level
- [ ] All existing tests pass (`npm test` and new test files).
- [ ] New tests for `/pitaj auto` pass.
- [ ] Verification: `npm test` green, manual smoke: `/pitaj auto --risk high is this safe?` and `/pitaj auto --risk bogus` (should error).

### M4-T1: `/pitaj auto`
- [ ] `classifySpecialCommand("auto")` returns `"auto"`.
- [ ] `classifySpecialCommand("auto --risk high test?")` returns `"auto"` (prefix guard, not just exact match).
- [ ] `/pitaj auto --risk high <question>` routes through auto-router, surfaces model/routing reason.
- [ ] `/pitaj auto --risk low <question>` routes through auto-router.
- [ ] `/pitaj auto --risk bogus` fails with clear error.
- [ ] `/pitaj auto <question>` (no flags) routes via default auto-router behavior.
- [ ] `usageText()` includes `auto` entry with `[--risk low|high]` syntax and reserved-names note.
- [ ] Existing subcommands (`snapshot`, `config`, `usage`, `check`, `aliases`, `help`) remain unchanged.

### M4-T3: Test split
- [ ] `auto-routing.test.ts` contains only auto-routing tests and passes.
- [ ] `settings.test.ts` contains only settings tests and passes.
- [ ] `parsing.test.ts` contains only parsing tests and passes.
- [ ] `helpers.test.ts` contains remaining tests (snapshot, usage, formatting) and passes.
- [ ] No test code duplicated across files.
- [ ] Run: `node --experimental-strip-types --test helpers.test.ts auto-routing.test.ts settings.test.ts parsing.test.ts` passes.

## Constraints / invariants

- **`classifySpecialCommand` pattern:** Use `startsWith` guard BEFORE switch, same as `config`. Do NOT add a bare switch case — the switch only matches exact strings (oracle Q5a). See plan: add `if (normalized === "auto" || normalized.startsWith("auto ")) return "auto";` before the switch at ~line 254 of `helpers.ts`.
- **No new routing:** `resolveAutoRoute()` and `consultModel()` are reused as-is.
- **No PitajParams changes.**
- **`auto` and `advise` are reserved subcommand names** — documented in `usageText()`.
- **Test split is pure code motion** — no test logic changes, no runner config changes.
- **Workspace:** current-branch (project default). Do not change branches.

## Execution order

1. Implement M4-T1 (`/pitaj auto` subcommand) in `helpers.ts` + `index.ts`.
2. Run full test suite; fix any issues.
3. Implement M4-T3 (test split) — extract test files.
4. Run all test files; verify no regressions.
5. Commit and request review (Review lane — T1 changes command routing).

## Next steps after completion

- Report diff and test output.
- Request reviewer (`pi-pitaj.opus-medium-reviewer`).
- After reviewer approval → M4-B2 (T2 + T4) can begin.
