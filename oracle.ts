import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { devNull } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { StringEnum, type Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	isDeniedPath,
	isDeniedSegment,
	ORACLE_EVIDENCE_OPERATIONS,
	ORACLE_MAX_RESULT_CHARS,
	resolveRootRelativePath,
	relativeRootPath,
	scanForSecrets,
	selectPathApi,
	truncateEvidenceResult,
	type OracleEvidenceOperation,
} from "./oracle-policy.ts";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 100;
const MAX_SEARCH_PATTERN_CHARS = 160;
/** Upper bound on repository files examined for one search request. */
export const MAX_SEARCH_CANDIDATES = 500;
/** Host buffer bound for the Git candidate listing itself. */
const MAX_CANDIDATE_LIST_BYTES = 4 * 1024 * 1024;
/** Initial sample inspected by the binary-file guard. */
const BINARY_SAMPLE_CHARS = 4096;
/** Finite aggregate host buffer bound for Git diff subprocess output. */
const MAX_DIFF_BYTES = 256 * 1024;
/** Staged plus unstaged changes to tracked files; untracked files are excluded. */
const GIT_DIFF_BASE_ARGS = ["diff", "HEAD", "--no-ext-diff", "--no-textconv"];
const GIT_CACHED_DIFF_ARGS = ["diff", "--cached", "--no-ext-diff", "--no-textconv"];
const GIT_UNSTAGED_DIFF_ARGS = ["diff", "--no-ext-diff", "--no-textconv"];

/**
 * Fixed argv prefix applied to every Oracle Git subprocess.
 *
 * `--no-optional-locks` keeps read-only evidence from writing index locks, and
 * `-c core.fsmonitor=false` overrides any repository-local or inherited
 * filesystem-monitor program. Command-line `-c` has the highest configuration
 * precedence, so a checked-in `.git/config` cannot reintroduce it.
 */
const GIT_HARDENED_ARG_PREFIX = ["--no-optional-locks", "-c", "core.fsmonitor=false"] as const;

/**
 * Environment rebuilt for every Oracle Git subprocess.
 *
 * Every inherited Git variable is removed rather than a named subset, matched
 * case-insensitively: Windows environment lookup ignores case, so `git_dir`
 * and `Git_External_Diff` select a repository or run a program exactly like
 * the uppercase spellings do.
 * repository selection (`GIT_DIR`, `GIT_WORK_TREE`, ...), configuration
 * injection (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_COUNT`),
 * and program-executing variables (`GIT_EXTERNAL_DIFF`, `GIT_SSH_COMMAND`,
 * `GIT_PAGER`, ...) are all `GIT_*`, so an allowlist would keep growing. Only
 * the values below are added back.
 *
 * Residual trust, stated exactly: this bounds Git's own configuration and
 * repository selection. It does not sandbox the process. `PATH` is still
 * inherited, so the resolved `git` executable itself is trusted; the working
 * tree is still read through the trusted `git` binary; and non-`GIT_*`
 * variables (`PATH`, `HOME`, `SSH_AUTH_SOCK`, ...) are preserved because
 * removing them would break ordinary local Git operation. A hostile `git` on
 * `PATH`, or a hostile system Git installation, remains out of scope.
 */
export function buildHardenedGitEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(inherited)) {
		if (name.toUpperCase().startsWith("GIT_")) continue;
		environment[name] = value;
	}
	// Read-only evidence never needs an index lock or an interactive prompt, and
	// C locale keeps parsed Git output stable.
	environment.GIT_OPTIONAL_LOCKS = "0";
	environment.GIT_TERMINAL_PROMPT = "0";
	environment.LC_ALL = "C";
	// Portable system/global configuration isolation: `GIT_CONFIG_NOSYSTEM`
	// drops the system file, and pointing the global file at the platform null
	// device drops user configuration without assuming a POSIX `/dev/null`.
	environment.GIT_CONFIG_NOSYSTEM = "1";
	environment.GIT_CONFIG_GLOBAL = devNull;
	return environment;
}

function hardenedGitEnvironment(): NodeJS.ProcessEnv {
	return buildHardenedGitEnvironment(process.env);
}

function gitExecutionOptions(cwd: string, maxBuffer: number) {
	return {
		cwd,
		encoding: "utf8" as const,
		maxBuffer,
		env: hardenedGitEnvironment(),
	};
}

/**
 * The single hardened boundary for every Oracle Git subprocess. Arguments stay
 * a fixed array passed to `execFile` — never a shell string — and always carry
 * the hardened prefix.
 */
async function runOracleGit(
	cwd: string,
	args: readonly string[],
	maxBuffer: number,
): Promise<{ stdout: string; stderr: string }> {
	const response = await execFileAsync("git", [...GIT_HARDENED_ARG_PREFIX, ...args], gitExecutionOptions(cwd, maxBuffer));
	return {
		stdout: typeof response.stdout === "string" ? response.stdout : String(response.stdout),
		stderr: typeof response.stderr === "string" ? response.stderr : String(response.stderr),
	};
}

export const PITAJ_EVIDENCE_TOOL_NAME = "pitaj_request_evidence";

export const PITAJ_EVIDENCE_TOOL: Tool = {
	name: PITAJ_EVIDENCE_TOOL_NAME,
	description:
		"Request bounded read-only evidence from the approved repository. Use one operation at a time; paths are root-relative. This tool cannot run shell commands, write files, access the network, or change models.",
	parameters: Type.Object({
		operation: StringEnum(ORACLE_EVIDENCE_OPERATIONS, {
			description:
				"The single bounded evidence operation to run. git_diff reports staged plus unstaged changes to tracked files only; use search or read_file for untracked files.",
		}),
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
	return relativeRootPath(root, candidate) !== undefined;
}

function isMissingPathError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = (error as { code?: unknown }).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Validate every existing path component. Git diffs may name a path that was
 * staged and then deleted, so callers that explicitly allow absent paths get a
 * clean result after all existing ancestors have still passed this check.
 */
async function assertStablePath(root: string, candidate: string, allowMissingPath = false): Promise<void> {
	// The same shared flavor helper the containment policy uses, so segment
	// splitting and joining never disagree with the containment decision.
	const api = selectPathApi(root);
	const relativePath = relativeRootPath(root, candidate);
	if (relativePath === undefined) throw new Error("path is outside the approved root");
	if (isDeniedPath(relativePath)) throw new Error("path is denied by the sensitive-material policy");

	let current = root;
	// `isDeniedPath` above remains conservatively cross-separator. Ancestor
	// traversal itself must use the selected platform separator, because a
	// backslash is an ordinary filename character on POSIX.
	for (const segment of relativePath.split(api.sep)) {
		if (!segment) continue;
		if (isDeniedSegment(segment)) throw new Error("path is denied by the sensitive-material policy");
		current = api.resolve(current, segment);
		try {
			const metadata = await lstat(current);
			if (metadata.isSymbolicLink()) throw new Error("symbolic links are not allowed for evidence paths");
		} catch (error) {
			if (allowMissingPath && isMissingPathError(error)) return;
			throw error;
		}
	}

	try {
		const canonical = await realpath(candidate);
		if (!pathIsInside(root, canonical)) throw new Error("path resolves outside the approved root");
	} catch (error) {
		if (allowMissingPath && isMissingPathError(error)) return;
		throw error;
	}
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
		const relativePath = relativeRootPath(root.path, path);
		if (relativePath === undefined) throw new Error("path is outside the approved root");
		return { text, relativePath };
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
			const relativePath = relativeRootPath(root.path, candidate);
			if (relativePath !== undefined) lines.push(`${relativePath}${kind}`);
		} catch {
			// Do not disclose unsafe or ambiguous entries.
		}
	}
	return safeContent(lines.join("\n") || "(no approved entries)", maxChars);
}

interface SearchCandidates {
	readonly relativePaths: string[];
	/** More repository files existed than the host candidate bound allows. */
	readonly truncated: boolean;
}

/**
 * Enumerate search candidates through Git: tracked plus non-ignored untracked
 * files, optionally narrowed to a root-relative directory. Ignored dependency
 * and build trees never become candidates. Throws when Git cannot enumerate.
 */
async function collectSearchCandidates(root: ApprovedOracleRoot, directory: string): Promise<SearchCandidates> {
	const relativeDirectory = relativeRootPath(root.path, directory, true);
	if (relativeDirectory === undefined) throw new Error("search directory is outside the approved root");
	const response = await runOracleGit(
		root.path,
		// `:(literal)` keeps a directory name from being read as pathspec magic.
		["ls-files", "-co", "--exclude-standard", "-z", ...(relativeDirectory ? ["--", `:(literal)${relativeDirectory}`] : [])],
		MAX_CANDIDATE_LIST_BYTES,
	);
	const listed = response.stdout;
	const unique = [...new Set(listed.split("\0").filter(Boolean))].sort((left, right) => left.localeCompare(right));
	return {
		relativePaths: unique.slice(0, MAX_SEARCH_CANDIDATES),
		truncated: unique.length > MAX_SEARCH_CANDIDATES,
	};
}

/** Bounded binary guard: a NUL byte in the initial sample means non-text. */
function looksBinary(text: string): boolean {
	return text.slice(0, BINARY_SAMPLE_CHARS).includes("\u0000");
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

	let candidates: SearchCandidates;
	try {
		candidates = await collectSearchCandidates(root, directory);
	} catch {
		return genericRefusal("search could not enumerate repository files");
	}

	const matches: string[] = [];
	let matchLimitReached = false;
	let skippedCandidates = 0;
	for (const candidatePath of candidates.relativePaths) {
		if (matchLimitReached) break;
		try {
			const { text, relativePath } = await readRegularFile(root, candidatePath);
			if (looksBinary(text)) {
				skippedCandidates++;
				continue;
			}
			for (const [index, line] of text.split("\n").entries()) {
				if (!line.includes(query)) continue;
				matches.push(`${relativePath}:${index + 1}: ${line}`);
				if (matches.length >= MAX_LIST_ENTRIES) {
					matchLimitReached = true;
					break;
				}
			}
		} catch {
			// A candidate can be denied, unsafe, oversized, or changed after
			// enumeration; count it without disclosing its path or the cause.
			skippedCandidates++;
		}
	}

	const notes: string[] = [];
	if (candidates.truncated) {
		notes.push(`[pitaj oracle: candidate limit reached; searched the first ${MAX_SEARCH_CANDIDATES} repository files]`);
	}
	if (skippedCandidates > 0) {
		notes.push(`[pitaj oracle: search was partial; skipped ${skippedCandidates} candidates without disclosing paths or causes]`);
	}
	if (matchLimitReached) notes.push("[pitaj oracle: search match limit reached]");
	const body = matches.length > 0
		? matches.join("\n")
		: candidates.truncated
			? `(no approved matches in the first ${MAX_SEARCH_CANDIDATES} repository files)`
			: "(no approved matches)";
	return safeContent([...notes, body].join("\n"), maxChars);
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

/** Marker error for a Git subprocess whose output passed the host buffer bound. */
class OversizedGitOutputError extends Error {}

/** Whether a failed subprocess exceeded its configured `maxBuffer`. */
function isMaxBufferFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	return code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || code === "ENOBUFS" || /maxBuffer/i.test(error.message);
}

/** Run one bounded Git command and account for its output against the diff budget. */
async function runBoundedGit(root: ApprovedOracleRoot, args: string[], budget?: GitOutputBudget): Promise<string> {
	const maxBuffer = budget?.remaining ?? MAX_DIFF_BYTES;
	if (maxBuffer <= 0) throw new OversizedGitOutputError("git output exceeded the host buffer limit");
	try {
		const { stdout, stderr } = await runOracleGit(root.path, args, maxBuffer);
		budget?.consume(stdout, stderr);
		return stdout;
	} catch (error) {
		if (isMaxBufferFailure(error)) throw new OversizedGitOutputError("git output exceeded the host buffer limit");
		throw error;
	}
}

/** Finite aggregate accounting for all Git output used to construct one diff. */
class GitOutputBudget {
	private usedBytes = 0;

	get remaining(): number {
		return Math.max(0, MAX_DIFF_BYTES - this.usedBytes);
	}

	consume(stdout: string, stderr: string): void {
		this.usedBytes += Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8");
		if (this.usedBytes > MAX_DIFF_BYTES) throw new OversizedGitOutputError("git output exceeded the host buffer limit");
	}
}

function isMissingHeadFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	return code === 1 || code === "1";
}

/** Check whether the approved repository has a resolvable commit named HEAD. */
async function repositoryHasHead(root: ApprovedOracleRoot, budget: GitOutputBudget): Promise<boolean> {
	try {
		return Boolean((await runBoundedGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"], budget)).trim());
	} catch (error) {
		// `rev-parse --verify --quiet HEAD` exits 1, without stderr, for a valid
		// repository whose current branch has no initial commit.
		if (isMissingHeadFailure(error)) return false;
		throw error;
	}
}
/** Preflight every changed path without exposing content before validation. */
async function validateChangedPathsAsync(root: ApprovedOracleRoot, statuses: readonly string[]): Promise<OracleAdapterResult | undefined> {
	const seen = new Set<string>();
	for (const changed of statuses.flatMap(parseGitNameStatus)) {
		const identity = `${changed.exists ? "exists" : "deleted"}\0${changed.path}`;
		if (seen.has(identity)) continue;
		seen.add(identity);
		// Lexical deny check — applies to deleted paths too.
		if (isDeniedPath(changed.path)) return genericRefusal("diff includes a denied sensitive path");
		// Lexical root/traversal check.
		const resolved = resolveRootRelativePath(root.path, changed.path);
		if (!resolved.ok) return genericRefusal("diff includes an unsafe path");
		// The helper checks current filesystem state, not the status letter:
		// existing paths receive full symlink/realpath validation, while an absent
		// staged or deleted path is allowed after lexical checks above.
		try {
			await assertStablePath(root.path, resolved.resolved, true);
		} catch {
			return genericRefusal("diff includes an unsafe path");
		}
	}
	return undefined;
}

/**
 * Return staged plus unstaged changes to tracked files. Committed repositories
 * use `git diff HEAD`; an unborn repository combines its cached and unstaged
 * tracked diffs because HEAD does not exist yet. Untracked files are excluded.
 * Every changed path is preflighted before content is returned, and all Git
 * output shares one finite host buffer.
 */
async function gitDiff(root: ApprovedOracleRoot, maxChars: number): Promise<OracleAdapterResult> {
	try {
		const budget = new GitOutputBudget();
		const statuses: string[] = [];
		const contents: string[] = [];
		const hasHead = await repositoryHasHead(root, budget);
		if (hasHead) {
			statuses.push(await runBoundedGit(root, [...GIT_DIFF_BASE_ARGS, "--name-status", "-z"], budget));
		} else {
			statuses.push(await runBoundedGit(root, [...GIT_CACHED_DIFF_ARGS, "--name-status", "-z"], budget));
			statuses.push(await runBoundedGit(root, [...GIT_UNSTAGED_DIFF_ARGS, "--name-status", "-z"], budget));
		}

		const refusal = await validateChangedPathsAsync(root, statuses);
		if (refusal) return refusal;

		if (hasHead) {
			contents.push(await runBoundedGit(root, [...GIT_DIFF_BASE_ARGS, "--unified=3"], budget));
		} else {
			contents.push(await runBoundedGit(root, [...GIT_CACHED_DIFF_ARGS, "--unified=3"], budget));
			contents.push(await runBoundedGit(root, [...GIT_UNSTAGED_DIFF_ARGS, "--unified=3"], budget));
		}
		const output = contents.filter(Boolean).join("\n");
		return safeContent(output || "(no staged or unstaged changes to tracked files)", maxChars);
	} catch (error) {
		if (error instanceof OversizedGitOutputError) {
			return genericRefusal("diff output exceeds the host buffer limit; narrow the request with read_file or search");
		}
		throw error;
	}
}

/** Canonical Git top-level directory containing `directory`. */
async function canonicalGitTopLevel(directory: string): Promise<string> {
	const canonicalDirectory = await realpath(directory.trim());
	const response = await runOracleGit(canonicalDirectory, ["rev-parse", "--show-toplevel"], 16 * 1024);
	return await realpath(response.stdout.trim());
}

/**
 * Approve a model-supplied `oracleRoot` for bounded read-only evidence.
 *
 * The root must be an existing canonical Git repository root and must equal the
 * Git top-level of the active Pi workspace (`workspaceCwd`). A different valid
 * Git repository is refused: Oracle evidence never leaves the active workspace.
 */
export async function approveOracleRoot(requestedRoot: string, workspaceCwd: string): Promise<ApprovedOracleRoot> {
	let canonicalRoot: string;
	try {
		canonicalRoot = await realpath(requestedRoot.trim());
		const metadata = await lstat(canonicalRoot);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("not a directory");
		const gitRoot = await canonicalGitTopLevel(canonicalRoot);
		if (gitRoot !== canonicalRoot) throw new Error("not the repository root");
	} catch {
		throw new Error("Oracle mode requires oracleRoot to be an existing repository root.");
	}

	let workspaceRoot: string;
	try {
		workspaceRoot = await canonicalGitTopLevel(workspaceCwd);
	} catch {
		throw new Error("Oracle mode requires the active workspace to be inside a Git repository.");
	}
	if (workspaceRoot !== canonicalRoot) {
		throw new Error("Oracle mode requires oracleRoot to equal the active workspace repository root.");
	}
	return { path: canonicalRoot };
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
