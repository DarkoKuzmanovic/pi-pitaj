export type SnapshotCategory =
	| "question"
	| "recent-user-request"
	| "tool-results"
	| "active-plan"
	| "risks";

export type SnapshotSourceKind = "caller" | "bounded-session" | "tool-result-ring-buffer" | "custom-entry";

export type SnapshotCategoryStatus = "included" | "omitted" | "truncated";

export interface SnapshotCategoryInput {
	category: SnapshotCategory;
	title: string;
	content?: string;
	sourceKind: SnapshotSourceKind;
	sourceLabel: string;
}

export interface SnapshotCategoryMetadata {
	category: SnapshotCategory;
	status: SnapshotCategoryStatus;
	sourceKind?: SnapshotSourceKind;
	sourceLabel?: string;
	charCount: number;
	itemCount?: number;
	omissionReason?: string;
	truncated?: boolean;
}

export interface SnapshotBuildInput {
	question: string;
	categories: SnapshotCategoryInput[];
	maxContextChars: number;
}

export interface SnapshotBuildResult {
	context: string;
	metadata: SnapshotCategoryMetadata[];
	omittedCategories: SnapshotCategory[];
	truncated: boolean;
}

export interface SnapshotCapturePolicy {
	category: SnapshotCategory;
	sourceKind: SnapshotSourceKind;
	captureMechanism: string;
	omitByDefault: boolean;
	unavailableBehavior: string;
}

interface SnapshotSection {
	category: SnapshotCategory;
	title: string;
	content: string;
	sourceKind: SnapshotSourceKind;
	sourceLabel: string;
	charCount: number;
	status: "included" | "truncated";
}

interface SnapshotSectionRange {
	category: SnapshotCategory;
	start: number;
	end: number;
}

interface RenderedSnapshot {
	context: string;
	sectionRanges: readonly SnapshotSectionRange[];
}

interface BoundedSnapshot {
	context: string;
	cutoff: number;
	truncated: boolean;
}

export const SNAPSHOT_CATEGORY_ORDER: readonly SnapshotCategory[] = [
	"question",
	"recent-user-request",
	"active-plan",
	"tool-results",
	"risks",
];

export const SNAPSHOT_PROVENANCE_LABEL_TEMPLATE =
	"[snapshot:<category> — <itemCount> <itemLabel>, <charCount> chars, source: <sourceLabel>]";

export const SNAPSHOT_CAPTURE_POLICIES: Readonly<Record<SnapshotCategory, SnapshotCapturePolicy>> = {
	question: {
		category: "question",
		sourceKind: "caller",
		captureMechanism: "Caller-provided command parameter.",
		omitByDefault: false,
		unavailableBehavior: "Required; empty question follows existing /pitaj empty-question behavior.",
	},
	"recent-user-request": {
		category: "recent-user-request",
		sourceKind: "bounded-session",
		captureMechanism:
			"Bounded ctx.sessionManager.getLeafEntry() plus parent getEntry() traversal filtered to recent user SessionMessageEntry entries and maxContextChars.",
		omitByDefault: true,
		unavailableBehavior: "Omit if no bounded recent user message exists.",
	},
	"tool-results": {
		category: "tool-results",
		sourceKind: "tool-result-ring-buffer",
		captureMechanism: "Bounded in-extension ring buffer populated by pre-registered tool_execution_end hooks.",
		omitByDefault: true,
		unavailableBehavior: "Omit if the ring buffer is empty.",
	},
	"active-plan": {
		category: "active-plan",
		sourceKind: "custom-entry",
		captureMechanism: "Caller-provided context or extension-appended CustomEntry only; no session-branch inference.",
		omitByDefault: true,
		unavailableBehavior: "Omit by default.",
	},
	risks: {
		category: "risks",
		sourceKind: "custom-entry",
		captureMechanism: "Caller-provided context or extension-appended CustomEntry only; no session-branch inference.",
		omitByDefault: true,
		unavailableBehavior: "Omit by default.",
	},
};

const SNAPSHOT_HEADER =
	"# Curated pitaj snapshot\n\nThe sidecar has no tools and only sees this snapshot. It has not inspected files, run tools, or read session history beyond the excerpts below.";

export function buildSnapshotContext(input: SnapshotBuildInput): SnapshotBuildResult {
	const maxContextChars = normalizeMaxContextChars(input.maxContextChars);
	const sections = buildSections(input, maxContextChars);
	const initialMetadata = buildMetadata(sections, input.categories);
	const hasCategoryTruncation = sections.some((section) => section.status === "truncated");
	const rendered = renderSections(sections, hasCategoryTruncation);
	const bounded = enforceMaxContextChars(rendered.context, maxContextChars);
	const metadata = markWholeSnapshotTruncation(initialMetadata, rendered.sectionRanges, bounded.cutoff);
	const omittedCategories = metadata
		.filter((item) => item.status === "omitted")
		.map((item) => item.category);
	const truncated = hasCategoryTruncation || bounded.truncated;

	return {
		context: bounded.context,
		metadata,
		omittedCategories,
		truncated,
	};
}

function buildSections(input: SnapshotBuildInput, maxContextChars: number): SnapshotSection[] {
	return SNAPSHOT_CATEGORY_ORDER.flatMap((category) => {
		if (category === "question") {
			return [
				makeSection({
					category,
					title: "Question",
					content: input.question,
					sourceKind: "caller",
					sourceLabel: "caller",
					maxContextChars,
				}),
			];
		}

		const categoryInput = findCategoryInput(input.categories, category);
		if (!categoryInput) {
			return [];
		}

		return [makeSection({ ...categoryInput, maxContextChars })];
	});
}

function findCategoryInput(
	categories: readonly SnapshotCategoryInput[],
	category: Exclude<SnapshotCategory, "question">,
): SnapshotCategoryInput | undefined {
	return categories.find((item) => item.category === category && Boolean(item.content?.trim()));
}

function makeSection(input: SnapshotCategoryInput & { maxContextChars: number }): SnapshotSection {
	const content = input.content?.trim() ?? "";
	const charCount = content.length;
	const limit = Math.min(categoryContentLimit(input.maxContextChars), input.maxContextChars);
	if (charCount > limit) {
		const bounded = truncateSnapshotContent(content, limit, input.category);
		return {
			category: input.category,
			title: input.title,
			content: bounded,
			sourceKind: input.sourceKind,
			sourceLabel: input.sourceLabel,
			charCount,
			status: "truncated",
		};
	}

	return {
		category: input.category,
		title: input.title,
		content,
		sourceKind: input.sourceKind,
		sourceLabel: input.sourceLabel,
		charCount,
		status: "included",
	};
}

function truncateSnapshotContent(content: string, cap: number, category: SnapshotCategory): string {
	if (cap <= 0) return "";
	const markerFor = (omitted: number): string => `\n\n[snapshot:${category} truncated ${omitted} chars]`;
	const initialMarker = markerFor(content.length - cap);
	if (initialMarker.length >= cap) return content.slice(0, cap);

	let headLength = Math.max(0, cap - markerFor(content.length).length);
	while (headLength < cap && headLength + 1 + markerFor(content.length - headLength - 1).length <= cap) {
		headLength++;
	}
	while (headLength > 0) {
		const retained = content.slice(0, headLength).trimEnd();
		const marker = markerFor(content.length - retained.length);
		if (retained.length > 0 && retained.length + marker.length <= cap) return `${retained}${marker}`;
		headLength--;
	}
	return content.slice(0, cap);
}

function buildMetadata(
	sections: readonly SnapshotSection[],
	categoryInputs: readonly SnapshotCategoryInput[],
): SnapshotCategoryMetadata[] {
	return SNAPSHOT_CATEGORY_ORDER.map((category) => {
		const section = sections.find((item) => item.category === category);
		if (section) {
			return {
				category,
				status: section.status,
				sourceKind: section.sourceKind,
				sourceLabel: section.sourceLabel,
				charCount: section.charCount,
				itemCount: 1,
				truncated: section.status === "truncated" || undefined,
			};
		}

		const policy = SNAPSHOT_CAPTURE_POLICIES[category];
		const source = categoryInputs.find((item) => item.category === category);
		return {
			category,
			status: "omitted",
			sourceKind: source?.sourceKind ?? policy.sourceKind,
			sourceLabel: source?.sourceLabel,
			charCount: 0,
			itemCount: 0,
			omissionReason: policy.unavailableBehavior,
		};
	});
}

function markWholeSnapshotTruncation(
	metadata: readonly SnapshotCategoryMetadata[],
	sectionRanges: readonly SnapshotSectionRange[],
	cutoff: number,
): SnapshotCategoryMetadata[] {
	return metadata.map((item) => {
		if (item.status === "omitted") {
			return item;
		}

		const range = sectionRanges.find((candidate) => candidate.category === item.category);
		if (!range || range.start >= cutoff) {
			const { truncated: _truncated, ...withoutTruncation } = item;
			return {
				...withoutTruncation,
				status: "omitted",
				omissionReason: "Omitted by maxContextChars bound.",
			};
		}

		if (range.end > cutoff) {
			return {
				...item,
				status: "truncated",
				truncated: true,
			};
		}

		return item;
	});
}

function renderSections(sections: readonly SnapshotSection[], includeTruncationMarker: boolean): RenderedSnapshot {
	let context = SNAPSHOT_HEADER;
	const sectionRanges: SnapshotSectionRange[] = [];
	for (const section of sections) {
		const renderedSection = renderSection(section);
		const start = context.length + 2;
		context += `\n\n${renderedSection}`;
		sectionRanges.push({ category: section.category, start, end: context.length });
	}

	if (includeTruncationMarker) {
		context += "\n\n[snapshot truncated: one or more categories were shortened before consultation]";
	}

	return { context, sectionRanges };
}

function renderSection(section: SnapshotSection): string {
	return `## ${section.title}\n${renderProvenanceLabel(section)}\n\n${section.content}`;
}

function renderProvenanceLabel(section: SnapshotSection): string {
	const itemLabel = section.charCount === 1 ? "item" : "item";
	return `[snapshot:${section.category} — 1 ${itemLabel}, ${section.charCount} chars, source: ${section.sourceLabel}]`;
}

function categoryContentLimit(maxContextChars: number): number {
	return Math.max(80, Math.floor(maxContextChars * 0.45));
}

function enforceMaxContextChars(context: string, maxContextChars: number): BoundedSnapshot {
	if (context.length <= maxContextChars) {
		return { context, cutoff: context.length, truncated: false };
	}

	const marker = `\n\n[snapshot truncated to ${maxContextChars} chars]`;
	if (maxContextChars <= marker.length) {
		return { context: marker.slice(0, maxContextChars), cutoff: 0, truncated: true };
	}

	const cutoff = maxContextChars - marker.length;
	return {
		context: `${context.slice(0, cutoff).trimEnd()}${marker}`,
		cutoff,
		truncated: true,
	};
}

function normalizeMaxContextChars(maxContextChars: number): number {
	if (!Number.isFinite(maxContextChars) || !Number.isInteger(maxContextChars) || maxContextChars < 1 || maxContextChars > 64_000) {
		throw new Error("maxContextChars must be a finite whole number between 1 and 64000.");
	}
	return maxContextChars;
}
