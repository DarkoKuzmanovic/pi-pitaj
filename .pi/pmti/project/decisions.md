# PMTI decisions

Future PMTI decisions should use milestone-scoped IDs such as `M1-a` and cite task IDs in the body when a task surfaces the decision.

## P0-a — Initialize PMTI for pi-pitaj

**Date:** 2026-05-30
**Status:** accepted

**Decision:** Create PMTI v1 project state under `.pi/pmti/` for `pi-pitaj`.

**Rationale:** The next work is no longer a one-line extension tweak. It spans tool schema, routing policy, prompt guidance, settings, tests, documentation, and later context capture. PMTI gives future agents a durable roadmap and milestone boundary before implementation.

**Consequences:** Future PMTI-managed planning should read `.pi/pmti/project/` and `.pi/pmti/milestones/` first. Existing `AGENTS.md` remains authoritative for contributor guidance, with the managed PMTI block pointing to project state.

## P0-b — Use current branch/workspace by default

**Date:** 2026-06-01
**Status:** accepted

**Decision:** Record `current-branch` as the default workspace strategy for `pi-pitaj` PMTI work.

**Rationale:** The user selected current-branch during the 2026-06-01 PMTI scaffold refresh. This mirrors the pi-todo lesson that workspace strategy must be explicit, while fitting this project better than per-milestone questioning for now.

**Consequences:** Future milestone and task packets should verify cwd and branch/worktree state before editing. They must not assume `main` is safe; they should use the already selected project workspace unless a milestone explicitly chooses a different strategy.

## P0-c — Preserve focused pitaj consults over whole-branch advisor defaults

**Date:** 2026-06-01
**Status:** accepted

**Decision:** Preserve `pitaj` as an explicit, bounded consultation tool. Do not adopt a default zero-parameter full-branch advisor model.

**Rationale:** This adapts the pi-todo decision pattern of preserving explicit public tools instead of adopting a convenient but less-auditable external API wholesale. Full-branch forwarding is useful for some review-everything moments, but it is noisy, costly, and can leak irrelevant context.

**Consequences:** Snapshot/advisor features must wrap the existing consult path, clearly state what context was provided, and keep full-branch capture disabled unless explicitly requested.

## P0-d — Implement curated snapshot before config and full-branch mode

**Date:** 2026-06-01
**Status:** accepted

**Decision:** Follow the implementation-plan order: first a curated snapshot builder and tested snapshot command/path, then `/pitaj config`, then optional full-branch parity.

**Rationale:** A snapshot builder is the foundation that makes advisor-style shortcuts safe. Config UI and full-branch affordances are easier to add later once the context boundary is proven.

**Consequences:** The next milestone candidate is M1 curated snapshot consult mode. `/pitaj config`, zero-parameter shortcuts, budgets, and full-branch mode remain later candidates unless M1 planning deliberately reshapes the roadmap.

## M0-a — Put first routing burden in the extension, not MiniMax

**Date:** 2026-05-30
**Status:** accepted for M0 planning

**Decision:** M0 should add extension-owned auto-routing inputs before adding heavier context capture or sidecar tools.

**Rationale:** MiniMax is fast and cheap but should not need to remember a large GPT-vs-Opus rubric on every call. A compact `model: "auto"` plus risk hints lets the extension make the default choice while preserving explicit aliases for callers that already know what they want.

**Consequences:** M0 focuses on schema, helpers, tests, promptGuidelines, and docs. Context modes and budgets remain later milestones unless M0 implementation reveals they are needed to make auto-routing coherent.

## M0-b — Use binary risk hint for auto-routing

**Date:** 2026-05-30
**Status:** accepted

**Decision:** M0 auto-routing will use `risk?: "low" | "high"` as the public routing hint. `model: "auto"` with `risk: "low"` routes to the `gpt` alias; `risk: "high"` routes to the `opus` alias. When risk is omitted, `mode: "risk-check"` routes to `opus`; all other omitted-risk modes/defaults route to `gpt`.

**Rationale:** Oracle recommended the binary risk hint as more MiniMax-friendly than a larger topic enum. It maps directly to the intended distinction between bounded technical checks and high-consequence judgment/architecture decisions.

**Consequences:** M0 task packets and implementation use this schema. Topic enums are deferred unless later usage shows the binary hint is too coarse.

## M0-c — Bundle the MiniMax alias in M0-T1

**Date:** 2026-05-30
**Status:** accepted

**Decision:** M0-T1 may bundle the convenience alias `"mm": "minimax/MiniMax-M2.7-highspeed"` in `settings.json` and `DEFAULT_SETTINGS.aliases`.

**Rationale:** Oracle identified this as a zero-risk quick win that addresses a known friction point without changing auto-routing semantics.

**Consequences:** The M0 implementation included the alias change explicitly so the executor did not treat it as scope creep. Convenience tools remain deferred to later milestones.

## M1-a — Omit active-plan and risks unless explicitly supplied

**Date:** 2026-06-01
**Status:** accepted

**Decision:** M1 snapshot mode will not infer `active-plan` or `risks` from broad session history. These categories are included only when caller-provided or available through extension-appended custom entries; otherwise they are omitted with provenance/omission metadata.

**Rationale:** Oracle identified no safe reactive Pi API path for deriving these categories without drifting into session-branch scraping. The user confirmed the omit-by-default approach.

**Consequences:** M1 task packets must preserve graceful omission for these categories. Any future auto-capture of plans/risks requires a separate scoped decision and likely another oracle review.

## M1-b — Capture tool results through a bounded reactive ring buffer

**Date:** 2026-06-01
**Status:** accepted

**Decision:** M1 tool-result snapshot context will use a pre-registered `pi.on("tool_execution_end", ...)` ring buffer owned by `pitaj()` entry-point setup, not command-time session scanning.

**Rationale:** A ring buffer is reactive and bounded, avoids broad transcript access, and fits the project invariant that snapshot context should not become full-session serialization. The user confirmed this mechanism.

**Consequences:** M1-T3 owns any required event hook registration in `index.ts` and must keep the buffer bounded. If the buffer is empty, the `tool-results` category is omitted gracefully.

## M2-a — Store auto-route targets as alias names

**Date:** 2026-06-01
**Status:** accepted

**Decision:** M2 settings fields for low/high auto-route targets will store alias names, not provider/model strings. Defaults remain `gpt` for low/default routing and `opus` for high/risk-check routing.

**Rationale:** Alias names preserve the existing indirection through `settings.aliases`, keep `settings.json` readable, and allow operators to repoint routes by updating a single alias target. Oracle recommended this and the user confirmed it.

**Consequences:** M2-T1/T2 should widen `AutoRouteResult.alias` to `string`, validate that configured route aliases resolve through `settings.aliases`, and document that removing a referenced alias makes auto-routing fail with a clear error.

## M2-b — Treat absent numeric settings fields as undefined

**Date:** 2026-06-01
**Status:** accepted

**Decision:** M2 settings parsing should distinguish absent numeric fields from invalid numeric fields. When `maxContextChars` or `maxOutputChars` is absent from JSON, `settingsFromUnknown()` or its M2 successor should leave the override undefined so precedence can fall through intentionally.

**Rationale:** This preserves the intended `request override > explicit settings value > brevity default` order for `maxOutputChars`. If absent fields are fallback-populated, `settings.maxOutputChars` silently overrides brevity-specific caps even when the operator did not explicitly configure a global cap. Oracle recommended the undefined-on-absent behavior and the user confirmed it.

**Consequences:** M2-T1/T2 must update tests around `settingsFromUnknown()`, `mergeSettings()`, and consult output-limit selection. Existing `settings.json` files with explicit numeric values, including the current project file, remain unaffected.

## M2-c — Use two fast-lane implementation batches for M2

**Date:** 2026-06-01
**Status:** accepted

**Decision:** Execute M2 with two bundled worker packets instead of five separate implementation/review loops. Batch A (`M2-B1-config-core`) covers M2-T1 through M2-T3. Batch B (`M2-B2-config-ui-closeout`) covers M2-T4 through M2-T5.

**Rationale:** The five logical tasks remain useful as acceptance criteria, but per-task packet/handoff/review ceremony is too slow for this milestone. The safety-critical boundary is before interactive persistent settings writes, so one review after Batch A and one final review after Batch B preserves the important gate while reducing overhead.

**Consequences:** Batch A must be verified and reviewed before Batch B starts. If Batch A changes or reopens the settings contract, pause for orchestrator/human decision before any interactive writer work. Worker handoffs should still preserve stop-on-ambiguity, workspace verification, and bounded fix-back rules.