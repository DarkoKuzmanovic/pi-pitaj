import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	isDeniedPath,
	isDeniedSegment,
	ORACLE_EVIDENCE_OPERATIONS,
	ORACLE_MAX_RESULT_CHARS,
	resolveRootRelativePath,
	scanForSecrets,
	truncateEvidenceResult,
	type OracleEvidenceOperation,
} from "./oracle-policy.ts";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 100;
const MAX_SEARCH_FILES = 64;
const MAX_SEARCH_DEPTH = 6;
const MAX_SEARCH_PATTERN_CHARS = 160;

export const PITAJ_EVIDENCE_TOOL_NAME = "pitaj_request_evidence";

export const PITAJ_EVIDENCE_TOOL: Tool = {
	name: PITAJ_EVIDENCE_TOOL_NAME,
	description:
		"Request bounded read-only evidence from the approved repository. Use one operation at a time; paths are root-relative. This tool cannot run shell commands, write files, access the network, or change models.",
	parameters: Type.Object({
		operation: Type.Union(ORACLE_EVIDENCE_OPERATIONS.map((operation) => Type.Literal(operation))),
		path: Type.Optional(
			Type.String({
				description: "Optional root-relative directory for search/list_files, required root-relative file path for read_file.",
				maxLength: 512,
			}),
		),
		pattern: Type.Optional(
			Type.String({
				description: "Plain-text search pattern, required only for search.",
				maxLength: MAX_SEARCH_PATTERN_CHARS,
			}),
		),
	}),
};

export interface ApprovedOracleRoot {
	readonly path: string;
}

export interface OracleAdapterResult {
	readonly content: string;
	readonly isError: boolean;
}

interface ParsedEvidenceRequest {
	operation: OracleEvidenceOperation;
	path?: string;
	pattern?: string;
}

function genericRefusal(reason: string): OracleAdapterResult {
	return { content: `Evidence request refused: ${reason}`, isError: true };
}

function safeUnexpectedError(): OracleAdapterResult {
	return genericRefusal("host could not safely complete the requested evidence operation");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function parseEvidenceRequest(value: unknown): ParsedEvidenceRequest | OracleAdapterResult {
	if (!isRecord(value)) return genericRefusal("tool arguments must be an object");
	const operation = asOptionalString(value.operation);
	if (!operation || !ORACLE_EVIDENCE_OPERATIONS.includes(operation as OracleEvidenceOperation)) {
		return genericRefusal("operation must be read_file, search, list_files, or git_diff");
	}
	const path = asOptionalString(value.path);
	const pattern = asOptionalString(value.pattern);
	if (value.path !== undefined && path === undefined) return genericRefusal("path must be a string");
	if (value.pattern !== undefined && pattern === undefined) return genericRefusal("pattern must be a string");
	return { operation: operation as OracleEvidenceOperation, ...(path ? { path } : {}), ...(pattern ? { pattern } : {}) };
}

function pathIsInside(root: string, candidate: string): boolean {
	const pathRelative = relative(root, candidate);
	return pathRelative !== "" && !pathRelative.startsWith(`..${sep}`) && pathRelative !== "..";
}

async function assertStablePath(root: string, candidate: string): Promise<void> {
	if (!pathIsInside(root, candidate)) throw new Error("path is outside the approved root");
	const relativePath = relative(root, candidate);
	if (isDeniedPath(relativePath)) throw new Error("path is denied by the sensitive-material policy");

	let current = root;
	for (const segment of relativePath.split(sep)) {
		if (!segment) continue;
		if (isDeniedSegment(segment)) throw new Error("path is denied by the sensitive-material policy");
		current = resolve(current, segment);
		const metadata = await lstat(current);
		if (metadata.isSymbolicLink()) throw new Error("symbolic links are not allowed for evidence paths");
	}

	const canonical = await realpath(candidate);
	if (!pathIsInside(root, canonical)) throw new Error("path resolves outside the approved root");
}

async function resolveEvidencePath(root: ApprovedOracleRoot, requestedPath: string, allowRoot: boolean): Promise<string> {
	const trimmed = requestedPath.trim();
	if (allowRoot && (trimmed === "" || trimmed === ".")) return root.path;
	const resolved = resolveRootRelativePath(root.path, trimmed);
	if (!resolved.ok) throw new Error(resolved.reason);
	await assertStablePath(root.path, resolved.resolved);
	return resolved.resolved;
}

async function readRegularFile(root: ApprovedOracleRoot, requestedPath: string): Promise<{ text: string; relativePath: string }> {
	const path = await resolveEvidencePath(root, requestedPath, false);
	const beforeOpen = await lstat(path);
	if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) throw new Error("requested path is not a regular file");

	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error("requested path is not a regular file");
		if (metadata.size > MAX_FILE_BYTES) throw new Error("requested file exceeds the evidence size limit");
		const text = await handle.readFile({ encoding: "utf8" });
		return { text, relativePath: relative(root.path, path) };
	} finally {
		await handle.close();
	}
}

function safeContent(content: string, maxChars: number): OracleAdapterResult {
	const scan = scanForSecrets(content);
	if (!scan.safe) return genericRefusal(scan.refusalReason ?? "content could not be safely disclosed");
	const truncated = truncateEvidenceResult(scan.content, Math.min(maxChars, ORACLE_MAX_RESULT_CHARS));
	return { content: truncated.content, isError: false };
}

async function listFiles(root: ApprovedOracleRoot, requestedPath: string | undefined, maxChars: number): Promise<OracleAdapterResult> {
	const directory = await resolveEvidencePath(root, requestedPath ?? ".", true);
	const metadata = await lstat(directory);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("requested path is not a directory");
	const entries = await readdir(directory, { withFileTypes: true });
	const lines: string[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		if (lines.length >= MAX_LIST_ENTRIES) {
			lines.push("[pitaj oracle: list entry limit reached]");
			break;
		}
		if (isDeniedSegment(entry.name)) continue;
		const candidate = resolve(directory, entry.name);
		try {
			await assertStablePath(root.path, candidate);
			const kind = entry.isDirectory() ? "/" : entry.isFile() ? "" : " [unsupported]";
			lines.push(`${relative(root.path, candidate)}${kind}`);
		} catch {
			// Do not disclose unsafe or ambiguous entries.
		}
	}
	return safeContent(lines.join("\n") || "(no approved entries)", maxChars);
}

async function collectSearchFiles(root: ApprovedOracleRoot, directory: string): Promise<string[]> {
	const files: string[] = [];
	const visit = async (current: string, depth: number): Promise<void> => {
		if (files.length >= MAX_SEARCH_FILES || depth > MAX_SEARCH_DEPTH) return;
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (files.length >= MAX_SEARCH_FILES) return;
			if (isDeniedSegment(entry.name)) continue;
			const candidate = resolve(current, entry.name);
			try {
				await assertStablePath(root.path, candidate);
				const metadata = await lstat(candidate);
				if (metadata.isDirectory()) {
					await visit(candidate, depth + 1);
				} else if (metadata.isFile() && !metadata.isSymbolicLink()) {
					files.push(candidate);
				}
			} catch {
				// Skip unsafe or unreadable nested paths without identifying them.
			}
		}
	};
	await visit(directory, 0);
	return files;
}

async function searchFiles(
	root: ApprovedOracleRoot,
	requestedPath: string | undefined,
	pattern: string | undefined,
	maxChars: number,
): Promise<OracleAdapterResult> {
	const query = pattern?.trim();
	if (!query) return genericRefusal("search requires a non-empty plain-text pattern");
	if (query.length > MAX_SEARCH_PATTERN_CHARS) return genericRefusal("search pattern exceeds the allowed length");
	const directory = await resolveEvidencePath(root, requestedPath ?? ".", true);
	const metadata = await lstat(directory);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("requested path is not a directory");
	const matches: string[] = [];
	for (const file of await collectSearchFiles(root, directory)) {
		if (matches.length >= MAX_LIST_ENTRIES) break;
		try {
			const { text, relativePath } = await readRegularFile(root, relative(root.path, file));
			for (const [index, line] of text.split("\n").entries()) {
				if (line.includes(query)) {
					matches.push(`${relativePath}:${index + 1}: ${line}`);
					if (matches.length >= MAX_LIST_ENTRIES) break;
				}
			}
		} catch {
			// A file can change after enumeration; ignore it rather than leak host details.
		}
	}
	if (matches.length >= MAX_LIST_ENTRIES) matches.push("[pitaj oracle: search match limit reached]");
	return safeContent(matches.join("\n") || "(no approved matches)", maxChars);
}

interface GitChangedPath {
	readonly path: string;
	readonly exists: boolean;
}

/**
 * Parse `git diff --name-status -z` output into changed paths.
 *
 * NUL-separated tokens survive spaces and special characters; with -z git
 * disables quoting so each path token is the literal relative path. This is
 * more robust than parsing diff content headers (which split on spaces and
 * require quote/unquote handling).
 *
 * Record format per entry:
 *   M/A/D/T \0 path \0                        (modify / add / delete / typechange)
 *   R<score> \0 oldPath \0 newPath \0          (rename: source removed, dest added)
 *   C<score> \0 oldPath \0 newPath \0          (copy: both paths present)
 */
function parseGitNameStatus(output: string): GitChangedPath[] {
	const tokens = output.split("\0");
	const paths: GitChangedPath[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const statusToken = tokens[i];
		if (!statusToken) continue;
		const letter = statusToken[0].toUpperCase();
		const deleted = letter === "D";
		if (letter === "R" || letter === "C") {
			const oldPath = tokens[++i];
			const newPath = tokens[++i];
			// For renames the source is removed; for copies it remains on disk.
			if (oldPath) paths.push({ path: oldPath, exists: letter === "C" });
			if (newPath) paths.push({ path: newPath, exists: !deleted });
		} else {
			const path = tokens[++i];
			if (path) paths.push({ path, exists: !deleted });
		}
	}
	return paths;
}

async function assertApprovedRoot(root: ApprovedOracleRoot): Promise<void> {
	const canonical = await realpath(root.path);
	const metadata = await lstat(canonical);
	if (canonical !== root.path || !metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error("approved repository root is no longer safe");
	}
}

async function gitDiff(root: ApprovedOracleRoot, maxChars: number): Promise<OracleAdapterResult> {
	// Inspect changed paths via --name-status -z before fetching content.
	// NUL-separated tokens handle paths with spaces; -z disables quoting.
	const statusResponse = await execFileAsync(
		"git",
		["diff", "--name-status", "-z", "--no-ext-diff", "--no-textconv"],
		{ cwd: root.path, encoding: "utf8", maxBuffer: MAX_FILE_BYTES },
	);
	const statusOutput = typeof statusResponse.stdout === "string" ? statusResponse.stdout : String(statusResponse.stdout);
	for (const changed of parseGitNameStatus(statusOutput)) {
		// Lexical deny check — applies to deleted paths too.
		if (isDeniedPath(changed.path)) return genericRefusal("diff includes a denied sensitive path");
		// Lexical root/traversal check.
		const resolved = resolveRootRelativePath(root.path, changed.path);
		if (!resolved.ok) return genericRefusal("diff includes an unsafe path");
		// For paths that still exist on disk, apply the same symlink/realpath
		// policy as read_file. Deleted paths skip this (the file is gone) but
		// have already passed the lexical checks above.
		if (changed.exists) {
			try {
				await assertStablePath(root.path, resolved.resolved);
			} catch {
				return genericRefusal("diff includes an unsafe path");
			}
		}
	}

	const diffResponse = await execFileAsync(
		"git",
		["diff", "--no-ext-diff", "--no-textconv", "--unified=3"],
		{ cwd: root.path, encoding: "utf8", maxBuffer: MAX_FILE_BYTES },
	);
	const output = typeof diffResponse.stdout === "string" ? diffResponse.stdout : String(diffResponse.stdout);
	return safeContent(output || "(no working-tree diff)", maxChars);
}

export async function approveOracleRoot(requestedRoot: string): Promise<ApprovedOracleRoot> {
	try {
		const canonicalRoot = await realpath(requestedRoot.trim());
		const metadata = await lstat(canonicalRoot);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("not a directory");
		const response = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd: canonicalRoot,
			encoding: "utf8",
			maxBuffer: 16 * 1024,
		});
		const gitRoot = await realpath(String(response.stdout).trim());
		if (gitRoot !== canonicalRoot) throw new Error("not the repository root");
		return { path: canonicalRoot };
	} catch {
		throw new Error("Oracle mode requires oracleRoot to be an existing repository root.");
	}
}

export async function executeOracleEvidence(
	root: ApprovedOracleRoot,
	arguments_: unknown,
	maxChars: number = ORACLE_MAX_RESULT_CHARS,
): Promise<OracleAdapterResult> {
	try {
		await assertApprovedRoot(root);
	} catch {
		return safeUnexpectedError();
	}
	const request = parseEvidenceRequest(arguments_);
	if ("isError" in request) return request;
	const boundedChars = Math.max(0, Math.min(Math.floor(maxChars), ORACLE_MAX_RESULT_CHARS));
	try {
		switch (request.operation) {
			case "read_file": {
				if (!request.path) return genericRefusal("read_file requires a root-relative path");
				const { text } = await readRegularFile(root, request.path);
				return safeContent(text, boundedChars);
			}
			case "list_files":
				return await listFiles(root, request.path, boundedChars);
			case "search":
				return await searchFiles(root, request.path, request.pattern, boundedChars);
			case "git_diff":
				return await gitDiff(root, boundedChars);
		}
	} catch (error) {
		if (error instanceof Error && /^(empty path|absolute paths|path traversal|path resolves|path is denied|symbolic links|requested path|requested file|requested path is not|requested file exceeds)/.test(error.message)) {
			return genericRefusal(error.message);
		}
		return safeUnexpectedError();
	}
}
