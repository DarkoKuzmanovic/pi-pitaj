import type { SnapshotBuildInput, SnapshotCategoryInput } from "./snapshot.ts";

const DEFAULT_MAX_TOOL_ITEMS = 5;
const DEFAULT_MAX_TOOL_ITEM_CHARS = 600;
const DEFAULT_MAX_TOOL_TOTAL_CHARS = 2_000;
const DEFAULT_RECENT_USER_ENTRY_LIMIT = 12;
const DEFAULT_RECENT_USER_CHARS = 1_000;

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
		const text = truncateWithMarker(extractResultText(input.result, this.maxItemChars), this.maxItemChars, `tool:${input.toolName}`);
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
	const categories: SnapshotCategoryInput[] = [];
	const recentUserRequest = collectRecentUserRequest(options.sessionManager, {
		entryLimit: options.recentUserEntryLimit ?? DEFAULT_RECENT_USER_ENTRY_LIMIT,
		maxChars: options.recentUserMaxChars ?? DEFAULT_RECENT_USER_CHARS,
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
		maxContextChars: options.maxContextChars,
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
				content: truncateWithMarker(content, limits.maxChars, "recent-user-request"),
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

function isAllowedCustomRuntimeCategory(input: SnapshotCategoryInput): boolean {
	return input.category === "active-plan" || input.category === "risks";
}

function getUserMessageText(entry: SessionEntryLike): string | undefined {
	if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") {
		return undefined;
	}

	return messageContentToText(entry.message.content, DEFAULT_RECENT_USER_CHARS);
}

function messageContentToText(content: unknown, maxChars: number): string | undefined {
	if (typeof content === "string") {
		const trimmed = truncateWithMarker(content.trim(), maxChars, "message-content");
		return trimmed || undefined;
	}

	if (!Array.isArray(content)) {
		return undefined;
	}

	let text = "";
	for (const part of content) {
		if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
			continue;
		}
		const separator = text ? "\n" : "";
		const next = `${text}${separator}${part.text}`;
		text = truncateWithMarker(next, maxChars, "message-content");
		if (text.length >= maxChars) {
			break;
		}
	}

	const trimmed = text.trim();
	return trimmed || undefined;
}

function extractResultText(result: unknown, maxChars: number): string {
	const content = isRecord(result) ? result.content : undefined;
	const contentText = messageContentToText(content, maxChars);
	if (contentText) {
		return contentText;
	}

	if (typeof result === "string") {
		return result.trim();
	}

	return safeStringify(result, maxChars);
}

function truncateWithMarker(text: string, maxChars: number, label: string): string {
	const normalizedLimit = normalizePositiveInteger(maxChars, 1);
	if (text.length <= normalizedLimit) {
		return text;
	}

	const marker = `… [snapshot:${label} truncated ${text.length - normalizedLimit} chars]`;
	if (normalizedLimit <= marker.length) {
		return marker.slice(0, normalizedLimit);
	}

	return `${text.slice(0, normalizedLimit - marker.length).trimEnd()}${marker}`;
}

function safeStringify(value: unknown, maxChars: number): string {
	try {
		const rendered = stringifyShallow(value);
		return truncateWithMarker(rendered, maxChars, "tool-result-json");
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
