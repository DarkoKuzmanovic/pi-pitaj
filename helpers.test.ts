import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	BREVITY_OUTPUT_CHARS,
	USAGE_BUDGET,
	applyUsageWarningFlags,
	boundConsultContext,
	buildConsultSystemPrompt,
	buildConsultUserText,
	buildInlineWarnings,
	buildUsageSummary,
	classifySpecialCommand,
	classifyUsageEvent,
	createUsageStore,
	detectContextSource,
	describeRouteKind,
	finalizeConsultAnswer,
	formatResultForDisplay,
	formatUsageSummaryText,
	isAdviseFlagViolation,
	mergeSettings,
	truncateText,
} from "./helpers.ts";
import { buildSnapshotCommandRequest, parseSnapshotCommandArgs } from "./index.ts";
import { createUsageRecorder } from "./usage.ts";
import {
	buildSnapshotContext,
	SNAPSHOT_CAPTURE_POLICIES,
	SNAPSHOT_CATEGORY_ORDER,
	SNAPSHOT_PROVENANCE_LABEL_TEMPLATE,
} from "./snapshot.ts";
import {
	SNAPSHOT_OMITTED_SENSITIVE_TEXT,
	SnapshotToolResultBuffer,
	buildRuntimeSnapshotInput,
	registerSnapshotToolResultCapture,
} from "./snapshot-runtime.ts";


describe("pitaj prompt shaping", () => {
	it("includes mode and brevity in the consult system prompt", () => {
		const prompt = buildConsultSystemPrompt("critique", "short");
		assert.match(prompt, /fast consultant/i);
		assert.match(prompt, /critique/i);
		assert.match(prompt, /short/i);
	});

	it("truncates text with an explicit omitted-character marker budgeted inside the cap", () => {
		const bounded = truncateText("a".repeat(100), 50);
		assert.equal(bounded.length, 50);
		assert.match(bounded, /\[pitaj truncated 83 characters\]$/);
	});
});

describe("pitaj exact text caps", () => {
	const caps = [0, 1, 2, 5, 10, 30, 32, 33, 34, 50, 100, 4_000];
	const texts = ["", "a", "short text", "x".repeat(120), "y".repeat(10_000)];

	it("never returns more characters than the cap allows", () => {
		for (const cap of caps) {
			for (const text of texts) {
				const bounded = truncateText(text, cap);
				assert.ok(
					bounded.length <= cap,
					`truncateText(len=${text.length}, cap=${cap}) returned ${bounded.length} chars`,
				);
			}
		}
	});

	it("returns a cap-sized prefix when the marker cannot fit", () => {
		assert.equal(truncateText("abcdef", 0), "");
		assert.equal(truncateText("abcdef", 1), "a");
		assert.equal(truncateText("abcdef", 4), "abcd");
	});


	describe("snapshot truncation bounds", () => {
		it("keeps category markers within the cap and reports the exact omitted count when the marker fits", () => {
			for (const maxContextChars of [1, 2, 10, 80, 120, 240]) {
				const source = "x".repeat(300);
				const result = buildSnapshotContext({
					question: "q",
					maxContextChars,
					categories: [
						{
							category: "tool-results",
							title: "Tools",
							content: source,
							sourceKind: "tool-result-ring-buffer",
							sourceLabel: "test",
						},
					],
				});
				assert.ok(result.context.length <= maxContextChars);
				const marker = /\[snapshot:tool-results truncated (\d+) chars\]/.exec(result.context);
				if (marker) {
					const markerStart = result.context.indexOf(marker[0]);
					const kept = result.context.slice(0, markerStart).replace(/\s+$/, "").length;
					assert.equal(Number(marker[1]), source.length - kept + (result.context.length - markerStart - marker[0].length));
				}
			}
		});


		it("reports exact category omission when the retained prefix ends in whitespace", () => {
			const source = `${"x".repeat(380)}${" ".repeat(80)}${"y".repeat(1_000)}`;
			const result = buildSnapshotContext({
				question: "q",
				maxContextChars: 1_000,
				categories: [
					{
						category: "tool-results",
						title: "Tools",
						content: source,
						sourceKind: "tool-result-ring-buffer",
						sourceLabel: "test",
					},
				],
			});
			const marker = /\[snapshot:tool-results truncated (\d+) chars\]/.exec(result.context);
			assert.ok(marker);
			assert.equal(Number(marker[1]), source.length - 380);
		});
	});

	it("leaves text that already fits untouched", () => {
		assert.equal(truncateText("abc", 10), "abc");
		assert.equal(truncateText("abc", 3), "abc");
		assert.equal(truncateText("", 0), "");
	});

	it("bounds manual context to the configured cap", () => {
		for (const cap of caps) {
			const bounded = boundConsultContext("  ".concat("c".repeat(500)), cap);
			assert.ok(bounded.length <= cap, `boundConsultContext(cap=${cap}) returned ${bounded.length} chars`);
			assert.ok(buildConsultUserText("q?", "c".repeat(500), cap).length <= cap + "## Context\n\n\n\n## Question\n\nq?".length);
		}
		assert.equal(boundConsultContext(undefined, 100), "");
		assert.equal(boundConsultContext("   ", 100), "");
		assert.equal(boundConsultContext(" keep me ", 100), "keep me");
	});

	it("sends exactly the bounded context in the user text", () => {
		const bounded = boundConsultContext("c".repeat(500), 60);
		const userText = buildConsultUserText("why?", "c".repeat(500), 60);
		assert.equal(bounded.length, 60);
		assert.ok(userText.includes(`## Context\n\n${bounded}`));
		assert.ok(userText.endsWith("## Question\n\nwhy?"));
	});

	it("keeps the final answer inside maxOutputChars including markers and warnings", () => {
		for (const cap of caps) {
			for (const stopReason of ["stop", "length"] as const) {
				for (const rawText of ["", "tiny", "z".repeat(5_000)]) {
					const { answer } = finalizeConsultAnswer(
						{ stopReason, rawText, partialChars: rawText.length },
						cap,
					);
					assert.ok(
						answer.length <= cap,
						`finalizeConsultAnswer(${stopReason}, len=${rawText.length}, cap=${cap}) returned ${answer.length} chars`,
					);
				}
			}
		}
	});

	it("drops the provider-length warning rather than overrunning a tiny cap", () => {
		const tiny = finalizeConsultAnswer({ stopReason: "length", rawText: "hello there", partialChars: 11 }, 5);
		assert.equal(tiny.answer, "hello");
		assert.equal(tiny.truncated, true);
		assert.doesNotMatch(tiny.answer, /provider stopped/);
	});

	it("keeps the provider-length warning when it fits inside the cap", () => {
		const { answer, truncated } = finalizeConsultAnswer(
			{ stopReason: "length", rawText: "w".repeat(500), partialChars: 500 },
			200,
		);
		assert.ok(answer.length <= 200);
		assert.match(answer, /provider stopped at max output tokens/);
		assert.match(answer, /\[pitaj truncated \d+ characters\]/);
		assert.equal(truncated, true);
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

	it("classifies advise as a special command", () => {
		assert.equal(classifySpecialCommand("advise"), "advise");
		assert.equal(classifySpecialCommand("ADVISE"), "advise");
	});

	it("treats 'advise is this safe?' as a prefix-matching advise command", () => {
		assert.equal(classifySpecialCommand("advise is this safe?"), "advise");
		assert.equal(classifySpecialCommand("advise should we ship?"), "advise");
	});

	it("does not treat non-advise input as the advise command", () => {
		assert.equal(classifySpecialCommand("adviser"), "none");
		assert.equal(classifySpecialCommand("opus advise"), "none");
	});

	it("does not modify existing special commands alongside advise", () => {
		assert.equal(classifySpecialCommand("help"), "help");
		assert.equal(classifySpecialCommand("auto"), "auto");
		assert.equal(classifySpecialCommand("snapshot"), "snapshot");
		assert.equal(classifySpecialCommand("config"), "config");
		assert.equal(classifySpecialCommand("usage"), "usage");
		assert.equal(classifySpecialCommand("advise"), "advise");
	});
});

describe("pitaj advise flag violation", () => {
	const settings = mergeSettings({
		defaultModel: "gpt",
		defaultMode: "answer",
		defaultBrevity: "normal",
		aliases: { opus: "anthropic/claude-opus-4-7", deepseek: "deepseek/deepseek-v4-pro" },
	});

	it("flags forbidden flags in advise input", () => {
		const { forbiddenFlags, looksLikeModel } = isAdviseFlagViolation("--mode plan should we refactor?", settings);
		assert.ok(forbiddenFlags.length > 0);
		assert.equal(looksLikeModel, false);
	});

	it("flags model-as-first-token with slash", () => {
		const { forbiddenFlags, looksLikeModel } = isAdviseFlagViolation("anthropic/claude-opus should we refactor?", settings);
		assert.equal(forbiddenFlags.length, 0);
		assert.equal(looksLikeModel, true);
	});

	it("flags model-as-first-token with alias", () => {
		const { forbiddenFlags, looksLikeModel } = isAdviseFlagViolation("opus should we refactor?", settings);
		assert.equal(forbiddenFlags.length, 0);
		assert.equal(looksLikeModel, true);
	});

	it("allows bare questions without flags or model", () => {
		const { forbiddenFlags, looksLikeModel } = isAdviseFlagViolation("should we refactor the auth layer?", settings);
		assert.equal(forbiddenFlags.length, 0);
		assert.equal(looksLikeModel, false);
	});

	it("allows questions with slashes inside words", () => {
		const { forbiddenFlags, looksLikeModel } = isAdviseFlagViolation("is client/server split ok?", settings);
		assert.equal(forbiddenFlags.length, 0);
		assert.equal(looksLikeModel, false);
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

	it("marks a section removed by the whole-snapshot bound as omitted", () => {
		const input = {
			question: "Review this change.",
			categories: [
				{
					category: "active-plan" as const,
					title: "Active plan",
					content: "This plan should be omitted by the final bound.",
					sourceKind: "custom-entry" as const,
					sourceLabel: "caller plan",
				},
			],
		};
		const complete = buildSnapshotContext({ ...input, maxContextChars: 2_000 });
		const activeStart = complete.context.indexOf("## Active plan");

		let cut: ReturnType<typeof buildSnapshotContext> | undefined;
		for (let maxContextChars = 120; maxContextChars <= 900; maxContextChars += 1) {
			const candidate = buildSnapshotContext({ ...input, maxContextChars });
			const cutoff = candidate.context.lastIndexOf(`\n\n[snapshot truncated to ${maxContextChars} chars]`);
			if (cutoff >= 0 && cutoff < activeStart) {
				cut = candidate;
				break;
			}
		}

		assert.ok(cut, "expected a bound before the active-plan section");
		assert.equal(cut.metadata.find((item) => item.category === "active-plan")?.status, "omitted");
		assert.ok(cut.omittedCategories.includes("active-plan"));
	});

	it("keeps duplicate section content independently included", () => {
		const result = buildSnapshotContext({
			question: "same section text",
			maxContextChars: 2_000,
			categories: [
				{
					category: "recent-user-request",
					title: "Recent user request",
					content: "same section text",
					sourceKind: "bounded-session",
					sourceLabel: "recent",
				},
			],
		});

		assert.equal(result.metadata.find((item) => item.category === "question")?.status, "included");
		assert.equal(result.metadata.find((item) => item.category === "recent-user-request")?.status, "included");
		assert.equal(result.metadata.find((item) => item.category === "question")?.charCount, 17);
		assert.equal(result.metadata.find((item) => item.category === "recent-user-request")?.charCount, 17);
	});

	it("does not infer inclusion from a question embedding another section rendering", () => {
		const activeContent = "Keep this exact section text.";
		const embeddedActiveSection = `## Active plan\n[snapshot:active-plan — 1 item, ${activeContent.length} chars, source: plan]\n\n${activeContent}`;
		const input = {
			question: `Question includes this duplicate:\n${embeddedActiveSection}`,
			categories: [
				{
					category: "active-plan" as const,
					title: "Active plan",
					content: activeContent,
					sourceKind: "custom-entry" as const,
					sourceLabel: "plan",
				},
			],
		};
		const complete = buildSnapshotContext({ ...input, maxContextChars: 2_000 });
		const activeStart = complete.context.lastIndexOf("## Active plan");

		let cut: ReturnType<typeof buildSnapshotContext> | undefined;
		for (let maxContextChars = 350; maxContextChars <= 900; maxContextChars += 1) {
			const candidate = buildSnapshotContext({ ...input, maxContextChars });
			const cutoff = candidate.context.lastIndexOf(`\n\n[snapshot truncated to ${maxContextChars} chars]`);
			if (cutoff > activeStart && cutoff < activeStart + "## Active plan".length) {
				cut = candidate;
				break;
			}
		}

		assert.ok(cut, "expected a bound that cuts the actual active-plan header");
		assert.equal(cut.metadata.find((item) => item.category === "question")?.status, "included");
		assert.equal(cut.metadata.find((item) => item.category === "active-plan")?.status, "truncated");
	});

	it("marks cuts through section headers, provenance labels, and content structurally", () => {
		const input = {
			question: "Review this snapshot.",
			categories: [
				{
					category: "active-plan" as const,
					title: "Active plan",
					content: "Content payload that must remain distinguishable.",
					sourceKind: "custom-entry" as const,
					sourceLabel: "plan",
				},
			],
		};
		const complete = buildSnapshotContext({ ...input, maxContextChars: 2_000 });
		const targets = [
			complete.context.indexOf("## Active plan") + 2,
			complete.context.indexOf("[snapshot:active-plan") + 2,
			complete.context.indexOf("Content payload") + 2,
		];

		for (const target of targets) {
			let cut: ReturnType<typeof buildSnapshotContext> | undefined;
			for (let maxContextChars = 120; maxContextChars <= 900; maxContextChars += 1) {
				const candidate = buildSnapshotContext({ ...input, maxContextChars });
				const cutoff = candidate.context.lastIndexOf(`\n\n[snapshot truncated to ${maxContextChars} chars]`);
				if (cutoff > target && cutoff <= target + 8) {
					cut = candidate;
					break;
				}
			}
			assert.ok(cut, `expected a bound near snapshot offset ${target}`);
			assert.equal(cut.metadata.find((item) => item.category === "active-plan")?.status, "truncated");
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
		assert.ok((input?.content?.length ?? 0) <= 140);
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
				on: (
					event: string,
					handler: (event: { toolName: string; result: unknown; isError: boolean }) => void,
				) => registered.push({ event, handler }),
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

describe("automatic snapshot capture privacy", () => {
	const AWS_KEY_LINE = 'aws_secret_access_key = AKIAIOSFODNN7EXAMPLE0123456789ABCDEFGHIJ';
	const PRIVATE_KEY_BLOCK = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQ\n-----END RSA PRIVATE KEY-----";

	it("discards secret-bearing tool results before ring-buffer retention", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 400, maxTotalChars: 800 });
		buffer.record({ toolName: "bash", result: `env dump\n${AWS_KEY_LINE}`, isError: false });

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.match(content, /\[snapshot source omitted: possible sensitive material\]/);
		assert.doesNotMatch(content, /AKIA/);
		assert.doesNotMatch(content, /aws_secret_access_key/);
	});

	it("never names the secret, detector, or line in the omission marker", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 400, maxTotalChars: 800 });
		buffer.record({ toolName: "read", result: `line one\n${PRIVATE_KEY_BLOCK}\nline three`, isError: false });

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.equal(content, `- read (ok): ${SNAPSHOT_OMITTED_SENSITIVE_TEXT}`);
		assert.doesNotMatch(content, /PRIVATE KEY|pattern|regex|line \d/i);
	});

	it("leaves safe tool results and TypeScript password declarations unchanged", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 400, maxTotalChars: 800 });
		buffer.record({ toolName: "read", result: "interface User { password: string; }", isError: false });
		buffer.record({ toolName: "npm", result: "tests passed", isError: false });

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.match(content, /password: string;/);
		assert.match(content, /tests passed/);
		assert.doesNotMatch(content, /snapshot source omitted/);
	});

	it("omits a secret-bearing recent user message from automatic capture", () => {
		const entries = new Map<string, unknown>([
			[
				"leaf",
				{
					type: "message",
					id: "leaf",
					parentId: null,
					message: { role: "user", content: `rotate this for me: ${AWS_KEY_LINE}` },
				},
			],
		]);

		const input = buildRuntimeSnapshotInput({
			question: "What now?",
			maxContextChars: 1_000,
			sessionManager: {
				getLeafEntry: () => entries.get("leaf"),
				getEntry: (id: string) => entries.get(id),
			},
		});

		const recent = input.categories.find((item) => item.category === "recent-user-request");
		assert.equal(recent?.content, SNAPSHOT_OMITTED_SENSITIVE_TEXT);
		assert.doesNotMatch(JSON.stringify(input), /AKIA/);
	});

	it("keeps the explicit question and caller-provided context unscanned", () => {
		const settings = mergeSettings({ maxContextChars: 2_000 });
		const built = buildSnapshotCommandRequest(
			{
				question: `is ${AWS_KEY_LINE} rotated?`,
				context: PRIVATE_KEY_BLOCK,
				model: undefined,
				mode: undefined,
				brevity: undefined,
			},
			settings,
			{},
		);

		assert.match(built.request.context ?? "", /AKIA/);
		assert.match(built.request.context ?? "", /BEGIN RSA PRIVATE KEY/);
	});

	it("omits a tool result whose secret sits past the retained prefix", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 120, maxTotalChars: 800 });
		buffer.record({ toolName: "bash", result: `${"safe log line\n".repeat(40)}${AWS_KEY_LINE}`, isError: false });

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.equal(content, `- bash (ok): ${SNAPSHOT_OMITTED_SENSITIVE_TEXT}`);
		assert.doesNotMatch(content, /AKIA/);
	});

	it("omits a tool result whose secret sits in a late multipart text part", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 120, maxTotalChars: 800 });
		buffer.record({
			toolName: "read",
			result: {
				content: [
					{ type: "text", text: "head part\n".repeat(30) },
					{ type: "text", text: PRIVATE_KEY_BLOCK },
				],
			},
			isError: false,
		});

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.equal(content, `- read (ok): ${SNAPSHOT_OMITTED_SENSITIVE_TEXT}`);
		assert.doesNotMatch(content, /PRIVATE KEY/);
	});


	it("omits a generic tool-result string field whose secret sits past its rendered summary", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 120, maxTotalChars: 800 });
		buffer.record({
			toolName: "custom",
			result: { payload: `${"safe".repeat(40)}\n${AWS_KEY_LINE}` },
			isError: false,
		});

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.equal(content, `- custom (ok): ${SNAPSHOT_OMITTED_SENSITIVE_TEXT}`);
		assert.doesNotMatch(JSON.stringify(buffer), /AKIA/);
	});


	it("omits a generic tool result when a later top-level field contains a secret", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 120, maxTotalChars: 800 });
		const result = Object.fromEntries([
			...Array.from({ length: 8 }, (_, index) => [`safe${index}`, `value${index}`]),
			["later", `PASSWORD=${"hunter2secret".repeat(2)}`],
		]);
		buffer.record({ toolName: "custom", result, isError: false });

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.equal(content, `- custom (ok): ${SNAPSHOT_OMITTED_SENSITIVE_TEXT}`);
		assert.doesNotMatch(JSON.stringify(buffer), /hunter2secret/);
	});

	it("keeps a long safe tail bounded instead of omitting it", () => {
		const buffer = new SnapshotToolResultBuffer({ maxItems: 5, maxItemChars: 120, maxTotalChars: 800 });
		buffer.record({ toolName: "npm", result: `${"safe log line\n".repeat(40)}all tests passed`, isError: false });

		const content = buffer.toSnapshotCategoryInput()?.content ?? "";
		assert.match(content, /safe log line/);
		assert.doesNotMatch(content, /snapshot source omitted/);
	});

	it("omits a recent user message whose secret sits past the retained prefix", () => {
		const entries = new Map<string, unknown>([
			[
				"leaf",
				{
					type: "message",
					id: "leaf",
					parentId: null,
					message: { role: "user", content: `${"please review this line\n".repeat(120)}${AWS_KEY_LINE}` },
				},
			],
		]);

		const input = buildRuntimeSnapshotInput({
			question: "What now?",
			maxContextChars: 4_000,
			recentUserMaxChars: 500,
			sessionManager: {
				getLeafEntry: () => entries.get("leaf"),
				getEntry: (id: string) => entries.get(id),
			},
		});

		const recent = input.categories.find((item) => item.category === "recent-user-request");
		assert.equal(recent?.content, SNAPSHOT_OMITTED_SENSITIVE_TEXT);
		assert.doesNotMatch(JSON.stringify(input), /AKIA/);
	});

	it("omits a recent user message whose secret sits in a late multipart text part", () => {
		const entries = new Map<string, unknown>([
			[
				"leaf",
				{
					type: "message",
					id: "leaf",
					parentId: null,
					message: {
						role: "user",
						content: [
							{ type: "text", text: "please review this line\n".repeat(120) },
							{ type: "text", text: PRIVATE_KEY_BLOCK },
						],
					},
				},
			],
		]);

		const input = buildRuntimeSnapshotInput({
			question: "What now?",
			maxContextChars: 4_000,
			recentUserMaxChars: 500,
			sessionManager: {
				getLeafEntry: () => entries.get("leaf"),
				getEntry: (id: string) => entries.get(id),
			},
		});

		const recent = input.categories.find((item) => item.category === "recent-user-request");
		assert.equal(recent?.content, SNAPSHOT_OMITTED_SENSITIVE_TEXT);
		assert.doesNotMatch(JSON.stringify(input), /PRIVATE KEY/);
	});

	it("keeps a long safe recent user message bounded instead of omitting it", () => {
		const entries = new Map<string, unknown>([
			[
				"leaf",
				{
					type: "message",
					id: "leaf",
					parentId: null,
					message: { role: "user", content: `${"please review this line\n".repeat(120)}and then ship it` },
				},
			],
		]);

		const input = buildRuntimeSnapshotInput({
			question: "What now?",
			maxContextChars: 4_000,
			recentUserMaxChars: 500,
			sessionManager: {
				getLeafEntry: () => entries.get("leaf"),
				getEntry: (id: string) => entries.get(id),
			},
		});

		const recent = input.categories.find((item) => item.category === "recent-user-request");
		assert.match(recent?.content ?? "", /please review this line/);
		assert.doesNotMatch(recent?.content ?? "", /snapshot source omitted/);
	});
});

describe("automatic snapshot truncation accounting", () => {
	function recentUserContent(source: string | { type: string; text: string }[], maxChars: number): string {
		const entries = new Map<string, unknown>([
			["leaf", { type: "message", id: "leaf", parentId: null, message: { role: "user", content: source } }],
		]);
		const input = buildRuntimeSnapshotInput({
			question: "q",
			maxContextChars: 32_000,
			recentUserMaxChars: maxChars,
			sessionManager: {
				getLeafEntry: () => entries.get("leaf"),
				getEntry: (id: string) => entries.get(id),
			},
		});
		return input.categories.find((item) => item.category === "recent-user-request")?.content ?? "";
	}

	function omittedCount(content: string): number {
		const match = /\[snapshot:recent-user-request truncated (\d+) chars\]$/.exec(content);
		assert.ok(match, `expected a truncation marker in: ${content.slice(-120)}`);
		return Number(match[1]);
	}

	for (const cap of [500, 1_000, 5_000]) {
		it(`reports the exact omitted char count for a single-part source at cap ${cap}`, () => {
			const source = "x".repeat(cap * 3 + 17);
			const content = recentUserContent(source, cap);

			assert.ok(content.length <= cap, `content ${content.length} exceeded cap ${cap}`);
			const retained = content.slice(0, content.indexOf("… [snapshot:"));
			assert.equal(omittedCount(content), source.length - retained.length);
		});

		it(`reports the exact omitted char count for a multipart source at cap ${cap}`, () => {
			const parts = [
				{ type: "text", text: "a".repeat(cap) },
				{ type: "text", text: "b".repeat(cap) },
				{ type: "text", text: "c".repeat(cap + 3) },
			];
			const logicalLength = parts.map((part) => part.text).join("\n").length;
			const content = recentUserContent(parts, cap);

			assert.ok(content.length <= cap, `content ${content.length} exceeded cap ${cap}`);
			const retained = content.slice(0, content.indexOf("… [snapshot:"));
			assert.equal(omittedCount(content), logicalLength - retained.length);
		});
	}

	it("keeps the truncation marker inside a tiny cap without a body", () => {
		const content = recentUserContent("y".repeat(400), 20);
		assert.ok(content.length <= 20, `content ${content.length} exceeded cap 20`);
		assert.ok(content.length > 0);
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

// The former "pitaj tool wiring contract" describe lived here: it grepped
// index.ts source text for expected strings. Replaced by executable behavior
// tests in consult-behavior.test.ts (consultModel through a fake stream).
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


describe("pitaj M3 result block foundation", () => {
	it("keeps the answer as the first line and metadata after a divider", () => {
		const rendered = formatResultForDisplay("Confirmed answer.", {
			model: "openai/gpt-5.1",
			alias: "gpt",
			mode: "answer",
			brevity: "short",
			contextChars: 0,
		});

		const lines = rendered.split("\n");
		assert.equal(lines[0], "Confirmed answer.");
		assert.ok(lines.includes("---"));
		assert.ok(lines.indexOf("model: openai/gpt-5.1 (gpt)") > lines.indexOf("---"));
		assert.ok(lines.includes("context: none"));
		assert.ok(lines.includes("sidecar: no tools / no file access (no context provided)"));
	});

	it("renders auto-route and manual context metadata", () => {
		const rendered = formatResultForDisplay("Use the narrower fix.", {
			model: "anthropic/claude-opus-4-8",
			alias: "opus",
			mode: "risk-check",
			brevity: "normal",
			contextChars: 1234,
			autoRouted: true,
			routingReason: "risk=high",
		});

		assert.match(rendered, /^Use the narrower fix\./);
		assert.match(rendered, /model: anthropic\/claude-opus-4-8 \(opus\)/);
		assert.match(rendered, /route: mode=risk-check · brevity=normal · auto-routed · reason=risk=high/);
		assert.match(rendered, /context: manual, 1234 chars/);
		assert.match(rendered, /sidecar: no tools \/ no file access \(caller-provided context only\)/);
	});

	it("renders snapshot categories and explicit snapshot context", () => {
		const rendered = formatResultForDisplay("Snapshot answer.", {
			model: "openai/gpt-5.1",
			mode: "answer",
			brevity: "short",
			contextChars: 4321,
			snapshot: {
				includedCategories: ["selection", "git"],
				truncatedCategories: ["toolResults"],
				omittedCategories: ["activePlan"],
				truncated: true,
			},
		});

		assert.match(rendered, /^Snapshot answer\./);
		assert.match(rendered, /context: snapshot/);
		assert.match(rendered, /snapshot: included=2, truncated=1, omitted=1, size=truncated \(\+selection, \+git, ~toolResults, -activePlan\)/);
		assert.match(rendered, /sidecar: no tools \/ no file access \(snapshot context only\)/);
	});

	it("renders optional post-answer warnings without moving the answer", () => {
		const rendered = formatResultForDisplay(
			"Budget answer.",
			{ model: "openai/gpt-5.1", mode: "answer", brevity: "short", contextChars: 0 },
			{ warnings: ["low-risk consult threshold reached"] },
		);

		const lines = rendered.split("\n");
		assert.equal(lines[0], "Budget answer.");
		assert.ok(lines.includes("warning: low-risk consult threshold reached"));
	});

	it("renders advisory label when isAdvisory is true", () => {
		const rendered = formatResultForDisplay(
			"Advisory answer.",
			{
				model: "openai/gpt-5.1",
				mode: "answer",
				brevity: "short",
				contextChars: 200,
				snapshot: {
					includedCategories: ["selection"],
					truncatedCategories: [],
					omittedCategories: ["activePlan", "toolResults"],
					truncated: false,
				},
			},
			{ isAdvisory: true },
		);

		assert.match(rendered, /^Advisory answer\./);
		assert.match(rendered, /advisory: true — advisory snapshot consult/);
		assert.match(rendered, /context: snapshot/);
	});
});


describe("pitaj M3-B2 usage accounting", () => {
	it("classifies usage and usage reset as the usage special command", () => {
		assert.equal(classifySpecialCommand("usage"), "usage");
		assert.equal(classifySpecialCommand("USAGE"), "usage");
		assert.equal(classifySpecialCommand("usage reset"), "usage");
		assert.equal(classifySpecialCommand("USAGE RESET"), "usage");
	});

	it("does not treat non-usage input as the usage command", () => {
		assert.equal(classifySpecialCommand("usage stats for last week"), "none");
		assert.equal(classifySpecialCommand("how is usage tracked?"), "none");
		assert.equal(classifySpecialCommand("opus usage"), "none");
	});

	it("does not regress other special commands", () => {
		assert.equal(classifySpecialCommand("help"), "help");
		assert.equal(classifySpecialCommand("check"), "check");
		assert.equal(classifySpecialCommand("aliases"), "aliases");
		assert.equal(classifySpecialCommand("snapshot"), "snapshot");
		assert.equal(classifySpecialCommand("snapshot this"), "none");
		assert.equal(classifySpecialCommand("config"), "config");
	});

	it("classifies context source as none/manual/snapshot", () => {
		assert.equal(detectContextSource({ hasSnapshot: false, contextChars: 0 }), "none");
		assert.equal(detectContextSource({ hasSnapshot: false, contextChars: 1200 }), "manual");
		assert.equal(detectContextSource({ hasSnapshot: true, contextChars: 0 }), "snapshot");
		assert.equal(detectContextSource({ hasSnapshot: true, contextChars: 1200 }), "snapshot");
	});

	it("classifies low-risk auto route events", () => {
		const c = classifyUsageEvent({
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: true,
			risk: "low",
			mode: "answer",
			success: true,
			contextSource: "none",
		});
		assert.equal(c.routeKind, "auto-low");
		assert.equal(c.risk, "low");
	});

	it("classifies default auto route events as low-risk", () => {
		const c = classifyUsageEvent({
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: true,
			mode: "answer",
			success: true,
			contextSource: "none",
		});
		assert.equal(c.routeKind, "auto-low");
		assert.equal(c.risk, "low");
	});

	it("classifies high-risk auto route events", () => {
		const c = classifyUsageEvent({
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: true,
			risk: "high",
			mode: "answer",
			success: true,
			contextSource: "none",
		});
		assert.equal(c.routeKind, "auto-high");
		assert.equal(c.risk, "high");
	});

	it("classifies auto risk-check events", () => {
		const c = classifyUsageEvent({
			requestedModel: "auto",
			resolvedModel: "anthropic/claude-opus-4-8",
			resolvedAlias: "opus",
			autoRouted: true,
			risk: "high",
			mode: "risk-check",
			success: true,
			contextSource: "none",
		});
		assert.equal(c.routeKind, "auto-risk-check");
		assert.equal(c.risk, "high");
	});

	it("classifies explicit model events with manual context", () => {
		const c = classifyUsageEvent({
			requestedModel: "opus",
			resolvedModel: "anthropic/claude-opus-4-8",
			resolvedAlias: "opus",
			autoRouted: false,
			risk: "high",
			mode: "answer",
			success: true,
			contextSource: "manual",
		});
		assert.equal(c.routeKind, "explicit-high");
		assert.equal(c.risk, "high");
	});

	it("classifies explicit GPT-style and Opus-style events without risk hints", () => {
		const low = classifyUsageEvent({
			requestedModel: "gpt",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: false,
			mode: "answer",
			success: true,
			contextSource: "none",
		});
		assert.equal(low.routeKind, "explicit-low");
		assert.equal(low.risk, "low");

		const high = classifyUsageEvent({
			requestedModel: "opus",
			resolvedModel: "anthropic/claude-opus-4-8",
			resolvedAlias: "opus",
			autoRouted: false,
			mode: "answer",
			success: true,
			contextSource: "none",
		});
		assert.equal(high.routeKind, "explicit-high");
		assert.equal(high.risk, "high");
	});

	it("classifies snapshot events regardless of auto flag", () => {
		const c = classifyUsageEvent({
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: false,
			success: true,
			contextSource: "snapshot",
		});
		assert.equal(c.routeKind, "snapshot");
		assert.equal(c.risk, "none");
	});

	it("classifies handled errors as error events", () => {
		const c = classifyUsageEvent({
			requestedModel: "opus",
			resolvedModel: "unknown",
			autoRouted: false,
			success: false,
			contextSource: "none",
		});
		assert.equal(c.routeKind, "error");
		assert.equal(c.risk, "none");
	});

	it("records events without storing the prompt or context", () => {
		const store = createUsageStore();
		store.record({
			timestamp: 1,
			requestedModel: "opus",
			resolvedModel: "anthropic/claude-opus-4-8",
			resolvedAlias: "opus",
			autoRouted: false,
			routeKind: "explicit-high",
			mode: "answer",
			brevity: "short",
			risk: "high",
			contextSource: "manual",
			contextChars: 42,
			maxOutputChars: 2000,
			success: true,
			truncated: false,
		});
		const snap = store.snapshot();
		assert.equal(snap.events.length, 1);
		const json = JSON.stringify(snap.events);
		assert.equal(json.includes("question"), false);
		assert.equal(json.includes("prompt"), false);
		assert.equal(json.includes("contextChars"), true);
		assert.equal(json.includes("caller-provided"), false);
	});

	it("does not retain provider error messages in usage events", () => {
		const recorder = createUsageRecorder();
		recorder.recordFromRequest({
			requestedModel: "opus",
			resolvedModel: "anthropic/claude-opus-4-8",
			resolvedAlias: "opus",
			autoRouted: false,
			mode: "answer",
			brevity: "short",
			contextChars: 0,
			hasSnapshot: false,
			maxOutputChars: 2000,
			success: false,
		});
		const text = recorder.renderSummary();
		assert.equal(text.includes("provider echoed secret"), false);
		assert.equal(text.includes("caller-provided"), false);
	});

	it("records failed snapshot consults as snapshot context", () => {
		const recorder = createUsageRecorder();
		recorder.recordFromRequest({
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: true,
			mode: "answer",
			brevity: "short",
			contextChars: 1200,
			hasSnapshot: true,
			maxOutputChars: 2000,
			success: false,
			truncated: true,
		});
		const text = recorder.renderSummary();
		assert.match(text, /errors: 1/);
		assert.match(text, /context source:\n  snapshot: 1/);
	});


	it("retains effective facts on failed default, alias, and auto-route events", () => {
		const recorder = createUsageRecorder();
		const cases = [
			{
				requestedModel: undefined,
				resolvedModel: "anthropic/claude-opus-4-8",
				resolvedAlias: "opus",
				mode: "answer",
				brevity: "short",
				risk: "high" as const,
				autoRouted: false,
			},
			{
				requestedModel: "opus",
				resolvedModel: "anthropic/claude-opus-4-8",
				resolvedAlias: "opus",
				mode: "critique",
				brevity: "detailed",
				risk: "high" as const,
				autoRouted: false,
			},
			{
				requestedModel: "auto",
				resolvedModel: "openai-codex/gpt-5.5",
				resolvedAlias: "gpt",
				mode: "answer",
				brevity: "short",
				risk: "low" as const,
				autoRouted: true,
			},
			{
				requestedModel: "auto",
				resolvedModel: "anthropic/claude-opus-4-8",
				resolvedAlias: "opus",
				mode: "risk-check",
				brevity: "short",
				risk: "high" as const,
				autoRouted: true,
			},
			{
				requestedModel: "auto",
				resolvedModel: "anthropic/claude-opus-4-8",
				resolvedAlias: "opus",
				mode: "risk-check",
				brevity: "short",
				risk: "high" as const,
				autoRouted: true,
			},
		];

		for (const input of cases) {
			recorder.recordFromRequest({
				...input,
				contextChars: 0,
				hasSnapshot: false,
				maxOutputChars: 2000,
				success: false,
			});
			const event = recorder.snapshot().events.at(-1);
			assert.ok(event);
			assert.equal(event.requestedModel, input.requestedModel ?? "");
			assert.equal(event.resolvedModel, input.resolvedModel);
			assert.equal(event.resolvedAlias, input.resolvedAlias);
			assert.equal(event.mode, input.mode);
			assert.equal(event.brevity, input.brevity);
			assert.equal(event.autoRouted, input.autoRouted);
			assert.equal(event.risk, input.risk);
			assert.equal(event.routeKind, "error");
			assert.equal(event.success, false);
		}

		assert.deepEqual(recorder.snapshot().totals, {
			lowRisk: 0,
			highRisk: 0,
			snapshot: 0,
			lowRiskWarned: false,
			highRiskWarned: false,
			snapshotWarned: false,
		});
	});

	it("flags low-risk warning at threshold 3", () => {
		const store = createUsageStore();
		for (let i = 0; i < USAGE_BUDGET.lowRisk - 1; i += 1) {
			store.record({
				timestamp: i,
				requestedModel: "auto",
				resolvedModel: "openai/gpt-5.1",
				autoRouted: true,
				routeKind: "auto-low",
				mode: "answer",
				brevity: "short",
				risk: "low",
				contextSource: "none",
				contextChars: 0,
				maxOutputChars: 0,
				success: true,
				truncated: false,
			});
		}
		assert.equal(store.snapshot().totals.lowRiskWarned, false);
		store.record({
			timestamp: 99,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			autoRouted: true,
			routeKind: "auto-low",
			mode: "answer",
			brevity: "short",
			risk: "low",
			contextSource: "none",
			contextChars: 0,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		assert.equal(store.snapshot().totals.lowRiskWarned, true);
		assert.equal(store.snapshot().totals.lowRisk, USAGE_BUDGET.lowRisk);
	});

	it("flags high-risk warning at threshold 3", () => {
		const store = createUsageStore();
		for (let i = 0; i < USAGE_BUDGET.highRisk; i += 1) {
			store.record({
				timestamp: i,
				requestedModel: "auto",
				resolvedModel: "openai/gpt-5.1",
				autoRouted: true,
				routeKind: "auto-high",
				mode: "answer",
				brevity: "short",
				risk: "high",
				contextSource: "none",
				contextChars: 0,
				maxOutputChars: 0,
				success: true,
				truncated: false,
			});
		}
		const totals = store.snapshot().totals;
		assert.equal(totals.highRiskWarned, true);
		assert.equal(totals.highRisk, USAGE_BUDGET.highRisk);
	});

	it("flags snapshot warning at threshold >= 5", () => {
		const store = createUsageStore();
		for (let i = 0; i < USAGE_BUDGET.snapshot - 1; i += 1) {
			store.record({
				timestamp: i,
				requestedModel: "auto",
				resolvedModel: "openai/gpt-5.1",
				autoRouted: false,
				routeKind: "snapshot",
				mode: "answer",
				brevity: "short",
				risk: "none",
				contextSource: "snapshot",
				contextChars: 0,
				maxOutputChars: 0,
				success: true,
				truncated: false,
			});
		}
		assert.equal(store.snapshot().totals.snapshotWarned, false);
		store.record({
			timestamp: 99,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			autoRouted: false,
			routeKind: "snapshot",
			mode: "answer",
			brevity: "short",
			risk: "none",
			contextSource: "snapshot",
			contextChars: 0,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		const totals = store.snapshot().totals;
		assert.equal(totals.snapshotWarned, true);
		assert.equal(totals.snapshot, USAGE_BUDGET.snapshot);
	});

	it("does not treat error events as budget consultations", () => {
		const store = createUsageStore();
		for (let i = 0; i < 5; i += 1) {
			store.record({
				timestamp: i,
				requestedModel: "opus",
				resolvedModel: "unknown",
				autoRouted: false,
				routeKind: "error",
				mode: "answer",
				brevity: "short",
				risk: "none",
				contextSource: "none",
				contextChars: 0,
				maxOutputChars: 0,
				success: false,
				truncated: false,
			});
		}
		const totals = store.snapshot().totals;
		assert.equal(totals.lowRisk, 0);
		assert.equal(totals.highRisk, 0);
		assert.equal(totals.snapshot, 0);
		assert.equal(totals.lowRiskWarned, false);
	});

	it("resets all counters and warning flags", () => {
		const store = createUsageStore();
		store.record({
			timestamp: 0,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			autoRouted: true,
			routeKind: "auto-low",
			mode: "answer",
			brevity: "short",
			risk: "low",
			contextSource: "none",
			contextChars: 0,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		store.record({
			timestamp: 1,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			autoRouted: true,
			routeKind: "auto-low",
			mode: "answer",
			brevity: "short",
			risk: "low",
			contextSource: "none",
			contextChars: 0,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		store.record({
			timestamp: 2,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			autoRouted: true,
			routeKind: "auto-low",
			mode: "answer",
			brevity: "short",
			risk: "low",
			contextSource: "none",
			contextChars: 0,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		assert.equal(store.snapshot().totals.lowRiskWarned, true);
		store.reset();
		const snap = store.snapshot();
		assert.equal(snap.events.length, 0);
		assert.equal(snap.totals.lowRisk, 0);
		assert.equal(snap.totals.highRisk, 0);
		assert.equal(snap.totals.snapshot, 0);
		assert.equal(snap.totals.lowRiskWarned, false);
		assert.equal(snap.totals.highRiskWarned, false);
		assert.equal(snap.totals.snapshotWarned, false);
	});

	it("builds a summary that includes total, routes, context, budget, and reset guidance", () => {
		const store = createUsageStore();
		store.record({
			timestamp: 0,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: true,
			routeKind: "auto-low",
			mode: "answer",
			brevity: "short",
			risk: "low",
			contextSource: "none",
			contextChars: 0,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		store.record({
			timestamp: 1,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: true,
			routeKind: "auto-high",
			mode: "risk-check",
			brevity: "normal",
			risk: "high",
			contextSource: "manual",
			contextChars: 500,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		store.record({
			timestamp: 2,
			requestedModel: "auto",
			resolvedModel: "openai/gpt-5.1",
			resolvedAlias: "gpt",
			autoRouted: false,
			routeKind: "snapshot",
			mode: "answer",
			brevity: "short",
			risk: "none",
			contextSource: "snapshot",
			contextChars: 4000,
			maxOutputChars: 0,
			success: true,
			truncated: false,
		});
		const summary = buildUsageSummary(store.snapshot());
		assert.equal(summary.total, 3);
		assert.equal(summary.byRouteKind["auto-low"], 1);
		assert.equal(summary.byRouteKind["auto-high"], 1);
		assert.equal(summary.byRouteKind.snapshot, 1);
		assert.equal(summary.byContext.none, 1);
		assert.equal(summary.byContext.manual, 1);
		assert.equal(summary.byContext.snapshot, 1);
		assert.equal(summary.errors, 0);
		assert.equal(summary.byModel["gpt (openai/gpt-5.1)"], 3);
		assert.equal(summary.budgetStatus, "ok");

		const text = formatUsageSummaryText(summary);
		assert.match(text, /pitaj usage \(current session\)/);
		assert.match(text, /total consults: 3/);
		assert.match(text, /routes:/);
		assert.match(text, /auto \(low-risk\): 1/);
		assert.match(text, /auto \(high-risk\): 1/);
		assert.match(text, /snapshot: 1/);
		assert.match(text, /models:/);
		assert.match(text, /gpt \(openai\/gpt-5\.1\): 3/);
		assert.match(text, /context source:/);
		assert.match(text, /\bnone: 1\b/);
		assert.match(text, /\bmanual: 1\b/);
		assert.match(text, /\bsnapshot: 1\b/);
		assert.match(text, /budget:/);
		assert.match(text, /warn at 3/);
		assert.match(text, /warn at 5/);
		assert.match(text, /status: ok/);
		assert.match(text, /reset with \/pitaj usage reset; counters also reset when the Pi session ends\./);
	});

	it("marks summary as warning when threshold reached", () => {
		const store = createUsageStore();
		for (let i = 0; i < USAGE_BUDGET.lowRisk; i += 1) {
			store.record({
				timestamp: i,
				requestedModel: "auto",
				resolvedModel: "openai/gpt-5.1",
				autoRouted: true,
				routeKind: "auto-low",
				mode: "answer",
				brevity: "short",
				risk: "low",
				contextSource: "none",
				contextChars: 0,
				maxOutputChars: 0,
				success: true,
				truncated: false,
			});
		}
		const summary = buildUsageSummary(store.snapshot());
		assert.equal(summary.budgetStatus, "warning");
		assert.deepEqual(summary.warningsReached, ["low-risk"]);
		const text = formatUsageSummaryText(summary);
		assert.match(text, /status: warning/);
		assert.match(text, /warnings reached: low-risk/);
	});

	it("exposes a stable description for every route kind", () => {
		const expected = [
			"auto-low",
			"auto-high",
			"auto-risk-check",
			"explicit-low",
			"explicit-high",
			"explicit-other",
			"snapshot",
			"error",
		];
		for (const kind of expected) {
			const label = describeRouteKind(kind as Parameters<typeof describeRouteKind>[0]);
			assert.ok(typeof label === "string" && label.length > 0, `missing label for ${kind}`);
		}
	});

	it("applies warning flags via the pure helper", () => {
		const before = { lowRisk: 2, highRisk: 0, snapshot: 4, lowRiskWarned: false, highRiskWarned: false, snapshotWarned: false };
		const after = applyUsageWarningFlags(before);
		assert.equal(after.lowRiskWarned, false);
		assert.equal(after.snapshotWarned, false);

		const after2 = applyUsageWarningFlags({ ...before, lowRisk: 3, snapshot: 5 });
		assert.equal(after2.lowRiskWarned, true);
		assert.equal(after2.snapshotWarned, true);
	});
	it("returns no warnings when under every threshold", () => {
		const totals = { lowRisk: 2, highRisk: 0, snapshot: 4, lowRiskWarned: false, highRiskWarned: false, snapshotWarned: false };
		const w = buildInlineWarnings(totals);
		assert.equal(w.length, 0);
	});

	it("returns low-risk warning when lowRiskWarned is true", () => {
		const totals = { lowRisk: 3, highRisk: 0, snapshot: 0, lowRiskWarned: true, highRiskWarned: false, snapshotWarned: false };
		const w = buildInlineWarnings(totals);
		assert.equal(w.length, 1);
		assert.match(w[0], /low-risk\/GPT-style consult/);
		assert.match(w[0], /\/pitaj usage/);
		assert.match(w[0], /\/pitaj usage reset/);
	});

	it("returns high-risk warning when highRiskWarned is true", () => {
		const totals = { lowRisk: 0, highRisk: 3, snapshot: 0, lowRiskWarned: false, highRiskWarned: true, snapshotWarned: false };
		const w = buildInlineWarnings(totals);
		assert.equal(w.length, 1);
		assert.match(w[0], /high-risk\/Opus-style consult/);
	});

	it("returns snapshot warning when snapshotWarned is true", () => {
		const totals = { lowRisk: 0, highRisk: 0, snapshot: 5, lowRiskWarned: false, highRiskWarned: false, snapshotWarned: true };
		const w = buildInlineWarnings(totals);
		assert.equal(w.length, 1);
		assert.match(w[0], /snapshot consult/);
		assert.match(w[0], /bounded but still context-heavy/);
	});

	it("returns multiple warnings when multiple thresholds are reached", () => {
		const totals = { lowRisk: 3, highRisk: 3, snapshot: 5, lowRiskWarned: true, highRiskWarned: true, snapshotWarned: true };
		const w = buildInlineWarnings(totals);
		assert.equal(w.length, 3);
	});

	it("pluralises consult count correctly", () => {
		const one = { lowRisk: 1, highRisk: 0, snapshot: 0, lowRiskWarned: true, highRiskWarned: false, snapshotWarned: false };
		const two = { lowRisk: 2, highRisk: 0, snapshot: 0, lowRiskWarned: true, highRiskWarned: false, snapshotWarned: false };
		assert.match(buildInlineWarnings(one)[0], /consult in this session/);
		assert.match(buildInlineWarnings(two)[0], /consults in this session/);
	});
});
