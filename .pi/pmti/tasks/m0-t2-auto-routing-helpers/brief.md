# M0-T2 — Implement deterministic auto-routing helpers

**Status:** ready for executor  
**Milestone:** M0 — MiniMax-friendly auto-routing contract  
**Depends on:** M0-T1  
**Blocks:** M0-T3, M0-T4, M0-T5  
**Packet prepared:** 2026-05-30

## Goal

Add the pure helper layer and unit tests for the M0 auto-routing policy. This task implements deterministic helper code only; it does not wire the helper into the Pi tool/command runtime.

## Required context

Read, in order:
1. `AGENTS.md`
2. `.pi/pmti/project/roadmap.md`
3. `.pi/pmti/milestones/M0.md` lines for M0-T1/M0-T2
4. `.pi/pmti/project/decisions.md` (`M0-b`, `M0-c`)
5. `context-build/oracle-m0-review.md` section “M0-T2 packet”
6. `.pi/pmti/tasks/m0-t1-routing-schema/brief.md`
7. `helpers.ts`, `helpers.test.ts`, `settings.json`

## Implementation scope

Change only:
- `helpers.ts`
- `helpers.test.ts`

Do not change `index.ts`, `README.md`, `AGENTS.md`, `settings.json`, or PMTI decisions unless a direct contradiction is found.

## Helper contract

Add these exports in `helpers.ts` near the existing mode/brevity types:

```ts
export const PITAJ_AUTO_RISKS = ["low", "high"] as const;
export type PitajAutoRisk = (typeof PITAJ_AUTO_RISKS)[number];

export interface AutoRouteInput {
	risk?: PitajAutoRisk;
	mode?: PitajMode;
}

export interface AutoRouteResult {
	alias: "gpt" | "opus";
	routingReason: string;
	suggestedMode?: PitajMode;
}
```

Add:

```ts
export function resolveAutoRoute(input: AutoRouteInput, settings: PitajSettings): AutoRouteResult
```

Rules:
- Pure function; no I/O, no model registry access, no `resolveModelRef()` call.
- Returns alias keys (`"gpt"` or `"opus"`), not provider/model IDs.
- Validates the selected alias exists and is non-empty in `settings.aliases`; throw a clear `Error` if missing.
- Does not inspect `model`; M0-T3 owns the `request.model === "auto"` guard and manual override precedence.

## Routing table

- `risk: "high"` → `{ alias: "opus", routingReason: "auto: risk=high → opus", suggestedMode: "risk-check" }` when `mode` is omitted.
- `risk: "high"` with explicit mode → alias `"opus"`, same route reason, no `suggestedMode`.
- `risk: "low"` → alias `"gpt"`, reason `"auto: risk=low → gpt"`, no suggestion.
- no risk + `mode: "risk-check"` → alias `"opus"`, reason `"auto: mode=risk-check → opus"`, no suggestion.
- no risk + any other explicit mode → alias `"gpt"`, reason `"auto: default → gpt"`, no suggestion.
- no risk + omitted mode → alias `"gpt"`, reason `"auto: default → gpt"`, no suggestion.

## Tests to add

In `helpers.test.ts`, import the new helper/types and add tests covering:
- `risk: "high"` routes to `opus` and suggests `risk-check` when mode is omitted.
- `risk: "high"` with explicit `mode: "debug"` routes to `opus` without overriding/suggesting mode.
- `risk: "low"` routes to `gpt` without suggestion.
- no risk + `mode: "risk-check"` routes to `opus`.
- no risk + `mode: "debug"` routes to `gpt`.
- no risk + omitted mode routes to `gpt`.
- missing/blank selected `gpt` or `opus` alias throws a clear error.
- existing `resolveModelRef()` explicit alias/provider behavior still passes unchanged; this is the manual-override regression guard for M0-T2.

## Acceptance criteria

- `resolveAutoRoute()` is exported from `helpers.ts` and is the only new helper function needed for M0-T2.
- Routing behavior exactly matches `M0-b` and the M0-T1 task packet.
- Tests cover GPT route, Opus route, missing alias failure, mode suggestion behavior, and existing manual model resolution behavior.
- No runtime wiring is added; `consultModel()` still calls `resolveModelRef()` directly until M0-T3.
- `npm test` passes from `/home/quzma/.pi/agent/extensions/pi-pitaj`.

## Guardrails

- Do not add `auto` as a settings alias.
- Do not hardcode provider/model IDs in the helper.
- Do not use `any` or non-null assertions.
- Keep error messages user-actionable, e.g. `pitaj auto routing requires a non-empty "gpt" alias in settings.json`.
- If the helper signature above conflicts with current source constraints, stop and report the conflict rather than inventing a new contract.
