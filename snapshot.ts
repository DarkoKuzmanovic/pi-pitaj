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
	const bounded = enforceMaxContextChars(rendered, maxContextChars);
	const metadata = markWholeSnapshotTruncation(initialMetadata, sections, bounded);
	const omittedCategories = metadata
		.filter((item) => item.status === "omitted")
		.map((item) => item.category);
	const truncated = hasCategoryTruncation || bounded.length < rendered.length;

	return {
		context: bounded,
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
	const limit = categoryContentLimit(input.maxContextChars);
	if (charCount > limit) {
		const omittedChars = charCount - limit;
		return {
			category: input.category,
			title: input.title,
			content: `${content.slice(0, limit).trimEnd()}\n\n[snapshot:${input.category} truncated ${omittedChars} chars]`,
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
	sections: readonly SnapshotSection[],
	context: string,
): SnapshotCategoryMetadata[] {
	return metadata.map((item) => {
		if (item.status !== "included") {
			return item;
		}

		const section = sections.find((candidate) => candidate.category === item.category);
		if (!section || context.includes(renderSection(section))) {
			return item;
		}

		return {
			...item,
			status: "truncated",
			truncated: true,
		};
	});
}

function renderSections(sections: readonly SnapshotSection[], includeTruncationMarker: boolean): string {
	const renderedSections = sections.map((section) => renderSection(section));
	const context = [SNAPSHOT_HEADER, ...renderedSections].join("\n\n");
	if (!includeTruncationMarker) {
		return context;
	}

	return `${context}\n\n[snapshot truncated: one or more categories were shortened before consultation]`;
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

function enforceMaxContextChars(context: string, maxContextChars: number): string {
	if (context.length <= maxContextChars) {
		return context;
	}

	const marker = `\n\n[snapshot truncated to ${maxContextChars} chars]`;
	if (maxContextChars <= marker.length) {
		return marker.slice(0, maxContextChars);
	}

	return `${context.slice(0, maxContextChars - marker.length).trimEnd()}${marker}`;
}

function normalizeMaxContextChars(maxContextChars: number): number {
	if (!Number.isFinite(maxContextChars) || maxContextChars < 1) {
		return 1;
	}
	return Math.floor(maxContextChars);
}
