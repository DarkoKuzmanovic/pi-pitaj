# Reviewer fix-back report — M2-B2 config UI close-out

**Reviewer:** fresh-context read-only reviewer (fix-back pass)
**Model/thinking:** anthropic/claude-opus-4-8, medium
**Date:** 2026-06-01
**Scope:** Re-review of the M2-B2 close-out after fix-back for the prior Important finding and one Minor. Read-only.
**Verdict at a glance:** No Critical. No Important. Prior Important finding fixed and tested. Remaining prior Minors are acceptable / non-blocking. **Ready to close M2.**

## Critical

None found.

## Important

None found.

### Prior Important — verified FIXED

- **Empty `defaultModel` no longer bypasses validation.** `applyConfigUpdate` now rejects empty input in the `defaultModel` case before `resolveModelRef`:
  - `helpers.ts:464` — `if (!value) throw new Error("defaultModel must be a non-empty alias or provider/model.");`
  - `value` is `rawValue.trim()` (`helpers.ts:461`), so whitespace-only submissions also become `""` and are rejected. This closes the fallback-resolution gap (empty input previously resolved via `settings.defaultModel` in `resolveModelRef`, `helpers.ts:185`).
  - The guard runs before `resolveModelRef(value, settings)` (`helpers.ts:465`), so the write path can no longer persist `"defaultModel": ""`.
  - Test added and passing: `helpers.test.ts:803` — `assert.throws(() => applyConfigUpdate(settings, "defaultModel", ""), /non-empty alias or provider\/model/)`. The regex matches the new error message exactly.
  - Reachability now safe: the UI submits the raw string to `applyConfigUpdate` inside a try/catch (`index.ts:381-386`); an empty submission throws, is caught, and surfaces `pitaj config invalid value: ...` via `notify(..., "warning")` with an early return — no write, no confirm.

## Minor

### Prior Minor — verified FIXED

- **`writeFileSync` now guarded.** The serialize/write step is wrapped in try/catch with a friendly error notify and early return (`index.ts:409-414`): `notify("pitaj config save failed: ${errorMessage(error)}", "error")`. This matches the friendly-notify pattern used elsewhere and prevents an uncaught command error on EACCES/read-only FS. Source-level tests assert the guarded shape: `helpers.test.ts:844-846` (`try { writeFileSync(...)` and `pitaj config save failed`).

### Prior Minors — still present, acceptable / non-blocking

- **Default aliases re-materialize on save.** `mergeSettings` always spreads `DEFAULT_SETTINGS.aliases` (`helpers.ts:168-171`) and `serializeSettings` writes the merged set (`helpers.ts:411`). A user who manually deleted a default alias would see it reappear after any config save. No valid alias is *dropped* (the brief's stop-condition is not triggered), and the written set equals effective runtime resolution. Non-blocking; worth a future doc note only.
- **Magic-string coupling for the no-op short-circuit.** `index.ts:389` compares against the literal `"No settings changes."`, which must stay byte-identical to `formatSettingsChangeSummary` (`helpers.ts:495`). A future edit to one literal silently breaks the short-circuit. Cosmetic robustness issue; non-blocking.
- **Non-UI hint wording / untested inline routing.** The unsupported-subcommand prefix at `index.ts:585` still recommends "Use /pitaj config for the UI" even when `ctx.hasUI` is false, and the inline `config`/`config show`/`hasUI` branching (`index.ts:578-588`) is exercised only indirectly via `classifySpecialCommand` tests (`helpers.test.ts:849-877`). Source is simple and degrades gracefully (non-UI path only ever shows a summary, never writes). Non-blocking.

No new findings introduced by the fix-back changes.

## Evidence checked

- **Prior report:** `.pi/pmti/tasks/m2-b2-config-ui-closeout/reviewer-report.md` — one Important + four Minor.
- **Brief:** `.pi/pmti/tasks/m2-b2-config-ui-closeout/brief.md` — validation rules (`:46-50`), three-state write safety (`:53-57`), acceptance (`:96-109`), stop conditions (`:123-132`).
- **`helpers.ts`:** `applyConfigUpdate` (`:460-482`), defaultModel guard (`:464`), `resolveModelRef` fallback (`:184-208`), `mergeSettings` (`:159-173`), `serializeSettings` (`:401-413`), `planSettingsWrite` (`:415-438`), `formatSettingsChangeSummary` (`:488-496`).
- **`index.ts`:** `runConfigUi` flow — cancel (`:375-378`), apply-in-try/catch (`:380-386`), no-op short-circuit (`:388-392`), write-plan gate (`:394-398`), confirm (`:400-407`), guarded write (`:409-414`); config command routing (`:578-588`).
- **`helpers.test.ts`:** empty-defaultModel throws (`:803`), auto-route alias requirement (`:818`), enum/numeric/clear (`:823-827`), change summary (`:830-836`), source-level UI/write wiring incl. guarded write + save-failed message (`:838-846`).
- **Verification re-run:** `npm test` → 70 tests, 70 pass, 0 fail (15 suites).
- **Scope guardrails:** `grep` for `autoContext|getBranch(|getEntries(` over product source returned no matches in `helpers.ts`/`index.ts`/`snapshot.ts`/`snapshot-runtime.ts` (only a `node_modules` example extension matched). Confirms M2 out-of-scope items (M5 full-branch capture, sidecars) were not introduced.

## Final verdict

**Ready to close M2.** The prior Important finding is fixed at the correct layer (validation boundary in `applyConfigUpdate`) with a precise test, and the prior unguarded-write Minor is also resolved with matching source-level tests. `npm test` is green (70/70). The three remaining prior Minors are cosmetic/robustness items that do not block close-out and may be deferred or noted for a future polish pass.
