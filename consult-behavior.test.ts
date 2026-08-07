import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	boundConsultContext,
	buildUsageSummary,
	createUsageStore,
	finalizeConsultAnswer,
	formatUsageSummaryText,
	formatResultForDisplay,
	isAdviseFlagViolation,
	mergeSettings,
	parseCommandArgs,
	PROVIDER_MAX_TOKENS,
	validateAutoRouteAliases,
	type UsageEvent,
} from "./helpers.ts";
import { consultModel, type PitajStreamSimple } from "./index.ts";
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

	it("includes provider detail and partial size when aborted", () => {
		assert.throws(
			() =>
				finalizeConsultAnswer(
					{ stopReason: "aborted", errorMessage: "cancelled upstream", rawText: "partial", partialChars: 7 },
					4000,
				),
			/aborted: cancelled upstream \(received 7 chars of partial text before failure\)/,
		);
		assert.throws(
			() =>
				finalizeConsultAnswer(
					{ stopReason: "aborted", errorMessage: "x".repeat(2_000), rawText: "partial", partialChars: 7 },
					4000,
				),
			(error: unknown) =>
				error instanceof Error &&
				error.message.length < 700 &&
				/pitaj truncated/.test(error.message) &&
				/received 7 chars/.test(error.message),
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

describe("result formatting", () => {
	it("surfaces persisted settings warnings in visible content", () => {
		const display = formatResultForDisplay("answer", {
			model: "openai/test",
			mode: "answer",
			brevity: "short",
			contextChars: 0,
			settingsWarning: 'pitaj settings.json defaultMode "oracle" is not a valid default.',
		});

		assert.match(display, /settings warning:.*defaultMode "oracle"/);
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
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	};
};

function fakeStreamImpl(plan: FakeStreamPlan, calls: unknown[][] = []): PitajStreamSimple {
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
					...(plan.usage ? { usage: plan.usage } : {}),
				};
			},
		};
	}) as unknown as PitajStreamSimple;
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

function fakeAuthFailureCtx(message = "missing credentials"): ExtensionContext {
	return {
		modelRegistry: {
			find(provider: string, modelId: string) {
				return { provider, id: modelId };
			},
			async getApiKeyAndHeaders() {
				return { ok: false, error: message };
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

/**
 * Context whose registry resolves an effective provider, so the default
 * (non-injected) streaming path can be exercised end to end.
 */
function fakeProviderCtx(options: {
	streamSimple?: unknown;
	provider?: unknown;
	auth?: { ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string };
	getProviderCalls?: string[];
}): ExtensionContext {
	const providerRecord =
		"provider" in options
			? options.provider
			: { id: "anthropic", streamSimple: options.streamSimple };
	return {
		modelRegistry: {
			find(provider: string, modelId: string) {
				return { provider, id: modelId };
			},
			getProvider(id: string) {
				options.getProviderCalls?.push(id);
				return providerRecord;
			},
			async getApiKeyAndHeaders() {
				return options.auth ?? { ok: true, apiKey: "test-key" };
			},
		},
	} as unknown as ExtensionContext;
}

describe("consultModel provider streaming boundary", () => {
	it("streams through the effective provider resolved for the model", async () => {
		const getProviderCalls: string[] = [];
		const calls: unknown[][] = [];
		const result = await consultModel(
			{ question: "q", model: "opus" },
			fakeProviderCtx({ streamSimple: fakeStreamImpl({ deltas: ["ok"], stopReason: "stop" }, calls), getProviderCalls }),
			undefined,
			LOADED,
		);
		assert.equal(result.answer, "ok");
		assert.deepEqual(getProviderCalls, ["anthropic"]);
		assert.equal(calls.length, 1);
	});

	it("fails loudly when the model's provider is not registered", async () => {
		await assert.rejects(
			consultModel({ question: "q", model: "opus" }, fakeProviderCtx({ provider: undefined }), undefined, LOADED),
			/cannot reach provider "anthropic" for anthropic\/claude-opus-4-8/,
		);
	});

	it("fails loudly when the resolved provider cannot stream", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeProviderCtx({ provider: { id: "anthropic" } }),
				undefined,
				LOADED,
			),
			/does not support streaming consultations/,
		);
	});

	it("omits an absent apiKey instead of failing an authenticated provider", async () => {
		const calls: unknown[][] = [];
		const result = await consultModel(
			{ question: "q", model: "opus" },
			fakeProviderCtx({
				streamSimple: fakeStreamImpl({ deltas: ["ok"], stopReason: "stop" }, calls),
				auth: { ok: true, headers: { "x-test": "1" } },
			}),
			undefined,
			LOADED,
		);
		assert.equal(result.answer, "ok");
		const options = calls[0][2] as Record<string, unknown>;
		assert.equal("apiKey" in options, false);
		assert.deepEqual(options.headers, { "x-test": "1" });
	});

	it("fails only when auth reports not ok", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeProviderCtx({
					streamSimple: fakeStreamImpl({ deltas: ["ok"], stopReason: "stop" }),
					auth: { ok: false, error: "no credentials configured" },
				}),
				undefined,
				LOADED,
			),
			/no credentials configured/,
		);
	});

	it("requests the brevity provider token ceiling on every round", async () => {
		for (const [brevity, expected] of Object.entries(PROVIDER_MAX_TOKENS)) {
			const calls: unknown[][] = [];
			await consultModel(
				{ question: "q", model: "opus", brevity: brevity as keyof typeof PROVIDER_MAX_TOKENS },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: ["ok"], stopReason: "stop" }, calls),
			);
			assert.equal((calls[0][2] as { maxTokens?: number }).maxTokens, expected);
		}
	});
});

describe("consultModel stream integrity", () => {
	it("fails a round whose iterator threw even when the result reports a normal stop", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({
					deltas: ["twelve chars"],
					stopReason: "stop",
					throwMidStream: new Error("socket closed"),
				}),
			),
			/failed mid-stream: socket closed \(received 12 chars of partial text before failure\)/,
		);
	});

	it("fails a round whose iterator threw even when the result reports length", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: ["abc"], stopReason: "length", throwMidStream: new Error("socket closed") }),
			),
			/failed mid-stream: socket closed/,
		);
	});

	it("does not count usage from a round whose iterator threw", async () => {
		const usage = {
			input: 5,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 10,
			cost: { input: 0.05, output: 0.05, cacheRead: 0, cacheWrite: 0, total: 0.1 },
		};
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: ["x"], stopReason: "stop", throwMidStream: new Error("boom"), usage }),
			),
			(error: unknown) => {
				assert.equal((error as { usage?: unknown }).usage, undefined);
				return /failed mid-stream: boom/.test(String(error));
			},
		);
	});

	it("reports the bounded partial-character count when result() rejects", async () => {
		const rejectingStream = (() => ({
			async *[Symbol.asyncIterator]() {
				yield { type: "text_delta", delta: "1234567890" };
			},
			async result() {
				throw new Error("result unavailable");
			},
		})) as unknown as PitajStreamSimple;
		await assert.rejects(
			consultModel({ question: "q", model: "opus" }, fakeCtx(), undefined, LOADED, undefined, rejectingStream),
			/failed mid-stream: result unavailable \(received 10 chars of partial text before failure\)/,
		);
	});

	it("never calls result() after the iterator throws", async () => {
		let resultCalls = 0;
		const throwingStream = (() => ({
			async *[Symbol.asyncIterator]() {
				yield { type: "text_delta", delta: "partial123" };
				throw new Error("socket closed");
			},
			async result() {
				resultCalls += 1;
				return {
					role: "assistant",
					content: [{ type: "text", text: "never used" }],
					stopReason: "stop",
					usage: {
						input: 9,
						output: 9,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 18,
						cost: { input: 0.09, output: 0.09, cacheRead: 0, cacheWrite: 0, total: 0.18 },
					},
				};
			},
		})) as unknown as PitajStreamSimple;

		await assert.rejects(
			consultModel({ question: "q", model: "opus" }, fakeCtx(), undefined, LOADED, undefined, throwingStream),
			/failed mid-stream: socket closed \(received 10 chars of partial text before failure\)/,
		);
		assert.equal(resultCalls, 0, "result() must never be awaited after the iterator threw");
	});

	// The Oracle counterpart of this contract lives in oracle.test.ts, where a
	// real approved repository root is available.
});

	it("rejects invalid direct-call character limits before opening a provider stream", async () => {
		for (const request of [
			{ question: "q", model: "opus", maxContextChars: 0 },
			{ question: "q", model: "opus", maxContextChars: 64_001 },
			{ question: "q", model: "opus", maxContextChars: 1.5 },
			{ question: "q", model: "opus", maxOutputChars: 0 },
			{ question: "q", model: "opus", maxOutputChars: 16_001 },
			{ question: "q", model: "opus", maxOutputChars: Number.NaN },
		] as const) {
			let streamOpened = false;
			await assert.rejects(
				consultModel(request, fakeCtx(), undefined, LOADED, undefined, ((...args: unknown[]) => {
					streamOpened = true;
					const inner = fakeStreamImpl({ deltas: ["unused"], stopReason: "stop" }) as unknown as (...innerArgs: unknown[]) => unknown;
					return inner(...args);
				}) as unknown as PitajStreamSimple),
				/finite whole number between/,
			);
			assert.equal(streamOpened, false);
		}
	});
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

		assert.equal(result.usage, undefined);
		assert.equal(result.details.model, "anthropic/claude-opus-4-8");
		assert.equal(result.details.alias, "opus");
		assert.equal(result.details.truncated, undefined);
	});

	it("returns the completed round's real usage", async () => {
		const usage = {
			input: 11,
			output: 7,
			cacheRead: 2,
			cacheWrite: 1,
			totalTokens: 21,
			cost: { input: 0.11, output: 0.07, cacheRead: 0.02, cacheWrite: 0.01, total: 0.21 },
		};
		const result = await consultModel(
			{ question: "q", model: "opus" },
			fakeCtx(),
			undefined,
			LOADED,
			undefined,
			fakeStreamImpl({ deltas: ["ok"], stopReason: "stop", usage }),
		);

		assert.deepEqual(result.usage, usage);
	});

	it("does not fabricate usage for missing or zero completed-round usage", async () => {
		const zeroUsage = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		for (const usage of [undefined, zeroUsage]) {
			const result = await consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: ["ok"], stopReason: "stop", usage }),
			);
			assert.equal(result.usage, undefined);
		}
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

	it("preserves base facts when a blank question fails before routing", async () => {
		const loaded = {
			...LOADED,
			settings: mergeSettings({
				...LOADED.settings,
				defaultMode: "debug",
				defaultBrevity: "detailed",
			}),
		};
		await assert.rejects(
			consultModel(
				{
					model: "auto",
					risk: "high",
					question: " \t ",
					context: "123456789",
					maxContextChars: 6,
					maxOutputChars: 321,
				},
				fakeCtx(),
				undefined,
				loaded,
				undefined,
				fakeStreamImpl({ deltas: ["unused"], stopReason: "stop" }),
			),
			(error: unknown) => {
				const facts = (error as { facts?: Record<string, unknown> }).facts;
				assert.ok(facts);
				assert.equal(facts.mode, "debug");
				assert.equal(facts.brevity, "detailed");
				assert.equal(facts.risk, "high");
				assert.equal(facts.autoRouted, true);
				assert.equal(facts.contextChars, boundConsultContext("123456789", 6).length);
				assert.equal(facts.maxOutputChars, 321);
				assert.equal(facts.model, undefined);
				assert.equal(facts.alias, undefined);
				assert.equal(facts.routingReason, undefined);
				return /needs a question/.test(String(error));
			},
		);
	});

	it("preserves base facts when an auto-route alias is missing", async () => {
		const loaded = {
			...LOADED,
			settings: mergeSettings({
				...LOADED.settings,
				defaultMode: "debug",
				defaultBrevity: "detailed",
				autoRouteLow: "missing",
			}),
		};
		await assert.rejects(
			consultModel(
				{
					model: "auto",
					risk: "low",
					question: "q",
					context: "123456789",
					maxContextChars: 6,
					maxOutputChars: 321,
				},
				fakeCtx(),
				undefined,
				loaded,
				undefined,
				fakeStreamImpl({ deltas: ["unused"], stopReason: "stop" }),
			),
			(error: unknown) => {
				const facts = (error as { facts?: Record<string, unknown> }).facts;
				assert.ok(facts);
				assert.equal(facts.mode, "debug");
				assert.equal(facts.brevity, "detailed");
				assert.equal(facts.risk, "low");
				assert.equal(facts.autoRouted, true);
				assert.equal(facts.contextChars, boundConsultContext("123456789", 6).length);
				assert.equal(facts.maxOutputChars, 321);
				assert.equal(facts.model, undefined);
				assert.equal(facts.alias, undefined);
				assert.equal(facts.routingReason, undefined);
				assert.equal(facts.autoSuggestedMode, undefined);
				return /requires a non-empty "missing" alias/.test(String(error));
			},
		);
	});

	it("preserves effective facts for failed default, explicit, and auto-routed auth setups", async () => {
		const cases: Array<{
			name: string;
			request: Parameters<typeof consultModel>[0];
			expected: {
				model: string;
				alias: string;
				mode: string;
				brevity: string;
				autoRouted: boolean;
				routingReason?: RegExp;
			};
		}> = [
			{
				name: "default model",
				request: { question: "q" },
				expected: { model: "anthropic/claude-opus-4-8", alias: "opus", mode: "answer", brevity: "short", autoRouted: false },
			},
			{
				name: "explicit alias",
				request: { model: "opus", question: "q", mode: "critique", brevity: "detailed", risk: "high" as const },
				expected: { model: "anthropic/claude-opus-4-8", alias: "opus", mode: "critique", brevity: "detailed", autoRouted: false },
			},
			{
				name: "auto low",
				request: { model: "auto", question: "q", risk: "low" as const },
				expected: { model: "openai-codex/gpt-5.5", alias: "gpt", mode: "answer", brevity: "short", autoRouted: true, routingReason: /risk=low/ },
			},
			{
				name: "auto high",
				request: { model: "auto", question: "q", risk: "high" as const },
				expected: { model: "anthropic/claude-opus-4-8", alias: "opus", mode: "risk-check", brevity: "short", autoRouted: true, routingReason: /risk=high/ },
			},
			{
				name: "auto risk-check",
				request: { model: "auto", question: "q", mode: "risk-check" as const },
				expected: { model: "anthropic/claude-opus-4-8", alias: "opus", mode: "risk-check", brevity: "short", autoRouted: true, routingReason: /mode=risk-check/ },
			},
		];

		for (const testCase of cases) {
			await assert.rejects(
				consultModel(testCase.request, fakeAuthFailureCtx(), undefined, LOADED, undefined, fakeStreamImpl({ deltas: ["unused"], stopReason: "stop" })),
				(error: unknown) => {
					const facts = (error as { facts?: Record<string, unknown> }).facts;
					assert.ok(facts, `${testCase.name} should expose effective facts`);
					assert.equal(facts.model, testCase.expected.model);
					assert.equal(facts.alias, testCase.expected.alias);
					assert.equal(facts.mode, testCase.expected.mode);
					assert.equal(facts.brevity, testCase.expected.brevity);
					assert.equal(facts.autoRouted, testCase.expected.autoRouted);
					if (testCase.expected.routingReason) {
						assert.match(String(facts.routingReason), testCase.expected.routingReason);
					}
					return true;
				},
			);
		}
	});

	it("preserves effective facts for a failed provider stream", async () => {
		await assert.rejects(
			consultModel(
				{ model: "opus", question: "q", mode: "debug", brevity: "short" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: ["partial"], stopReason: "error", errorMessage: "provider down" }),
			),
			(error: unknown) => {
				const facts = (error as { facts?: Record<string, unknown> }).facts;
				assert.ok(facts);
				assert.equal(facts.model, "anthropic/claude-opus-4-8");
				assert.equal(facts.alias, "opus");
				assert.equal(facts.mode, "debug");
				assert.equal(facts.brevity, "short");
				return /failed mid-stream: provider down/.test(String(error));
			},
		);
	});

	it("rejects a thrown mid-stream provider error with the iterator's own message", async () => {
		// The iterator threw, so the provider's own summary of the round is never
		// requested: the thrown error is the only trustworthy diagnostic.
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
			/failed mid-stream: read ECONNRESET \(received 35 chars of partial text/,
		);
	});

	it("rejects a provider error round that ended without throwing, using the provider message", async () => {
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
				}),
			),
			/failed mid-stream: stream disconnected \(received 35 chars of partial text/,
		);
	});

	it("does not aggregate usage from a provider error round", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({
					deltas: ["partial"],
					stopReason: "error",
					errorMessage: "stream disconnected",
					usage: {
						input: 7,
						output: 7,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 14,
						cost: { input: 0.07, output: 0.07, cacheRead: 0, cacheWrite: 0, total: 0.14 },
					},
				}),
			),
			(error: unknown) => {
				assert.equal((error as { usage?: unknown }).usage, undefined);
				return /failed mid-stream: stream disconnected/.test(String(error));
			},
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

	it("reports the bounded context actually sent and the bounded answer actually returned", async () => {
		const calls: unknown[][] = [];
		const rawContext = "c".repeat(5_000);
		const result = await consultModel(
			{ question: "q", model: "opus", context: rawContext, maxContextChars: 120, maxOutputChars: 90 },
			fakeCtx(),
			undefined,
			LOADED,
			undefined,
			fakeStreamImpl({ deltas: ["a".repeat(4_000)], stopReason: "length" }, calls),
		);

		const boundedContext = boundConsultContext(rawContext, 120);
		assert.equal(boundedContext.length, 120);
		assert.equal(result.details.contextChars, boundedContext.length);
		assert.ok(result.answer.length <= 90);
		assert.equal(result.details.answerChars, result.answer.length);

		const sent = (calls[0][1] as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text;
		assert.ok(sent.includes(`## Context\n\n${boundedContext}`));
		assert.ok(!sent.includes("c".repeat(200)));
	});

	it("reports zero context chars when no context is provided", async () => {
		const result = await consultModel(
			{ question: "q", model: "opus", context: "   " },
			fakeCtx(),
			undefined,
			LOADED,
			undefined,
			fakeStreamImpl({ deltas: ["ok"], stopReason: "stop" }),
		);
		assert.equal(result.details.contextChars, 0);
		assert.equal(result.details.answerChars, result.answer.length);
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


	it("rejects an unexpected toolUse stop in ordinary mode", async () => {
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus" },
				fakeCtx(),
				undefined,
				LOADED,
				undefined,
				fakeStreamImpl({ deltas: ["unexpected answer"], stopReason: "toolUse" }),
			),
			/unavailable tool|toolUse/,
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
