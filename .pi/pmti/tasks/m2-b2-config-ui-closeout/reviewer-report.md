# Reviewer report — M2-B2 config UI close-out

**Reviewer:** fresh-context read-only reviewer
**Date:** 2026-06-01
**Scope:** `/pitaj config` interactive UI, safe settings writes, docs/help, regressions. Read-only review.
**Verdict at a glance:** No Critical. One Important (validation gap on `defaultModel`, self-healing). Several Minor. **Not yet ready to close M2** until the Important finding is fixed or explicitly downgraded by the orchestrator; Minors are optional.

## Critical

None found.

## Important

- **Empty `defaultModel` input bypasses validation and persists `"defaultModel": ""`.** In `applyConfigUpdate`, the `defaultModel` case validates by calling `resolveModelRef(value, settings)` then writes the raw trimmed `value` (`helpers.ts:463-465`). When the UI input is submitted empty, `value === ""`. `resolveModelRef("")` does not throw: `requested = (input?.trim() || settings.defaultModel.trim()).trim()` falls back to the current `settings.defaultModel` (`helpers.ts:185`), which is always non-empty after `mergeSettings` (`helpers.ts:161`), so it resolves successfully. The function then returns `{ ...settings, defaultModel: "" }`, and `serializeSettings` writes `"defaultModel": ""` to disk (`helpers.ts:403`).
  - **Reachability:** `ctx.ui.input` returns `string | undefined` (`dist/core/extensions/types.d.ts:73`); `undefined` is cancel (handled at `index.ts:375`), but an empty *submission* returns `""`, which is not caught. The changed-fields summary then shows `defaultModel: <current> -> ` (empty), which the user may confirm.
  - **Impact / mitigation:** Self-healing — on next load, `mergeSettings` maps the empty string back to `DEFAULT_SETTINGS.defaultModel` (`helpers.ts:161`). So runtime routing is not broken, but an invalid value is persisted to a manually-editable file, contradicting the M2-T4 acceptance criterion "Validates model aliases/references before saving where possible" (`M2.md:145`) and the brief requirement that "model/default model values must resolve as alias or provider/model-shaped string where possible" (`brief.md:48`). The validation only "passes" because of the fallback, not because the input was a real model.
  - **Smallest safe fix:** In the `defaultModel` case of `applyConfigUpdate`, reject empty input before resolving, e.g. `if (!value) throw new Error("defaultModel must be a non-empty alias or provider/model.");` then `resolveModelRef(value, settings)`. Add a unit test asserting `applyConfigUpdate(settings, "defaultModel", "")` throws.

## Minor

- **`writeFileSync` is not wrapped in error handling.** `runConfigUi` calls `writeFileSync(SETTINGS_PATH, serializeSettings(updated), "utf8")` (`index.ts:409`) outside any try/catch, and the `config` branch of the command handler awaits `runConfigUi` without a surrounding try/catch (`index.ts:573-579`). A write failure (e.g. read-only FS, EACCES) would surface as an uncaught command error rather than the friendly `ctx.ui.notify(..., "error")` pattern used by the consult paths (`index.ts:666-667`). The `applyConfigUpdate` call is already guarded (`index.ts:381-386`); the serialize/write step is not. Smallest fix: wrap the write in try/catch and `notify` on failure.

- **Save re-materializes all default aliases into the user's file.** For a cleanly `loaded` file, `loaded.settings` comes from `mergeSettings(settingsFromUnknown(parsed))`, and `mergeSettings` always spreads `DEFAULT_SETTINGS.aliases` first (`helpers.ts:168-171`). `serializeSettings(updated)` therefore writes all 8 default aliases even if the user had intentionally removed some. No aliases are *dropped* (so the brief's stop-condition "serialization would drop valid manual aliases" is not triggered — `handoff.md:74`), and the written set matches effective runtime resolution. But it does modify the user's file beyond the single field they edited (a removed default alias reappears). Worth a doc note or, if undesired, serializing only explicitly-present aliases. I rank this Minor because effective behavior already treats defaults as present.

- **Brittle magic-string coupling for the no-op short-circuit.** `runConfigUi` compares the change summary against the literal `"No settings changes."` to decide whether to skip the write (`index.ts:388-392`), which must stay byte-identical to the string produced in `formatSettingsChangeSummary` (`helpers.ts:494`). A future edit to one literal silently breaks the short-circuit. Smallest fix: have `formatSettingsChangeSummary` (or a sibling helper) return a structured "changed/empty" signal, or export the sentinel constant.

- **Unsupported-subcommand hint can mislead in non-UI sessions, and handler-level config routing lacks a direct test.** The fallthrough message recommends "Use /pitaj config for the UI or /pitaj config show for summary" (`index.ts:580`) even when `ctx.hasUI` is false and the UI is unavailable. Separately, the `config`/`config show`/`hasUI`/unsupported-prefix branching logic lives inline in the command handler (`index.ts:573-583`) and is not unit-tested; only `classifySpecialCommand` classification is covered (`helpers.test.ts:849-877`). Source is simple, so this is Minor.

## Evidence checked

Requirements / source of truth:
- `brief.md` (in/out of scope, validation rules, three-state write safety `brief.md:53-57`, acceptance `brief.md:96-109`, stop conditions).
- `handoff.md` (workspace, hard constraints, stop-on-ambiguity).
- `M2.md` (tasks M2-T4/T5, acceptance, fast-lane Batch A/B gates, Batch A close-out).
- `decisions.md` M2-a (alias-name route targets, defaults gpt/opus), M2-b (absent numerics undefined), M2-c (two-batch fast lane).

Implementation:
- `helpers.ts` — `CONFIG_EDITABLE_FIELDS` (26-34), `applyConfigUpdate` (460-481), `parseOptionalPositiveInteger` (440-450, clear via blank/"default"/"clear"), `requireAlias` (452-458), `formatSettingsChangeSummary` (487-495), `serializeSettings` (401-413, omits undefined numerics/auto-route, sorts aliases), `planSettingsWrite` (415-438, refuse on malformed), `summarizeSettings`/`formatConfigSummaryText`, `mergeSettings` (159-173), `resolveModelRef` (184-208), `settingsFromUnknown` (145-157).
- `index.ts` — config command routing (573-583: UI gate `normalizedConfig === "config" && ctx.hasUI`, `config show` summary-only in all contexts, unsupported-subcommand prefix), `runConfigUi` (336-411: malformed early-return refuses overwrite `338-344`; Cancel/Show summary/Alias instructions branches; field prompt; invalid-value catch; no-op short-circuit; write-plan defense-in-depth `394-398`; confirm-then-write `400-410`), `promptConfigValue` (324-334), `configFieldOption`/`fieldFromConfigOption` round-trip (315-322), `loadSettings` three-state detection (102-117).
- `helpers.test.ts` — config contract, summary/validation helpers, interactive config update helpers (797-847: applyConfigUpdate alias preservation, auto-route alias requirement, enum/numeric/clear, change summary, source-level UI wiring), config classification (849-877). `npm test` re-run: all suites pass.

Scope guardrails (all confirmed clean):
- No secrets/API keys/credentials serialized — `serializeSettings` writes only the seven config fields + aliases (`helpers.ts:401-413`).
- No `autoContext`, no direct `pitaj` tool-schema config/snapshot fields — `PitajParams` unchanged (`index.ts:476-520`); test asserts no `autoContext` / `snapshot: Type` (`helpers.test.ts:635-636`).
- No `getBranch(` / `getEntries(` added — asserted across `index.ts`, `snapshot.ts`, `snapshot-runtime.ts` (`helpers.test.ts:639`).
- No full-branch capture / sidecar tools.

UI API signatures (verified against installed types, `dist/core/extensions/types.d.ts`):
- `select(title, options, opts?): Promise<string | undefined>` (69) — matches `ctx.ui.select` usage.
- `confirm(title, message, opts?): Promise<boolean>` (71) — matches; `false` on cancel handled (`index.ts:404`).
- `input(title, placeholder?, opts?): Promise<string | undefined>` (73) — matches; `undefined` cancel handled.
- `notify(message, type?)` (75), `setStatus` (79), `editor(title, prefill?)` (134) — all match existing usage.
- `runner.hasUI()` exists (`dist/core/extensions/runner.d.ts:100`).

Write-safety confirmation:
- Malformed → refuse: `runConfigUi` returns before any prompt (`index.ts:338-344`); non-UI handler shows warning summary, never writes (`index.ts:580-582`); `planSettingsWrite("malformed").canWrite === false` as defense-in-depth.
- Not-found → create only after validation + confirm; loaded → overwrite only after validation + confirm. No write reachable on cancel/invalid/no-op paths (all return before `writeFileSync`).

Docs:
- `README.md` documents `/pitaj config`, supported fields, UI/non-UI behavior, three write-safety rules, manual-edit compatibility, and no-secrets guidance (`README.md:106-125`, quick start `34`). `usageText()` lists `/pitaj config` with a concise description (`index.ts:136,144,156`).

## Final verdict

**Not ready to close M2 as-is.** No Critical findings and the implementation is functionally sound, well-scoped, and matches the brief/decisions. However, per the PMTI close-out rule that Critical/Important findings are fixed before milestone close, the one Important finding (empty `defaultModel` persists an invalid `""` despite the stated validate-before-save requirement) should be fixed — a one-line guard plus a test — or explicitly downgraded/accepted by the orchestrator given its self-healing nature. The Minor findings (unguarded write, default-alias re-materialization, magic-string coupling, misleading non-UI hint / untested handler branch) are optional polish and do not block close on their own.
