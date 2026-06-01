# PMTI changes log

## 2026-06-01 — M2 `/pitaj config` settings UI completed

- Added `/pitaj config` and `/pitaj config show` settings summaries plus an interactive UI flow for common settings when Pi UI is available.
- Added safe settings helpers for optional numeric fields, configurable `autoRouteLow`/`autoRouteHigh` alias targets, manual-editable serialization, three-state write planning, and confirmed writes.
- Fixed `maxOutputChars` precedence to use request override, then explicit settings value, then brevity default.
- Preserved malformed `settings.json` recovery by refusing UI overwrites, and preserved existing `pitaj`, `model: "auto"`, `/pitaj snapshot`, aliases/models/check behavior, with no direct tool schema config fields.
- Documented `/pitaj config` in README and `/pitaj help`; verified with `npm test`, strip import checks, Biome, product-source guardrail audit, and Opus reviewer fix-back close-out.
## 2026-06-01 — M1 curated snapshot consult mode completed

- Added a tested pure snapshot contract and builder in `snapshot.ts` with provenance, omitted-category, and truncation metadata.
- Added bounded runtime snapshot collection in `snapshot-runtime.ts`, including recent user-message traversal through `getLeafEntry()`/`getEntry()` and a guarded `tool_execution_end` ring buffer.
- Wired `/pitaj snapshot ...` through the existing slash-command consult path without adding direct `pitaj` tool schema fields or full-branch capture.
- Documented `/pitaj snapshot` in README and `/pitaj help`, including sidecar no-tools and bounded-context limitations.
- Verified with `npm test`, TypeScript strip checks, Biome, and fresh read-only reviewer close-out.
## 2026-06-01 — Project scaffold refreshed from implementation plan

- Refreshed project-level charter, roadmap, decisions, watch list, and polish backlog from `IMPLEMENTATION_PLAN.md`.
- Preserved completed M0 auto-routing history and moved the next candidate focus to curated snapshot consult mode.
- Recorded `current-branch` as the default workspace strategy.
- Distilled pi-todo PMTI lessons: preserve explicit public tools, avoid wholesale external API adoption, and record workspace strategy explicitly.

## 2026-05-30 — PMTI initialized

- Created PMTI project state for `pi-pitaj` under `.pi/pmti/`.
- Set current milestone to M0: MiniMax-friendly auto-routing contract.
- Preserved existing root `AGENTS.md` until the user later approved adding a managed PMTI block.

## Future entries

Record completed milestone/task outcomes here after implementation or review, not speculative plans.
