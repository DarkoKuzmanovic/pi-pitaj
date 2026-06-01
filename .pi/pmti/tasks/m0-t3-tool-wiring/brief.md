# M0-T3 — Wire auto-routing into the pitaj tool and command UX

**Status:** ready for executor  
**Milestone:** M0 — MiniMax-friendly auto-routing contract  
**Depends on:** M0-T2  
**Blocks:** M0-T4, M0-T5  
**Packet prepared:** 2026-05-30

## Goal

Wire the M0-T2 `resolveAutoRoute()` helper into the `pitaj` tool runtime and public tool schema while preserving existing explicit alias/provider behavior. This is the runtime integration task; docs/promptGuidelines expansion remains M0-T4.

## Required context

Read, in order:
1. `AGENTS.md`
2. `.pi/pmti/project/roadmap.md`
3. `.pi/pmti/milestones/M0.md` M0-T3 section
4. `.pi/pmti/project/decisions.md` (`M0-b`)
5. `context-build/oracle-m0-review.md` M0-T3 packet notes
6. `.pi/pmti/tasks/m0-t1-routing-schema/brief.md`
7. `.pi/pmti/tasks/m0-t2-auto-routing-helpers/brief.md`
8. `helpers.ts`, `index.ts`, `helpers.test.ts`

## Implementation scope

Allowed source changes:
- `index.ts`
- `helpers.test.ts` only if adding a narrow regression test is useful

Do not change `helpers.ts` routing policy unless a compile error reveals a direct mismatch. Do not change README/promptGuidelines beyond the small `/pitaj help` note described below; M0-T4 owns agent-facing docs.

## Required `index.ts` changes

1. Import from `helpers.ts`:
   - `PITAJ_AUTO_RISKS`
   - `resolveAutoRoute`
   - `type PitajAutoRisk`

2. Extend `PitajRequest`:

```ts
risk?: PitajAutoRisk;
```

3. Extend `PitajResultDetails`:

```ts
autoRouted?: boolean;
routingReason?: string;
autoSuggestedMode?: PitajMode;
```

4. In `consultModel()`, route before model registry lookup:

```ts
const autoRoute = request.model?.trim().toLowerCase() === "auto"
	? resolveAutoRoute({ risk: request.risk, mode: request.mode }, settings)
	: undefined;
const resolved = resolveModelRef(autoRoute?.alias ?? request.model, settings);
```

Then compute effective mode after routing:

```ts
const mode = request.mode ?? autoRoute?.suggestedMode ?? settings.defaultMode;
```

Constraints:
- Only `request.model === "auto"` engages auto-routing.
- Explicit non-auto aliases/provider IDs ignore `risk` entirely.
- `resolveAutoRoute()` must run before `ctx.modelRegistry.find()` so `"auto"` never reaches `resolveModelRef()`.
- Explicit caller-provided `mode` always wins over `autoRoute.suggestedMode`.

5. Include auto metadata in returned details only when auto-routing happened:

```ts
...(autoRoute ? { autoRouted: true, routingReason: autoRoute.routingReason } : {}),
...(autoRoute?.suggestedMode ? { autoSuggestedMode: autoRoute.suggestedMode } : {}),
```

6. Update `PitajParams`:
- `model` description must mention `auto` without implying `/pitaj auto` command support.
- Add optional `risk` using `StringEnum(PITAJ_AUTO_RISKS, ...)` with concise description:
  `Routing hint for model auto. low=bounded technical check; high=architecture, security, data integrity, or hard-to-reverse change. Only used when model is auto.`

7. Update `/pitaj help` output with one clear line under Options or Examples:

```text
Tool auto-routing: use model="auto" with risk="low"|"high"; /pitaj auto syntax is not enabled in M0.
```

Do not make `parseCommandArgs()` treat `auto` as a command alias in this task.

## Tests / verification

At minimum, run existing `npm test`.

If adding a narrow regression test is easy, prefer testing command parsing remains unchanged:
- `parseCommandArgs("auto should we do this?", settings)` returns `model: undefined` unless `auto` is configured as an alias.

Do not introduce heavyweight model-registry mocks unless needed; M0-T5 will perform integrated schema sanity checks.

## Acceptance criteria

- Tool calls can pass `model: "auto"` and `risk?: "low" | "high"` without schema rejection.
- `consultModel()` resolves `auto` via `resolveAutoRoute()` before `resolveModelRef()` / registry lookup.
- Explicit non-auto `model` values preserve current behavior and ignore `risk`.
- Effective mode applies `autoRoute.suggestedMode` only when caller omitted `mode`.
- Result details include `autoRouted`, `routingReason`, and `autoSuggestedMode` when applicable.
- `/pitaj help` states tool-schema auto-routing is available but `/pitaj auto` syntax is not enabled in M0.
- Streaming/result behavior is unchanged except for additional details metadata.
- `npm test` passes from `/home/quzma/.pi/agent/extensions/pi-pitaj`.

## Guardrails

- Do not add `auto` to `settings.json` or `DEFAULT_SETTINGS.aliases`.
- Do not register new tools (`pitaj_auto`, `pitaj_gpt`, `pitaj_opus`).
- Do not add context capture or budget tracking.
- Do not alter M0-T2 routing table or helper semantics.
- Keep TypeScript strict: no `any`, no non-null assertions, type-only imports where applicable.
