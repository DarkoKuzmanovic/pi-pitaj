/**
 * Oracle-lite pure policy module.
 *
 * Contains all validation, budget accounting, path-policy, redaction, and
 * host-action marker logic for Oracle mode. No filesystem I/O — realpath,
 * lstat, O_NOFOLLOW, and the actual evidence adapter live in O2.
 *
 * The sidecar never receives a root selector or model choice. The host
 * validates the root, resolves paths, and applies this policy before any
 * evidence reaches the sidecar context.
 */

import { isAbsolute, normalize, sep } from "node:path";

// --- Budget constants (hard maximums; callers cannot raise these) ------------

export const ORACLE_MAX_EVIDENCE_REQUESTS = 9;
export const ORACLE_MAX_RESULT_CHARS = 4_000;
export const ORACLE_MAX_TOTAL_CHARS = 18_000;

/** Minimum evidence-request override a caller can set. */
export const ORACLE_MIN_EVIDENCE_REQUESTS = 1;

// --- Evidence operations -----------------------------------------------------

export const ORACLE_EVIDENCE_OPERATIONS = [
	"read_file",
	"search",
	"list_files",
	"git_diff",
] as const;

export type OracleEvidenceOperation = (typeof ORACLE_EVIDENCE_OPERATIONS)[number];

// --- Denied path patterns (case-insensitive) ---------------------------------
//
// Matched against every path *segment* (directory/file basename) after
// normalization. A path is denied if ANY segment matches ANY pattern.
// Patterns use simple glob semantics: `*` matches zero or more characters.

export const ORACLE_DENIED_SEGMENTS: readonly string[] = [
	".git",
	".env*",
	".npmrc",
	".netrc",
	".aws",
	".ssh",
	".docker",
	"credentials*",
	"secret*",
	"token*",
	"password*",
	"*private*key*",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"id_rsa",
	"id_ed25519",
];

// --- Host-action marker ------------------------------------------------------

export const PITAJ_HOST_ACTION_MARKER = "PITAJ_NEEDS_HOST_ACTION";

// --- Types -------------------------------------------------------------------

export interface OracleEvidenceRequest {
	operation: OracleEvidenceOperation;
	/** Root-relative path for read_file / search / list_files. */
	path?: string;
	/** Search pattern for the `search` operation. */
	pattern?: string;
}

export interface OracleEvidenceResult {
	operation: OracleEvidenceOperation;
	content: string;
	truncated: boolean;
	refused: boolean;
	refusalReason?: string;
}

export interface OracleBudgetState {
	requestsUsed: number;
	totalChars: number;
}

export interface OracleBudgetCheck {
	allowed: boolean;
	reason?: string;
}

export interface OracleRequestValidation {
	ok: boolean;
	reason?: string;
}

export interface HostAction {
	action: string;
	reason: string;
}

// --- Request / root validation ----------------------------------------------

/**
 * Validate that Oracle mode has a non-empty oracleRoot.
 * Returns `{ ok: true }` when valid, or `{ ok: false, reason }` otherwise.
 *
 * `oracleRoot` is required at runtime for oracle mode — there is no cwd
 * fallback. The host must supply an explicitly approved repository root.
 */
export function validateOracleRequest(request: {
	mode?: string;
	oracleRoot?: string;
}): OracleRequestValidation {
	if (request.mode !== "oracle") return { ok: true };
	const root = request.oracleRoot?.trim();
	if (!root) {
		return { ok: false, reason: "Oracle mode requires an explicit oracleRoot; there is no cwd fallback." };
	}
	return { ok: true };
}

/**
 * Resolve the caller-supplied evidence-request override into an effective
 * request limit. Whole numbers are clamped into the allowed range; the hard
 * maximum (ORACLE_MAX_EVIDENCE_REQUESTS) can never be raised. A fractional or
 * non-finite override is rejected instead of being expanded to the maximum.
 */
export function resolveEvidenceRequestLimit(
	value: number | undefined,
): number {
	if (value === undefined) return ORACLE_MAX_EVIDENCE_REQUESTS;
	if (!Number.isInteger(value)) {
		throw new Error(
			`maxEvidenceRequests must be a whole number between ${ORACLE_MIN_EVIDENCE_REQUESTS} and ${ORACLE_MAX_EVIDENCE_REQUESTS}.`,
		);
	}
	return Math.min(Math.max(value, ORACLE_MIN_EVIDENCE_REQUESTS), ORACLE_MAX_EVIDENCE_REQUESTS);
}

// --- Path policy (pure string logic — no fs I/O) -----------------------------

/**
 * Resolve a root-relative path and reject traversal outside the root.
 * Pure string logic: normalizes the joined path and checks the result
 * stays under the root. Realpath/lstat/O_NOFOLLOW checks are O2.
 *
 * Returns `{ ok: true, resolved }` or `{ ok: false, reason }`.
 */
export function resolveRootRelativePath(
	root: string,
	relativePath: string,
): { ok: true; resolved: string } | { ok: false; reason: string } {
	const trimmedPath = relativePath.trim();
	if (!trimmedPath) {
		return { ok: false, reason: "empty path" };
	}
	if (isAbsolute(trimmedPath)) {
		return { ok: false, reason: "absolute paths are not allowed; use root-relative paths" };
	}

	const rootNorm = normalize(root);
	const joined = normalize(`${rootNorm}${sep}${trimmedPath}`);

	if (joined === rootNorm) {
		return { ok: false, reason: "path resolves to the root itself" };
	}
	if (!joined.startsWith(`${rootNorm}${sep}`)) {
		return { ok: false, reason: "path traversal outside the approved root" };
	}
	return { ok: true, resolved: joined };
}

/**
 * Convert a simple glob pattern (`*` = zero or more chars) to a RegExp.
 * All matching is case-insensitive.
 */
function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

const DENIED_SEGMENT_REGEXES: readonly RegExp[] = ORACLE_DENIED_SEGMENTS.map(globToRegExp);

/**
 * Check whether a single path segment (basename) matches any denied pattern.
 * Case-insensitive.
 */
export function isDeniedSegment(segment: string): boolean {
	return DENIED_SEGMENT_REGEXES.some((re) => re.test(segment));
}

/**
 * Check whether a root-relative path contains any denied segment.
 * Splits on both `/` and `\` to handle cross-platform paths.
 */
export function isDeniedPath(relativePath: string): boolean {
	const segments = relativePath.trim().split(/[/\\]/).filter(Boolean);
	return segments.some(isDeniedSegment);
}

// --- Budget accounting --------------------------------------------------------

/**
 * Check whether a new evidence request is allowed under the current budget.
 * Does not mutate state — the caller consumes budget via `consumeBudget`.
 */
export function checkEvidenceBudget(
	state: OracleBudgetState,
	maxRequests: number = ORACLE_MAX_EVIDENCE_REQUESTS,
): OracleBudgetCheck {
	if (state.requestsUsed >= maxRequests) {
		return {
			allowed: false,
			reason: `evidence budget exhausted: ${state.requestsUsed}/${maxRequests} requests used`,
		};
	}
	if (state.totalChars >= ORACLE_MAX_TOTAL_CHARS) {
		return {
			allowed: false,
			reason: `evidence budget exhausted: ${state.totalChars}/${ORACLE_MAX_TOTAL_CHARS} total chars used`,
		};
	}
	return { allowed: true };
}

/**
 * Consume one evidence request from the budget. Invalid and refused requests
 * still consume the request budget (but not the char budget, since no content
 * was returned). Returns the updated state.
 */
export function consumeEvidenceBudget(
	state: OracleBudgetState,
	resultChars: number,
): OracleBudgetState {
	return {
		requestsUsed: state.requestsUsed + 1,
		totalChars: state.totalChars + Math.max(0, resultChars),
	};
}

export function createOracleBudgetState(): OracleBudgetState {
	return { requestsUsed: 0, totalChars: 0 };
}

// --- Evidence result truncation ----------------------------------------------

/**
 * Truncate an evidence result to the per-result character cap.
 * Appends a visible truncation marker when content is cut.
 */
export function truncateEvidenceResult(
	content: string,
	maxChars: number = ORACLE_MAX_RESULT_CHARS,
): { content: string; truncated: boolean } {
	const cap = Math.max(0, Math.floor(maxChars));
	if (content.length <= cap) return { content, truncated: false };
	if (cap === 0) return { content: "", truncated: true };

	const markerFor = (omitted: number): string => `\n\n[pitaj oracle: truncated ${omitted} characters]`;
	const initialMarker = markerFor(content.length - cap);
	if (initialMarker.length >= cap) {
		return { content: content.slice(0, cap), truncated: true };
	}

	let headLength = cap - initialMarker.length;
	let marker = markerFor(content.length - headLength);
	if (headLength + marker.length > cap) {
		headLength = Math.max(0, headLength - (headLength + marker.length - cap));
		marker = markerFor(content.length - headLength);
	}
	if (headLength === 0 || marker.length >= cap) {
		return { content: content.slice(0, cap), truncated: true };
	}

	return {
		content: `${content.slice(0, headLength)}${marker}`.slice(0, cap),
		truncated: true,
	};
}

// --- Secret-pattern redaction / refusal --------------------------------------
//
// Conservative heuristic scan for common secret material. This is a
// mitigation, not a guarantee — a non-denied path is not proof it contains
// no secret. When a strong match is found, the content is refused entirely
// rather than partially redacted, to avoid leaking fragments.

const SECRET_PATTERNS: readonly RegExp[] = [
	// Private key blocks (PEM/DER)
	/-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP|ENCRYPTED)?\s*PRIVATE\s+KEY-----/i,
	// AWS access key IDs
	/AKIA[0-9A-Z]{16}/,
	// AWS secret keys (40-char base64 after assignment)
	/(?:aws_secret_access_key|secret_access_key)\s*[:=]\s*[A-Za-z0-9/+=]{40}/i,
	// GitHub tokens
	/gh[pousr]_[A-Za-z0-9]{36,}/i,
	// Generic API key / token assignments
	/(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*["']?[A-Za-z0-9_\-+/=]{20,}["']?/i,
];

/**
 * Candidate assignment key: `password`, `dbPassword`, `passwordHash`,
 * `"password"`, and the passwd/pwd variants. Filtering the full identifier
 * rather than requiring a word boundary catches camel-case names without
 * turning type declarations into credentials on its own.
 */
const PASSWORD_ASSIGNMENT_PATTERN = /(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)["']?\s*\??\s*[:=]/gi;

/**
 * A value that starts with a TypeScript type-only expression such as `string`,
 * `string[]`, or `string | undefined`, followed only by a declaration
 * terminator. This is a type declaration, not an assigned credential.
 */
const PASSWORD_TYPE_DECLARATION_PREFIX =
	/^(?:readonly\s+)?(?:string|number|boolean|bigint|symbol|object|any|unknown|never|null|undefined)(?:\[\])*(?:\s*\|\s*(?:string|number|boolean|bigint|symbol|object|any|unknown|never|null|undefined)(?:\[\])*)*\s*$/;

/** Shortest assigned value still treated as a possible credential. */
const MIN_PASSWORD_VALUE_CHARS = 4;

/** Read one assignment value without consuming a later assignment on the line. */
function readPasswordAssignedValue(content: string, start: number): string {
	let index = start;
	while (/\s/.test(content[index] ?? "")) index++;
	const first = content[index];
	if (first === "\"" || first === "'" || first === "`") {
		let escaped = false;
		for (let cursor = index + 1; cursor < content.length; cursor++) {
			const character = content[cursor];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === first) return content.slice(index + 1, cursor);
		}
		return content.slice(index + 1);
	}
	const lineEnd = content.indexOf("\n", index);
	const line = content.slice(index, lineEnd === -1 ? content.length : lineEnd);
	const boundary = line.search(/[;,)}]/);
	return boundary === -1 ? line : line.slice(0, boundary);
}

/**
 * Decide whether an assigned password value looks like a credential rather than
 * a TypeScript declaration. `password: string;` is a type declaration and is
 * allowed; `password: "hunter2secret"` and `PASSWORD=hunter2secret` are refused.
 */
function passwordValueLooksLikeCredential(rawValue: string): boolean {
	const value = rawValue.trim();
	if (!value) return false;
	if (PASSWORD_TYPE_DECLARATION_PREFIX.test(value)) return false;
	return value.length >= MIN_PASSWORD_VALUE_CHARS;
}

/** Detect a password assignment whose value looks like a real credential. */
function containsPasswordCredential(content: string): boolean {
	for (const match of content.matchAll(PASSWORD_ASSIGNMENT_PATTERN)) {
		const identifier = match[1] ?? "";
		if (!/(?:password|passwd|pwd)/i.test(identifier)) continue;
		const valueStart = (match.index ?? 0) + match[0].length;
		if (passwordValueLooksLikeCredential(readPasswordAssignedValue(content, valueStart))) return true;
	}
	return false;
}

export interface SecretScanResult {
	/** Safe to show to the sidecar. */
	safe: boolean;
	/** Redacted content (only when safe is true and redaction occurred). */
	content: string;
	/** Reason for refusal (only when safe is false). */
	refusalReason?: string;
}

/**
 * Scan content for common secret patterns. If a strong match is found,
 * refuse the content entirely. Otherwise return it unchanged.
 */
export function scanForSecrets(content: string): SecretScanResult {
	const refusal = {
		safe: false as const,
		content: "",
		refusalReason: "content matched a secret pattern; refusing to avoid leaking credentials",
	};
	for (const pattern of SECRET_PATTERNS) {
		if (pattern.test(content)) return refusal;
	}
	if (containsPasswordCredential(content)) return refusal;
	return { safe: true, content };
}

// --- PITAJ_NEEDS_HOST_ACTION marker ------------------------------------------

/**
 * Format a host-action marker. The sidecar emits this when it needs an
 * action it cannot perform (e.g., running tests, writing a file).
 *
 * Format:
 * ```
 * PITAJ_NEEDS_HOST_ACTION
 * action: <action>
 * reason: <reason>
 * ```
 */
export function formatHostActionMarker(action: string, reason: string): string {
	const cleanAction = action.trim() || "unspecified";
	const cleanReason = reason.trim() || "unspecified";
	return [
		PITAJ_HOST_ACTION_MARKER,
		`action: ${cleanAction}`,
		`reason: ${cleanReason}`,
	].join("\n");
}

/**
 * Parse a host-action marker from text. Returns the parsed action/reason
 * if the marker is present and well-formed, or `undefined` otherwise.
 *
 * The marker may appear anywhere in the text (the sidecar may include
 * preamble), but must start at the beginning of a line.
 */
export function parseHostActionMarker(text: string): HostAction | undefined {
	const lines = text.split("\n");
	const markerIndex = lines.findIndex((line) => line.trim() === PITAJ_HOST_ACTION_MARKER);
	if (markerIndex === -1) return undefined;

	let action = "";
	let reason = "";
	for (let i = markerIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		const actionMatch = line.match(/^\s*action:\s*(.*)$/i);
		if (actionMatch) {
			action = actionMatch[1].trim();
			continue;
		}
		const reasonMatch = line.match(/^\s*reason:\s*(.*)$/i);
		if (reasonMatch) {
			reason = reasonMatch[1].trim();
			continue;
		}
		// Stop at the first non-field line after the marker
		if (line.trim() && !actionMatch && !reasonMatch) break;
	}
	if (!action && !reason) return undefined;
	return { action: action || "unspecified", reason: reason || "unspecified" };
}

/**
 * Check whether text contains a host-action marker.
 */
export function containsHostActionMarker(text: string): boolean {
	return parseHostActionMarker(text) !== undefined;
}
