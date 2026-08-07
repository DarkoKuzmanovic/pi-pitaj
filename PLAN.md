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
- **dispatches:** 12 delivered
- **burned:** 1
- **review-bundles:** 2
- **review-dispatches:** 5
- **worker-retries:** 1
- **compactions:** 2

## M3 — Correctness, privacy, accounting, and Oracle evidence hardening

- [x] **M3.1 — Make Oracle evidence complete within its declared bounds and enforce the active-workspace trust boundary**
- [x] **M3.2 — Make consultation parsing, defaults, truncation, accounting, and evidence exhaustion match their public contracts**
- [ ] **M3.3 — Make snapshot and failure metadata structurally accurate**
- [ ] **M3.4 — Restore package verification hygiene and reconcile the integrated documentation contract**

### M3.2 — Gated outcome

**Acceptance criteria**

- `oracle` remains an explicit per-call mode but cannot be persisted or selected as `defaultMode`; invalid persisted state falls back safely with a clear warning.
- Manual context and final answers never exceed their configured character caps. Truncation markers and provider-length warnings are budgeted inside the cap when they fit; tiny caps return a cap-sized prefix rather than overrunning. `contextChars` and `answerChars` report bounded text.
- `/pitaj auto --risk low|high` uses the quote-aware parser. Only top-level flags are consumed; quoted/literal question text survives; duplicate, missing, and invalid risk values are rejected.
- Nested model `usage` is aggregated across all completed stream rounds and returned through Pi’s registered tool result without fabricated or double-counted usage.
- Oracle evidence exhaustion appends one refusal result, performs exactly one final tools-disabled round, exposes `exhausted: true`, preserves terminal stop semantics, and executes no host evidence after exhaustion.
- Focused regressions and the full suite pass; README and AGENTS match shipped behavior.

**Runway**

- `settingsFromUnknown()`, config validation, and config-choice rendering own the default-mode boundary.
- `truncateText()`, `buildConsultUserText()`, and `finalizeConsultAnswer()` own exact text caps and bounded metadata.
- `parseCommandArgs()` and the `/pitaj auto` route own quote-aware risk parsing.
- `consultModel()` owns serial stream rounds, evidence exhaustion, and usage aggregation; the registered `pitaj` tool result is the Pi accounting boundary.
- Installed Pi `docs/extensions.md`, `docs/packages.md`, and `examples/extensions/summarize.ts` define nested model streaming and result usage.

**Current wave**

- [x] Add failing regressions for default-mode exclusion, exact caps, quote-aware risk parsing, nested usage aggregation, and graceful exhaustion.
- [x] Implement the smallest owning-boundary fixes in `helpers.ts` and `index.ts`.
- [x] Reconcile README and AGENTS with M3.2 behavior.
- [x] Run focused tests, full `npm test`, strict TypeScript for product plus changed tests, and `git diff --check`.
- [x] Run one fresh-context deep combined review; resolve blockers within the bounded Full-tier fix cycles.

**Counters:** dispatches: 4/8 (delivered) · burned: 1 · review-bundles: 1 · review-dispatches: 2 · fix-cycles: 1/2 · oracle: 0 · worker-retries: 1 · direct-edits: 0

**Documentation:** README and AGENTS cover default-mode exclusion, quote-aware risk parsing, exact caps, nested provider usage, and graceful Oracle exhaustion.

## Conventions

- Shared Pi development tooling is resolved from `~/.pi/agent`; do not install local compiler/test dependencies merely to obtain TypeScript or the test runner.
- `settings.json` contains a pre-existing unrelated modification. Never edit, restore, stage, or commit it in this run.
- `ROADMAP.md` gained a concurrent unrelated argument-completions idea during M3.1. Never edit, restore, stage, or commit that line in this outcome.
- Implementation workers do not commit. The orchestrator stages explicit paths and commits only after the outcome gate passes.
- Pi API work must follow installed `docs/extensions.md`, `docs/packages.md`, `examples/extensions/README.md`, and the closest shipped source examples; do not infer signatures from compiled internals.
- The failed first M3.2 worker left an in-scope, green partial baseline for default-mode exclusion, exact caps, and quote-aware risk parsing. Recovery work must preserve and audit it rather than restart or rewrite it.

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
- 2026-08-07 — M3.1 gated commit: `14316b8 feat(m3.1): harden Oracle evidence boundaries`; explicit outcome files only, with unrelated ROADMAP/settings changes left unstaged.
- 2026-08-07 — Protected-outcome checkpoint: M3.1 complete; M3.2 activated under the existing Full / contained-protected / local scope.
- 2026-08-07 — M3.2 worker failure: hard-lane Opus hit its output-token limit after 77 tool calls while implementing five contracts; classified as task breadth/model-output exhaustion. The partial default/cap/risk patch passes 257/257 tests. One retry is authorized with a narrower remaining contract and normal lane; 1 burned, 0 delivered.
- 2026-08-07 — M3.2 recovery worker: nested usage and graceful exhaustion completed on the green partial baseline; 263/263 tests, 1 delivered dispatch.
- 2026-08-07 — M3.2 supervisor check: unmatched sibling tool calls after the single exhaustion refusal would violate Anthropic/OpenAI history protocols. Locked minimal fix: filter the persisted assistant turn to text plus only tool calls that received results. Independent strict TypeScript also exposed one new settings assertion error and three known helper-test strictness errors now inside a changed test file; all must be clean before review.
- 2026-08-07 — M3.2 protocol follow-up: persisted assistant history now keeps only tool calls with matching results; multi-call exhaustion regression added; strict changed-test errors cleared. Independent verification: 264/264 tests, exact strict TypeScript command, and diff check passed.
- 2026-08-07 — M3.2 documentation reconciliation: README and AGENTS now cover all five contracts; diff, fence, and internal-anchor checks passed; 1 delivered dispatch.
- 2026-08-07 — M3.2 deep review: two blockers found. Quoted standalone `"--risk"` tokens lose quote metadata and are consumed as syntax; invalid persisted-default warnings remain hidden from registered-tool content. Caps, usage, exhaustion, full tests, strict TypeScript, and diff checks otherwise passed. One fix cycle returned to the recovery worker.
- 2026-08-07 — M3.2 fix-back: quote metadata now survives standalone quoted `"--risk"` tokens, and persisted settings warnings are visible in registered-tool content. Focused 47/47 and full 266/266 tests, strict TypeScript, and diff check passed; 1 delivered dispatch.
- 2026-08-07 — M3.2 final deep recheck: both former counterexamples passed, real unquoted risk routing remained correct, and cap, usage, and Oracle exhaustion contracts stayed green. Reviewer verdict APPROVE after focused 210/210, full 266/266, strict TypeScript, and scoped diff check; 1 review dispatch.
- 2026-08-07 — M3.2 gate passed under Full-tier ceremony after one bounded fix cycle; explicit outcome files committed with unrelated ROADMAP/settings changes left unstaged.

## Deferred

- Streaming-update performance measurement and coalescing.
- Package-local settings persistence migration.
- TUI-only metadata footer rendering.
- Oracle streaming cosmetics that do not affect correctness.

## Handoff

M3.1 is gated at `14316b8`. M3.2 is gated by the `feat(m3.2): harden consultation contracts` commit. M3.3 is next: make snapshot and failure metadata structurally accurate. Unrelated `ROADMAP.md` and `settings.json` changes remain unstaged and excluded.
