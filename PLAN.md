# pi-pitaj M3 execution plan

## Scope decision

- **Tier:** Full (promoted from Standard after the first protected-boundary fix cycle left a blocker)
- **Risk:** contained protected
- **Delivery:** local
- **Branch:** `crew/m3-correctness-hardening`
- **Base:** `main` at `2a225a5`
- **Specification:** `docs/specs/correctness-hardening.md`
- **Evidence:** one repository and resolved architecture, but Oracle root/secret/evidence disclosure is a protected privacy boundary; an additional valid unborn-repository state escaped the first bounded fix cycle, requiring Full ceremony.
- **Allowed ceremony:** one writer, focused plus full verification, deep protected-boundary review, and at most two bounded review-fix cycles. No planner dispatch because the reviewed specification and codegraph map already define the seams.
- **Outcome dispatch ceiling:** 8 delivered child dispatches for protected outcomes under Full; 4 for ordinary outcomes. Session ceiling remains 12 delivered child dispatches / 180 child-runtime minutes / 2 compactions.
- **Promotion:** Standard → Full after the first review-fix cycle left a valid unborn-repository diff state blocked; no new product decision or second grill is required.
- **Grill:** explicitly offered; user chose to skip and accept the reviewed specification.

## Run metrics

- **started-at:** 2026-08-07T00:32:35+02:00
- **first-worker-at:** 2026-08-07T00:35:00+02:00
- **completed-at:** pending
- **dispatches:** 6 delivered
- **burned:** 0
- **review-bundles:** 1
- **review-dispatches:** 3
- **worker-retries:** 0
- **compactions:** 1

## M3 — Correctness, privacy, accounting, and Oracle evidence hardening

- [x] **M3.1 — Make Oracle evidence complete within its declared bounds and enforce the active-workspace trust boundary**
- [ ] **M3.2 — Make consultation parsing, defaults, truncation, accounting, and evidence exhaustion match their public contracts**
- [ ] **M3.3 — Make snapshot and failure metadata structurally accurate**
- [ ] **M3.4 — Restore package verification hygiene and reconcile the integrated documentation contract**

### M3.1 — Completed outcome

**Acceptance criteria**

- Git-backed search finds tracked and non-ignored untracked files without the current 64-file traversal false negative.
- Oracle rejects a valid Git root outside the canonical workspace containing `ctx.cwd` before model streaming.
- Secret scanning permits TypeScript password type declarations while continuing to refuse credential-looking values.
- Oracle operation enums serialize through Pi’s documented Google-compatible `StringEnum` shape.
- Fractional evidence-request limits are rejected at schema and runtime boundaries.
- `git_diff` reports staged plus unstaged tracked changes, excludes untracked files explicitly, and returns bounded explicit failure for oversized subprocess output.
- Focused tests cover every changed invariant; the full test suite passes.
- README and AGENTS describe the actual root, search, secret, enum, budget, and diff behavior.

**Runway**

- `consultModel()` calls `approveOracleRoot()` before model resolution/streaming.
- `executeOracleEvidence()` owns host-mediated operations; `searchFiles()` consumes Git-backed `collectSearchCandidates()` and `gitDiff()` owns tracked diff output.
- `oracle-policy.ts` owns operation lists, secret refusal, evidence limits, and truncation.
- Test seams already exist in `oracle.test.ts`, `oracle-policy.test.ts`, and `consult-behavior.test.ts`.
- Installed Pi `docs/extensions.md` and `examples/extensions/README.md` require `StringEnum` and allow nested tool `usage`; `examples/extensions/summarize.ts` demonstrates model-registry nested calls.

**Current wave**

- [x] Add failing regression tests for search coverage, workspace-root rejection, password declarations, schema shape, fractional budgets, and staged/oversized diff behavior.
- [x] Implement the smallest owning-boundary fixes in `oracle.ts`, `oracle-policy.ts`, and the Oracle setup path in `index.ts`.
- [x] Reconcile README and AGENTS for the shipped M3.1 behavior.
- [x] Run focused and full verification.
- [x] Run one fresh-context deep combined review; resolve blockers within the bounded Full-tier fix cycles.

**Counters:** dispatches: 6/8 (delivered) · burned: 0 · review-bundles: 1 · review-dispatches: 3 · fix-cycles: 2/2 · oracle: 0 · worker-retries: 0 · direct-edits: 0

**Documentation:** README and AGENTS reconciled with the M3.1 trust, search, budget, secret, schema, and diff contracts.

## Conventions

- Shared Pi development tooling is resolved from `~/.pi/agent`; do not install local compiler/test dependencies merely to obtain TypeScript or the test runner.
- `settings.json` contains a pre-existing unrelated modification. Never edit, restore, stage, or commit it in this run.
- `ROADMAP.md` gained a concurrent unrelated argument-completions idea during M3.1. Never edit, restore, stage, or commit that line in this outcome.
- Implementation workers do not commit. The orchestrator stages explicit paths and commits only after the outcome gate passes.
- Pi API work must follow installed `docs/extensions.md`, `docs/packages.md`, `examples/extensions/README.md`, and the closest shipped source examples; do not infer signatures from compiled internals.

## Gate log

- 2026-08-07 — Spec gate: `docs/specs/correctness-hardening.md` accepted by the user through authorization to create and implement M3.
- 2026-08-07 — Grill gate: offered; user selected skip.
- 2026-08-07 — Scope checkpoint: Standard / contained protected / local; user selected local delivery.
- 2026-08-07 — Pi harness documentation gate: read installed `docs/extensions.md`, `docs/packages.md`, `examples/extensions/README.md`, `examples/extensions/summarize.ts`, and `examples/extensions/tools.ts`.
- 2026-08-07 — M3.1 implementation: hard-lane worker completed 17 regression tests and protected-boundary code/docs; 1 delivered dispatch, 0 burned.
- 2026-08-07 — M3.1 independent verification: `npm test` passed 221/221; strict TypeScript passed for all product files plus changed tests; `git diff --check` clean; alternative root caller path traced.
- 2026-08-07 — M3.1 deep review: blocked on password-scanner bypasses, inherited Git repository-selection environment, silent per-candidate search skips, and unborn-repository diff semantics. One bounded fix cycle opened; conservative complex-type false positives remain a note.
- 2026-08-07 — M3.1 fix-back: original worker closed all four blockers test-first; 4 RED regressions, then 225/225 GREEN; 1 additional delivered dispatch.
- 2026-08-07 — M3.1 fix-back verification: orchestrator confirmed 225/225 tests, strict TypeScript for product plus changed tests, clean diff check, sanitized Git execution, explicit partial-search notes, bounded unborn-repository diff, and scanner regression paths.
- 2026-08-07 — M3.1 fix verification review: three blockers closed; unborn staged-add-then-working-tree-delete still refused because cached `A` status implied current file existence.
- 2026-08-07 — Scope promotion: Standard → Full, allowing the second bounded fix cycle and final deep verification within an 8-dispatch protected-outcome ceiling.
- 2026-08-07 — M3.1 final fix-back: current-filesystem path validation now allows absent staged/deleted paths after lexical checks while preserving stable-path checks for existing paths; exact regression RED then 226/226 GREEN.
- 2026-08-07 — M3.1 final independent verification: 226/226 tests, strict TypeScript, and diff check passed; owning-boundary path logic inspected.
- 2026-08-07 — M3.1 final deep review: exact unborn staged-add/delete probe returned both diff halves; 226/226 tests, strict TypeScript, and diff check passed; reviewer verdict APPROVE. Accepted non-blocking note: conservative `Readonly<string>` password declaration false positive.

## Deferred

- Streaming-update performance measurement and coalescing.
- Package-local settings persistence migration.
- TUI-only metadata footer rendering.
- Oracle streaming cosmetics that do not affect correctness.

## Handoff

No handoff yet. M3.1 is the active outcome; later outcomes remain intentionally undecomposed until M3.1 evidence is gated.
