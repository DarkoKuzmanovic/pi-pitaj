# pi-pitaj correctness hardening specification

**Status:** Shipped in v0.3.0 as Crew M3 on 2026-08-07 (`14316b8`, `e7541ae`, `fad8e49`, `b00b700`) — retained as implementation history
**Scope:** Correctness, privacy boundaries, Oracle evidence usefulness, accounting, and repository hygiene
**Non-goal:** Reopen retired full active-conversation forwarding

## Review evidence

Three requested reviewers completed independent whole-repository passes:

- `openai-codex/gpt-5.6-sol`
- `anthropic/claude-opus-5`
- `deepseek/deepseek-v4-flash`

`xai-auth/grok-4.5` was attempted twice. Both runs failed before model execution because xAI OAuth refresh returned HTTP 400. The failure is external to this repository, so this plan does not represent Grok findings.

Fresh baseline evidence:

- `npm test` — 204 tests passed, 0 failed.
- Strict manual TypeScript checking passed for product source.
- README anchor/fence check passed.
- Local probes confirmed the search false negative, truncation-cap overrun, password-type false positive, invalid fractional evidence-budget escalation, and `defaultMode: "oracle"` acceptance.
- Installed Pi documentation confirms nested LLM usage should be returned from a custom tool as `usage`, and Google-compatible string enums must use `StringEnum` rather than `Type.Union(Type.Literal(...))`.

## Triage

| Priority | Finding | Outcome |
|---|---|---|
| P0 | Oracle search can return false “no matches” after scanning irrelevant files | Fix first |
| P0 | `oracleRoot` is validated as a Git root but not constrained to the active workspace | Make and implement the trust-boundary decision first |
| P1 | Secret scanning rejects ordinary TypeScript such as `password: string` | Fix |
| P1 | Oracle evidence operation enum is incompatible with Google providers | Fix |
| P1 | Config permits `defaultMode: "oracle"`, breaking bare consults | Fix |
| P1 | `truncateText` exceeds advertised output/context caps | Fix |
| P1 | `/pitaj auto --risk` parsing mutates quoted context or literal question text | Fix |
| P1 | Nested sidecar token/cost usage is absent from Pi session accounting | Fix |
| P1 | Oracle budget exhaustion discards all prior paid work | Change to bounded graceful degradation |
| P1 | `git_diff` omits staged changes and fails opaquely above 256 KB | Fix |
| P2 | Whole-snapshot truncation metadata uses substring inference | Fix |
| P2 | Failed consult and context metrics can be inaccurate | Fix with accounting work |
| P2 | Fractional evidence-request overrides expand to the maximum | Reject at schema and runtime boundaries |
| P2 | Lockfile version and verification scripts have drifted | Fix |
| Later | Streaming updates, package-local settings persistence, binary search handling | Reassess after correctness work |

## Decisions locked for implementation

### D1 — Constrain Oracle evidence to the active workspace

**Choice:** `oracleRoot` must equal the canonical Git top-level containing `ctx.cwd`. A model-supplied path to another repository is rejected even when it is a valid Git root.

**Why:** This is deterministic, headless-safe, and makes “approved repository” mean the repository the active Pi session is operating in. It removes cross-project data egress without introducing session caches or confirmation state.

**Alternatives rejected for now:**

- UI confirmation per root: unavailable in headless use and adds session-state semantics.
- Arbitrary valid Git root: current behavior; too broad for a model-provided tool argument.
- Persistent allowlist: unnecessary configuration and a wider long-term trust surface.

**Revisit condition:** A concrete cross-repository Oracle workflow that cannot be served by starting Pi in the target repository.

### D2 — Enumerate search candidates through Git

**Choice:** Replace recursive filesystem-first enumeration with `git ls-files -co --exclude-standard -z`, optionally narrowed to the requested root-relative directory. Retain all existing deny, symlink, regular-file, size, secret-scan, result, and aggregate-budget checks.

**Why:** The approved root is already guaranteed to be a Git root. This skips ignored dependency/build trees, includes tracked and non-ignored untracked work, and avoids false negatives caused by the 64-file depth-first cutoff.

### D3 — Degrade gracefully when Oracle evidence is exhausted

**Choice:** When the evidence cap is reached, append one refusal tool result, disable tools, and run one final model round using evidence already gathered. Mark exhaustion in result details and the displayed footer.

**Why:** Failing the entire consultation throws away up to nine provider round trips. A forced final answer preserves the hard evidence boundary without wasting prior work.

### D4 — Define `git_diff` as tracked staged plus unstaged changes

**Choice:** Use `git diff HEAD --no-ext-diff --no-textconv` for both path preflight and content. Explicitly document that untracked files are excluded.

**Why:** This matches the ordinary meaning of a working-tree diff while preserving a bounded, auditable Git operation.

## Implementation sequence

### Oracle evidence correctness and trust boundaries

#### Fix repository search coverage

**Files:** `oracle.ts`, `oracle.test.ts`, `README.md`

- Replace `collectSearchFiles()` recursive enumeration with the D2 Git candidate list.
- Preserve root-relative path filtering and reject/skip denied or unstable paths before reading.
- Keep the 100-match output limit, but distinguish match-limit truncation from candidate-enumeration failure.
- Never return unqualified `(no approved matches)` when candidate enumeration failed or was cut short.
- Add a bounded binary-file guard, such as refusing/skipping a file containing a NUL byte in its initial sample.

**Tests:**

- A repository containing more than 64 ignored/dependency files plus one source match finds the source match.
- A non-ignored untracked source file is searchable.
- A requested subdirectory is respected.
- Denied, symlinked, oversized, binary, and secret-bearing files remain undisclosed.
- Candidate enumeration failure returns an explicit bounded refusal, not a false no-match.

#### Enforce active-workspace Oracle root scope

**Files:** `index.ts`, `oracle.ts`, `oracle.test.ts`, `README.md`, `AGENTS.md`

- Derive the canonical Git top-level for `ctx.cwd` with a fixed-argument Git subprocess.
- Require the approved `oracleRoot` to equal that canonical root before the first provider request.
- Preserve the existing exact-Git-root, realpath, directory, and symlink checks.
- Replace wording that implies an unimplemented user-confirmation gate with the exact workspace-root rule.

**Tests:**

- Current workspace Git root succeeds.
- A subdirectory spelling of the same root normalizes correctly only through the documented input contract.
- A different valid Git repository is rejected before streaming.
- Missing, non-Git, symlinked, and non-root paths remain rejected.

#### Remove the password-type false positive

**Files:** `oracle-policy.ts`, `oracle-policy.test.ts`

- Narrow the password assignment pattern to value-looking literals rather than any four non-space characters.
- Keep strong refusal for quoted password literals and other existing secret patterns.
- Do not weaken private-key, AWS, GitHub-token, API-key, or bearer-token checks.

**Tests:**

- `password: string;` and equivalent interface/type declarations are safe.
- Quoted password assignments remain refused.
- Object literals, JSON, YAML, and environment-style assignments have explicit positive/negative cases.

#### Make the evidence schema provider-compatible

**Files:** `oracle.ts`, `oracle.test.ts`

- Replace `Type.Union(...Type.Literal(...))` for `operation` with Pi’s documented `StringEnum` helper.
- Keep the four-operation list sourced from `ORACLE_EVIDENCE_OPERATIONS`.

**Tests:**

- Serialized schema is `{ type: "string", enum: [...] }` for `operation`.
- Existing ordinary and Oracle consult tests remain green.

### User-visible contracts and accounting

#### Prevent Oracle from becoming the default mode

**Files:** `helpers.ts`, `index.ts`, `settings.test.ts`

- Introduce a distinct list/type guard for modes valid as defaults, excluding `oracle`.
- Filter the config UI choices through that list.
- Reject persisted or interactive `defaultMode: "oracle"` input with a clear recovery message.
- Keep explicit tool-call `mode: "oracle"` support unchanged.

**Compatibility decision:** Treat an existing persisted `defaultMode: "oracle"` as invalid and fall back safely with a warning rather than bricking every consult.

**Tests:** config update rejection, malformed persisted fallback, ordinary default modes, and explicit per-call Oracle mode.

#### Make text caps exact

**Files:** `helpers.ts`, `helpers.test.ts`, `consult-behavior.test.ts`

- Budget the truncation marker inside `maxChars`, matching the existing Oracle and snapshot truncators.
- Define behavior for caps too small to contain the full marker.
- Report `answerChars` and manual `contextChars` from the bounded text actually returned/sent.

**Tests:** table-driven lengths from 0/1 through normal limits; every result must satisfy `result.length <= cap`.

#### Parse `--risk` through the quote-aware command parser

**Files:** `helpers.ts`, `index.ts`, `parsing.test.ts`, `auto-routing.test.ts`

- Add structured `risk` parsing to `parseCommandArgs()` or a dedicated quote-aware auto parser.
- Consume only top-level `--risk low|high` tokens.
- Preserve literal `--risk high` text inside quoted context and ordinary questions.
- Define duplicate-flag behavior explicitly; recommended: reject duplicates.

**Tests:** normal flag use, quoted context, literal question text, duplicate flags, missing value, invalid value, and mixed flag ordering.

#### Return nested LLM usage to Pi

**Files:** `index.ts`, `consult-behavior.test.ts`, `oracle.test.ts`

- Accumulate `response.usage` across every stream round.
- Return combined usage from the registered `pitaj` tool result.
- Keep the extension’s coarse in-memory consultation counter separate; do not add pricing tables or persistent history.
- Ensure failed nested calls do not produce fabricated usage. Preserve any real usage available from completed rounds if Pi’s result/error contract permits it.

**Tests:** one-round consult usage, multi-round Oracle aggregation, missing/zero usage, and no double-counting.

#### Preserve an answer at evidence-budget exhaustion

**Files:** `index.ts`, `oracle.test.ts`, `README.md`

- Implement D3 with exactly one final tools-disabled round.
- Do not allow the model to request more evidence after exhaustion.
- Expose `exhausted: true` in Oracle details and a concise footer warning.
- Preserve abort/error/length stop semantics for the final round.

**Tests:** request-count exhaustion, aggregate-char exhaustion, final-round provider error, and proof that no host evidence operation runs after exhaustion.

### Diff behavior and metadata integrity

#### Make `git_diff` useful and bounded

**Files:** `oracle.ts`, `oracle.test.ts`, `README.md`

- Apply D4 to staged plus unstaged tracked changes.
- Raise subprocess buffer headroom above the 4,000-character disclosure cap, but keep a finite host-side limit.
- Convert max-buffer failures into an explicit bounded refusal instead of the generic host error.
- Continue preflighting every changed path before returning any diff content.

**Tests:** staged-only change, unstaged-only change, combined change, denied changed path, diff above 256 KB, and explicit untracked-file exclusion.

#### Track snapshot section ranges structurally

**Files:** `snapshot.ts`, `helpers.test.ts`

- Record rendered start/end offsets for each section during assembly.
- Determine whole-snapshot truncation from those ranges and the final cutoff.
- Remove `context.includes(renderSection(section))` as a structural test.

**Tests:** duplicate section text, a question embedding another section’s exact rendering, boundary cuts through headers/provenance/content, and unchanged metadata for fully included sections.

#### Preserve effective details on failures

**Files:** `index.ts`, `usage.ts`, `consult-behavior.test.ts`, `auto-routing.test.ts`

- Carry resolved model, alias, effective mode, brevity, risk, and route facts through a typed consultation error or a setup-result object.
- Record failure events from effective facts rather than raw-request fallbacks.
- Keep failed consults excluded from advisory budget thresholds.

**Tests:** failed default-model, explicit alias, auto-low, auto-high, auto-risk-check, auth failure, and provider failure.

### Boundary validation and repository hygiene

#### Reject fractional evidence limits

**Files:** `index.ts`, `oracle-policy.ts`, `oracle-policy.test.ts`, `oracle.test.ts`

- Make the public schema integer-only.
- Reject non-integers at runtime rather than converting them to the maximum budget.
- Keep clamping valid integers to the hard 1–9 range only where a trusted internal caller bypasses schema validation.

#### Restore package metadata consistency and a repeatable check gate

**Files:** `package.json`, `package-lock.json`, new `tsconfig.json` if needed, `README.md` or contributor docs if commands are documented

- Regenerate the lockfile so its root package version matches `package.json` (`0.2.0` during implementation; both bumped together to `0.3.0` for release).
- Add `typecheck` and `check` scripts using the shared Pi development toolchain; do not add local compiler dependencies unless required.
- Keep `npm test` unchanged as the focused test command.

**Required gate:**

```bash
npm test
npm run typecheck
npm run check
npm pack --dry-run --json --ignore-scripts
git diff --check
python3 "$HOME/.pi/agent/skills/readme-freshness-audit/readme_toc.py" README.md --check
```

## Deferred optimization opportunities

These are measurable but should not expand the first correctness pass:

1. **Streaming update churn:** `roundText += delta` and full-text `onUpdate` on every delta can become quadratic. Measure a long detailed answer before adding throttling/coalescing.
2. **Package-local settings persistence:** Git-installed package reconciliation may overwrite tracked `settings.json`. Decide whether settings should move to a stable user-data path only after migration and precedence semantics are specified.
3. **Oracle search syscall duplication:** Git-based candidate enumeration should reduce this naturally. Profile before further caching.
4. **Metadata footer in model context:** A TUI-only entry renderer could reduce context noise, but changing session-message behavior requires a separate product decision.
5. **Oracle round streaming cosmetics:** Reset `streamError` per round and decide whether partial text from tool-call rounds should remain visible.

## Risks and mitigations

1. **Search expansion leaks ignored or sensitive files.** Use Git’s tracked/non-ignored candidate set and retain every existing path/secret check.
2. **Workspace-root enforcement breaks intentional cross-repo consults.** Document the new invariant and require starting Pi in the target repo; do not add an implicit fallback.
3. **Secret-regex relaxation misses real credentials.** Add positive and negative fixtures before changing the pattern; keep refusal conservative.
4. **Usage aggregation double-counts provider rounds.** Sum only terminal `AssistantMessage.usage` once per stream result and test exact totals.
5. **Graceful exhaustion creates an unbounded extra loop.** Permit exactly one final tools-disabled stream call.
6. **Large diff buffers increase host memory pressure.** Keep a finite subprocess cap and return an explicit refusal above it.
7. **Parser changes regress ordinary `/pitaj` flags.** Extend the existing quote-aware parser rather than adding another raw regex.
8. **Snapshot range tracking drifts from rendering.** Produce rendered text and offsets in one assembly pass rather than reconstructing positions later.
9. **Config compatibility surprises existing users.** Warn and fall back when persisted Oracle default mode is encountered; never silently rewrite settings.
10. **Hygiene work accidentally captures the user’s current `settings.json` edit.** Stage and commit explicit paths only; treat `settings.json` as out of scope unless the user separately authorizes it.

## Completion criteria

- Every P0/P1 item has a regression test that failed before its fix.
- All required gates pass on the final tree.
- A fresh-context reviewer checks the complete uncommitted diff or explicit commit range.
- README and tool descriptions match actual root scope, search coverage, diff semantics, budget exhaustion, and accounting.
- Full active-conversation forwarding remains retired.
- `settings.json` is neither reverted nor included accidentally.

## Rollback

For an uncommitted implementation, restore only files owned by this plan:

```bash
git restore -- helpers.ts index.ts oracle.ts oracle-policy.ts usage.ts \
  helpers.test.ts consult-behavior.test.ts auto-routing.test.ts parsing.test.ts \
  settings.test.ts oracle.test.ts oracle-policy.test.ts package.json package-lock.json \
  README.md AGENTS.md
```

If `tsconfig.json` was newly created, move it to a recoverable temporary location instead of deleting broadly:

```bash
mv tsconfig.json /tmp/pi-pitaj-tsconfig-removed
```

Do not restore or stage `settings.json`. For partial rollback, revert the corresponding implementation area’s listed files and rerun the full required gate before continuing.
