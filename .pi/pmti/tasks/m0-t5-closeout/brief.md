# M0-T5 — Verify M0 and prepare task handoff boundary

**Status:** ready for executor  
**Milestone:** M0 — MiniMax-friendly auto-routing contract  
**Depends on:** M0-T2, M0-T3, M0-T4  
**Blocks:** none  
**Packet prepared:** 2026-05-30

## Goal

Close M0 by validating the integrated auto-routing contract, recording final evidence in the PMTI session log, and recommending whether M1 should proceed immediately or wait for MiniMax usage feedback.

## Required context

Read, in order:
1. `AGENTS.md`
2. `.pi/pmti/project/roadmap.md`
3. `.pi/pmti/milestones/M0.md`
4. `.pi/pmti/project/session-log/2026-05-30-001.md`
5. `.pi/pmti/tasks/m0-t1-routing-schema/brief.md`
6. `.pi/pmti/tasks/m0-t2-auto-routing-helpers/brief.md`
7. `.pi/pmti/tasks/m0-t3-tool-wiring/brief.md`
8. `.pi/pmti/tasks/m0-t4-docs-guidance/brief.md`
9. `helpers.ts`, `helpers.test.ts`, `index.ts`, `README.md`, `package.json`

## Implementation scope

Allowed changes:
- `.pi/pmti/project/session-log/2026-05-30-001.md` append-only close-out section
- `.pi/pmti/milestones/M0.md` status line only, if all validation passes

Do not change source code, tests, README, settings, or task packets in M0-T5 unless validation finds a blocker; report blockers instead of fixing them.

## Required validation

1. Run:

```bash
npm test
```

from `/home/quzma/.pi/agent/extensions/pi-pitaj` and record the exact result.

2. Run a schema/docs sanity pass. Confirm:
- `PitajParams` model description mentions `auto`.
- `PitajParams` exposes `risk` using `PITAJ_AUTO_RISKS`.
- `PitajResultDetails` includes `autoRouted`, `routingReason`, and `autoSuggestedMode`.
- `consultModel()` intercepts literal `model: "auto"` before `resolveModelRef()` / registry lookup.
- `promptGuidelines` include the auto-low, auto-high, explicit alias, local-first, and sidecar/tool-less rubric.
- README includes `model: "auto"`, `risk`, explicit `gpt`, explicit `opus`, and the sidecar/tool-less context limitation.

3. Confirm routing determinism for four canonical inputs from M0-b:
- `risk: "high"` routes to `opus` and suggests `risk-check` if mode omitted.
- `risk: "low"` routes to `gpt`.
- no risk plus `mode: "risk-check"` routes to `opus`.
- no risk and no mode routes to `gpt`.

The existing helper tests may satisfy this if inspected and passing.

4. Record review evidence:
- M0-T3 read-only reviewer found no Critical/Important/Minor findings after implementation.
- M0-T4 read-only reviewer found only README alias-list Minor issues; those were fixed by adding `gpt` to the settings example/troubleshooting, and `npm test` still passed.

5. Note known follow-ups:
- `settings.maxOutputChars` schema/runtime ambiguity is pre-existing; recommend standalone fix or M1 inclusion.
- `mesh-review/synthesis.md` stale B1/H1/M4 findings are resolved in current code; mention as a snapshot note, no source change required unless session log policy requires it.

6. Recommend M1 boundary:
- Proceed to M1 only if MiniMax still demonstrably miscalls `pitaj` after M0 auto-routing is available.
- Otherwise wait for one session cycle of usage feedback before implementing bounded context modes.

## Session log update

Append a section such as:

```md
## M0 close-out — 2026-05-30

- Tasks completed: M0-T1 through M0-T5.
- Validation: ...
- Schema/docs sanity: ...
- Review: ...
- Known follow-ups: ...
- M1 recommendation: ...
```

If validation passes, update `.pi/pmti/milestones/M0.md` status from `planned` to `completed`.

## Acceptance criteria

- `npm test` passes.
- Manual schema/docs sanity pass is recorded.
- Reviewer/test evidence is recorded in the session log.
- M1 proceed/wait recommendation is recorded.
- Source/runtime code is unchanged by M0-T5.
