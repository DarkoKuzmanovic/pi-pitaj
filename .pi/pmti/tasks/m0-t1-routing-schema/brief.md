# M0-T1 — Define routing schema and policy contract

**Status:** ready for executor  
**Milestone:** M0 — MiniMax-friendly auto-routing contract  
**Depends on:** none  
**Blocks:** M0-T2, M0-T3, M0-T4, M0-T5  
**Packet prepared:** 2026-05-30

## Goal

Lock the public auto-routing contract for `pitaj` so downstream tasks can implement it without re-deciding schema or policy. This task is contract-first: update durable decision/contract artifacts if needed, make the approved zero-risk alias addition, and leave helper logic/wiring/docs expansion to downstream tasks.

## Required context

Read, in order:
1. `AGENTS.md`
2. `.pi/pmti/project/roadmap.md`
3. `.pi/pmti/milestones/M0.md`
4. `.pi/pmti/project/session-log/2026-05-30-001.md`
5. `.pi/pmti/project/decisions.md`
6. `context-build/oracle-m0-review.md`
7. `helpers.ts`, `index.ts`, `helpers.test.ts`, `settings.json`, `README.md`

PMTI files under `.pi/pmti/` are authoritative. `context-build/pitaj-product-context.md` has older milestone numbering; do not use its M1/M2/M3 labels as PMTI scope.

## Contract decisions to preserve

- `model: "auto"` is the only M0 auto-routing entry point.
- Add one public hint: `risk?: "low" | "high"`.
- Routing table:
  - `model: "auto"`, `risk: "high"` → `opus` alias.
  - `model: "auto"`, `risk: "low"` → `gpt` alias.
  - `model: "auto"`, no risk, `mode: "risk-check"` → `opus` alias.
  - `model: "auto"`, no risk, any other mode or omitted mode → `gpt` alias.
  - explicit non-`auto` alias or `provider/model` → pass through unchanged and ignore risk.
- `/pitaj auto ...` command syntax is out of scope for M0; auto-routing is tool-schema-only first.
- `resolveAutoRoute()` is the chosen mechanism for M0-T2: a pure helper in `helpers.ts`, called by `consultModel()` before `resolveModelRef()`, only when `request.model === "auto"`.
- Expected helper shape for downstream tasks: returns an alias plus metadata, e.g. `{ alias: string; routingReason: string; suggestedMode?: PitajMode }`.
- When `model: "auto"` chooses `opus` and the caller omitted `mode`, downstream wiring should send `mode: "risk-check"` and expose that in result details; explicit caller-provided mode always wins.

## Deliverables

1. Verify `.pi/pmti/project/decisions.md` already records `M0-b` and `M0-c`; add only if missing, do not duplicate.
2. Add the approved MiniMax alias bundle exactly once:
   - `settings.json`: `"mm": "minimax/MiniMax-M2.7-highspeed"`
   - `helpers.ts` `DEFAULT_SETTINGS.aliases`: `mm: "minimax/MiniMax-M2.7-highspeed"`
3. If touching contract text, keep it aligned with the routing table above and with `.pi/pmti/milestones/M0.md`.
4. Do not implement `resolveAutoRoute()` logic in this task unless the orchestrator explicitly expands M0-T1. That belongs to M0-T2.
5. Do not wire `consultModel()` or change `PitajParams` in this task unless the orchestrator explicitly merges M0-T2/T3. Those belong to M0-T2/M0-T3.

## Acceptance criteria

- Existing direct aliases and explicit `provider/model` resolution remain unchanged.
- `mm` alias is present in both runtime settings and built-in defaults.
- Decisions `M0-b` and `M0-c` are present exactly once and match the accepted risk schema / MiniMax alias decisions.
- No new `/pitaj auto` command behavior is introduced.
- No automatic context capture, budget tracking, sidecar tools, or convenience tools are added.
- `npm test` passes from `/home/quzma/.pi/agent/extensions/pi-pitaj` after changes.

## Risks and guardrails

- Do not add `auto` as a settings alias; aliasing cannot express policy and would mask the required helper design.
- Keep manual override precedence strict: only `request.model === "auto"` can engage auto-routing later.
- Treat stale mesh-review findings about quoted `-c`, `/pitaj check`, and `mimo` alias as already resolved; do not re-fix them here.
- Preserve TypeScript style: no `any`, no non-null assertions, type-only imports where applicable.
- If `decisions.md` or settings already contain a target entry in a different form, stop and ask before normalizing.
