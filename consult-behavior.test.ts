import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { stream } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildUsageSummary,
	createUsageStore,
	finalizeConsultAnswer,
	formatUsageSummaryText,
	isAdviseFlagViolation,
	mergeSettings,
	parseCommandArgs,
	validateAutoRouteAliases,
	type UsageEvent,
} from "./helpers.ts";
import { consultModel } from "./index.ts";
import { SNAPSHOT_CATEGORY_ORDER, SNAPSHOT_CAPTURE_POLICIES } from "./snapshot.ts";
import { RUNTIME_CUSTOM_CATEGORIES } from "./snapshot-runtime.ts";

// ---------------------------------------------------------------------------
// finalizeConsultAnswer — a dead stream must never be success-shaped
// ---------------------------------------------------------------------------

describe("finalizeConsultAnswer", () => {
	it("throws on stopReason error with provider message and partial size", () => {
		assert.throws(
			() =>
				finalizeConsultAnswer(
					{ stopReason: "error", errorMessage: "upstream 500", rawText: "partial ans", partialChars: 11 },
					4000,
				),
			/failed mid-stream: upstream 500 \(received 11 chars of partial text before failure\)/,
		);
	});

	it("falls back to the stream iterator error message when the provider gives none", () => {
		assert.throws(
			() =>
				finalizeConsultAnswer(
					{ stopReason: "error", rawText: "", partialChars: 0, streamErrorMessage: "socket hang up" },
					4000,
				),
			/failed mid-stream: socket hang up/,
		);
	});

	it("throws on aborted", () => {
		assert.throws(
			() => finalizeConsultAnswer({ stopReason: "aborted", rawText: "x", partialChars: 1 }, 4000),
			/aborted/,
		);
	});

	it("marks provider length-stops visibly and flags truncated", () => {
		const { answer, truncated } = finalizeConsultAnswer(
			{ stopReason: "length", rawText: "half an answer", partialChars: 14 },
			4000,
		);
		assert.ok(answer.startsWith("half an answer"));
		assert.match(answer, /provider stopped at max output tokens/);
		assert.equal(truncated, true);
	});

	it("flags local maxOutputChars clipping as truncated", () => {
		const { answer, truncated } = finalizeConsultAnswer(
			{ stopReason: "stop", rawText: "a".repeat(100), partialChars: 100 },
			50,
		);
		assert.match(answer, /\[pitaj truncated \d+ characters\]/);
		assert.equal(truncated, true);
	});

	it("returns clean answers untouched and not truncated", () => {
		const { answer, truncated } = finalizeConsultAnswer(
			{ stopReason: "stop", rawText: "  fine  ", partialChars: 8 },
			4000,
		);
		assert.equal(answer, "fine");
		assert.equal(truncated, false);
	});

	it("substitutes a placeholder for empty answers", () => {
		const { answer } = finalizeConsultAnswer({ stopReason: "stop", rawText: "", partialChars: 0 }, 4000);
		assert.equal(answer, "(pitaj returned no text)");
	});
});

// ---------------------------------------------------------------------------
// consultModel — behavior tests through a fake stream (replaces the old
// source-grepping "wiring contract" tests with executable ones)
// ---------------------------------------------------------------------------

type FakeStreamPlan = {
	deltas?: string[];
	stopReason: string;
	errorMessage?: string;
	throwMidStream?: Error;
	finalText?: string;
};

function fakeStreamImpl(plan: FakeStreamPlan, calls: unknown[][] = []): typeof stream {
	return ((...args: unknown[]) => {
		calls.push(args);
		const deltas = plan.deltas ?? [];
		return {
			async *[Symbol.asyncIterator]() {
				for (const d of deltas) {
					yield { type: "text_delta", delta: d };
				}
				if (plan.throwMidStream) throw plan.throwMidStream;
			},
			async result() {
				return {
					role: "assistant",
					content: [{ type: "text", text: plan.finalText ?? deltas.join("") }],
					stopReason: plan.stopReason,
					...(plan.errorMessage ? { errorMessage: plan.errorMessage } : {}),
				};
			},
		};
	}) as unknown as typeof stream;
}

function fakeCtx(findCalls: Array<{ provider: string; modelId: string }> = []): ExtensionContext {
	return {
		modelRegistry: {
			find(provider: string, modelId: string) {
				findCalls.push({ provider, modelId });
				return { provider, id: modelId };
			},
			async getApiKeyAndHeaders() {
				return { ok: true, apiKey: "test-key" };
			},
		},
	} as unknown as ExtensionContext;
}

const LOADED = {
	settings: mergeSettings({
		aliases: { opus: "anthropic/claude-opus-4-8", gpt: "openai-codex/gpt-5.5" },
	}),
	fileState: "loaded" as const,
};

describe("consultModel behavior", () => {
	it("returns a clean answer with resolved alias details on stopReason stop", async () => {
		const result = await consultModel(
			{ question: "What is X?", model: "opus" },
			fakeCtx(),
			undefined,
			LOADED,
			undefined,
			fakeStreamImpl({ deltas: ["The ", "answer."], stopReason: "stop" }),
		);
		assert.equal(result.answer, "The answer.");
		assert.equal(result.details.model, "anthropic/claude-opus-4-8");
		assert.equal(result.details.alias, "opus");
		assert.equal(result.details.truncated, undefined);
	});

	it("intercepts model 'auto' and resolves the routed alias before the registry lookup", async () => {
		const findCalls: Array<{ provider: string; modelId: string }> = [];
		const result = await consultModel(
			{ question: "Is this architecture sound?", model: "auto", risk: "high" },
			fakeCtx(findCalls),
			undefined,
			LOADED,
			undefined,
			fakeStreamImpl({ deltas: ["ok"], stopReason: "stop" }),
		);
		// autoRouteHigh defaults to "opus": the registry must be asked for the
		// routed model, not the literal "auto" token.
		assert.deepEqual(findCalls, [{ provider: "anthropic", modelId: "claude-opus-4-8" }]);
		assert.equal(result.details.autoRouted, true);
		assert.match(result.details.routingReason ?? "", /risk=high/);
	});

	it("rejects mid-stream provider errors instead of returning partial text", async () => {
		await assert.rejects(
			consultModel(
				{ question: "Risks of dropping this table?", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({
					deltas: ["The main risks are: 1) data loss if"],
					stopReason: "error",
					errorMessage: "stream disconnected",
					throwMidStream: new Error("read ECONNRESET"),
				}),
			),
			/failed mid-stream: stream disconnected \(received 35 chars of partial text/,
		);
	});

	it("uses the stream iterator error when the provider message is missing", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: [], stopReason: "error", throwMidStream: new Error("read ECONNRESET") }),
			),
			/failed mid-stream: read ECONNRESET/,
		);
	});

	it("marks provider-truncated answers and sets details.truncated", async () => {
		const result = await consultModel(
			{ question: "q", model: "opus" },
			fakeCtx(),
			undefined,
			LOADED,
			undefined,
			fakeStreamImpl({ deltas: ["cut off mid"], stopReason: "length" }),
		);
		assert.match(result.answer, /provider stopped at max output tokens/);
		assert.equal(result.details.truncated, true);
		assert.equal(result.details.stopReason, "length");
	});

	it("rejects aborted consults", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: [], stopReason: "aborted" }),
			),
			/aborted/,
		);
	});
});

// ---------------------------------------------------------------------------
// Config-load-time auto-route validation
// ---------------------------------------------------------------------------

describe("validateAutoRouteAliases", () => {
	it("accepts settings whose auto-route aliases exist", () => {
		assert.equal(validateAutoRouteAliases(LOADED.settings), undefined);
	});

	it("warns when an auto-route alias is not defined", () => {
		const settings = mergeSettings({
			aliases: { gpt: "openai-codex/gpt-5.5" },
			autoRouteLow: "gtee",
		});
		const warning = validateAutoRouteAliases(settings);
		assert.match(warning ?? "", /autoRouteLow points at alias "gtee"/);
		assert.match(warning ?? "", /\/pitaj auto will fail/);
	});

	it("reports both routes when both are broken", () => {
		const settings = mergeSettings({ aliases: {}, autoRouteLow: "a", autoRouteHigh: "b" });
		const warning = validateAutoRouteAliases(settings) ?? "";
		assert.match(warning, /autoRouteLow/);
		assert.match(warning, /autoRouteHigh/);
	});
});

// ---------------------------------------------------------------------------
// Parsing robustness
// ---------------------------------------------------------------------------

describe("parsing robustness", () => {
	it("survives an unbalanced quote without corrupting later tokens", () => {
		const parsed = parseCommandArgs('opus "what is wrong here?', LOADED.settings);
		assert.equal(parsed.model, "opus");
		assert.equal(parsed.question, '"what is wrong here?');
	});

	it("still merges balanced quoted context", () => {
		const parsed = parseCommandArgs('opus -c "some context here" what now', LOADED.settings);
		assert.equal(parsed.context, "some context here");
		assert.equal(parsed.question, "what now");
	});

	it("catches inline --mode=plan in advise input", () => {
		const violation = isAdviseFlagViolation("--mode=plan how do we proceed", LOADED.settings);
		assert.deepEqual(violation.forbiddenFlags, ["--mode"]);
	});

	it("catches spaced --mode plan in advise input", () => {
		const violation = isAdviseFlagViolation("--mode plan how do we proceed", LOADED.settings);
		assert.deepEqual(violation.forbiddenFlags, ["--mode"]);
	});
});

// ---------------------------------------------------------------------------
// Usage summary surfaces truncated answers
// ---------------------------------------------------------------------------

function usageEvent(overrides: Partial<UsageEvent>): UsageEvent {
	return {
		timestamp: Date.now(),
		requestedModel: "opus",
		resolvedModel: "anthropic/claude-opus-4-8",
		autoRouted: false,
		routeKind: "explicit-other",
		mode: "answer",
		brevity: "short",
		risk: "none",
		contextSource: "none",
		contextChars: 0,
		maxOutputChars: 4000,
		success: true,
		truncated: false,
		...overrides,
	};
}

describe("usage summary truncated count", () => {
	it("counts truncated answers and surfaces them in the summary text", () => {
		const store = createUsageStore();
		store.record(usageEvent({}));
		store.record(usageEvent({ truncated: true }));
		store.record(usageEvent({ truncated: true, success: false }));
		const summary = buildUsageSummary(store.snapshot());
		assert.equal(summary.truncated, 2);
		assert.match(formatUsageSummaryText(summary), /truncated answers: 2/);
	});
});

// ---------------------------------------------------------------------------
// Snapshot category drift guard
// ---------------------------------------------------------------------------

describe("snapshot category bookkeeping", () => {
	it("has no duplicate categories in the order list", () => {
		assert.equal(new Set(SNAPSHOT_CATEGORY_ORDER).size, SNAPSHOT_CATEGORY_ORDER.length);
	});

	it("defines a capture policy for every ordered category, and nothing more", () => {
		const policyKeys = Object.keys(SNAPSHOT_CAPTURE_POLICIES).sort();
		const ordered = [...SNAPSHOT_CATEGORY_ORDER].sort();
		assert.deepEqual(policyKeys, ordered);
	});

	it("only allows runtime custom categories that exist in the category order", () => {
		for (const category of RUNTIME_CUSTOM_CATEGORIES) {
			assert.ok(
				(SNAPSHOT_CATEGORY_ORDER as readonly string[]).includes(category),
				`runtime custom category "${category}" missing from SNAPSHOT_CATEGORY_ORDER`,
			);
		}
	});
});
