# Handoff — M0-T5 close-out

Use this prompt for the executor.

```text
You are implementing PMTI task M0-T5 for pi-pitaj at /home/quzma/.pi/agent/extensions/pi-pitaj.

Read first:
- AGENTS.md
- .pi/pmti/project/roadmap.md
- .pi/pmti/milestones/M0.md
- .pi/pmti/project/session-log/2026-05-30-001.md
- .pi/pmti/tasks/m0-t1-routing-schema/brief.md
- .pi/pmti/tasks/m0-t2-auto-routing-helpers/brief.md
- .pi/pmti/tasks/m0-t3-tool-wiring/brief.md
- .pi/pmti/tasks/m0-t4-docs-guidance/brief.md
- .pi/pmti/tasks/m0-t5-closeout/brief.md
- helpers.ts
- helpers.test.ts
- index.ts
- README.md
- package.json

Task: validate and close M0. Do not implement new behavior.

Allowed changes:
- append-only close-out section in .pi/pmti/project/session-log/2026-05-30-001.md
- .pi/pmti/milestones/M0.md status line only, if validation passes

Do not change source code, tests, README, settings, or task packets. If validation finds a blocker, stop and report it instead of fixing code.

Required validation:
1. Run `npm test` from /home/quzma/.pi/agent/extensions/pi-pitaj.
2. Inspect index.ts, helpers.ts, helpers.test.ts, and README.md to confirm:
   - PitajParams model description mentions auto.
   - PitajParams risk uses PITAJ_AUTO_RISKS.
   - PitajResultDetails has autoRouted, routingReason, autoSuggestedMode.
   - consultModel intercepts literal model auto before resolveModelRef / registry lookup.
   - promptGuidelines include auto-low, auto-high, explicit aliases, local-first, and sidecar/tool-less guidance.
   - README includes model auto/risk, explicit gpt and opus examples, and sidecar/tool-less context limitation.
3. Confirm the four deterministic routing cases from M0-b are covered by helpers.test.ts and passing.
4. Append the final close-out section to .pi/pmti/project/session-log/2026-05-30-001.md.
5. If all validation passes, update M0.md status from planned to completed.

Review evidence to record:
- M0-T3 reviewer: no Critical / Important / Minor findings; ready to proceed.
- M0-T4 reviewer: only Minor README alias-list inconsistencies; fixed by adding gpt to settings example and troubleshooting; npm test passed after fix.

Known follow-ups to record:
- settings.maxOutputChars schema/runtime ambiguity is pre-existing; recommend standalone fix or M1 inclusion.
- mesh-review/synthesis.md B1/H1/M4 findings are stale/resolved in current code; treat as older snapshot unless separately updated.

M1 recommendation to record:
- Wait one session cycle for MiniMax usage feedback unless MiniMax still demonstrably miscalls pitaj after M0 auto-routing; proceed to M1 bounded context modes only if usage shows the need.

Return:
- Changed files
- Exact validation result
- Sanity pass result
- Recorded M1 recommendation
- Any blocker or ambiguity
```

## Expected changed files

- `.pi/pmti/project/session-log/2026-05-30-001.md`
- `.pi/pmti/milestones/M0.md`

## Stop conditions

Stop and report if:
- `npm test` fails;
- schema/docs sanity check fails;
- deterministic routing coverage cannot be confirmed;
- source code changes appear necessary.
