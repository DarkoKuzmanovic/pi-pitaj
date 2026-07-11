# pi-pitaj 0.2.0 — Oracle-lite Release Plan

**Status:** Released as `v0.2.0` on 2026-07-11; GitHub release published, rollback tag `v0.1.1` retained
**Started-at:** 2026-07-11T11:28:16+02:00
**Scope tier:** Standard
**Risk class:** Protected — filesystem evidence, prompt-injection exposure, and public release gates
**Target:** GitHub tag/release `v0.2.0`; npm publication is out of scope

## Scope decision

This is a bounded, single-repository release with a resolved architecture and four outcome boundaries. It is **Standard**, not Full: no multi-repo work, no unresolved architecture fork, and no broad UX bundle. The protected risk is handled with explicit root-policy and evidence-loop gates rather than ceremony or per-task reviews.

The orchestrator owns this tier decision. No planner dispatch is required before the first implementation slice because the relevant source surface is known; a fresh reviewer is required at the protected boundary and again before release.

### User-approved release choices

- Ship **Oracle-lite only** in this version; the additional UX improvements from `UX_IMPROVEMENTS_PLAN.md` are deferred.
- Release as **0.2.0**.
- Publish through the existing GitHub source with a reviewed commit, a pinned tag, and a GitHub release; clarify the unpinned branch behavior in README.
- Keep the package private; do not add npm publication in this release.

## Dirty-worktree baseline (must be reconciled before release work)

Captured before planning, against `main...origin/main`:

- Deleted: `.pi/agents/pi-pitaj.opus-medium-reviewer.md`.
- Modified: `.pi/pmti/tasks/m4-b1-auto-and-test-split/brief.md` (reviewer name changed to generic `Request reviewer`).
- Modified: `README.md` (adds a `CHANGELOG.md` link).
- Modified: `package.json` (working-tree version `0.1.1`; `HEAD` is `0.1.0`).
- Modified: `settings.json` (alias changes/additions).
- Untracked: `CHANGELOG.md` containing the 0.1.1 history and prior milestone notes.
- Post-capture planning artifact owned by this Crew run: `PLAN.md`. It is not part of the pre-existing baseline; retain it as Crew state and commit it separately after the baseline tag and before O1.

These changes predate Oracle-lite planning and are not automatically part of the Oracle-lite diff. The package metadata and changelog observed during orientation may therefore be uncommitted release work, not baseline repository facts.

**Baseline gate (O0):** inspect ownership and intent for every pre-existing item above; do not restore, discard, or stage any of them implicitly. First reconcile accepted release work into a distinct `0.1.1` baseline commit, without staging Oracle files, and verify the current suite plus `package.json` `0.1.1`/`private: true`, README, and changelog. With explicit user approval, create and push `v0.1.1` at that baseline commit; the remote tag is the concrete rollback/install ref, and a GitHub release page for the baseline is optional. Then commit `PLAN.md` separately as Crew state. O1 starts only after both commits leave a clean tree. If the baseline is not accepted or `v0.1.1` cannot be published, stop and use the existing `v0.1.0` only after verifying that ref; never describe an uncommitted 0.1.1 as rollback.

## Product contract

### Goal

Add an explicit `mode: "oracle"` consultation path in which the sidecar can request a small amount of bounded, read-only evidence from the host, while remaining unable to run arbitrary shell commands, choose models, access Pi tools, write files, or recursively spawn another consultant.

When the sidecar cannot answer from evidence and needs an action outside its capability, it returns the structured `PITAJ_NEEDS_HOST_ACTION` protocol. The host/main model decides whether to perform that action and may start a fresh bounded consultation with the result.

### Non-goals for 0.2.0

- No recursive `pitaj_second_opinion` mode; that is a later one-hop experiment.
- No arbitrary shell, process execution, network access, file writes, raw access to denied sensitive artifacts, full-transcript capture, or persistence of Oracle state.
- No automatic host-action execution or hidden retry loop.
- No new unrelated slash-command UX, alias-management work, or snapshot-preview bundle.
- No npm publication, registry metadata, or package-name migration.
- No guarantee against a concurrently attacker-writable checkout; Oracle-lite assumes the approved root is not modified by an attacker during consultation.
- Sensitive-path denial and content scanning are conservative mitigations, not complete secret detection; a non-denied path is not proof that it contains no secret.

## Oracle-lite contract and invariants

1. **Explicit root:** `oracleRoot` is required for Oracle mode. There is no `ctx.cwd` fallback. The host normalizes and approves the root before any evidence operation; the sidecar never receives a root selector.
2. **Repository boundary under a stable-checkout assumption:** the approved root must be an exact project/repository root (not an arbitrary descendant). Canonical-path checks reject traversal and deterministic symlink escapes outside that root; they are not a defense against a concurrent filesystem attacker.
3. **Sensitive-material deny policy:** before every operation, canonicalize the root and every candidate path using `realpath` plus ancestor `lstat` checks. These are correctness and defense-in-depth guards under the stable-checkout assumption. Reject traversal, symlink escapes, `.git`, and case-insensitive denied path names/components including `.env*`, `.npmrc`, `.netrc`, `.aws`, `.ssh`, `.docker`, `credentials*`, `secret*`, `token*`, `password*`, `*private*key*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, and `id_ed25519`. `list_files` hides denied entries; `read_file`, `search`, and `git_diff` reject or filter them. Scan every returned text/diff hunk for common private-key, API-token, and credential-assignment patterns; redact or refuse before the sidecar sees it. If safety cannot be proven, refuse the operation. Denylist and redaction are mitigations, not complete secret detection.
4. **Read-only evidence:** the virtual tool exposes only `read_file`, `search`, `list_files`, and `git_diff`. All operations are host-mediated and use fixed argument forms; no shell strings are accepted. `git_diff` runs at the approved root and applies the same per-path and output-redaction policy, including deleted or renamed paths that have no current filesystem target.
5. **Bounded budget:** maximum three evidence requests per consultation, maximum 4,000 characters per result, maximum 12,000 characters total. The fourth request is refused deterministically. Invalid and refused requests still consume the request budget.
6. **Capability honesty:** the Oracle prompt and virtual tool schema state the exact evidence operations and restrictions; result details state the read-only capability, request/usage caps, and that host actions are not automatic.
7. **Protocol honesty:** unsupported requests produce a machine-detectable `PITAJ_NEEDS_HOST_ACTION` marker with the requested action and reason, without pretending that the action ran.
8. **Compatibility:** calls that omit `mode: \"oracle\"` retain the existing model routing, context handling, budgets, display, and error semantics.
9. **No ambient authority:** the sidecar cannot select a model, change `oracleRoot`, call Pi tools, invoke the host adapter directly, or ask for another Pitaj model.

### Filesystem threat model

Oracle-lite protects against sidecar-supplied traversal, deterministic symlink escapes, denied paths, and accidental reads under a stable approved checkout. It does **not** claim to defend against another process concurrently swapping directories/symlinks or hardlinking content while a read is in flight. The host must not enable Oracle on a checkout that is concurrently attacker-writable. `read_file` must use a leaf `O_NOFOLLOW` open, `fstat` the descriptor as a regular file within the size bound, and read from that descriptor; ancestor `realpath`/`lstat` remains defense-in-depth. Full per-component `openat`-style atomic traversal would require a separate platform/native-dependency decision and is deferred to a later hardening release. Tests must prove deterministic escapes and leaf no-follow behavior without implying full concurrent-swap resistance.

## Outcome map and gates

### O0 — Reconcile the existing baseline

**Depends on:** none

- Identify the owner and intended commit boundary for every dirty file listed above; ask before touching an ambiguous deletion or unrelated change.
- Preserve unrelated work; never use reset, checkout, stash, or broad staging to manufacture a clean tree.
- Commit/tag the accepted 0.1.1 baseline first, then commit `PLAN.md` separately, and record both refs before implementation begins.

**Gate:** accepted baseline is committed and remotely tagged as `v0.1.1` (or an explicitly verified `v0.1.0` fallback), `PLAN.md` is owned by this run, and the post-O0 tree is clean. If ownership or publication approval is ambiguous, stop and ask before implementation.

### O1 — Define and test the Oracle contract

**Depends on:** O0

- Add the public Oracle request shape (`mode`, required `oracleRoot`, bounded evidence settings if any) without weakening the existing request schema.
- Add pure policy/types for operation validation, request accounting, result truncation, root-relative path validation, sensitive-path denial/content redaction, and `PITAJ_NEEDS_HOST_ACTION` parsing/formatting.
- Keep model resolution outside the sidecar-controlled schema; Oracle mode uses the existing selected/auto-routed model path.
- Add focused tests for normal-mode compatibility, all four operations, budget edges (3 succeeds/4 refuses), result and total caps, traversal/deterministic symlink rejection on every operation, leaf `O_NOFOLLOW`/regular-file checks, denied sensitive names, secret-pattern redaction/refusal, malformed requests, and protocol round trips.

**Gate:** protected review of root and budget invariants; all focused tests green.

### O2 — Implement the host evidence adapter and bounded model loop

**Depends on:** O1

- Implement a small host-owned adapter (prefer a dedicated `oracle.ts`/`oracle-evidence.ts` module rather than expanding `index.ts`) that performs only the four approved read-only operations and applies the deny policy consistently.
- Use `realpath` plus ancestor `lstat` checks for every operation and every returned path as defense-in-depth under the stable-checkout assumption. `read_file` must open the leaf with `O_NOFOLLOW`, `fstat` a regular file within the size bound, and read from the descriptor; apply fixed `fs`/`git` argument boundaries, denied-path filtering, and bounded traversal/output; never construct a shell command from sidecar text and must not claim protection from concurrent mid-path swaps.
- Wire Oracle mode to the Pi model stream/tool-call loop with a serial, hard-capped evidence budget and deterministic refusal on exhaustion.
- Ensure tool results are bounded and secret-pattern scanned/redacted or refused before they enter the sidecar context; failures identify the host-side reason without leaking absolute paths or sensitive content.
- Preserve stream stop-reason/error behavior already used by ordinary consults.

**Gate:** protected review of the adapter/loop and its stable-checkout threat model, including adversarial attempts to escape the root, swap a deterministic symlink, request a fourth call, or smuggle shell syntax; integration tests prove leaf no-follow behavior without overstating concurrent-swap resistance, plus the existing suite green.

### O3 — Expose the host-action continuation and document the capability boundary

**Depends on:** O2

- Return a stable answer/result shape for Oracle completion, evidence refusal, provider failure, and `PITAJ_NEEDS_HOST_ACTION`.
- Document how the main model handles a host-action marker: inspect it, decide whether the user-authorized action is appropriate, perform it outside Pitaj, and re-consult with bounded output if needed.
- Update README capability and installation sections without implying that normal Pitaj calls gain file access; recommend the pinned `pi install git:...@v0.2.0` ref and explain that the unpinned `git:` form follows the default branch.
- Add the 0.2.0 changelog entry only after behavior and tests are settled; keep the pre-existing 0.1.1 history intact.
- Do not add a silent default root or a hidden auto-action path.

**Gate:** fresh-context reviewer verifies documentation matches actual schemas and that ordinary mode output still advertises no file access.

### O4 — Reconcile, verify, and prepare the GitHub release

**Depends on:** O0, O3

- Reconcile any remaining pre-existing changes separately from the Oracle-lite diff; stage explicit paths only, and verify O0's remote rollback tag before release work proceeds.
- Set `package.json` to `0.2.0` and ensure README/changelog/package metadata agree. Keep `private: true`, the verified GitHub source, and a pinned `@v0.2.0` install instruction.
- Verify the dependency boundary required by Pi's git install (`npm install --omit=dev`): Oracle-lite adds no runtime dependency; `dependencies` must remain empty unless a new runtime import proves otherwise, and peer dependencies must remain intentional. Then run the real test command, strict typecheck/load smoke check if available, and whitespace/diff checks.
- Treat the release commit pushed to `main` as the go-live for unpinned installers; create `v0.2.0` at that same commit for exact installs and verify both remote refs. Inspect `git diff`/`git status` immediately before commit.
- Obtain explicit user approval before pushing the release commit/tag. Then push `main`, create/push `v0.2.0`, publish the GitHub release, and record the commit/tag plus pinned install and rollback commands in the completion receipt.

**Gate:** all verification commands green, no unowned changes, fresh release review signed off, and explicit publish approval.

## Verification matrix

- Existing test suite remains green before and after Oracle changes.
- Pure policy tests cover root, traversal, deterministic symlink escape, leaf `O_NOFOLLOW`/regular-file checks, operation, sensitive-path denylist, redaction/refusal, budget, truncation, and marker boundaries.
- Integration tests prove the sidecar can use approved evidence but cannot execute arbitrary host actions, select a new model/root, escape via deterministic symlinks, or receive denied sensitive artifacts; they do not claim defense against a concurrently attacker-writable checkout.
- Regression tests prove ordinary tool/slash-command/snapshot/auto/advise paths remain behaviorally unchanged.
- Manual smoke test loads the extension through Pi and exercises one Oracle consultation against an approved repository root.
- Release checks validate `v0.1.1` rollback and `v0.2.0` release refs, pinned and unpinned install wording, version/changelog heading, `private` status, dependency boundary under `--omit=dev`, clean status, explicit staged paths, and tag target.

## Review and speed metrics

- `dispatches: unavailable` — the run-level counter was not maintained during O1–O3; record this as a process gap rather than inventing a value.
- `time-to-first-worker: unavailable` — the first-worker timestamp was not recorded when implementation began.
- `review-bundles: 3 documented in the session handoff` — O1 contract, O2 adapter/loop, and O3 documentation reviews each recorded SHIP. O4 release verification completed with 202 tests, strict TypeScript, tag, and GitHub release checks.
- Reviews are outcome-boundary bundles, not one review per task. Unstarted work may be collapsed if new evidence reduces the scope; no started outcome is silently rewritten.

## Rollback

Before release, normal Pitaj behavior is the compatibility fallback: do not use `mode: "oracle"`. O0 must make `pi install git:github.com/DarkoKuzmanovic/pi-pitaj@v0.1.1` resolve to the reconciled baseline; if O0 uses the verified existing `v0.1.0` fallback instead, document that exact ref. `@v0.2.0` is the exact release ref, while an unpinned `git:` install follows `main`. If implementation is unsafe, revert only Oracle-owned commits and instruct users to reinstall the pinned prior tag. If a GitHub release has already been published, mark 0.2.0 withdrawn and delete its tag only with explicit user approval and a recorded reason.

## Open release decision

The implementation plan is approved for planning, but no code implementation, commit, push, tag, or GitHub release is authorized by this document alone. The baseline ownership gate and final publish approval remain mandatory.
