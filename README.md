# pi-pitaj

A tiny [Pi](https://github.com/earendil-works/pi-coding-agent) extension for in-session AI-to-AI consultation.

Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## Contents

- [What it does](#what-it-does)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Snapshot consults](#snapshot-consults)
- [Tool usage](#tool-usage)
  - [Auto-routed call](#auto-routed-call)
  - [Explicit model calls](#explicit-model-calls)
  - [Oracle call](#oracle-call)
  - [Auto command](#auto-command)
  - [Advise command](#advise-command)
- [Config command](#config-command)
  - [Parameters](#parameters)
- [Oracle mode](#oracle-mode)
  - [Evidence tool operations](#evidence-tool-operations)
  - [What Oracle mode cannot do](#what-oracle-mode-cannot-do)
  - [Host-action continuation](#host-action-continuation)
  - [Stable-checkout threat model](#stable-checkout-threat-model)
  - [Failure behavior](#failure-behavior)
- [Settings](#settings)
  - [Usage summary](#usage-summary)
  - [Advisory budget warnings](#advisory-budget-warnings)
  - [Sidecar model limitations](#sidecar-model-limitations)
  - [Result block format](#result-block-format)
- [Testing](#testing)
- [Files](#files)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What it does

`pi-pitaj` adds:

- `pitaj` tool: call another configured model from an existing Pi flow.
- `/pitaj` command: ask a model directly from chat using a compact prompt.

It supports aliases, bounded context + output size, built-in response modes, nested-model usage accounting, in-session usage tracking, and advisory budget warnings so you can stay aware of how many consults you have sent.

## Installation

From Pi, install this extension from GitHub:

```bash
# Exact 0.3.1 release (recommended for reproducible installs)
pi install git:github.com/DarkoKuzmanovic/pi-pitaj@v0.3.1

# Or follow the default branch (main) for the latest unreleased state
pi install git:github.com/DarkoKuzmanovic/pi-pitaj

# Roll back to the 0.3.0 correctness baseline
pi install git:github.com/DarkoKuzmanovic/pi-pitaj@v0.3.0
```

`git:` installs with no `@ref` follow the repository's default branch (`main`). Use an `@v...` tag when you want a pinned, reviewed release.

Then restart Pi.

## Quick start

```text
/pitaj Are we shipping this with minimal change?
/pitaj opus  Give me a quick architecture risk check
/pitaj opus47 Should we rework this flow?   # alias support
/pitaj snapshot Should we proceed with this bounded context?
/pitaj snapshot opus --mode risk-check --brevity detailed Is this safe?
/pitaj aliases  # show available aliases
/pitaj models   # same as aliases (for quick config check)
/pitaj config  # show or edit pitaj settings (UI mode); /pitaj config show is summary-only
/pitaj help   # show extension usage
```

If you run `/pitaj` with no question and UI support is enabled, Pi opens an editor prompt for longer questions.

## Snapshot consults

Use `/pitaj snapshot` when the sidecar needs more than a bare question but you do not want to paste a large transcript manually:

```text
/pitaj snapshot Should we keep this implementation boundary?
/pitaj snapshot opus --mode risk-check --brevity detailed Are there hidden architecture risks?
```

Snapshot mode wraps the existing `/pitaj` consult path. It builds a compact, bounded context block and passes it as `context` to the selected model. The sidecar still has no Pi tools and only sees the generated snapshot plus your question. Oracle mode is separate: it requires an explicit `oracleRoot` equal to the active workspace repository root and exposes only the bounded, read-only `pitaj_request_evidence` tool.

A snapshot can include:

- your current question;
- a recent user request when safely available from bounded leaf-entry traversal;
- recent tool results from the in-extension bounded `tool_execution_end` ring buffer;
- active-plan or risk notes only when explicitly supplied by the runtime seam/custom inputs;
- provenance, omission, and truncation metadata so missing or cut context is visible.

Snapshot mode deliberately excludes:

- full-branch or full-transcript capture;
- unbounded session scraping;
- sidecar access to read/grep/bash or other Pi tools;
- a direct `pitaj` tool-schema snapshot parameter.

Use the regular `pitaj` tool with explicit `context` when you already know the exact excerpt to send. Use `/pitaj snapshot` when you want the extension to assemble the approved bounded context sources for a slash-command consult.


### Ambient versus explicit snapshot context

Snapshot capture is intentionally split into two policies. Ambient capture is limited to the bounded recent-user traversal and the reactive `tool_execution_end` ring buffer. Those automatic sources are classified over the **complete** logical source — every text part of a multipart message and the whole tail, before any truncation — and only then bounded and retained. A possible secret replaces the entire source with `[snapshot source omitted: possible sensitive material]`, without naming the detector, secret, or line, so a secret past the retained prefix cannot be cut away and forgotten. The full source exists only as a temporary value for that one classification pass; the ring buffer and the built snapshot retain only bounded, already-classified text. The explicit question and caller-provided `context` are opt-in material and are not scanned or silently rewritten. This is a conservative mitigation, not a guarantee that a non-matching excerpt contains no sensitive data.
Generic tool-result fallbacks inspect every complete top-level string before choosing their bounded rendered summary, so a sensitive tail or later field still omits the entire automatic source.

When an automatic source is safe but longer than its cap, the retained prefix is followed by a marker whose omitted-character count is exactly the complete source length minus the retained prefix length. The marker is budgeted inside the cap, and a cap too small to hold any body returns the bounded marker alone.

## Tool usage

You can also call the registered tool directly:

### Auto-routed call

```json
{
  "model": "auto",
  "risk": "low",
  "mode": "debug",
  "question": "Is this TypeScript narrowing approach sound?",
  "context": "Relevant code excerpt here"
}
```

### Explicit model calls

```json
{
  "model": "opus",
  "mode": "risk-check",
  "question": "Any edge cases for user-entered regex input?",
  "context": "Feature: bulk upload validation",
  "brevity": "short"
}
```

```json
{
  "model": "terra",
  "mode": "debug",
  "question": "Is this API usage pattern correct?"
}
```

**Note:** Auto-routing via `model: "auto"` is available through the tool schema and also via the `/pitaj auto` slash command. Snapshot mode is a slash-command path (`/pitaj snapshot ...`) and does not add a direct tool-schema snapshot parameter.

### Oracle call

```json
{
  "model": "opus",
  "mode": "oracle",
  "question": "Does this diff introduce a secret leak?",
  "oracleRoot": "/home/quzma/my-project"
}
```

### Auto command

Use `/pitaj auto` to route through the built-in auto-router instead of specifying a model or alias:

```text
/pitaj auto Is this TypeScript narrowing approach sound?
/pitaj auto --risk high Is this architecture safe?
/pitaj auto --risk low --mode debug Check this test assertion
```

Auto-routing dispatches based on the `--risk` hint (or the `/pitaj` `risk` field): low risk → GPT-style model; high risk → Opus-style model. When risk is omitted and mode is `risk-check`, it routes to Opus; otherwise defaults to GPT.

The `--risk` flag is parsed quote-aware. Only top-level `--risk low|high` flags are consumed for routing; quoted or literal text in the question or context is preserved. Duplicate, missing, or invalid risk flags are rejected.

The `auto` subcommand name is reserved and cannot be used as a settings alias.

### Advise command

Use `/pitaj advise` for a zero-flag advisory shortcut that wraps the curated snapshot builder:

```text
/pitaj advise Should we keep this implementation boundary?
/pitaj advise is this safe?
```

`/pitaj advise` accepts only a bare question. The flags `--mode`, `--brevity`, `-c`, and model-as-first-argument are rejected with a clear error. Use `/pitaj snapshot` if you need those options.

Advise builds context through the same curated snapshot path as `/pitaj snapshot` (recent request, tool-result ring buffer), but is limited to the existing sources — it adds no new capture. Results are labeled advisory. Usage is recorded with `hasSnapshot: true` and counts toward the existing snapshot budget threshold.

The `advise` subcommand name is reserved and cannot be used as a settings alias.

## Config command

Use `/pitaj config` to inspect or update extension settings from Pi. In non-UI contexts it prints the same compact effective-settings summary as `/pitaj config show`. In UI-capable sessions, `/pitaj config` opens a guided flow for common settings and writes only after showing a changed-fields summary and receiving confirmation.

Supported guided fields:

- `defaultModel`
- `autoRouteLow` and `autoRouteHigh` (alias names, not provider/model strings)
- `defaultMode`
- `defaultBrevity`
- `maxContextChars`
- `maxOutputChars`

`defaultMode` accepts only `answer`, `critique`, `debug`, `plan`, or `risk-check`. Oracle remains an explicit per-call mode. A persisted `defaultMode` of `oracle` or another invalid value falls back to `answer` and emits a warning.

Write safety rules:

- Missing `settings.json`: `/pitaj config` may create it after validation and confirmation.
- Cleanly parsed `settings.json`: `/pitaj config` may overwrite it after validation and confirmation.
- Malformed `settings.json`: `/pitaj config` refuses to overwrite and shows manual recovery guidance.
- Cleanly parsed files with an invalid known setting are readable with warning/fallback behavior, but `/pitaj config` refuses to carry that invalid field through an unrelated rewrite. Repair the named field manually, then reopen the config UI.
For model-related fields, validation is semantic: the merged `defaultModel` and every alias target must resolve as an alias or `provider/model`; normalized alias collisions and the reserved `auto`/`advise` names are refused.

Alias editing remains manual: edit `settings.json` directly, then run `/pitaj check`. Interactive config patches only the selected known field and preserves unknown root fields and raw aliases. Clear/default values delete only that selected field. The persistence layer rejects malformed, non-object, symlink, and non-regular sources. It reads the source through one `O_NOFOLLOW` descriptor, stats that descriptor on both sides of the read, and confirms the path still names the same device/inode afterwards, so a source truncated, rewritten, or swapped mid-read is refused instead of parsed. It compares source identity plus exact-content hash before the write and again immediately before rename; writes replacement bytes encoded once as UTF-8 into a fixed exclusive same-directory temp using byte offsets, so a partial write can never split a multi-byte character; fsyncs the temp, atomically renames it, and best-effort fsyncs the directory. A pre-existing temp file belongs to another writer: the exclusive create fails and that file is never deleted. It never retries a conflict. The existing mode is reapplied to the temp descriptor after the exclusive create, so an inherited mode survives a restrictive umask, and new files are exactly `0600`. Settings remain at the package-local `settings.json` path in 0.3.1; this release performs no migration.

### Parameters

- `question` **required**
- `model` optional: a configured alias (`opus`, `opus47`, `fable`, `terra`, `sol`, `deepseek`, `gpt`, `glm`, `spark`, `mm`), explicit `provider/model`, or `auto` for built-in routing.
- `risk` optional: `low` or `high`. Only used when `model` is `auto`. `low` = bounded technical question; `high` = architecture, security, data integrity, or hard-to-reverse decision.
- `mode`: `answer` | `critique` | `debug` | `plan` | `risk-check` | `oracle`; `oracle` is explicit per-call only
- `context` optional bounded supporting context. In ordinary modes pitaj is a sidecar consult without tools — it cannot inspect files unless you provide context.
- `brevity`: `short` | `normal` | `detailed`
- `maxContextChars` optional exact cap for context characters sent (1..64,000); truncation markers count toward the cap and invalid/non-finite/non-integer/zero/oversize values are rejected.
- `maxOutputChars` optional exact cap for answer characters returned (1..16,000); truncation and provider-warning markers count toward the cap and invalid/non-finite/non-integer/zero/oversize values are rejected.
- `oracleRoot` required when `mode` is `oracle`: exact path to a Git repository root. It must equal the canonical Git top-level of the active Pi workspace (the repository containing the session's working directory). A different repository is rejected before any model request, and there is no cwd fallback.
- `maxEvidenceRequests` optional when `mode` is `oracle`: override the evidence-request cap with a whole number (1..9; default 9). A fractional or non-finite value is rejected rather than expanded.

Provider usage is separate from `/pitaj usage`'s coarse in-session counters. When available, the registered tool's top-level `usage` reports nested-model usage aggregated once per completed stream round, including Oracle tool rounds; missing or zero-usage rounds are not fabricated.


The active runtime resolves `ctx.modelRegistry.getProvider(model.provider)?.streamSimple`, so custom providers use their registered public streaming implementation. Authentication is resolved with `getApiKeyAndHeaders(model)`; `ok: true` is sufficient for OAuth or other keyless providers, and optional `apiKey`/`headers` are forwarded only when present. A missing provider or streaming implementation fails loudly. Provider `maxTokens` is a token-generation ceiling: short/normal/detailed request 2,048/4,096/8,192 tokens. It is distinct from the local `maxOutputChars` answer-character cap (1..16,000); tokens and answer characters are not interchangeable.

Command parsing uses one quote-aware lexer. JavaScript whitespace separates unquoted tokens; only escaped double quotes and backslashes are decoded. Quoted aliases, provider/model references, flags, and risk text remain literal, duplicate recognized flags are rejected, and unbalanced quotes use a deterministic raw-token fallback. Advise and special-command classification use the same lexical provenance, and special-command **execution** consumes the very tokens classification produced: `/pitaj usage\treset` resets counters, `/pitaj config\tshow` prints the summary, and a quoted `"reset"` or `"show"` stays literal text rather than becoming syntax. `auto`, `advise`, and `snapshot` keep their raw argument text and are re-lexed by their own parsers, so quoting inside them is never lost.

Oracle path containment picks its POSIX or Win32 flavor from the host platform and the approved root alone — never from an untrusted candidate path. A POSIX root keeps POSIX semantics even when a candidate filename contains a backslash, and a drive-letter or UNC root is treated as Win32 on any host. The selection helper is exported so Win32 and POSIX fixtures behave identically on any machine.

Budget defaults are hard caps enforced by the host adapter: 9 evidence requests per consultation, 4,000 characters per result, 18,000 characters total. When a request would exceed the request or aggregate-character cap, the host returns one bounded refusal, performs exactly one final model round without tools, marks `details.oracle.exhausted`, and adds a concise warning to the result footer.

## Oracle mode

`mode: "oracle"` gives the sidecar one bounded, read-only evidence tool: `pitaj_request_evidence`. The tool is host-mediated and operates only inside `oracleRoot`, which must be spelled out explicitly and must be the same repository the active Pi session is working in. There is no cwd fallback, no auto-selected root, and no interactive approval prompt: the workspace-root rule is the whole trust boundary. To consult about another repository, start Pi in that repository.

```json
{
  "model": "opus",
  "mode": "oracle",
  "question": "Is this diff introducing a secret leak?",
  "oracleRoot": "/home/quzma/my-project"
}
```

### Evidence tool operations

`pitaj_request_evidence` accepts exactly one of these operations:

- `read_file`: read a single regular file, root-relative path, capped at 256 KB before truncation.
- `search`: literal-text search over Git-listed candidates — tracked plus non-ignored untracked files (`git ls-files -co --exclude-standard`), optionally narrowed to a root-relative directory. Ignored dependency and build trees are never scanned. Binary candidates (a NUL byte in the initial sample) are skipped, matches are bounded to 100, and at most 500 repository files are examined per request. Candidates that cannot be safely read are skipped without exposing paths or causes, and the result explicitly says when the search is partial.
- `list_files`: list directory entries, bounded to 100 entries.
- `git_diff`: staged plus unstaged changes to tracked files at the approved root. Committed repositories use `git diff HEAD --no-ext-diff --no-textconv`; unborn repositories combine cached and unstaged tracked diffs. Per-path deny/traversal checks apply in both cases. Untracked files are excluded by definition; use `search` or `read_file` for those.

All paths are root-relative. Absolute paths, parent traversal (`..`), `.git`, and a conservative denylist of sensitive names are rejected. Each result is capped at 4,000 characters and aggregate evidence is capped at 18,000 characters. A 10th request is refused deterministically; the aggregate cap may stop an earlier request when prior results are large. You can override the request cap down to 1 with `maxEvidenceRequests`, but not above 9.
A structurally valid Oracle round that names an unsupported evidence tool is handled as a bounded refused request: no unknown host tool runs, the request consumes one evidence slot, and the refusal is returned to the sidecar so it can recover. This is distinct from a `toolUse` response with no tool call, or any `toolUse` response when Oracle tools are disabled; those protocol-invalid rounds fail terminally before usage is accepted.

Bounded operations report their own limits instead of pretending to be complete: a search that hits the candidate or match bound, or skips unreadable candidates, says so; a search whose Git candidate listing fails returns an explicit refusal rather than an empty no-match; and a diff whose finite aggregate Git output exceeds 256 KB returns an explicit refusal rather than a generic host error.

### What Oracle mode cannot do

- No shell commands, no file writes, no network access, no Pi tool access.
- No model selection inside the loop; the model is fixed by your initial call.
- No recursive Pitaj consultation.
- No automatic host actions.

### Host-action continuation

If the sidecar needs something it cannot do, its answer contains a structured marker:

```text
PITAJ_NEEDS_HOST_ACTION
action: run npm test
reason: verify the suite passes before we decide
```

The host or main model must decide whether that action is authorized, perform it outside Pitaj, and start a fresh bounded consultation with the result. Pitaj does not run the action for you.

### Stable-checkout threat model

Oracle-lite assumes the approved `oracleRoot` checkout is **not concurrently attacker-writable**. The adapter applies canonical-path checks, ancestor `lstat` defense-in-depth, and leaf `O_NOFOLLOW` opens with `fstat` verification to reject traversal and deterministic symlink escapes. It does **not** guarantee defense against concurrent mid-path swaps or hardlinks: do not point `oracleRoot` at a directory another process can modify during the consultation.

Sensitive-path denial and content scanning are conservative, case-insensitive mitigations. They are not complete secret detection: a non-denied path may still contain sensitive data. Password scanning refuses assigned credential-looking values (`password: "hunter2secret"`, `PASSWORD=hunter2secret`) while allowing type-only declarations such as `password: string;`.


Every Oracle Git subprocess removes every inherited `GIT_*` environment variable — matched case-insensitively, because Windows environment lookup ignores case and `git_dir` selects a repository exactly like `GIT_DIR` does — including repository-selection, configuration-injection, and program-executing variables. It re-adds only `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_CONFIG_NOSYSTEM=1`, and the platform null device for `GIT_CONFIG_GLOBAL`; argv also forces `--no-optional-locks` and `-c core.fsmonitor=false`. Residual trust is explicit: this bounds Git's own configuration and repository selection, but it does not sandbox the process. `PATH` remains inherited, so the resolved `git` executable and system Git installation are trusted; a hostile executable on `PATH` remains out of scope.

### Failure behavior

A consult that dies mid-stream is never returned as a normal answer:

- provider error or abort → the tool call fails loudly, with the provider's error message and how much partial text had streamed before the failure
- stream iterator throws → the round is dead immediately: the provider's own `result()` summary is never requested or awaited, no usage from that round is counted, no Oracle evidence runs, and no further round starts. The failure reports the thrown error and the partial character count
- unexpected `toolUse` in an ordinary or tools-disabled final round → rejected as an unavailable-tool protocol error before usage is accepted
- `result()` rejects → equally terminal, reported with the same bounded partial-character diagnostic
- provider stops at its max output tokens → the answer is returned but visibly marked `⚠ [pitaj: provider stopped at max output tokens — answer may be incomplete]`, and counted under `truncated answers` in `/pitaj usage`
- exact context/output caps → truncation markers and provider-warning text count toward the configured cap; tiny caps return a bounded prefix when a marker cannot fit
- Oracle evidence budget exhaustion → one bounded refusal is followed by one tools-disabled final round; the final round keeps normal abort, provider-error, and length-stop semantics
- misconfigured `autoRouteLow`/`autoRouteHigh` aliases → reported as a settings warning at load time, not on the first `auto` call

## Settings

`settings.json` is loaded from the extension folder.
The snippet mirrors the shipped aliases; aliases are editable and may differ in a local installation. Optional `autoRouteLow` and `autoRouteHigh` fields are supported but omitted here.

```json
{
  "defaultModel": "opus",
  "defaultMode": "answer",
  "defaultBrevity": "short",
  "maxContextChars": 12000,
  "maxOutputChars": 4000,
  "aliases": {
    "opus": "anthropic/claude-opus-4-8",
    "opus47": "anthropic/claude-opus-4-7",
    "fable": "anthropic/claude-fable-5",
    "terra": "openai-codex/gpt-5.6-terra",
    "sol": "openai-codex/gpt-5.6-sol",
    "deepseek": "deepseek/deepseek-v4-pro",
    "glm": "umans/umans-glm-5.2",
    "spark": "openai-codex/gpt-5.3-codex-spark",
    "mm": "minimax/MiniMax-M2.7-highspeed"
  }
}
```

### Usage summary

`/pitaj usage` shows a compact summary of your current-session consults:

```text
pitaj usage (current session)

total consults: 5
errors: 0
truncated answers: 0

routes:
  auto (low-risk): 3
  explicit (high-risk): 1
  snapshot: 1

models:
  gpt (openai-codex/gpt-5.5): 3
  opus (anthropic/claude-opus-4-8): 2

context source:
  none: 4
  snapshot: 1

budget:
  low-risk/GPT-style: 3 (warn at 3)
  high-risk/Opus-style: 1 (warn at 3)
  snapshot: 1 (warn at 5)

status: warning
warnings reached: low-risk

reset with /pitaj usage reset; counters also reset when the Pi session ends.
```

Counters reset automatically when your Pi session ends. To reset them manually:

```text
/pitaj usage reset
```

This clears all in-session consult counters and confirms with `pitaj usage counters reset`.

### Advisory budget warnings

pitaj tracks consults in-session and shows compact advisory guidance when thresholds are reached:

- **Low-risk/GPT-style:** after 3 low-risk consults in the session
- **High-risk/Opus-style:** after 3 high-risk consults in the session
- **Snapshot:** after 5 snapshot consults in the session

Warnings are advisory only — no consults are blocked. When a threshold is reached, the result block includes a compact line such as:

```text
warning: You have sent 3 low-risk/GPT-style consults in this session. Run `/pitaj usage` for details or `/pitaj usage reset` to clear counters.
```

Run `/pitaj usage` to see full details or `/pitaj usage reset` to clear counters.

### Sidecar model limitations

In ordinary and snapshot modes, a second model has no file inspection or tool access unless you explicitly provide that context. The bounded exception is explicit `mode: "oracle"`, which can use `pitaj_request_evidence` only inside a required approved `oracleRoot`; see [Oracle mode](#oracle-mode). Result metadata notes the context source used (none, manual, or snapshot); Oracle capability is shown separately in the sidecar line and result details. Do not assume a sidecar model can read your project files unless you either include excerpts or explicitly authorize Oracle mode with its repository root.

### Result block format

Consult results are presented answer-first, with compact metadata after a divider:

```text
Your answer here.

---
model: openai-codex/gpt-5.5 (gpt)
route: mode=answer · brevity=short · auto-routed · reason=auto: default → gpt
context: none
sidecar: no tools / no file access (no context provided)
```

When advisory thresholds are reached, `warning: ...` lines are appended after the metadata. The `contextChars` and `answerChars` fields report the bounded text actually sent and returned.

## Testing

Node.js 24 or newer is required. The repeatable verification commands are:

```bash
npm ci --include=dev --ignore-scripts
npm test
npm run typecheck
npm run check
npm pack --dry-run --json --ignore-scripts
git diff --check HEAD^ HEAD
```

- `npm test` runs the focused Node test suite for the extension.
- `npm run typecheck` runs the exact TypeScript 5.9.3 compiler against every root product and test `.ts` file under the strict NodeNext, no-emit configuration.
- `npm run check` runs `npm run typecheck` first, then `npm test`.
- CI runs on `actions/checkout@v5` and `actions/setup-node@v5` with full history, repeats the Node 24 clean-install/check/pack gate under read-only permissions, and checks whitespace over a meaningful range: the pull-request base SHA for pull requests, the pushed-from SHA for pushes (so a multi-commit push is covered), falling back to `HEAD^` and then the empty tree when that SHA is absent, all-zero, or missing from the checkout.
- Unit tests cover model alias resolution and auto-routing, command/flag parsing, prompt shaping, Oracle policy/host evidence/serial tool-loop behavior, snapshot context building and runtime capture, snapshot command wiring, atomic settings persistence, consult stopReason/error-handling integrity, provider auth/stream selection, and usage/budget accounting.

## Files

- `index.ts` — extension entry, Pi tool/command registration.
- `helpers.ts` — settings parsing, model alias resolution, config helper logic, prompt builders.
- `oracle.ts` — approved-root validation, bounded read/search/list/diff adapter, and serial evidence tool-loop seam.
- `oracle-policy.ts` — pure Oracle request, path, budget, truncation, secret-refusal, and host-action-marker policy.
- `snapshot.ts` — pure snapshot contract and context builder.
- `snapshot-runtime.ts` — bounded runtime snapshot collection seam and tool-result ring buffer.
- `settings-persistence.ts` — narrow-fs, compare-and-swap, fsync, and atomic settings writer.
- `usage.ts` — usage-event recorder wrapping the in-memory usage store; `index.ts` owns one instance per extension setup.
- `tsconfig.json` — strict NodeNext, no-emit TypeScript configuration for the typecheck gate.
- `settings.json` — default model/mode/alias configuration.
- `helpers.test.ts` — prompt shaping, command/config classification, advise flag violations, snapshot contract/runtime/wiring, brevity scaling, and M3 result-block/usage-accounting tests.
- `settings.test.ts` — settings parsing, model aliases, M2 config contract, config summary/validation, and interactive config-update tests.
- `consult-behavior.test.ts` — `finalizeConsultAnswer`/`consultModel` stopReason integrity via fake streams, auto-route alias validation, parsing robustness, truncated-usage summary, and snapshot category drift guard.
- `auto-routing.test.ts` — `resolveAutoRoute` pure-function tests.
- `oracle-policy.test.ts` — pure Oracle request, path, budget, truncation, secret-refusal, and host-action-marker boundaries.
- `oracle.test.ts` — temporary-repository adapter checks and serial evidence-loop integration tests.
- `parsing.test.ts` — command and flag parsing tests.

## Troubleshooting

- If `/pitaj` asks for a model and your alias is unknown, use a configured alias such as `opus`, `opus47`, `fable`, `terra`, `sol`, `deepseek`, `gpt`, `glm`, `spark`, or `mm`, or pass a full `provider/model` reference.
- On parse/config issues, run `/pitaj config show`; if `settings.json` is malformed, fix it manually because `/pitaj config` refuses to overwrite malformed files.
- If a model lookup fails, check model registration in Pi model configuration.
- If `/pitaj snapshot` has too little context, remember that active-plan and risk categories are omitted unless explicitly supplied, and recent tool results only appear after the bounded ring buffer has captured tool completions.
- If `/pitaj snapshot` output says a category was omitted or truncated, treat the consultation as advisory over only the included context.


## Deferred follow-ups

The 0.3.1 correctness release deliberately defers P2.4, P2.6, O1, O2, and O3. O4 is documented only at display scope: any future O4 work is limited to how already-produced consultation status is presented, and this release makes no O4 code changes. None of these deferred identifiers changes the bounded sidecar, ambient-versus-explicit snapshot policy, Oracle root/evidence boundary, or settings persistence contract shipped here.

## License

MIT — see `LICENSE`.
