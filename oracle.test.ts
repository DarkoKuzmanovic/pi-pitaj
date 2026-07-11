import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { stream } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mergeSettings } from "./helpers.ts";
import { consultModel } from "./index.ts";
import {
	PITAJ_EVIDENCE_TOOL,
	PITAJ_EVIDENCE_TOOL_NAME,
	approveOracleRoot,
	executeOracleEvidence,
} from "./oracle.ts";

function execGit(cwd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd }, (error) => (error ? reject(error) : resolve()));
	});
}

async function makeRepository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-pitaj-oracle-"));
	await execGit(root, ["init"]);
	await writeFile(join(root, "source.ts"), "export const answer = 42;\n");
	await writeFile(join(root, "notes.txt"), "needle special\nsecond line\n");
	await writeFile(join(root, ".env"), "SAFE=1\n");
	await mkdir(join(root, "nested"));
	await writeFile(join(root, "nested", "child.txt"), "needle nested\n");
	await execGit(root, ["add", "."]);
	await execGit(root, ["-c", "commit.gpgSign=false", "-c", "user.name=pi-pitaj-test", "-c", "user.email=pi-pitaj@example.test", "commit", "-m", "fixture"]);
	return root;
}

async function evidence(root: string, args: unknown, maxChars?: number) {
	return executeOracleEvidence(await approveOracleRoot(root), args, maxChars);
}

describe("Oracle host evidence adapter", () => {
	it("approves only an exact Git repository root", async () => {
		const root = await makeRepository();
		const approved = await approveOracleRoot(root);
		assert.equal(approved.path, root);
		await assert.rejects(approveOracleRoot(join(root, "nested")), /repository root/);
		await assert.rejects(approveOracleRoot(join(root, "missing")), /repository root/);
	});

	it("defines exactly one virtual evidence tool with bounded arguments", () => {
		assert.equal(PITAJ_EVIDENCE_TOOL.name, PITAJ_EVIDENCE_TOOL_NAME);
		const schema = PITAJ_EVIDENCE_TOOL.parameters as unknown as { properties: Record<string, unknown> };
		assert.deepEqual(Object.keys(schema.properties).sort(), ["operation", "path", "pattern"]);
	});

	it("reads an approved regular file and rejects traversal and denied paths", async () => {
		const root = await makeRepository();
		const success = await evidence(root, { operation: "read_file", path: "source.ts" });
		assert.equal(success.isError, false);
		assert.match(success.content, /answer = 42/);

		const traversal = await evidence(root, { operation: "read_file", path: "../outside.txt" });
		assert.equal(traversal.isError, true);
		assert.doesNotMatch(traversal.content, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

		await writeFile(join(root, ".env"), "PASSWORD=do-not-show\n");
		const denied = await evidence(root, { operation: "read_file", path: ".env" });
		assert.equal(denied.isError, true);
		assert.doesNotMatch(denied.content, /do-not-show/);
	});

	it("rejects symlink escapes, symlink leaves, directories, and oversized files", async () => {
		const root = await makeRepository();
		const outside = await mkdtemp(join(tmpdir(), "pi-pitaj-outside-"));
		await writeFile(join(outside, "outside.txt"), "outside secret\n");
		await symlink(join(outside, "outside.txt"), join(root, "escape.txt"));
		await symlink(join(root, "source.ts"), join(root, "leaf-link.ts"));
		for (const path of ["escape.txt", "leaf-link.ts", "nested"]) {
			const result = await evidence(root, { operation: "read_file", path });
			assert.equal(result.isError, true);
			assert.doesNotMatch(result.content, /outside secret/);
		}
		await writeFile(join(root, "large.txt"), "x".repeat(256 * 1024 + 1));
		const large = await evidence(root, { operation: "read_file", path: "large.txt" });
		assert.equal(large.isError, true);
	});

	it("bounds list and search output without absolute paths or denied files", async () => {
		const root = await makeRepository();
		const search = await evidence(root, { operation: "search", pattern: "special" }, 600);
		assert.equal(search.isError, false);
		assert.ok(search.content.length <= 600);
		assert.match(search.content, /notes\.txt:1: needle special/);
		assert.doesNotMatch(search.content, /hidden/);

		for (let i = 0; i < 120; i++) await writeFile(join(root, `entry-${i}.txt`), `needle ${i}\n`);
		await writeFile(join(root, "secret-token.txt"), "needle hidden\n");
		const list = await evidence(root, { operation: "list_files" }, 500);
		assert.equal(list.isError, false);
		assert.ok(list.content.length <= 500);
		assert.doesNotMatch(list.content, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.doesNotMatch(list.content, /secret-token/);
	});

	it("filters denied and secret Git diffs before returning content", async () => {
		const root = await makeRepository();
		await writeFile(join(root, "source.ts"), "export const answer = 43;\n");
		const diff = await evidence(root, { operation: "git_diff" });
		assert.equal(diff.isError, false);
		assert.match(diff.content, /answer = 43/);
		await writeFile(join(root, ".env"), "PASSWORD=do-not-show\n");
		const deniedDiff = await evidence(root, { operation: "git_diff" });
		assert.equal(deniedDiff.isError, true);
		assert.doesNotMatch(deniedDiff.content, /do-not-show/);
	});

	it("refuses a git_diff touching a tracked sensitive path even with harmless content", async () => {
		const root = await makeRepository();
		// .env is tracked (committed with SAFE=1); change to harmless content.
		await writeFile(join(root, ".env"), "SAFE=2\n");
		const diff = await evidence(root, { operation: "git_diff" });
		assert.equal(diff.isError, true);
		assert.match(diff.content, /denied sensitive path/);
		assert.doesNotMatch(diff.content, /SAFE/);
	});
});

type StreamStep = {
	stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
	text?: string;
	toolCall?: { id: string; name?: string; arguments: Record<string, unknown> };
	errorMessage?: string;
};

function streamSequence(steps: StreamStep[], calls: unknown[][]): typeof stream {
	let index = 0;
	return ((...args: unknown[]) => {
		calls.push(args);
		const step = steps[index++];
		if (!step) throw new Error("unexpected extra stream round");
		const content = step.toolCall
			? [{ type: "toolCall", id: step.toolCall.id, name: step.toolCall.name ?? PITAJ_EVIDENCE_TOOL_NAME, arguments: step.toolCall.arguments }]
			: [{ type: "text", text: step.text ?? "" }];
		return {
			async *[Symbol.asyncIterator]() {
				if (step.text) yield { type: "text_delta", delta: step.text };
			},
			async result() {
				return {
					role: "assistant",
					content,
					stopReason: step.stopReason,
					...(step.errorMessage ? { errorMessage: step.errorMessage } : {}),
				};
			},
		};
	}) as unknown as typeof stream;
}

function fakeContext(findCalls: Array<{ provider: string; modelId: string }> = []): ExtensionContext {
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
	settings: mergeSettings({ aliases: { opus: "anthropic/claude-opus-4-8", gpt: "openai-codex/gpt-5.5" } }),
	fileState: "loaded" as const,
};

describe("Oracle serial consult loop", () => {
	it("adds matching tool results in order and re-streams after evidence", async () => {
		const root = await makeRepository();
		const calls: unknown[][] = [];
		const result = await consultModel(
			{ question: "What is the answer?", model: "opus", mode: "oracle", oracleRoot: root, maxEvidenceRequests: 1 },
			fakeContext(),
			undefined,
			LOADED,
			undefined,
			streamSequence(
				[
					{ stopReason: "toolUse", toolCall: { id: "call-1", arguments: { operation: "read_file", path: "source.ts" } } },
					{ stopReason: "stop", text: "The answer is 42." },
				],
				calls,
			),
		);
		assert.equal(result.answer, "The answer is 42.");
		assert.equal(calls.length, 2);
		const secondContext = calls[1][1] as { messages: Array<Record<string, unknown>>; tools: Array<{ name: string }>; systemPrompt: string };
		assert.equal(secondContext.tools.length, 1);
		assert.equal(secondContext.tools[0].name, PITAJ_EVIDENCE_TOOL_NAME);
		assert.match(secondContext.systemPrompt, /at most 1 evidence operations/);
		assert.equal(secondContext.messages[1].role, "assistant");
		assert.equal(secondContext.messages[2].role, "toolResult");
		assert.equal(secondContext.messages[2].toolCallId, "call-1");
		assert.equal(secondContext.messages[2].toolName, PITAJ_EVIDENCE_TOOL_NAME);
		assert.equal(secondContext.messages[2].isError, false);
	});

	it("rejects missing or invalid roots before starting a stream", async () => {
		const calls: unknown[][] = [];
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus", mode: "oracle" },
				fakeContext(),
				undefined,
				LOADED,
				undefined,
				streamSequence([{ stopReason: "stop", text: "never" }], calls),
			),
			/oracleRoot/,
		);
		assert.equal(calls.length, 0);
	});

	it("refuses and terminates the fourth evidence request without executing it", async () => {
		const root = await makeRepository();
		const calls: unknown[][] = [];
		const step = (id: string): StreamStep => ({ stopReason: "toolUse", toolCall: { id, arguments: { operation: "read_file", path: "source.ts" } } });
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus", mode: "oracle", oracleRoot: root },
				fakeContext(),
				undefined,
				LOADED,
				undefined,
				streamSequence([step("one"), step("two"), step("three"), step("four")], calls),
			),
			/evidence request limit reached/,
		);
		assert.equal(calls.length, 4);
	});

	it("keeps auto routing and terminal length behavior in Oracle mode", async () => {
		const root = await makeRepository();
		const findCalls: Array<{ provider: string; modelId: string }> = [];
		const result = await consultModel(
			{ question: "q", model: "auto", risk: "high", mode: "oracle", oracleRoot: root },
			fakeContext(findCalls),
			undefined,
			LOADED,
			undefined,
			streamSequence([{ stopReason: "length", text: "partial" }], []),
		);
		assert.deepEqual(findCalls, [{ provider: "anthropic", modelId: "claude-opus-4-8" }]);
		assert.equal(result.details.autoRouted, true);
		assert.equal(result.details.truncated, true);
	});


	it("preserves terminal error and aborted handling in Oracle mode", async () => {
		const root = await makeRepository();
		for (const stopReason of ["error", "aborted"] as const) {
			await assert.rejects(
				consultModel(
					{ question: "q", model: "opus", mode: "oracle", oracleRoot: root },
					fakeContext(),
					undefined,
					LOADED,
					undefined,
					streamSequence([{ stopReason, text: "partial", ...(stopReason === "error" ? { errorMessage: "upstream failed" } : {}) }], []),
				),
				stopReason === "error" ? /upstream failed/ : /aborted/,
			);
		}
	});
});
