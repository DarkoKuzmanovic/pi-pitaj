# pi-pitaj

A tiny [Pi](https://github.com/earendil-works/pi-coding-agent) extension for in-session AI-to-AI consultation.

Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## What it does

`pi-pitaj` adds:

- `pitaj` tool: call another configured model from an existing Pi flow.
- `/pitaj` command: ask a model directly from chat using a compact prompt.

It supports aliases, bounded context + output size, built-in response modes, in-session usage tracking, and advisory budget warnings so you can stay aware of how many consults you have sent.

## Installation

From Pi, install this extension from GitHub:

```bash
# Exact 0.2.0 release (recommended for reproducible installs)
pi install git:github.com/DarkoKuzmanovic/pi-pitaj@v0.2.0

# Or follow the default branch (main) for the latest unreleased state
pi install git:github.com/DarkoKuzmanovic/pi-pitaj

# Rollback to the 0.1.1 baseline
pi install git:github.com/DarkoKuzmanovic/pi-pitaj@v0.1.1
```text

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
```text

If you run `/pitaj` with no question and UI support is enabled, Pi opens an editor prompt for longer questions.

## Snapshot consults

Use `/pitaj snapshot` when the sidecar needs more than a bare question but you do not want to paste a large transcript manually:

```text
/pitaj snapshot Should we keep this implementation boundary?
/pitaj snapshot opus --mode risk-check --brevity detailed Are there hidden architecture risks?
```text

Snapshot mode wraps the existing `/pitaj` consult path. It builds a compact, bounded context block and passes it as `context` to the selected model. The sidecar still has no Pi tools and only sees the generated snapshot plus your question. Oracle mode is separate: it requires an explicit `oracleRoot` and exposes only the bounded, read-only `pitaj_request_evidence` tool.

A snapshot can include:

- your current question;
- a recent user request when safely available from bounded leaf-entry traversal;
- recent tool results from the in-extension bounded `tool_execution_end` ring buffer;
- active-plan or risk notes only when explicitly supplied by the runtime seam/custom inputs;
- provenance, omission, and truncation metadata so missing or cut context is visible.

Snapshot mode deliberately excludes:

- full-branch or full-transcript capture by default;
- unbounded session scraping;
- sidecar access to read/grep/bash or other Pi tools;
- a direct `pitaj` tool-schema snapshot parameter.

Use the regular `pitaj` tool with explicit `context` when you already know the exact excerpt to send. Use `/pitaj snapshot` when you want the extension to assemble the approved bounded context sources for a slash-command consult.

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
```text

### Explicit model calls

```json
{
  "model": "opus",
  "mode": "risk-check",
  "question": "Any edge cases for user-entered regex input?",
  "context": "Feature: bulk upload validation",
  "brevity": "short"
}
```text

```json
{
  "model": "gpt",
  "mode": "debug",
  "question": "Is this API usage pattern correct?"
}
```text

**Note:** Auto-routing via `model: "auto"` is available through the tool schema and also via the `/pitaj auto` slash command. Snapshot mode is a slash-command path (`/pitaj snapshot ...`) and does not add a direct tool-schema snapshot parameter.

### Oracle call

```json
{
  "model": "opus",
  "mode": "oracle",
  "question": "Does this diff introduce a secret leak?",
  "oracleRoot": "/home/quzma/my-project"
}
```text

### Auto command

Use `/pitaj auto` to route through the built-in auto-router instead of specifying a model or alias:

```text
/pitaj auto Is this TypeScript narrowing approach sound?
/pitaj auto --risk high Is this architecture safe?
/pitaj auto --risk low --mode debug Check this test assertion
```text

Auto-routing dispatches based on the `--risk` hint (or the `/pitaj` `risk` field): low risk → GPT-style model; high risk → Opus-style model. When risk is omitted and mode is `risk-check`, it routes to Opus; otherwise defaults to GPT.

The `auto` subcommand name is reserved and cannot be used as a settings alias.

### Advise command

Use `/pitaj advise` for a zero-flag advisory shortcut that wraps the curated snapshot builder:

```text
/pitaj advise Should we keep this implementation boundary?
/pitaj advise is this safe?
```text

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

Write safety rules:

- Missing `settings.json`: `/pitaj config` may create it after validation and confirmation.
- Cleanly parsed `settings.json`: `/pitaj config` may overwrite it after validation and confirmation.
- Malformed `settings.json`: `/pitaj config` refuses to overwrite and shows manual recovery guidance.

Alias editing is manual in M2: edit `settings.json` directly, then run `/pitaj check`. Generated settings JSON stays formatted and manual-editable; do not store API keys, auth headers, or provider credentials here.

### Parameters

- `question` **required**
- `model` optional: alias (`opus`, `gpt`, `deepseek`, `glm`), explicit `provider/model`, or `auto` for built-in routing.
- `risk` optional: `low` or `high`. Only used when `model` is `auto`. `low` = bounded technical question; `high` = architecture, security, data integrity, or hard-to-reverse decision.
- `mode`: `answer` | `critique` | `debug` | `plan` | `risk-check` | `oracle`
- `context` optional bounded supporting context. In ordinary modes pitaj is a sidecar consult without tools — it cannot inspect files unless you provide context.
- `brevity`: `short` | `normal` | `detailed`
- `maxContextChars` optional max chars sent from context
- `maxOutputChars` optional max chars returned
- `oracleRoot` required when `mode` is `oracle`: exact path to an approved Git repository root. There is no cwd fallback.
- `maxEvidenceRequests` optional when `mode` is `oracle`: override the evidence-request cap (1..3; default 3).

Budget defaults are hard caps enforced by the host adapter: 3 evidence requests per consultation, 4,000 characters per result, 12,000 characters total.

## Oracle mode

`mode: "oracle"` gives the sidecar one bounded, read-only evidence tool: `pitaj_request_evidence`. The tool is host-mediated and operates only inside the `oracleRoot` repository you explicitly approve. There is no cwd fallback and no auto-selected root.

```json
{
  "model": "opus",
  "mode": "oracle",
  "question": "Is this diff introducing a secret leak?",
  "oracleRoot": "/home/quzma/my-project"
}
```text

### Evidence tool operations

`pitaj_request_evidence` accepts exactly one of these operations:

- `read_file`: read a single regular file, root-relative path, capped at 256 KB before truncation.
- `search`: grep for a literal pattern across the repository.
- `list_files`: list directory entries, bounded to 100 entries.
- `git_diff`: working-tree diff at the approved root, `--no-ext-diff --no-textconv`, with per-path deny/traversal checks.

All paths are root-relative. Absolute paths, parent traversal (`..`), `.git`, and a conservative denylist of sensitive names are rejected. Each result is capped at 4,000 characters and total evidence is capped at 12,000 characters. A 4th request is refused deterministically. You can override the request cap down to 1 with `maxEvidenceRequests`, but not above 3.

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
```text

The host or main model must decide whether that action is authorized, perform it outside Pitaj, and start a fresh bounded consultation with the result. Pitaj does not run the action for you.

### Stable-checkout threat model

Oracle-lite assumes the approved `oracleRoot` checkout is **not concurrently attacker-writable**. The adapter applies canonical-path checks, ancestor `lstat` defense-in-depth, and leaf `O_NOFOLLOW` opens with `fstat` verification to reject traversal and deterministic symlink escapes. It does **not** guarantee defense against concurrent mid-path swaps or hardlinks: do not point `oracleRoot` at a directory another process can modify during the consultation.

Sensitive-path denial and content scanning are conservative, case-insensitive mitigations. They are not complete secret detection: a non-denied path may still contain sensitive data.

### Failure behavior

A consult that dies mid-stream is never returned as a normal answer:

## Settings

`settings.json` is loaded from the extension folder.

```json
{
  "defaultModel": "opus",
  "defaultMode": "answer",
  "defaultBrevity": "short",
  "maxContextChars": 12000,
  "maxOutputChars": 4000,
  "autoRouteLow": "gpt",
  "autoRouteHigh": "opus",
  "aliases": {
    "opus": "anthropic/claude-opus-4-8",
    "gpt": "openai-codex/gpt-5.5",
    "opus47": "anthropic/claude-opus-4-7",
    "deepseek": "deepseek/deepseek-v4-pro",
    "glm": "zai/glm-5.1",
    "spark": "openai-codex/gpt-5.3-codex-spark",
    "mm": "minimax/MiniMax-M2.7-highspeed"
  }
}
```text

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
  gpt (openai/gpt-5.1): 3
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
```text

Counters reset automatically when your Pi session ends. To reset them manually:

```text
/pitaj usage reset
```text

This clears all in-session consult counters and confirms with `pitaj usage counters reset`.

### Advisory budget warnings

pitaj tracks consults in-session and shows compact advisory guidance when thresholds are reached:

- **Low-risk/GPT-style:** after 3 low-risk consults in the session
- **High-risk/Opus-style:** after 3 high-risk consults in the session
- **Snapshot:** after 5 snapshot consults in the session

Warnings are advisory only — no consults are blocked. When a threshold is reached, the result block includes a compact line such as:

```text
warning: You have sent 3 low-risk/GPT-style consults in this session. Run `/pitaj usage` for details or `/pitaj usage reset` to clear counters.
```text

Run `/pitaj usage` to see full details or `/pitaj usage reset` to clear counters.

### Sidecar model limitations

When a second model is consulted, it has no file inspection or tool access unless you explicitly provided that context. Result metadata notes which context was used (none, manual, or snapshot). Do not assume a sidecar model can read your project files unless you included excerpts in your question.

### Result block format

Consult results are presented answer-first, with compact metadata after a divider:

```text
Your answer here.

---
model: openai/gpt-5.1 (gpt)
route: mode=answer · brevity=short · auto-routed · reason=auto: default → gpt
context: none
sidecar: no tools / no file access (no context provided)
```text

When advisory thresholds are reached, `warning: ...` lines are appended after the metadata.

## Testing

```bash
npm test
```text

- Unit tests cover model alias resolution and auto-routing, command/flag parsing, prompt shaping, snapshot context building and runtime capture, snapshot command wiring, config settings semantics and updates, consult stopReason/error-handling integrity, and usage/budget accounting.

## Files

- `index.ts` — extension entry, Pi tool/command registration.
- `helpers.ts` — settings parsing, model alias resolution, config helper logic, prompt builders.
- `snapshot.ts` — pure snapshot contract and context builder.
- `snapshot-runtime.ts` — bounded runtime snapshot collection seam and tool-result ring buffer.
- `usage.ts` — usage-event recorder wrapping the in-memory usage store; `index.ts` owns one instance per extension setup.
- `settings.json` — default model/mode/alias configuration.
- `helpers.test.ts` — prompt shaping, command/config classification, advise flag violations, snapshot contract/runtime/wiring, brevity scaling, and M3 result-block/usage-accounting tests.
- `settings.test.ts` — settings parsing, model aliases, M2 config contract, config summary/validation, and interactive config-update tests.
- `consult-behavior.test.ts` — `finalizeConsultAnswer`/`consultModel` stopReason integrity via fake streams, auto-route alias validation, parsing robustness, truncated-usage summary, and snapshot category drift guard.
- `auto-routing.test.ts` — `resolveAutoRoute` pure-function tests.
- `parsing.test.ts` — command and flag parsing tests.

## Troubleshooting

- If `/pitaj` asks for a model and your alias is unknown, use `opus`, `gpt`, `deepseek`, `glm`, or pass a full `provider/model` reference.
- On parse/config issues, run `/pitaj config show`; if `settings.json` is malformed, fix it manually because `/pitaj config` refuses to overwrite malformed files.
- If a model lookup fails, check model registration in Pi model configuration.
- If `/pitaj snapshot` has too little context, remember that active-plan and risk categories are omitted unless explicitly supplied, and recent tool results only appear after the bounded ring buffer has captured tool completions.
- If `/pitaj snapshot` output says a category was omitted or truncated, treat the consultation as advisory over only the included context.

## License

MIT — see `LICENSE`.
