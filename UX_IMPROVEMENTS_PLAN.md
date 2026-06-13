# pi-pitaj UX Improvements Plan

Source: 2026-06-14 session. Deeper round after the original `IMPLEMENTATION_PLAN.md`
(rpiv-advisor comparison) — most of that doc's ideas (snapshot mode, config UI,
auto-routing, usage tracking) are now shipped. This doc is the **next** round of
UX work, grounded in a full read of `index.ts` + `helpers.ts` and pressure-tested
by two `gpt` critique consults (`/pitaj snapshot gpt --mode critique`).

Status: **PLAN ONLY — not started.** Revisit later.

---

## Architecture facts that shape every item

- `helpers.ts` is pure/unit-testable (no Pi imports); `index.ts` is the Pi shell.
  Almost every feature splits: logic → `helpers.ts`, wiring → `index.ts`.
- Command dispatch: `classifySpecialCommand()` (helpers.ts ~273) → big `if`-chain
  in the `/pitaj` handler (index.ts ~649–924). New subcommand = one case + one branch.
- **Mode-aware routing already half-exists**: `resolveAutoRoute()` (helpers.ts ~231)
  already maps `mode==="risk-check" → high alias`, and `consultModel` only
  auto-routes when `model==="auto"`. So "explicit model always wins, routing only
  under auto" is already the architecture — we're extending a table.
- **Snapshot preview is nearly free**: `buildSnapshotCommandRequest()` (index.ts ~474)
  already returns the assembled context + included/truncated/omitted metadata.
  Preview = build it, render it, skip the `consultModel` call.
- **Collision risk is structural**: `classifySpecialCommand` runs *before* alias
  resolution, so a new subcommand name silently shadows a same-named alias. Today
  `auto`/`advise` are "reserved" by docs only — no validation in `normalizeAliases`.

---

## Phase 0 — Shared groundwork (do first; everything depends on it)

| Change | File | Detail |
|---|---|---|
| `RESERVED_SUBCOMMANDS` constant | `helpers.ts` | Single source of truth: existing specials + new ones (`critique`,`debug`,`plan`,`risk`,`answer`,`examples`,`last`,`again`,`followup`,`alias`). |
| Reserved-name validation | `helpers.ts` | `isReservedAliasName(name)`; wire into `alias add` (Phase 4) + a load-time warning (like `validateAutoRouteAliases`) if settings.json defines a colliding alias. |
| Last-consult store | `index.ts` | In the `pitaj()` closure (next to `usageRecorder`): `let lastConsult: { request; details; answer } | undefined`. Session-local, in-memory, never persisted. Set on every successful consult (tool + all command paths). Powers `last`/`again`/`followup`. |

## Phase 1 — Cheap, uncontested wins

| Feature | Files | Approach |
|---|---|---|
| `/pitaj examples` | `helpers.ts` (`examplesText()`), `index.ts` | Curated subset of `usageText()` examples — skimmable, copy-pasteable. |
| `/pitaj last` | `index.ts` | Reprint `lastConsult` via `formatResultForDisplay`; "no previous consult in this session" if empty. No model call. Successful-only. |
| Quieter metadata | `helpers.ts` (`formatResultForDisplay` + `FormatResultOptions.metadataVerbosity`), settings + config UI | `compact`(default)/`full`. Compact keeps trust signals (model, route/reason, context, warnings), drops verbose `sidecar:` line. Add `metadataVerbosity` to `PitajSettings`, `CONFIG_EDITABLE_FIELDS`, `summarizeSettings`, `serializeSettings`, `applyConfigUpdate`. |

## Phase 2 — Modes-as-subcommands (sugar only)

- `helpers.ts`: extend `SpecialCommand` + `classifySpecialCommand` for
  `critique|debug|plan|risk|answer` (`risk`→`risk-check`). Add `modeFromSubcommand()`.
- `index.ts`: one branch rewriting `/pitaj critique <rest>` → `parseCommandArgs(rest)`
  with `mode` forced, funneling into the **existing** plain-consult path. Thin sugar,
  never a divergent code path.
- **Precedence (gpt requirement):** explicit `--mode` in rest-args wins over the
  subcommand, surfaced in metadata (`route: mode=answer (via /pitaj critique)`) —
  never silent. Depends on Phase 0 reserved names.

## Phase 3 — Mode-aware routing, scoped to `auto`

- `helpers.ts` only: extend `resolveAutoRoute()` mode table beyond `risk-check`.
  e.g. `plan`/`risk-check` → high; `answer`/`critique` → low.
- **gpt caveat:** `debug→low` is questionable (subtle debugging wants the stronger
  model). Leave `debug` unmapped (falls through to low) and document, OR make it
  configurable. Do NOT hard-code `debug→low` silently.
- Explicit model already wins (no `index.ts` change). `routingReason` already renders.
- Lowest-risk feature — pure-function table edit, covered by `auto-routing.test.ts`.

## Phase 4 — Stateful follow-ups + guided aliases (highest effort)

**`/pitaj again [model]` + `/pitaj followup <text>`** (`index.ts`, uses Phase 0 store):
- `again` = exact replay of `lastConsult.request` w/ optional model override; footer
  notes "replaying previous request".
- `followup <text>` = new request; `context` = prior Q + prior answer (bounded via
  `truncateText`/`maxContextChars`), question = `<text>`. Footer is honest that the
  stateless sidecar is being *resent* prior turn, not "remembering".
- Guard: "no previous consult" when store empty.

**Guided `/pitaj alias add|list|remove|show`** (`helpers.ts` pure mutations + `index.ts` UI):
- `helpers.ts`: `applyAliasAdd/Remove(settings, name, target)` — reject reserved names,
  validate `provider/model` via `parseProviderModel`, block built-in overwrite w/o force.
- `index.ts`: `alias` branch reusing existing `planSettingsWrite` → `ctx.ui.confirm`
  → `serializeSettings` write flow from `runConfigUi`.
- ⚠️ **OPEN DESIGN QUESTION (decide before coding):** `serializeSettings` writes the
  *merged* alias set (`mergeSettings` folds in `DEFAULT_SETTINGS.aliases`), so any
  write bakes defaults into settings.json, and `alias remove` of a *default* alias
  gets re-merged on next load. Options: (a) block removing defaults, or (b) add a
  "removed defaults" tombstone field. Needs a call.

## Phase 5 — Snapshot preview (the trust feature)

- `helpers.ts`: `formatSnapshotPreview(snapshot)` — summarized by default (sources,
  included/truncated/omitted, `contextChars`, token estimate); full assembled context
  only on `--full` (gpt: don't dump every byte by default).
- `index.ts`: `--preview` flag in the snapshot branch → call
  `buildSnapshotCommandRequest`, render preview, **return without consulting**. Also
  `auto --dry-run` → run `resolveAutoRoute`+`resolveModelRef`, print decision, no consult.
- Label preview "assembled context (excludes system-prompt scaffolding)" so it isn't
  mistaken for the exact wire payload.

## Dropped (per the two gpt consults)

- `/pitaj panel` (multi-model compare) — cost/latency/complexity; `again` covers most value.
- Bare `/pitaj more` — redefined as `followup <text>` (sidecar is stateless).
- Universal TL;DR header — misleads in `critique`/`debug`/`risk-check` where nuance matters.

---

## Sequencing & risk

```
Phase 0 ──► Phase 1 (independent, ship anytime)
        └─► Phase 2 ──► Phase 3 (routing table)
        └─► Phase 4 (store + aliases)
        └─► Phase 5 (preview)
```

Phases 1, 3, 5 each independently shippable once Phase 0 lands. Phase 0 + Phase 2
are the must-do-together pair (reserved names make subcommands safe).

**Risk (low→high):** Phase 3 (pure table) < Phase 1 < Phase 5 < Phase 2 (precedence
+ collision) < Phase 4 (state + alias/defaults persistence wrinkle).

**Suggested first PR:** Phase 0 + Phase 1 (groundwork + three cheap wins, fully tested).

---

## Open questions to resolve before coding

1. **Phase 4 alias/defaults persistence** (above) — the one genuine design hole.
2. **Tests**: 6 `.test.ts` files mirror the modules (`parsing`, `auto-routing`,
   `settings`, `consult-behavior`, `helpers`). Project does TDD — every pure-function
   change lands with tests in the matching file; effort roughly doubles counting tests.
3. **`snapshot.ts`/`snapshot-runtime.ts` internals not yet read** — Phase 5 assumes
   `buildSnapshotCommandRequest` output is sufficient for a preview (and confirm the
   token-estimate source) before committing.
4. Phase 2 precedence semantics are a design choice needing sign-off.

---

## Provenance

- Full source read: `index.ts` (927 lines), `helpers.ts` (1120 lines).
- Critiques: two `gpt` (openai-codex/gpt-5.5) consults in `--mode critique`.
  Key catches captured above: namespace collision, snapshot-preview trust trap,
  `/pitaj again` statefulness, panel/more cuts, `debug→low` routing caution,
  keep trust signals visible when quieting metadata.
