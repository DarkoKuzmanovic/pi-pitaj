# Handoff — M0-T1 routing schema

Use this prompt for the executor. Do not run it automatically from task-packet prep.

```text
You are implementing PMTI task M0-T1 for pi-pitaj at /home/quzma/.pi/agent/extensions/pi-pitaj.

First read, in order:
- AGENTS.md
- .pi/pmti/project/roadmap.md
- .pi/pmti/milestones/M0.md
- .pi/pmti/project/session-log/2026-05-30-001.md
- .pi/pmti/project/decisions.md
- context-build/oracle-m0-review.md
- .pi/pmti/tasks/m0-t1-routing-schema/brief.md
- helpers.ts
- settings.json
- index.ts
- helpers.test.ts
- README.md

Task: define and preserve the M0 auto-routing schema/policy contract without implementing downstream routing logic.

Implement only these M0-T1 deliverables:
1. Ensure decisions M0-b and M0-c exist exactly once in .pi/pmti/project/decisions.md. If already present and correct, leave them unchanged.
2. Add the approved MiniMax alias in both places:
   - settings.json aliases: "mm": "minimax/MiniMax-M2.7-highspeed"
   - helpers.ts DEFAULT_SETTINGS.aliases: mm: "minimax/MiniMax-M2.7-highspeed"
3. Preserve the accepted contract for downstream tasks:
   - public auto entry point: model: "auto"
   - public hint: risk?: "low" | "high"
   - risk high => opus alias
   - risk low => gpt alias
   - omitted risk + mode risk-check => opus alias
   - omitted risk + any other/omitted mode => gpt alias
   - explicit non-auto model always wins and ignores risk
   - /pitaj auto command syntax is out of scope for M0
   - resolveAutoRoute() will be implemented in M0-T2 and called by consultModel() before resolveModelRef() in M0-T3

Do not implement resolveAutoRoute(). Do not change PitajParams or PitajRequest for risk/model auto yet unless the orchestrator explicitly merges downstream tasks. Do not wire consultModel(). Do not add context capture, budget tracking, sidecar tools, pitaj_auto/pitaj_gpt/pitaj_opus, or /pitaj auto command behavior.

Verification:
- Run npm test from /home/quzma/.pi/agent/extensions/pi-pitaj.
- Report changed files, test result, and any ambiguity.

If you find that M0-b/M0-c conflict with this packet, stop and ask the orchestrator instead of choosing a new contract.
```

## Suggested executor

Use `worker` or `delegate` with `model: "zai/glm-5.1"` for the small spec-driven edit. No oracle is needed unless the executor finds a contract conflict.

## Expected changed files for M0-T1 implementation

- `helpers.ts`
- `settings.json`
- `.pi/pmti/project/decisions.md` only if `M0-b` or `M0-c` is missing/corrupt

## Stop conditions

Return to the orchestrator without editing further if:
- any existing decision contradicts the risk schema or `mm` alias approval;
- adding `mm` would duplicate or overwrite a different alias target;
- tests fail for reasons unrelated to the small alias/decision changes;
- implementing the routing helper seems necessary to make tests pass.
