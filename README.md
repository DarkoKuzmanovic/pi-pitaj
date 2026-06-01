# pi-pitaj

A tiny [Pi](https://github.com/earendil-works/pi-coding-agent) extension for in-session AI-to-AI consultation.

## What it does

`pi-pitaj` adds:

- `pitaj` tool: call another configured model from an existing Pi flow.
- `/pitaj` command: ask a model directly from chat using a compact prompt.

It supports aliases, bounded context + output size, and built-in response modes so you can get a focused consultation without leaving the current session.

## Installation

From Pi, install this extension from GitHub:

```bash
pi install git:github.com/DarkoKuzmanovic/pi-pitaj
```

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

Snapshot mode wraps the existing `/pitaj` consult path. It builds a compact, bounded context block and passes it as `context` to the selected model. The sidecar still has no Pi tools and only sees the generated snapshot plus your question.

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
  "model": "gpt",
  "mode": "debug",
  "question": "Is this API usage pattern correct?"
}
```

**Note:** Auto-routing via `model: "auto"` is available through the tool schema. Snapshot mode is a slash-command path (`/pitaj snapshot ...`) and does not add a direct tool-schema snapshot parameter. The `/pitaj auto` command syntax is not enabled.

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
- `model` optional: alias (`opus`, `gpt`, `mimo`, `deepseek`, `glm`), explicit `provider/model`, or `auto` for built-in routing.
- `risk` optional: `low` or `high`. Only used when `model` is `auto`. `low` = bounded technical question; `high` = architecture, security, data integrity, or hard-to-reverse decision.
- `mode`: `answer` | `critique` | `debug` | `plan` | `risk-check`
- `context` optional bounded supporting context. pitaj is a sidecar consult without tools — it cannot inspect files unless you provide context.
- `brevity`: `short` | `normal` | `detailed`
- `maxContextChars` optional max chars sent from context
- `maxOutputChars` optional max chars returned

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
    "mimo": "mimo/mimo-v2.5-pro",
    "deepseek": "deepseek/deepseek-v4-pro",
    "glm": "zai/glm-5.1",
    "spark": "openai-codex/codex-5.3-spark",
    "mm": "minimax/MiniMax-M2.7-highspeed"
  }
}
```

## Testing

```bash
npm test
```

- Unit tests cover model alias resolution, command parsing, prompt shaping, snapshot context building, runtime snapshot capture, snapshot command wiring, config settings semantics, and config update helpers.

## Files

- `index.ts` — extension entry, Pi tool/command registration.
- `helpers.ts` — settings parsing, model alias resolution, config helper logic, prompt builders.
- `snapshot.ts` — pure snapshot contract and context builder.
- `snapshot-runtime.ts` — bounded runtime snapshot collection seam and tool-result ring buffer.
- `settings.json` — default model/mode/alias configuration.
- `helpers.test.ts` — test coverage.

## Troubleshooting

- If `/pitaj` asks for a model and your alias is unknown, use `opus`, `gpt`, `mimo`, `deepseek`, `glm`, or pass a full `provider/model` reference.
- On parse/config issues, run `/pitaj config show`; if `settings.json` is malformed, fix it manually because `/pitaj config` refuses to overwrite malformed files.
- If a model lookup fails, check model registration in Pi model configuration.
- If `/pitaj snapshot` has too little context, remember that active-plan and risk categories are omitted unless explicitly supplied, and recent tool results only appear after the bounded ring buffer has captured tool completions.
- If `/pitaj snapshot` output says a category was omitted or truncated, treat the consultation as advisory over only the included context.

## License

MIT — see `LICENSE`.
