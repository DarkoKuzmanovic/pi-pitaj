import { scanForSecrets } from "./oracle-policy.ts";
import type { SnapshotBuildInput, SnapshotCategory, SnapshotCategoryInput } from "./snapshot.ts";

const DEFAULT_MAX_TOOL_ITEMS = 5;
const DEFAULT_MAX_TOOL_ITEM_CHARS = 600;
const DEFAULT_MAX_TOOL_TOTAL_CHARS = 2_000;
const DEFAULT_RECENT_USER_ENTRY_LIMIT = 12;
const DEFAULT_RECENT_USER_CHARS = 1_000;

/**
 * Replacement text for automatically captured material that the conservative
 * secret classifier refused. It names nothing about the match: not the secret,
 * not the detector, not the line. Automatic capture is the only path that can
 * pull material the caller never chose to send, so it fails closed.
 */
export const SNAPSHOT_OMITTED_SENSITIVE_TEXT = "[snapshot source omitted: possible sensitive material]";

export interface SnapshotToolResultBufferOptions {
	maxItems?: number;
	maxItemChars?: number;
	maxTotalChars?: number;
}

export interface SnapshotToolResultRecordInput {
	toolName: string;
	result: unknown;
	isError: boolean;
}

interface SnapshotToolResultRecord {
	toolName: string;
	text: string;
	isError: boolean;
}

export interface SnapshotRuntimeSessionManager {
	getLeafEntry?: () => unknown;
	getEntry?: (id: string) => unknown;
}

export interface BuildRuntimeSnapshotInputOptions {
	question: string;
	maxContextChars: number;
	sessionManager?: SnapshotRuntimeSessionManager;
	toolResults?: SnapshotToolResultBuffer;
	customCategories?: SnapshotCategoryInput[];
	recentUserEntryLimit?: number;
	recentUserMaxChars?: number;
}

export interface SnapshotToolEventSource {
	on?: unknown;
}

export class SnapshotToolResultBuffer {
	private readonly maxItems: number;
	private readonly maxItemChars: number;
	private readonly maxTotalChars: number;
	private readonly records: SnapshotToolResultRecord[] = [];

	constructor(options: SnapshotToolResultBufferOptions = {}) {
		this.maxItems = normalizePositiveInteger(options.maxItems, DEFAULT_MAX_TOOL_ITEMS);
		this.maxItemChars = normalizePositiveInteger(options.maxItemChars, DEFAULT_MAX_TOOL_ITEM_CHARS);
		this.maxTotalChars = normalizePositiveInteger(options.maxTotalChars, DEFAULT_MAX_TOOL_TOTAL_CHARS);
	}

	record(input: SnapshotToolResultRecordInput): void {
		// Classify the complete logical source before any truncation and before
		// retention: a secret in the unretained tail must still refuse the whole
		// source, and the ring buffer must never hold raw secret text.
		const text = toolResultContainsPotentialSecret(input.result)
			? SNAPSHOT_OMITTED_SENSITIVE_TEXT
			: boundAutomaticSource(extractResultText(input.result), this.maxItemChars, `tool:${input.toolName}`);
		this.records.push({ toolName: input.toolName, text, isError: input.isError });
		while (this.records.length > this.maxItems) {
			this.records.shift();
		}
	}

	toSnapshotCategoryInput(): SnapshotCategoryInput | undefined {
		if (this.records.length === 0) {
			return undefined;
		}

		const lines = this.records.map((record) => {
			const status = record.isError ? "error" : "ok";
			return `- ${record.toolName} (${status}): ${record.text}`;
		});
		const content = truncateWithMarker(lines.join("\n"), this.maxTotalChars, "tool-results");
		return {
			category: "tool-results",
			title: "Recent tool results",
			content,
			sourceKind: "tool-result-ring-buffer",
			sourceLabel: `tool_execution_end ring buffer (${this.records.length} items)`,
		};
	}
}

export function registerSnapshotToolResultCapture(source: SnapshotToolEventSource | undefined, buffer: SnapshotToolResultBuffer): boolean {
	if (typeof source?.on !== "function") {
		return false;
	}

	source.on("tool_execution_end", (event: unknown) => {
		if (!isToolExecutionEndEvent(event)) {
			return;
		}
		buffer.record({ toolName: event.toolName, result: event.result, isError: event.isError });
	});
	return true;
}

export function buildRuntimeSnapshotInput(options: BuildRuntimeSnapshotInputOptions): SnapshotBuildInput {
	const maxContextChars = validateRuntimeLimit(options.maxContextChars, 64_000, "maxContextChars");
	const recentUserMaxChars = validateRuntimeLimit(options.recentUserMaxChars ?? DEFAULT_RECENT_USER_CHARS, 5_000, "recentUserMaxChars");
	const categories: SnapshotCategoryInput[] = [];
	const recentUserRequest = collectRecentUserRequest(options.sessionManager, {
		entryLimit: options.recentUserEntryLimit ?? DEFAULT_RECENT_USER_ENTRY_LIMIT,
		maxChars: recentUserMaxChars,
	});
	if (recentUserRequest) {
		categories.push(recentUserRequest);
	}

	const customCategories = options.customCategories?.filter(isAllowedCustomRuntimeCategory) ?? [];
	categories.push(...customCategories);

	const toolResults = options.toolResults?.toSnapshotCategoryInput();
	if (toolResults) {
		categories.push(toolResults);
	}

	return {
		question: options.question,
		maxContextChars,
		categories,
	};
}

function collectRecentUserRequest(
	sessionManager: SnapshotRuntimeSessionManager | undefined,
	limits: { entryLimit: number; maxChars: number },
): SnapshotCategoryInput | undefined {
	if (!sessionManager?.getLeafEntry || !sessionManager.getEntry) {
		return undefined;
	}

	let current = sessionManager.getLeafEntry();
	let visited = 0;
	while (isSessionEntryLike(current) && visited < limits.entryLimit) {
		const content = getUserMessageText(current);
		if (content) {
			return {
				category: "recent-user-request",
				title: "Recent user request",
				content: boundAutomaticSource(content, limits.maxChars, "recent-user-request"),
				sourceKind: "bounded-session",
				sourceLabel: `bounded leaf traversal (${visited + 1} entries)`,
			};
		}

		if (typeof current.parentId !== "string" || visited + 1 >= limits.entryLimit) {
			return undefined;
		}
		visited += 1;
		current = sessionManager.getEntry(current.parentId);
	}

	return undefined;
}

/**
 * Custom categories the runtime seam accepts. Adding a snapshot category
 * requires touching SNAPSHOT_CATEGORY_ORDER, SNAPSHOT_CAPTURE_POLICIES, and
 * (if runtime-suppliable) this list — the drift test asserts they stay aligned.
 */
export const RUNTIME_CUSTOM_CATEGORIES: readonly SnapshotCategory[] = ["active-plan", "risks"];

function isAllowedCustomRuntimeCategory(input: SnapshotCategoryInput): boolean {
	return (RUNTIME_CUSTOM_CATEGORIES as readonly string[]).includes(input.category);
}

function getUserMessageText(entry: SessionEntryLike): string | undefined {
	if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") {
		return undefined;
	}

	return messageContentToText(entry.message.content);
}

/**
 * Build the complete logical text of one message content value: every text
 * part, in order, with nothing dropped.
 *
 * This is deliberately unbounded. The secret classifier only fails closed if
 * it sees the whole source, so the full text exists as a temporary local value
 * for exactly one classification pass and is then discarded; only the bounded
 * prefix produced by `boundAutomaticSource` is ever retained or returned.
 */
function messageContentToText(content: unknown): string | undefined {
	if (typeof content === "string") {
		return content.trim() || undefined;
	}

	if (!Array.isArray(content)) {
		return undefined;
	}

	const parts: string[] = [];
	for (const part of content) {
		if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
			continue;
		}
		parts.push(part.text);
	}

	return parts.join("\n").trim() || undefined;
}

/** Complete logical text of one tool result, before any bound is applied. */
function extractResultText(result: unknown): string {
	const content = isRecord(result) ? result.content : undefined;
	const contentText = messageContentToText(content);
	if (contentText) {
		return contentText;
	}

	if (typeof result === "string") {
		return result.trim();
	}

	return safeStringify(result);
}


/**
 * Inspect every complete top-level string before the generic fallback selects
 * a bounded summary. Neither a discarded tail nor a later field may turn a
 * sensitive automatic source into an apparently safe retained prefix.
 */
function toolResultContainsPotentialSecret(result: unknown): boolean {
	const content = isRecord(result) ? result.content : undefined;
	const contentText = messageContentToText(content);
	if (contentText && !scanForSecrets(contentText).safe) return true;
	if (typeof result === "string") return !scanForSecrets(result).safe;
	if (!isRecord(result)) return false;
	for (const [, value] of Object.entries(result)) {
		if (typeof value === "string" && !scanForSecrets(value).safe) return true;
	}
	return false;
}

/**
 * Run the conservative Oracle secret classifier over automatically captured
 * text and replace refused material with a fixed marker. The caller's explicit
 * question and `-c/--context` are opt-in and are deliberately not scanned here.
 */
function omitSensitiveText(text: string): string {
	return scanForSecrets(text).safe ? text : SNAPSHOT_OMITTED_SENSITIVE_TEXT;
}

/**
 * Classify one complete automatic source, then bound it.
 *
 * Order matters and is the whole point: the classifier runs over the entire
 * logical source, so a secret past the retained prefix — or in a late
 * multipart text part — replaces the entire source rather than being silently
 * cut away and forgotten. Only a source that is safe in full is truncated and
 * retained.
 */
function boundAutomaticSource(text: string, maxChars: number, label: string): string {
	const classified = omitSensitiveText(text);
	if (classified === SNAPSHOT_OMITTED_SENSITIVE_TEXT) {
		return classified;
	}
	return truncateWithMarker(classified, maxChars, label);
}

function truncationMarker(label: string, omittedChars: number): string {
	return `… [snapshot:${label} truncated ${omittedChars} chars]`;
}

/**
 * Truncate to the cap and report the exact number of omitted characters:
 * complete source length minus retained prefix length, with the marker itself
 * budgeted inside the cap.
 *
 * The marker's own length depends on the digits of the count it carries, so
 * the retained prefix is grown from a guaranteed-safe lower bound (the widest
 * possible marker) until one more character would overrun the cap.
 */
function truncateWithMarker(text: string, maxChars: number, label: string): string {
	const normalizedLimit = normalizePositiveInteger(maxChars, 1);
	if (text.length <= normalizedLimit) {
		return text;
	}

	let headLength = Math.max(0, normalizedLimit - truncationMarker(label, text.length).length);
	while (
		headLength < normalizedLimit &&
		headLength + 1 + truncationMarker(label, text.length - headLength - 1).length <= normalizedLimit
	) {
		headLength += 1;
	}

	if (headLength === 0) {
		return truncationMarker(label, text.length).slice(0, normalizedLimit);
	}

	// `trimEnd` only shortens the prefix, so the recomputed count stays exact
	// and the result stays inside the cap.
	const retained = text.slice(0, headLength).trimEnd();
	return `${retained}${truncationMarker(label, text.length - retained.length)}`;
}

function safeStringify(value: unknown): string {
	try {
		return stringifyShallow(value);
	} catch {
		return String(value);
	}
}

function stringifyShallow(value: unknown): string {
	if (!isRecord(value)) {
		return JSON.stringify(value) ?? String(value);
	}

	const entries = Object.entries(value).slice(0, 8).map(([key, entryValue]) => [key, summarizeJsonValue(entryValue)]);
	return JSON.stringify(Object.fromEntries(entries));
}

function summarizeJsonValue(value: unknown): unknown {
	if (typeof value === "string") {
		return value.length > 120 ? `${value.slice(0, 120)}…` : value;
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		return value;
	}
	if (Array.isArray(value)) {
		return `[array:${value.length}]`;
	}
	if (isRecord(value)) {
		return "[object]";
	}
	return String(value);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value) || value < 1) {
		return fallback;
	}
	return Math.floor(value);
}

function validateRuntimeLimit(value: number, maximum: number, field: string): number {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > maximum) {
		throw new Error(`${field} must be a finite whole number between 1 and ${maximum}.`);
	}
	return value;
}

interface SessionEntryLike {
	type?: unknown;
	id?: unknown;
	parentId?: unknown;
	message?: unknown;
}

function isSessionEntryLike(value: unknown): value is SessionEntryLike {
	return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isToolExecutionEndEvent(value: unknown): value is SnapshotToolResultRecordInput {
	return (
		isRecord(value) &&
		typeof value.toolName === "string" &&
		"result" in value &&
		typeof value.isError === "boolean"
	);
}
