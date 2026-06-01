import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	BREVITY_OUTPUT_CHARS,
	PITAJ_AUTO_RISKS,
	CONFIG_EDITABLE_FIELDS,
	buildConsultSystemPrompt,
	classifySpecialCommand,
	applyConfigUpdate,
	formatSettingsChangeSummary,
	formatConfigSummaryText,
	mergeSettings,
	planSettingsWrite,
	parseCommandArgs,
	resolveAutoRoute,
	resolveMaxOutputChars,
	resolveModelRef,
	settingsFromUnknown,
	serializeSettings,
	summarizeSettings,
	truncateText,
} from "./helpers.ts";
import { buildSnapshotCommandRequest, parseSnapshotCommandArgs } from "./index.ts";
import {
	buildSnapshotContext,
	SNAPSHOT_CAPTURE_POLICIES,
	SNAPSHOT_CATEGORY_ORDER,
	SNAPSHOT_PROVENANCE_LABEL_TEMPLATE,
} from "./snapshot.ts";
import {
	SnapshotToolResultBuffer,
	buildRuntimeSnapshotInput,
	registerSnapshotToolResultCapture,
} from "./snapshot-runtime.ts";

const SETTINGS_PATH = "/home/quzma/.pi/agent/extensions/pi-pitaj/settings.json";

describe("pitaj settings and model aliases", () => {
	it("resolves shorthand aliases case-insensitively", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(resolveModelRef("Opus", settings), {
			input: "Opus",
			provider: "anthropic",
			modelId: "claude-opus-4-8",
			resolved: "anthropic/claude-opus-4-8",
			alias: "opus",
		});
	});

	it("accepts explicit provider/model references without an alias", () => {
		const settings = mergeSettings({ aliases: {} });
		assert.deepEqual(resolveModelRef("mimo/mimo-v2.5-pro", settings), {
			input: "mimo/mimo-v2.5-pro",
			provider: "mimo",
			modelId: "mimo-v2.5-pro",
			resolved: "mimo/mimo-v2.5-pro",
		});
	});

	it("falls back to defaultModel when no model is provided", () => {
		const settings = mergeSettings({
			defaultModel: "opus",
			aliases: { opus: "anthropic/claude-opus-4-8" },
		});
		assert.equal(resolveModelRef(undefined, settings).resolved, "anthropic/claude-opus-4-8");
	});

	it("throws a helpful error for unknown shorthand names", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.throws(() => resolveModelRef("unknown", settings), /Unknown pitaj model "unknown".*opus/s);
	});
});

describe("pitaj command parsing", () => {
	it("parses /pitaj opus question text", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(parseCommandArgs("opus should we do this?", settings), {
			model: "opus",
			question: "should we do this?",
			mode: undefined,
			brevity: undefined,
			context: undefined,
		});
	});

	it("uses the default model when the first word is not a model", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(parseCommandArgs("should we do this?", settings), {
			model: undefined,
			question: "should we do this?",
			mode: undefined,
			brevity: undefined,
			context: undefined,
		});
	});
});

describe("pitaj flag parsing", () => {
	it("parses --mode and --brevity flags", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.deepEqual(parseCommandArgs("opus --mode risk-check --brevity detailed is this safe?", settings), {
			model: "opus",
			question: "is this safe?",
			mode: "risk-check",
			brevity: "detailed",
			context: undefined,
		});
	});

	it("parses -c flag for context", () => {
		const settings = mergeSettings({ aliases: { deepseek: "deepseek/deepseek-v4-pro" } });
		assert.deepEqual(parseCommandArgs("deepseek -c some-context what edge cases?", settings), {
			model: "deepseek",
			question: "what edge cases?",
			mode: undefined,
			brevity: undefined,
			context: "some-context",
		});
	});

	it("parses -c flag with quoted multi-word context", () => {
		const settings = mergeSettings({ aliases: { deepseek: "deepseek/deepseek-v4-pro" } });
		assert.deepEqual(parseCommandArgs('deepseek -c "Feature: bulk upload" what edge cases?', settings), {
			model: "deepseek",
			question: "what edge cases?",
			mode: undefined,
			brevity: undefined,
			context: "Feature: bulk upload",
		});
	});

	it("ignores unknown flag values in question", () => {
		const settings = mergeSettings({ aliases: {} });
		const result = parseCommandArgs("--mode random stuff here", settings);
		assert.equal(result.mode, undefined);
		assert.equal(result.question, "--mode random stuff here");
	});
});

describe("pitaj prompt shaping", () => {
	it("includes mode and brevity in the consult system prompt", () => {
		const prompt = buildConsultSystemPrompt("critique", "short");
		assert.match(prompt, /fast consultant/i);
		assert.match(prompt, /critique/i);
		assert.match(prompt, /short/i);
	});

	it("truncates text with an explicit omitted-character marker", () => {
		assert.equal(truncateText("abcdef", 4), "abcd\n\n[pitaj truncated 2 characters]");
	});
});

describe("pitaj command routing", () => {
	it("classifies help aliases", () => {
		assert.equal(classifySpecialCommand("help"), "help");
		assert.equal(classifySpecialCommand("-h"), "help");
		assert.equal(classifySpecialCommand("--help"), "help");
	});

	it("classifies aliases and models aliases", () => {
		assert.equal(classifySpecialCommand("aliases"), "aliases");
		assert.equal(classifySpecialCommand("models"), "models");
	});

	it("classifies check", () => {
		assert.equal(classifySpecialCommand("check"), "check");
	});

	it("classifies snapshot as a special command", () => {
		assert.equal(classifySpecialCommand("snapshot"), "snapshot");
	});

	it("does not classify regular questions", () => {
		assert.equal(classifySpecialCommand("help me"), "none");
		assert.equal(classifySpecialCommand("opus help"), "none");
		assert.equal(classifySpecialCommand("snapshot this"), "none");
	});
});

describe("snapshot contract", () => {
	it("locks category order and provenance label template", () => {
		assert.deepEqual(SNAPSHOT_CATEGORY_ORDER, [
			"question",
			"recent-user-request",
			"active-plan",
			"tool-results",
			"risks",
		]);
		assert.equal(
			SNAPSHOT_PROVENANCE_LABEL_TEMPLATE,
			"[snapshot:<category> — <itemCount> <itemLabel>, <charCount> chars, source: <sourceLabel>]",
		);
	});

	it("locks capture policies for omit-by-default categories", () => {
		assert.equal(SNAPSHOT_CAPTURE_POLICIES["active-plan"].omitByDefault, true);
		assert.equal(SNAPSHOT_CAPTURE_POLICIES.risks.omitByDefault, true);
		assert.equal(SNAPSHOT_CAPTURE_POLICIES["tool-results"].sourceKind, "tool-result-ring-buffer");
		assert.match(SNAPSHOT_CAPTURE_POLICIES["recent-user-request"].captureMechanism, /bounded/i);
	});

	it("builds ordered snapshot context with provenance and metadata", () => {
		const result = buildSnapshotContext({
			question: "Should we ship M1-T2?",
			maxContextChars: 2_000,
			categories: [
				{
					category: "tool-results",
					title: "Recent tool results",
					content: "npm test passed with 0 failures.",
					sourceKind: "tool-result-ring-buffer",
					sourceLabel: "tool ring",
				},
				{
					category: "recent-user-request",
					title: "Recent user request",
					content: "Prepare M1-T2 and execute it immediately.",
					sourceKind: "bounded-session",
					sourceLabel: "last user message",
				},
			],
		});

		assert.match(result.context, /sidecar has no tools/i);
		assert.ok(result.context.indexOf("## Question") < result.context.indexOf("## Recent user request"));
		assert.ok(result.context.indexOf("## Recent user request") < result.context.indexOf("## Recent tool results"));
		assert.match(result.context, /\[snapshot:question — 1 item, \d+ chars, source: caller\]/);
		assert.match(result.context, /\[snapshot:tool-results — 1 item, \d+ chars, source: tool ring\]/);
		assert.equal(result.truncated, false);
		assert.equal(result.metadata.find((item) => item.category === "question")?.status, "included");
		assert.equal(result.metadata.find((item) => item.category === "tool-results")?.sourceKind, "tool-result-ring-buffer");
	});

	it("omits unavailable categories with metadata", () => {
		const result = buildSnapshotContext({
			question: "What is missing?",
			maxContextChars: 2_000,
			categories: [],
		});

		assert.deepEqual(result.omittedCategories, ["recent-user-request", "active-plan", "tool-results", "risks"]);
		assert.equal(result.metadata.find((item) => item.category === "active-plan")?.status, "omitted");
		assert.equal(result.metadata.find((item) => item.category === "risks")?.omissionReason, "Omit by default.");
		assert.doesNotMatch(result.context, /## Active plan/);
	});

	it("bounds noisy tool output with explicit truncation markers", () => {
		const rawOutput = `stdout:${"x".repeat(800)}`;
		const result = buildSnapshotContext({
			question: "What failed?",
			maxContextChars: 420,
			categories: [
				{
					category: "tool-results",
					title: "Recent tool results",
					content: rawOutput,
					sourceKind: "tool-result-ring-buffer",
					sourceLabel: "tool ring",
				},
			],
		});

		assert.equal(result.truncated, true);
		assert.ok(result.context.length <= 420);
		assert.match(result.context, /\[snapshot truncated/);
		assert.equal(result.metadata.find((item) => item.category === "tool-results")?.status, "truncated");
		assert.doesNotMatch(result.context, new RegExp(`${"x".repeat(300)}`));
	});

	it("does not report whole-snapshot-cut categories as included", () => {
		const result = buildSnapshotContext({
			question: "Review this change.",
			maxContextChars: 360,
			categories: [
				{
					category: "recent-user-request",
					title: "Recent user request",
					content: "Prepare and execute M1-T2 without a second approval prompt.",
					sourceKind: "bounded-session",
					sourceLabel: "last user message",
				},
				{
					category: "active-plan",
					title: "Active plan",
					content: "Implement builder, verify, review, and close out.",
					sourceKind: "custom-entry",
					sourceLabel: "caller plan",
				},
				{
					category: "tool-results",
					title: "Recent tool results",
					content: "npm test passed with zero failures.",
					sourceKind: "tool-result-ring-buffer",
					sourceLabel: "tool ring",
				},
				{
					category: "risks",
					title: "Risks",
					content: "Metadata must not overstate what the sidecar actually receives.",
					sourceKind: "custom-entry",
					sourceLabel: "caller risks",
				},
			],
		});
		const titlesByCategory = new Map([
			["recent-user-request", "## Recent user request"],
			["active-plan", "## Active plan"],
			["tool-results", "## Recent tool results"],
			["risks", "## Risks"],
		]);
		const cutCategories = [...titlesByCategory.entries()].filter(([, title]) => !result.context.includes(title));

		assert.ok(cutCategories.length > 0);
		for (const [category] of cutCategories) {
			assert.notEqual(result.metadata.find((item) => item.category === category)?.status, "included");
		}
	});
});

describe("runtime snapshot collection seam", () => {
	it("bounds tool result ring buffer by item count and character limits", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 2, maxItemChars: 80, maxTotalChars: 140 });

		buffer.record({ toolName: "read", result: "first-result", isError: false });
		buffer.record({ toolName: "bash", result: "second-result-is-long".repeat(10), isError: true });
		buffer.record({ toolName: "edit", result: "third-result", isError: false });

		const input = buffer.toSnapshotCategoryInput();
		assert.equal(input?.category, "tool-results");
		assert.equal(input?.sourceKind, "tool-result-ring-buffer");
		assert.match(input?.content ?? "", /edit/);
		assert.match(input?.content ?? "", /bash/);
		assert.doesNotMatch(input?.content ?? "", /first-result/);
		assert.ok((input?.content.length ?? 0) <= 140);
		assert.match(input?.content ?? "", /truncated/);
	});

	it("builds runtime snapshot input from bounded leaf traversal and optional custom categories", () => {
		const entries = new Map([
			[
				"leaf",
				{
					type: "message",
					id: "leaf",
					parentId: "assistant",
					message: { role: "assistant", content: [{ type: "text", text: "working" }] },
				},
			],
			[
				"assistant",
				{
					type: "message",
					id: "assistant",
					parentId: "user",
					message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
				},
			],
			[
				"user",
				{
					type: "message",
					id: "user",
					parentId: null,
					message: { role: "user", content: "Start M1-T3 now." },
				},
			],
		]);
		const toolResults = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 80, maxTotalChars: 200 });
		toolResults.record({ toolName: "npm", result: { content: [{ type: "text", text: "tests passed" }] }, isError: false });

		const input = buildRuntimeSnapshotInput({
			question: "How should M1-T3 proceed?",
			maxContextChars: 1_000,
			sessionManager: {
				getLeafEntry: () => entries.get("leaf"),
				getEntry: (id: string) => entries.get(id),
			},
			toolResults,
			customCategories: [
				{
					category: "risks",
					title: "Risks",
					content: "Avoid full-branch capture.",
					sourceKind: "custom-entry",
					sourceLabel: "caller risks",
				},
			],
		});

		assert.equal(input.question, "How should M1-T3 proceed?");
		assert.equal(input.categories.find((item) => item.category === "recent-user-request")?.content, "Start M1-T3 now.");
		assert.equal(input.categories.find((item) => item.category === "tool-results")?.sourceKind, "tool-result-ring-buffer");
		assert.equal(input.categories.find((item) => item.category === "active-plan"), undefined);
		assert.equal(input.categories.find((item) => item.category === "risks")?.content, "Avoid full-branch capture.");
	});

	it("omits unavailable runtime categories gracefully", () => {
		const input = buildRuntimeSnapshotInput({ question: "No context?", maxContextChars: 500 });

		assert.deepEqual(input.categories, []);
	});

	it("registers guarded tool_execution_end capture without changing tool schema", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 3, maxItemChars: 50, maxTotalChars: 100 });
		const registered: Array<{ event: string; handler: (event: { toolName: string; result: unknown; isError: boolean }) => void }> = [];
		const registeredOk = registerSnapshotToolResultCapture(
			{
				on: (event, handler) => registered.push({ event, handler }),
			},
			buffer,
		);
		const missingHookOk = registerSnapshotToolResultCapture({}, buffer);

		assert.equal(registeredOk, true);
		assert.equal(missingHookOk, false);

		registered[0]?.handler({ toolName: "read", result: "ok", isError: false });
		assert.equal(registered[0]?.event, "tool_execution_end");
		assert.match(buffer.toSnapshotCategoryInput()?.content ?? "", /read/);

		const indexSource = readFileSync("index.ts", "utf8");
		assert.doesNotMatch(indexSource, /autoContext/);
		assert.doesNotMatch(indexSource, /snapshot:\s*Type/);
	});
});


describe("snapshot command wiring", () => {
	it("parses snapshot prefix while preserving alias and flags", () => {
		const settings = mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8" } });

		const parsed = parseSnapshotCommandArgs("snapshot opus --mode risk-check --brevity detailed should we ship?", settings);

		assert.deepEqual(parsed, {
			model: "opus",
			question: "should we ship?",
			mode: "risk-check",
			brevity: "detailed",
			context: undefined,
		});
		assert.equal(parseSnapshotCommandArgs("snapshot this is a normal question", settings)?.question, "this is a normal question");
		assert.equal(parseSnapshotCommandArgs("opus snapshot this", settings), undefined);
	});

	it("builds a snapshot consult request with metadata", () => {
		const settings = mergeSettings({ maxContextChars: 1_200 });
		const toolResults = new SnapshotToolResultBuffer({ maxItems: 2, maxItemChars: 80, maxTotalChars: 200 });
		toolResults.record({ toolName: "npm", result: "tests passed", isError: false });

		const built = buildSnapshotCommandRequest(
			{
				model: "opus",
				question: "Review the command wiring.",
				mode: "risk-check",
				brevity: "detailed",
				context: "Active plan: keep this bounded.",
			},
			settings,
			{
				sessionManager: undefined,
				toolResults,
			},
		);

		assert.equal(built.request.model, "opus");
		assert.equal(built.request.question, "Review the command wiring.");
		assert.equal(built.request.mode, "risk-check");
		assert.equal(built.request.brevity, "detailed");
		assert.match(built.request.context ?? "", /sidecar has no tools/i);
		assert.match(built.request.context ?? "", /Active plan: keep this bounded/);
		assert.match(built.request.context ?? "", /tests passed/);
		assert.deepEqual(built.snapshot.includedCategories, ["question", "active-plan", "tool-results"]);
		assert.deepEqual(built.snapshot.omittedCategories, ["recent-user-request", "risks"]);
		assert.equal(built.snapshot.used, true);
	});

	it("uses the default snapshot context limit when maxContextChars is absent", () => {
		const built = buildSnapshotCommandRequest(
			{ question: "Review default snapshot limit." },
			mergeSettings(),
			{},
		);
		assert.equal(built.snapshot.contextChars, built.request.context?.length);
		assert.ok(built.snapshot.contextChars > 1);
		assert.equal(built.snapshot.truncated, false);
	});


	it("does not report truncated snapshot categories as included", () => {
		const settings = mergeSettings({ maxContextChars: 360 });
		const toolResults = new SnapshotToolResultBuffer({ maxItems: 2, maxItemChars: 400, maxTotalChars: 500 });
		toolResults.record({ toolName: "npm", result: "tool-output ".repeat(80), isError: false });

		const built = buildSnapshotCommandRequest(
			{
				question: "Review bounded metadata.",
				context: "active-plan ".repeat(80),
			},
			settings,
			{ toolResults },
		);
		const truncatedCategories = built.snapshot.metadata.filter((item) => item.status === "truncated").map((item) => item.category);

		assert.deepEqual(built.snapshot.truncatedCategories, truncatedCategories);
		assert.ok(truncatedCategories.length > 0);
		for (const category of truncatedCategories) {
			assert.equal(built.snapshot.includedCategories.includes(category), false);
		}
	});
});

describe("brevity output scaling", () => {
	it("maps brevity to output char limits", () => {
		assert.equal(BREVITY_OUTPUT_CHARS.short, 2000);
		assert.equal(BREVITY_OUTPUT_CHARS.normal, 4000);
		assert.equal(BREVITY_OUTPUT_CHARS.detailed, 8000);
	});
});

describe("pitaj auto routing", () => {
	it("routes high risk to opus with risk-check suggestion when mode omitted", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ risk: "high" }, settings);
		assert.equal(result.alias, "opus");
		assert.equal(result.routingReason, "auto: risk=high → opus");
		assert.equal(result.suggestedMode, "risk-check");
	});

	it("routes high risk to opus without suggestion when mode is explicit", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ risk: "high", mode: "debug" }, settings);
		assert.equal(result.alias, "opus");
		assert.equal(result.routingReason, "auto: risk=high → opus");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes low risk to gpt without suggestion", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ risk: "low" }, settings);
		assert.equal(result.alias, "gpt");
		assert.equal(result.routingReason, "auto: risk=low → gpt");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes no risk + risk-check mode to opus", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ mode: "risk-check" }, settings);
		assert.equal(result.alias, "opus");
		assert.equal(result.routingReason, "auto: mode=risk-check → opus");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes no risk + debug mode to gpt", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({ mode: "debug" }, settings);
		assert.equal(result.alias, "gpt");
		assert.equal(result.routingReason, "auto: default → gpt");
		assert.equal(result.suggestedMode, undefined);
	});

	it("routes no risk + omitted mode to gpt", () => {
		const settings = mergeSettings();
		const result = resolveAutoRoute({}, settings);
		assert.equal(result.alias, "gpt");
		assert.equal(result.routingReason, "auto: default → gpt");
		assert.equal(result.suggestedMode, undefined);
	});

	it("throws when selected gpt alias is blank", () => {
		const settings = mergeSettings({ aliases: { gpt: "", opus: "anthropic/claude-opus-4-8" } });
		assert.throws(
			() => resolveAutoRoute({ risk: "low" }, settings),
			/pitaj auto routing requires a non-empty "gpt" alias/,
		);
	});

	it("throws when selected opus alias is blank", () => {
		const settings = mergeSettings({ aliases: { opus: "", gpt: "openai-codex/gpt-5.5" } });
		assert.throws(
			() => resolveAutoRoute({ risk: "high" }, settings),
			/pitaj auto routing requires a non-empty "opus" alias/,
		);
	});

	it("rejects invalid runtime risk hints", () => {
		const settings = mergeSettings();
		assert.throws(
			() => resolveAutoRoute({ risk: "medium" as never }, settings),
			/Unknown pitaj auto risk "medium"/,
		);
	});

	it("keeps manual model resolution separate from auto routing hints", () => {
		const settings = mergeSettings();
		assert.deepEqual([...PITAJ_AUTO_RISKS], ["low", "high"]);
		assert.equal(resolveModelRef("gpt", settings).alias, "gpt");
		assert.equal(resolveModelRef("mimo/mimo-v2.5-pro", settings).resolved, "mimo/mimo-v2.5-pro");
	});
});

describe("pitaj tool wiring contract", () => {
	const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

	it("intercepts literal auto before model resolution and registry lookup", () => {
		const autoRouteIndex = indexSource.indexOf("const autoRoute = request.model?.trim().toLowerCase() === \"auto\"");
		const resolveIndex = indexSource.indexOf("resolveModelRef(autoRoute?.alias ?? request.model, settings)");
		const registryIndex = indexSource.indexOf("ctx.modelRegistry.find");

		assert.notEqual(autoRouteIndex, -1);
		assert.notEqual(resolveIndex, -1);
		assert.notEqual(registryIndex, -1);
		assert.ok(autoRouteIndex < resolveIndex);
		assert.ok(resolveIndex < registryIndex);
	});

	it("exposes auto routing schema and result metadata", () => {
		assert.match(indexSource, /risk: Type\.Optional\(\s*StringEnum\(PITAJ_AUTO_RISKS,/s);
		assert.match(indexSource, /autoRouted\?: boolean;/);
		assert.match(indexSource, /routingReason\?: string;/);
		assert.match(indexSource, /autoSuggestedMode\?: PitajMode;/);
		assert.match(indexSource, /autoRouted: true, routingReason: autoRoute\.routingReason/);
	});


	it("routes snapshot command through generated context without tool schema changes", () => {
		const snapshotParseIndex = indexSource.indexOf("const snapshotParsed = parseSnapshotCommandArgs(trimmed, loaded.settings)");
		const normalParseIndex = indexSource.indexOf("const parsed = parseCommandArgs(trimmed, loaded.settings)");
		assert.notEqual(snapshotParseIndex, -1);
		assert.notEqual(normalParseIndex, -1);
		assert.ok(snapshotParseIndex < normalParseIndex);
		assert.match(indexSource, /buildSnapshotCommandRequest\([\s\S]*sessionManager: ctx\.sessionManager,[\s\S]*toolResults: snapshotToolResults/s);
		assert.match(indexSource, /consultModel\(snapshotRequest\.request, ctx, undefined, loaded\)/);
		assert.match(indexSource, /snapshot: snapshotRequest\.snapshot/);
		assert.doesNotMatch(indexSource, /autoContext/);
		assert.doesNotMatch(indexSource, /snapshot:\s*Type/);
		const snapshotSource = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
		const runtimeSource = readFileSync(new URL("./snapshot-runtime.ts", import.meta.url), "utf8");
		assert.doesNotMatch(`${indexSource}\n${snapshotSource}\n${runtimeSource}`, /getBranch\(|getEntries\(/);
		assert.doesNotMatch(`${indexSource}\n${snapshotSource}\n${runtimeSource}`, /full-branch by default|sidecar tools|tool-enabled snapshot/i);
	});

	it("documents snapshot command in slash help", () => {
		assert.match(indexSource, /\/pitaj snapshot <question>/);
		assert.match(indexSource, /bounded session snapshot/);
	});
});

describe("pitaj M2 config contract", () => {
	it("leaves absent numeric fields as undefined in settingsFromUnknown", () => {
		const parsed = settingsFromUnknown({ defaultModel: "opus" });
		assert.equal(parsed.maxContextChars, undefined);
		assert.equal(parsed.maxOutputChars, undefined);
	});

	it("drops invalid numeric and string fields in settingsFromUnknown", () => {
		const parsed = settingsFromUnknown({
			defaultModel: 42,
			defaultMode: "wrong",
			defaultBrevity: "wrong",
			maxContextChars: "x",
			maxOutputChars: -1,
			aliases: { "": "target", OK: "  ", good: "anthropic/claude-opus-4-8" },
		});
		assert.equal(parsed.defaultModel, undefined);
		assert.equal(parsed.defaultMode, undefined);
		assert.equal(parsed.defaultBrevity, undefined);
		assert.equal(parsed.maxContextChars, undefined);
		assert.equal(parsed.maxOutputChars, undefined);
		assert.deepEqual(parsed.aliases, { good: "anthropic/claude-opus-4-8" });
	});

	it("parses new autoRouteLow and autoRouteHigh fields and ignores invalid values", () => {
		const parsed = settingsFromUnknown({ autoRouteLow: "gpt", autoRouteHigh: "opus47" });
		assert.equal(parsed.autoRouteLow, "gpt");
		assert.equal(parsed.autoRouteHigh, "opus47");
		const invalid = settingsFromUnknown({ autoRouteLow: 42, autoRouteHigh: "" });
		assert.equal(invalid.autoRouteLow, undefined);
		assert.equal(invalid.autoRouteHigh, undefined);
	});

	it("propagates undefined numerics through mergeSettings so brevity defaults still apply", () => {
		const settings = mergeSettings({ defaultModel: "opus" });
		assert.equal(settings.maxContextChars, undefined);
		assert.equal(settings.maxOutputChars, undefined);
		assert.equal(settings.autoRouteLow, undefined);
		assert.equal(settings.autoRouteHigh, undefined);
		assert.equal(settings.defaultModel, "opus");
		assert.equal(settings.aliases.gpt, "openai-codex/gpt-5.5");
	});

	it("does not require resolveAutoRoute alias to be a literal 'gpt' or 'opus'", () => {
		const settings = mergeSettings({
			autoRouteLow: "spark",
			autoRouteHigh: "opus47",
			aliases: { spark: "openai-codex/codex-5.3-spark", opus47: "anthropic/claude-opus-4-7" },
		});
		assert.equal(resolveAutoRoute({ risk: "low" }, settings).alias, "spark");
		assert.equal(resolveAutoRoute({ risk: "high" }, settings).alias, "opus47");
	});

	it("falls back to default 'gpt' and 'opus' auto-route aliases when settings don't override", () => {
		const settings = mergeSettings({
			aliases: { gpt: "openai-codex/gpt-5.5", opus: "anthropic/claude-opus-4-8" },
		});
		assert.equal(resolveAutoRoute({ risk: "low" }, settings).alias, "gpt");
		assert.equal(resolveAutoRoute({ risk: "high" }, settings).alias, "opus");
	});

	it("throws when configured autoRouteLow points to a missing or blank alias", () => {
		const settings = mergeSettings({ autoRouteLow: "missingAlias", aliases: { opus: "anthropic/claude-opus-4-8" } });
		assert.throws(
			() => resolveAutoRoute({ risk: "low" }, settings),
			/pitaj auto routing requires a non-empty "missingalias" alias/,
		);
	});

	it("resolves maxOutputChars with request then settings then brevity precedence", () => {
		const settings = mergeSettings({ maxOutputChars: 2222 });
		assert.equal(resolveMaxOutputChars(1111, settings, "short"), 1111);
		assert.equal(resolveMaxOutputChars(undefined, settings, "short"), 2222);
		assert.equal(resolveMaxOutputChars(undefined, mergeSettings(), "short"), BREVITY_OUTPUT_CHARS.short);
	});
});

describe("pitaj M2 config summary and validation helpers", () => {
	it("summarizes effective settings including auto-route aliases and file state", () => {
		const settings = mergeSettings({
			autoRouteLow: "gpt",
			autoRouteHigh: "opus",
			aliases: { gpt: "openai-codex/gpt-5.5", opus: "anthropic/claude-opus-4-8" },
		});
		const summary = summarizeSettings(settings, "loaded");
		assert.equal(summary.fileState, "loaded");
		assert.equal(summary.effective.defaultModel, "opus");
		assert.equal(summary.effective.defaultMode, "answer");
		assert.equal(summary.effective.defaultBrevity, "short");
		assert.equal(summary.effective.maxContextChars, undefined);
		assert.equal(summary.effective.maxOutputChars, undefined);
		assert.equal(summary.effective.autoRouteLow, "gpt");
		assert.equal(summary.effective.autoRouteHigh, "opus");
		assert.equal(summary.aliasCount, 8);
	});

	it("marks summary with a not-found file state when settings are defaults only", () => {
		const settings = mergeSettings();
		const summary = summarizeSettings(settings, "not-found");
		assert.equal(summary.fileState, "not-found");
		assert.equal(summary.effective.maxContextChars, undefined);
	});

	it("flags malformed file state without overwriting effective settings", () => {
		const settings = mergeSettings({ defaultModel: "opus" });
		const summary = summarizeSettings(settings, "malformed");
		assert.equal(summary.fileState, "malformed");
		assert.equal(summary.manualRecoveryPath, true);
		assert.match(summary.manualEditHint, /settings\.json/);
	});

	it("formats the summary as a multi-line text with manual edit path", () => {
		const settings = mergeSettings({
			aliases: { gpt: "openai-codex/gpt-5.5", opus: "anthropic/claude-opus-4-8" },
		});
		const text = formatConfigSummaryText(summarizeSettings(settings, "loaded"), SETTINGS_PATH);
		assert.match(text, /defaultModel: opus/);
		assert.match(text, /autoRouteLow: gpt/);
		assert.match(text, /autoRouteHigh: opus/);
		assert.match(text, /aliases: 8/);
		assert.match(text, /settings\.json/);
	});

	it("serializes settings as formatted manual-editable JSON", () => {
		const text = serializeSettings(
			mergeSettings({
				defaultModel: "mimo",
				maxOutputChars: 1234,
				autoRouteLow: "spark",
			}),
		);
		const parsed = JSON.parse(text) as Record<string, unknown>;
		assert.equal(parsed.defaultModel, "mimo");
		assert.equal(parsed.maxOutputChars, 1234);
		assert.equal(parsed.autoRouteLow, "spark");
		assert.match(text, /\n  "aliases": \{/);
	});

	it("plans settings writes without silently overwriting malformed files", () => {
		const settings = mergeSettings();
		assert.equal(planSettingsWrite(settings, "not-found").canWrite, true);
		assert.equal(planSettingsWrite(settings, "loaded").canWrite, true);
		const malformed = planSettingsWrite(settings, "malformed");
		assert.equal(malformed.canWrite, false);
		assert.match(malformed.reason, /malformed/);
	});
});

	describe("interactive config update helpers", () => {
		it("applies validated common setting updates without dropping aliases", () => {
			const settings = mergeSettings({ aliases: { custom: "provider/model" } });
			const updated = applyConfigUpdate(settings, "defaultModel", "custom");
			assert.equal(updated.defaultModel, "custom");
			assert.equal(updated.aliases.custom, "provider/model");
			assert.throws(() => applyConfigUpdate(settings, "defaultModel", ""), /non-empty alias or provider\/model/);
			assert.deepEqual(CONFIG_EDITABLE_FIELDS, [
				"defaultModel",
				"autoRouteLow",
				"autoRouteHigh",
				"defaultMode",
				"defaultBrevity",
				"maxContextChars",
				"maxOutputChars",
			]);
		});

		it("requires auto-route targets to name existing aliases", () => {
			const settings = mergeSettings({ aliases: { spark: "openai-codex/codex-5.3-spark" } });
			assert.equal(applyConfigUpdate(settings, "autoRouteLow", "spark").autoRouteLow, "spark");
			assert.throws(() => applyConfigUpdate(settings, "autoRouteHigh", "missing"), /existing alias/);
		});

		it("validates enum and numeric config updates and allows clearing numeric overrides", () => {
			const settings = mergeSettings({ maxContextChars: 12000, maxOutputChars: 4000 });
			assert.equal(applyConfigUpdate(settings, "defaultMode", "risk-check").defaultMode, "risk-check");
			assert.equal(applyConfigUpdate(settings, "defaultBrevity", "detailed").defaultBrevity, "detailed");
			assert.equal(applyConfigUpdate(settings, "maxContextChars", "1234").maxContextChars, 1234);
			assert.equal(applyConfigUpdate(settings, "maxOutputChars", "").maxOutputChars, undefined);
			assert.throws(() => applyConfigUpdate(settings, "maxOutputChars", "0"), /positive integer/);
		});

		it("formats a concise changed-fields summary for confirmation", () => {
			const before = mergeSettings({ defaultModel: "opus", maxOutputChars: 4000 });
			const after = applyConfigUpdate(before, "maxOutputChars", "2000");
			const summary = formatSettingsChangeSummary(before, after);
			assert.match(summary, /maxOutputChars: 4000 -> 2000/);
			assert.doesNotMatch(summary, /defaultModel/);
		});

		it("wires the interactive config path through UI selection, confirmation, and serialized writes", () => {
			const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
			assert.match(indexSource, /ctx\.hasUI/);
			assert.match(indexSource, /ctx\.ui\.select\("pitaj config"/);
			assert.match(indexSource, /ctx\.ui\.input\(`Enter \$\{field\}`/);
			assert.match(indexSource, /ctx\.ui\.confirm\(\s*"Write pitaj settings\?"/);
			assert.match(indexSource, /writeFileSync\(SETTINGS_PATH, serializeSettings\(updated\), "utf8"\)/);
			assert.match(indexSource, /try \{\s*writeFileSync\(SETTINGS_PATH, serializeSettings\(updated\), "utf8"\);/s);
			assert.match(indexSource, /pitaj config save failed/);
			assert.match(indexSource, /loaded\.fileState === "malformed"/);
			assert.match(indexSource, /Alias editing is manual in M2/);
		});
	});

describe("pitaj /pitaj config command classification", () => {
	it("classifies config as a special command", () => {
		assert.equal(classifySpecialCommand("config"), "config");
		assert.equal(classifySpecialCommand("CONFIG"), "config");
	});

	it("treats 'config show' as a config summary, not a normal question", () => {
		assert.equal(classifySpecialCommand("config show"), "config");
		assert.equal(classifySpecialCommand("config"), "config");
	});

	it("treats unsupported config subcommands as config routing, not consultation", () => {
		assert.equal(classifySpecialCommand("config set defaultModel opus"), "config");
		assert.equal(classifySpecialCommand("CONFIG edit"), "config");
	});

	it("does not treat non-config input as the config command", () => {
		assert.equal(classifySpecialCommand("configure this"), "none");
		assert.equal(classifySpecialCommand("opus config"), "none");
	});

	it("does not modify existing special commands", () => {
		assert.equal(classifySpecialCommand("help"), "help");
		assert.equal(classifySpecialCommand("check"), "check");
		assert.equal(classifySpecialCommand("aliases"), "aliases");
		assert.equal(classifySpecialCommand("snapshot"), "snapshot");
		assert.equal(classifySpecialCommand("snapshot this"), "none");
	});
});