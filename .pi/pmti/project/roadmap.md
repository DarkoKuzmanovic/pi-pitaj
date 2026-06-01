# PMTI roadmap

Detailed PMTI milestone scope, task decomposition, dependencies, and review state live in `.pi/pmti/milestones/MN.md`.

## Current state

- **M0:** Completed 2026-05-30 — MiniMax-friendly auto-routing contract for `pitaj`; see `.pi/pmti/milestones/M0.md`.
- **M1:** Completed 2026-06-01 — curated snapshot consult mode with pure builder, bounded runtime seam, `/pitaj snapshot` command wiring, README/help docs, verification, and reviewer close-out; see `.pi/pmti/milestones/M1.md`.
- **M2:** Completed 2026-06-01 — `/pitaj config` settings summary and UI-backed safe persistence with configurable auto-route aliases, max output precedence fix, documentation, verification, and reviewer close-out; see `.pi/pmti/milestones/M2.md`.

## Candidate milestones

- **M3:** Consultation observability and budgets - surface per-task/session usage for GPT/Opus-style routes, warnings, and troubleshooting for overuse or too-little-context cases.
- **M4:** Advisor-style shortcut polish — consider a zero-parameter convenience affordance only if it uses the M1 curated snapshot builder and clearly labels results as advisory.
- **M5:** Explicit full-branch mode — optional parity with whole-branch advisor tools, guarded by explicit opt-in, token/sensitivity warnings, and existing context limits.

## Planning notes

- The 2026-06-01 implementation plan supersedes the earlier generic “bounded context modes” wording: start with one curated snapshot path rather than several automatic context-source modes.
- M1 should avoid full session scraping. The snapshot must be compact, provenance-aware, and bounded by existing `maxContextChars` safeguards.
- Borrow the pi-todo PMTI pattern of preserving the public API first: new conveniences should wrap the existing focused `pitaj` consult path rather than replacing it.
- Roadmap entries are intentionally phase-sized. Task-level implementation steps belong in milestone manifests or task packets, not this file.
