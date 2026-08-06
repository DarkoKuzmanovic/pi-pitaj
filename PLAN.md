# pi-pitaj M3 execution plan

## Scope decision

- **Tier:** Standard
- **Risk:** contained protected
- **Delivery:** local
- **Branch:** `crew/m3-correctness-hardening`
- **Base:** `main` at `2a225a5`
- **Specification:** `docs/specs/correctness-hardening.md`
- **Evidence:** one repository; four bounded outcomes; resolved architecture; deterministic tests; Oracle root, secret, and evidence-disclosure changes form a contained privacy boundary.
- **Allowed ceremony:** inline outcome planning, one writer per outcome, focused verification plus full repository gate where public/protected contracts change, deep reviewer at protected boundaries, standard reviewer elsewhere. No planner dispatch because the reviewed specification and codegraph map already define the seams.
- **Outcome dispatch ceiling:** 5 delivered child dispatches for each contained-protected outcome; 4 for ordinary outcomes. Session ceiling remains 12 delivered child dispatches / 180 child-runtime minutes / 2 compactions.
- **Promotion triggers:** a new repository, unresolved architecture fork, destructive migration, low-confidence secret exposure, or broader cross-extension contract promotes the run to Full and requires a new grill offer.
- **Grill:** explicitly offered; user chose to skip and accept the reviewed specification.

## Run metrics

- **started-at:** 2026-08-07T00:32:35+02:00
- **first-worker-at:** pending
- **completed-at:** pending
- **dispatches:** 0 delivered
- **burned:** 0
- **review-bundles:** 0
- **review-dispatches:** 0
- **worker-retries:** 0
- **compactions:** 1

## M3 — Correctness, privacy, accounting, and Oracle evidence hardening

- [ ] **M3.1 — Make Oracle evidence complete within its declared bounds and enforce the active-workspace trust boundary**
- [ ] **M3.2 — Make consultation parsing, defaults, truncation, accounting, and evidence exhaustion match their public contracts**
- [ ] **M3.3 — Make snapshot and failure metadata structurally accurate**
- [ ] **M3.4 — Restore package verification hygiene and reconcile the integrated documentation contract**

### M3.1 — Active outcome

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
- `executeOracleEvidence()` owns host-mediated operations; `searchFiles()` currently consumes `collectSearchFiles()` and `gitDiff()` owns tracked diff output.
- `oracle-policy.ts` owns operation lists, secret refusal, evidence limits, and truncation.
- Test seams already exist in `oracle.test.ts`, `oracle-policy.test.ts`, and `consult-behavior.test.ts`.
- Installed Pi `docs/extensions.md` and `examples/extensions/README.md` require `StringEnum` and allow nested tool `usage`; `examples/extensions/summarize.ts` demonstrates model-registry nested calls.

**Current wave**

- [ ] Add failing regression tests for search coverage, workspace-root rejection, password declarations, schema shape, fractional budgets, and staged/oversized diff behavior.
- [ ] Implement the smallest owning-boundary fixes in `oracle.ts`, `oracle-policy.ts`, and the Oracle setup path in `index.ts`.
- [ ] Reconcile README and AGENTS for the shipped M3.1 behavior.
- [ ] Run focused and full verification.
- [ ] Run one fresh-context deep combined review; resolve blockers within the one-cycle budget.

**Counters:** dispatches: 0/5 (delivered) · burned: 0 · review-bundles: 0 · review-dispatches: 0 · fix-cycles: 0/1 · oracle: 0 · worker-retries: 0 · direct-edits: 0

**Documentation:** pending

## Conventions

- Shared Pi development tooling is resolved from `~/.pi/agent`; do not install local compiler/test dependencies merely to obtain TypeScript or the test runner.
- `settings.json` contains a pre-existing unrelated modification. Never edit, restore, stage, or commit it in this run.
- Implementation workers do not commit. The orchestrator stages explicit paths and commits only after the outcome gate passes.
- Pi API work must follow installed `docs/extensions.md`, `docs/packages.md`, `examples/extensions/README.md`, and the closest shipped source examples; do not infer signatures from compiled internals.

## Gate log

- 2026-08-07 — Spec gate: `docs/specs/correctness-hardening.md` accepted by the user through authorization to create and implement M3.
- 2026-08-07 — Grill gate: offered; user selected skip.
- 2026-08-07 — Scope checkpoint: Standard / contained protected / local; user selected local delivery.
- 2026-08-07 — Pi harness documentation gate: read installed `docs/extensions.md`, `docs/packages.md`, `examples/extensions/README.md`, `examples/extensions/summarize.ts`, and `examples/extensions/tools.ts`.

## Deferred

- Streaming-update performance measurement and coalescing.
- Package-local settings persistence migration.
- TUI-only metadata footer rendering.
- Oracle streaming cosmetics that do not affect correctness.

## Handoff

No handoff yet. M3.1 is the active outcome; later outcomes remain intentionally undecomposed until M3.1 evidence is gated.
