# PMTI execution lanes

**Date:** 2026-06-01
**Status:** accepted for pi-pitaj PMTI work after M3-B2

## Purpose

PMTI should make autonomous execution achievable without turning every edit into a full ceremony. Use lanes to choose the smallest safe gate set for each milestone batch while preserving review where mistakes would compound.

## Lane summary

| Lane | Use when | Required gates | Review rule |
|---|---|---|---|
| Fast | Narrow, reversible, well-tested implementation with no new public contract or persistence boundary | Approved packet, implementation, verification | Reviewer optional or sampled unless tests/worker behavior raise concern |
| Review | User-visible behavior, command semantics, routing, usage/state, persistence, or public contract changes | Approved packet, implementation, verification, fresh-context reviewer before next dependent batch | Reviewer required; fix Critical/Important before continuing |
| Oracle | Architecture fork, new invariant, irreversible choice, security/privacy boundary, broad workflow/process change, or milestone plan with multiple batch dependencies | Oracle before packet/implementation, then implementation verification and post-code reviewer | Oracle required before code; reviewer required after code |

## Fast lane

Use Fast lane for tasks that are all of the following:

- limited to a small allowlist of files,
- reversible with `git restore` or a small patch,
- covered by deterministic tests or a simple strip/import check,
- does not alter direct tool schemas, slash-command routing, persistent settings, storage, privacy boundaries, or PMTI process.

Typical gate:

1. Write or reuse an approved task packet.
2. Dispatch one worker with a tight allowlist and stop-on-mismatch instructions.
3. Orchestrator inspects report and diff.
4. Run verification.
5. If clean and low-risk, proceed without a dedicated reviewer; otherwise promote to Review lane.

Sampling rule: periodically review Fast-lane batches, and always review when a worker needed fix-back, touched more files than expected, or verification required non-obvious repair.

## Review lane

Use Review lane for tasks that affect behavior other agents/users will rely on:

- result presentation or user-visible output,
- command routing or command parsing,
- auto-routing/model selection,
- in-session or persistent state,
- settings/config writes,
- metadata contracts used by later batches,
- error handling semantics.

Required gate:

1. Approved task packet.
2. Worker implementation.
3. Orchestrator verification and obvious fix-back.
4. Fresh-context reviewer before the next dependent batch.
5. Fix every Critical and Important finding, rerun verification, and request targeted re-review when a reviewer requested changes.

Minor notes may be documented and deferred only when they do not violate acceptance criteria or future batch assumptions.

## Oracle lane

Use Oracle lane when the right plan is uncertain or hard to reverse:

- milestone scope or batch sequencing,
- new architectural invariant,
- privacy/security/context-capture boundary,
- switching workspace strategy,
- changing PMTI process,
- adding full-branch/session scraping, persistence, pricing/cost accounting, or blocking budget policy.

Required gate:

1. Draft milestone or decision.
2. Oracle review before task packets or code.
3. Record required edits and resolve them durably.
4. Prepare task packets only after oracle blockers are resolved.
5. Post-code reviewer still applies to Review/Oracle-lane implementation.

## Worker feedback loop

When a worker fails, do not only fix the code. Classify the failure:

- **Baseline confusion:** worker re-created completed prerequisite work instead of pausing.
- **Acceptance drift:** worker tested its own interpretation instead of literal packet criteria.
- **Edit discipline:** worker stacked risky edits, ignored warnings, or left syntax damage.
- **Verification discipline:** worker used truncated or filtered output where exact output was required.
- **Scope drift:** worker touched files or behavior outside the packet.

For preventable failures, update the worker prompt/agent instructions before the next dispatch, reload Pi if needed, and monitor the next comparable task for improvement.

## Promotion and demotion rules

- Promote Fast → Review if implementation touches user-visible behavior, state, routing, settings, or error semantics.
- Promote Review → Oracle if a task reveals a new invariant or contradicts an accepted project decision.
- Demote Oracle → Review after the oracle-approved plan resolves the architectural question and remaining work is implementation-only.
- Demote Review → Fast only for follow-up mechanical edits that are tightly scoped, verified, and not dependency-bearing.

## Current pi-pitaj application

- M3-B1 result presentation: Review lane because it changed direct tool and slash-command presentation contracts.
- M3-B2 usage state and command: Review lane because it added state, command routing, budget semantics, and error-path recording.
- M3-B3 warning integration and close-out: Review lane, with final reviewer before marking M3 complete.
- Future full-branch/advisor mode: Oracle lane before implementation because it changes context-capture and privacy boundaries.
