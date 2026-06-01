# Handoff — M0-T3 tool wiring

Use this prompt for the executor. Do not run it automatically from task-packet prep.

```text
You are implementing PMTI task M0-T3 for pi-pitaj at /home/quzma/.pi/agent/extensions/pi-pitaj.

First read, in order:
- AGENTS.md
- .pi/pmti/project/roadmap.md
- .pi/pmti/milestones/M0.md
- .pi/pmti/project/decisions.md
- context-build/oracle-m0-review.md, especially the M0-T3 packet notes
- .pi/pmti/tasks/m0-t1-routing-schema/brief.md
- .pi/pmti/tasks/m0-t2-auto-routing-helpers/brief.md
- .pi/pmti/tasks/m0-t3-tool-wiring/brief.md
- helpers.ts
- index.ts
- helpers.test.ts

Task: wire M0 auto-routing into the pitaj tool schema/runtime only.

Allowed source changes:
- index.ts
- helpers.test.ts only for a narrow command-parsing regression test if useful

Do not change helpers.ts unless there is a direct compile mismatch. Do not change README, AGENTS.md, settings.json, PMTI decisions, promptGuidelines, or register new tools. M0-T4 owns docs/promptGuidelines.

Required implementation:
1. Import `PITAJ_AUTO_RISKS`, `resolveAutoRoute`, and `type PitajAutoRisk` from helpers.ts.
2. Add `risk?: PitajAutoRisk` to `PitajRequest`.
3. Add optional `autoRouted?: boolean`, `routingReason?: string`, `autoSuggestedMode?: PitajMode` to `PitajResultDetails`.
4. In `consultModel()`, before `ctx.modelRegistry.find()`:
   - if `request.model?.trim().toLowerCase() === "auto"`, call `resolveAutoRoute({ risk: request.risk, mode: request.mode }, settings)`.
   - pass `autoRoute.alias` into `resolveModelRef()` instead of the literal `auto`.
   - otherwise keep existing `resolveModelRef(request.model, settings)` behavior.
5. Compute effective mode as `request.mode ?? autoRoute?.suggestedMode ?? settings.defaultMode`.
6. Add auto-route details when auto-routing happened: `autoRouted: true`, `routingReason`, and `autoSuggestedMode` if present.
7. Update `PitajParams`:
   - model description mentions `auto` as tool-schema option.
   - add optional `risk` via `StringEnum(PITAJ_AUTO_RISKS, ...)` with a concise MiniMax-readable description.
8. Update `/pitaj help` output with a line stating tool auto-routing uses `model="auto"` + `risk`, and `/pitaj auto` command syntax is not enabled in M0.

Important boundaries:
- Only literal `model: "auto"` engages auto-routing.
- Explicit non-auto aliases/provider IDs ignore risk hints.
- Do not teach `parseCommandArgs()` that `auto` is an alias.
- Do not add `auto` to settings aliases.
- Do not change streaming behavior except details metadata.
- No `any`; no non-null assertions.

Optional narrow test:
- Add/keep a helper test proving `parseCommandArgs("auto should we do this?", mergeSettings())` leaves `model` undefined and treats `auto` as part of the question, so `/pitaj auto` remains out of scope.

Verification:
- Run `npm test` from /home/quzma/.pi/agent/extensions/pi-pitaj.
- Report changed files, exact test result, and any ambiguity.

Stop and ask the orchestrator if the current helper contract makes literal auto routing impossible without changing M0-T2 policy.
```

## Suggested executor

Use `worker` or `delegate` with `model: "zai/glm-5.1"`. This is a small integration edit with strict scope boundaries.

## Expected changed files

- `index.ts`
- `helpers.test.ts` only if adding the optional parsing regression test

## Stop conditions

Return without broadening scope if:
- the executor wants to add `/pitaj auto` command parsing;
- the executor wants to change `resolveAutoRoute()` policy;
- tests require model-registry mocks or broad refactors;
- TypeBox cannot express the new `risk` field with existing imports.
