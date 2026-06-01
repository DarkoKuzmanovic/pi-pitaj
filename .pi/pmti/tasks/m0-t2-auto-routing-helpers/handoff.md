# Handoff — M0-T2 auto-routing helpers

Use this prompt for the executor. Do not run it automatically from task-packet prep.

```text
You are implementing PMTI task M0-T2 for pi-pitaj at /home/quzma/.pi/agent/extensions/pi-pitaj.

First read, in order:
- AGENTS.md
- .pi/pmti/project/roadmap.md
- .pi/pmti/milestones/M0.md
- .pi/pmti/project/decisions.md
- context-build/oracle-m0-review.md, especially the “M0-T2 packet” section
- .pi/pmti/tasks/m0-t1-routing-schema/brief.md
- .pi/pmti/tasks/m0-t2-auto-routing-helpers/brief.md
- helpers.ts
- helpers.test.ts
- settings.json

Task: implement deterministic auto-routing helpers and unit tests only.

Allowed source changes:
- helpers.ts
- helpers.test.ts

Do not change index.ts, README.md, AGENTS.md, settings.json, PMTI decisions, or command/tool runtime wiring. M0-T3 owns wiring into `consultModel()` and TypeBox/PitajRequest schema changes.

Implement in helpers.ts:
- `PITAJ_AUTO_RISKS = ["low", "high"] as const`
- `PitajAutoRisk`
- `AutoRouteInput`
- `AutoRouteResult`
- `resolveAutoRoute(input: AutoRouteInput, settings: PitajSettings): AutoRouteResult`

Routing rules:
- risk high => alias opus, reason `auto: risk=high → opus`; if mode omitted, suggest `risk-check`.
- risk high + explicit mode => alias opus, same reason, no suggestion.
- risk low => alias gpt, reason `auto: risk=low → gpt`, no suggestion.
- no risk + mode risk-check => alias opus, reason `auto: mode=risk-check → opus`, no suggestion.
- no risk + any other explicit or omitted mode => alias gpt, reason `auto: default → gpt`, no suggestion.

Helper constraints:
- Pure function only.
- Return alias keys, not provider/model IDs.
- Validate selected alias exists and is non-empty in `settings.aliases`; throw a clear Error if missing.
- Do not call `resolveModelRef()` inside `resolveAutoRoute()`.
- Do not inspect model; M0-T3 will call this helper only when `request.model === "auto"`.
- Do not add `auto` as a settings alias.
- No `any`; no non-null assertions.

Tests in helpers.test.ts must cover:
- high risk -> opus + suggested risk-check when mode omitted
- high risk + explicit debug mode -> opus, no suggestion
- low risk -> gpt
- no risk + risk-check mode -> opus
- no risk + debug mode -> gpt
- no risk + omitted mode -> gpt
- missing/blank gpt or opus alias throws a clear error
- existing explicit alias/provider `resolveModelRef()` behavior still passes unchanged as the manual-override regression guard

Verification:
- Run `npm test` from /home/quzma/.pi/agent/extensions/pi-pitaj.
- Report changed files, exact test result, and any ambiguity.

Stop and ask the orchestrator if the current source shape makes the packet’s helper signature impossible without touching `index.ts`.
```

## Suggested executor

Use `worker` with default project routing, or `delegate` with `model: "zai/glm-5.1"`. This is a small strict TypeScript implementation with tests.

## Expected changed files

- `helpers.ts`
- `helpers.test.ts`

## Stop conditions

Return without broadening scope if:
- the executor thinks `index.ts` must change;
- the helper signature conflicts with M0-T1/M0-b;
- tests require runtime wiring to pass;
- selected alias validation cannot be implemented without hardcoding provider/model IDs.
