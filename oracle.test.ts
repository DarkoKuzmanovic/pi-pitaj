import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { stream } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mergeSettings } from "./helpers.ts";
import pitaj, { consultModel } from "./index.ts";
import {
	MAX_SEARCH_CANDIDATES,
	PITAJ_EVIDENCE_TOOL,
	PITAJ_EVIDENCE_TOOL_NAME,
	approveOracleRoot,
	executeOracleEvidence,
} from "./oracle.ts";
import { ORACLE_EVIDENCE_OPERATIONS, ORACLE_MAX_EVIDENCE_REQUESTS } from "./oracle-policy.ts";

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
	return executeOracleEvidence(await approveOracleRoot(root, root), args, maxChars);
}

describe("Oracle host evidence adapter", () => {
	it("approves only an exact Git repository root", async () => {
		const root = await makeRepository();
		const approved = await approveOracleRoot(root, root);
		assert.equal(approved.path, root);
		await assert.rejects(approveOracleRoot(join(root, "nested"), root), /repository root/);
		await assert.rejects(approveOracleRoot(join(root, "missing"), root), /repository root/);
	});

	it("approves the workspace repository root from a nested working directory", async () => {
		const root = await makeRepository();
		const approved = await approveOracleRoot(root, join(root, "nested"));
		assert.equal(approved.path, root);
	});

	it("rejects a different valid Git repository than the active workspace", async () => {
		const workspace = await makeRepository();
		const otherRepository = await makeRepository();
		await assert.rejects(
			approveOracleRoot(otherRepository, workspace),
			/active workspace repository root/,
		);
	});


	it("sanitizes inherited Git repository-selection variables", async () => {
		const workspace = await makeRepository();
		const otherRepository = await makeRepository();
		const variables = {
			GIT_DIR: join(otherRepository, ".git"),
			GIT_WORK_TREE: otherRepository,
			GIT_COMMON_DIR: join(otherRepository, ".git"),
			GIT_INDEX_FILE: join(otherRepository, ".git", "index"),
			GIT_OBJECT_DIRECTORY: join(otherRepository, ".git", "objects"),
			GIT_ALTERNATE_OBJECT_DIRECTORIES: join(otherRepository, ".git", "objects"),
		};
		const previous = new Map<string, string | undefined>(Object.keys(variables).map((name) => [name, process.env[name]]));
		try {
			for (const [name, value] of Object.entries(variables)) process.env[name] = value;
			await assert.rejects(approveOracleRoot(otherRepository, workspace), /active workspace repository root/);
		} finally {
			for (const [name, value] of previous) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
	});

	it("rejects an approved root when the active working directory is not in a repository", async () => {
		const root = await makeRepository();
		const outside = await mkdtemp(join(tmpdir(), "pi-pitaj-norepo-"));
		await assert.rejects(approveOracleRoot(root, outside), /workspace/);
	});

	it("defines exactly one virtual evidence tool with bounded arguments", () => {
		assert.equal(PITAJ_EVIDENCE_TOOL.name, PITAJ_EVIDENCE_TOOL_NAME);
		const schema = PITAJ_EVIDENCE_TOOL.parameters as unknown as { properties: Record<string, unknown> };
		assert.deepEqual(Object.keys(schema.properties).sort(), ["operation", "path", "pattern"]);
	});

	it("declares the operation parameter as a Google-compatible string enum", () => {
		const operationSchema = (PITAJ_EVIDENCE_TOOL.parameters as unknown as {
			properties: { operation: { type?: string; enum?: string[] } };
		}).properties.operation;
		assert.equal(operationSchema.type, "string");
		assert.deepEqual(operationSchema.enum, [...ORACLE_EVIDENCE_OPERATIONS]);
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

	it("searches tracked and non-ignored untracked files without scanning ignored trees", async () => {
		const root = await makeRepository();
		await writeFile(join(root, ".gitignore"), "ignored/\n");
		await mkdir(join(root, "ignored"));
		for (let i = 0; i < 80; i++) {
			await writeFile(join(root, "ignored", `dep-${String(i).padStart(3, "0")}.ts`), "needle ignored\n");
		}
		await writeFile(join(root, "zz-tracked-source.ts"), "needle tracked\n");
		await execGit(root, ["add", "zz-tracked-source.ts"]);
		await writeFile(join(root, "zz-untracked-note.txt"), "needle untracked\n");

		const search = await evidence(root, { operation: "search", pattern: "needle" });
		assert.equal(search.isError, false);
		assert.match(search.content, /zz-tracked-source\.ts:1: needle tracked/);
		assert.match(search.content, /zz-untracked-note\.txt:1: needle untracked/);
		assert.doesNotMatch(search.content, /needle ignored/);
	});

	it("respects a requested subdirectory for search", async () => {
		const root = await makeRepository();
		const search = await evidence(root, { operation: "search", path: "nested", pattern: "needle" });
		assert.equal(search.isError, false);
		assert.match(search.content, /nested\/child\.txt:1: needle nested/);
		assert.doesNotMatch(search.content, /notes\.txt/);
	});

	it("skips binary candidates instead of disclosing their bytes", async () => {
		const root = await makeRepository();
		await writeFile(join(root, "payload.bin"), Buffer.from("needle binary\u0000\u0001\u0002 tail\n", "binary"));
		const search = await evidence(root, { operation: "search", pattern: "needle" });
		assert.equal(search.isError, false);
		assert.doesNotMatch(search.content, /payload\.bin/);
	});

	it("returns an explicit refusal when candidate enumeration fails", async () => {
		const root = await makeRepository();
		const approved = await approveOracleRoot(root, root);
		await rename(join(root, ".git"), join(root, "detached-git"));
		const search = await executeOracleEvidence(approved, { operation: "search", pattern: "needle" });
		assert.equal(search.isError, true);
		assert.match(search.content, /could not enumerate/);
		assert.doesNotMatch(search.content, /no approved matches/);
	});

	it("marks a cut-short candidate enumeration instead of reporting a clean no-match", async () => {
		const root = await makeRepository();
		for (let i = 0; i < MAX_SEARCH_CANDIDATES + 20; i++) {
			await writeFile(join(root, `bulk-${String(i).padStart(4, "0")}.txt`), "filler\n");
		}
		const search = await evidence(root, { operation: "search", pattern: "zzz-absent-pattern" });
		assert.equal(search.isError, false);
		assert.match(search.content, /candidate limit reached/);
		assert.doesNotMatch(search.content, /^\(no approved matches\)$/m);
	});


	it("reports partial search when a candidate cannot be safely read", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-pitaj-search-partial-"));
		await execGit(root, ["init"]);
		await writeFile(join(root, "oversized-candidate.txt"), `oversized-candidate-token${"x".repeat(256 * 1024)}\n`);
		const search = await evidence(root, { operation: "search", pattern: "oversized-candidate-token" });
		assert.equal(search.isError, false);
		assert.match(search.content, /search was partial/i);
		assert.match(search.content, /skipped \d+ candidate/);
		assert.doesNotMatch(search.content, /oversized-candidate\.txt/);
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

	it("reports staged plus unstaged tracked changes", async () => {
		const root = await makeRepository();
		await writeFile(join(root, "source.ts"), "export const answer = 43;\n");
		await execGit(root, ["add", "source.ts"]);
		await writeFile(join(root, "notes.txt"), "needle special\nthird line\n");
		const diff = await evidence(root, { operation: "git_diff" });
		assert.equal(diff.isError, false);
		assert.match(diff.content, /answer = 43/);
		assert.match(diff.content, /third line/);
	});

	it("excludes untracked files from git_diff", async () => {
		const root = await makeRepository();
		await writeFile(join(root, "brand-new.txt"), "untracked content\n");
		const diff = await evidence(root, { operation: "git_diff" });
		assert.equal(diff.isError, false);
		assert.doesNotMatch(diff.content, /brand-new/);
		assert.match(diff.content, /no staged or unstaged changes to tracked files/);
	});

	it("refuses oversized diff output with an explicit bounded message", async () => {
		const root = await makeRepository();
		const original = Array.from({ length: 8000 }, (_, index) => `original line ${index} ${"x".repeat(24)}`).join("\n");
		await writeFile(join(root, "bulk.txt"), `${original}\n`);
		await execGit(root, ["add", "bulk.txt"]);
		await execGit(root, ["-c", "commit.gpgSign=false", "-c", "user.name=pi-pitaj-test", "-c", "user.email=pi-pitaj@example.test", "commit", "-m", "bulk"]);
		const changed = Array.from({ length: 8000 }, (_, index) => `changed line ${index} ${"y".repeat(24)}`).join("\n");
		await writeFile(join(root, "bulk.txt"), `${changed}\n`);

		const diff = await evidence(root, { operation: "git_diff" });
		assert.equal(diff.isError, true);
		assert.match(diff.content, /exceeds the host buffer limit/);
		assert.doesNotMatch(diff.content, /changed line/);
	});


	it("includes staged and unstaged tracked content in an unborn repository diff", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-pitaj-unborn-"));
		await execGit(root, ["init"]);
		await writeFile(join(root, "tracked.txt"), "staged tracked content\n");
		await execGit(root, ["add", "tracked.txt"]);
		await writeFile(join(root, "tracked.txt"), "staged tracked content\nunstaged tracked content\n");
		await writeFile(join(root, "untracked.txt"), "untracked should stay hidden\n");

		const diff = await evidence(root, { operation: "git_diff" });
		assert.equal(diff.isError, false);
		assert.match(diff.content, /staged tracked content/);
		assert.match(diff.content, /unstaged tracked content/);
		assert.doesNotMatch(diff.content, /untracked should stay hidden/);
	});


	it("accepts an unborn staged addition deleted from the working tree", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-pitaj-unborn-deleted-"));
		await execGit(root, ["init"]);
		await writeFile(join(root, "staged-then-deleted.txt"), "staged addition content\n");
		await execGit(root, ["add", "staged-then-deleted.txt"]);
		await unlink(join(root, "staged-then-deleted.txt"));

		const diff = await evidence(root, { operation: "git_diff" });
		assert.equal(diff.isError, false);
		assert.match(diff.content, /staged addition content/);
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

function fakeContext(
	findCalls: Array<{ provider: string; modelId: string }> = [],
	cwd = process.cwd(),
): ExtensionContext {
	return {
		cwd,
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

describe("public pitaj tool schema", () => {
	it("publishes the same Oracle request maximum as the host policy", () => {
		let registeredTool: { parameters?: unknown } | undefined;
		const api = {
			on() {},
			registerTool(tool: { parameters?: unknown }) {
				registeredTool = tool;
			},
			registerCommand() {},
		} as unknown as ExtensionAPI;

		pitaj(api);
		if (!registeredTool) throw new Error("pitaj did not register its tool");
		const schema = registeredTool.parameters as {
			properties: { maxEvidenceRequests: { maximum: number } };
		};
		assert.equal(schema.properties.maxEvidenceRequests.maximum, ORACLE_MAX_EVIDENCE_REQUESTS);
	});

	it("declares maxEvidenceRequests as integer-only", () => {
		let registeredTool: { parameters?: unknown } | undefined;
		const api = {
			on() {},
			registerTool(tool: { parameters?: unknown }) {
				registeredTool = tool;
			},
			registerCommand() {},
		} as unknown as ExtensionAPI;

		pitaj(api);
		if (!registeredTool) throw new Error("pitaj did not register its tool");
		const schema = registeredTool.parameters as {
			properties: { maxEvidenceRequests: { type: string; minimum: number } };
		};
		assert.equal(schema.properties.maxEvidenceRequests.type, "integer");
		assert.equal(schema.properties.maxEvidenceRequests.minimum, 1);
	});
});

describe("Oracle serial consult loop", () => {
	it("adds matching tool results in order and re-streams after evidence", async () => {
		const root = await makeRepository();
		const calls: unknown[][] = [];
		const result = await consultModel(
			{ question: "What is the answer?", model: "opus", mode: "oracle", oracleRoot: root, maxEvidenceRequests: 1 },
			fakeContext([], root),
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

	it("rejects a Git repository outside the active workspace before starting a stream", async () => {
		const workspace = await makeRepository();
		const otherRepository = await makeRepository();
		const calls: unknown[][] = [];
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus", mode: "oracle", oracleRoot: otherRepository },
				fakeContext([], workspace),
				undefined,
				LOADED,
				undefined,
				streamSequence([{ stopReason: "stop", text: "never" }], calls),
			),
			/active workspace repository root/,
		);
		assert.equal(calls.length, 0);
	});

	it("rejects a fractional evidence-request override before starting a stream", async () => {
		const root = await makeRepository();
		const calls: unknown[][] = [];
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus", mode: "oracle", oracleRoot: root, maxEvidenceRequests: 2.5 },
				fakeContext([], root),
				undefined,
				LOADED,
				undefined,
				streamSequence([{ stopReason: "stop", text: "never" }], calls),
			),
			/whole number/,
		);
		assert.equal(calls.length, 0);
	});

	it("refuses and terminates the tenth evidence request without executing it", async () => {
		const root = await makeRepository();
		const calls: unknown[][] = [];
		const step = (id: string): StreamStep => ({ stopReason: "toolUse", toolCall: { id, arguments: { operation: "read_file", path: "source.ts" } } });
		const evidenceSteps = Array.from({ length: 10 }, (_, index) => step(`call-${index + 1}`));
		await assert.rejects(
			consultModel(
				{ question: "q", model: "opus", mode: "oracle", oracleRoot: root },
				fakeContext([], root),
				undefined,
				LOADED,
				undefined,
				streamSequence(evidenceSteps, calls),
			),
			/evidence request limit reached/,
		);
		assert.equal(calls.length, 10);
	});

	it("keeps auto routing and terminal length behavior in Oracle mode", async () => {
		const root = await makeRepository();
		const findCalls: Array<{ provider: string; modelId: string }> = [];
		const result = await consultModel(
			{ question: "q", model: "auto", risk: "high", mode: "oracle", oracleRoot: root },
			fakeContext(findCalls, root),
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
					fakeContext([], root),
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
