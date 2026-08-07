import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	openSync,
	renameSync,
	readFileSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { validateSettingsDocumentForWrite } from "./helpers.ts";

/** Permission mode for a newly-created settings file. */
export const DEFAULT_SETTINGS_FILE_MODE = 0o600;
const SETTINGS_TEMP_SUFFIX = ".tmp";

/**
 * Open flags for reading the settings source.
 *
 * `O_NOFOLLOW` refuses a symlinked source in the kernel, so there is no window
 * between a check and the open. Platforms without the flag (Windows) fall back
 * to 0 and rely on the explicit descriptor and path checks below.
 */
const READ_SOURCE_FLAGS =
	constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);

export interface SettingsStat {
	readonly isSymbolicLink: () => boolean;
	readonly isFile: () => boolean;
	readonly mode: number;
	readonly dev?: number | bigint;
	readonly ino?: number | bigint;
	readonly size?: number | bigint;
	readonly mtimeMs?: number;
	readonly ctimeMs?: number;
}

/**
 * Narrow synchronous fs seam. Persistence owns only these operations; tests can
 * inject a deterministic failure/race without mocking Node's whole fs module.
 *
 * Reads are descriptor-based on purpose: `lstat` on a path followed by a read
 * of the same path is two separate lookups, and anything may be renamed into
 * that path in between.
 */
export interface SettingsFs {
	openSync(path: string, flags: string | number, mode?: number): number;
	/** Stat the open descriptor itself, never the path it was opened from. */
	fstatSync(fd: number): SettingsStat;
	lstatSync(path: string): SettingsStat;
	/** Read the whole descriptor as UTF-8 text. */
	readFdSync(fd: number): string;
	/** Write `data` from byte `offset`; returns the byte count actually written. */
	writeSync(fd: number, data: Uint8Array, offset: number): number;
	fchmodSync(fd: number, mode: number): void;
	fsyncSync(fd: number): void;
	closeSync(fd: number): void;
	renameSync(oldPath: string, newPath: string): void;
	unlinkSync(path: string): void;
}

const nodeSettingsFs: SettingsFs = {
	openSync: (path, flags, mode) => openSync(path, flags, mode),
	fstatSync: (fd) => fstatSync(fd),
	lstatSync: (path) => lstatSync(path),
	readFdSync: (fd) => readFileSync(fd, "utf8"),
	writeSync: (fd, data, offset) => writeSync(fd, data, offset, data.length - offset),
	fchmodSync,
	fsyncSync,
	closeSync,
	renameSync,
	unlinkSync,
};

export function createSettingsFs(): SettingsFs {
	return nodeSettingsFs;
}

export interface SettingsFileWitness {
	readonly exists: boolean;
	/** Exact source identity, including device/inode when available. */
	readonly sourceIdentity?: string;
	/** SHA-256 of the decoded UTF-8 source text used for parsing and CAS checks. */
	readonly contentHash?: string;
	/** Exact source text, retained for diagnostics and pure comparison tests. */
	readonly content?: string;
}

export type SettingsDocumentState = "not-found" | "loaded" | "malformed";

export interface SettingsDocument {
	readonly path: string;
	readonly state: SettingsDocumentState;
	readonly witness: SettingsFileWitness;
	readonly rawText?: string;
	readonly parsed?: Record<string, unknown>;
	readonly mode: number;
	readonly error?: string;
}

export interface SettingsDocumentSource {
	readonly witness: SettingsFileWitness;
	readonly mode: number;
	readonly rawText?: string;
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

function isMissing(error: unknown): boolean {
	return errorCode(error) === "ENOENT";
}

/** `O_NOFOLLOW` refuses a symlink with ELOOP (EMLINK on some BSD kernels). */
function isSymlinkOpenRefusal(error: unknown): boolean {
	const code = errorCode(error);
	return code === "ELOOP" || code === "EMLINK";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceIdentity(stat: SettingsStat): string {
	return [
		stat.dev === undefined ? "" : String(stat.dev),
		stat.ino === undefined ? "" : String(stat.ino),
		stat.size === undefined ? "" : String(stat.size),
		stat.mtimeMs === undefined ? "" : String(stat.mtimeMs),
		stat.ctimeMs === undefined ? "" : String(stat.ctimeMs),
	].join(":");
}

/**
 * Whether two stats name the same file. Only device and inode are compared, so
 * an ordinary in-place edit is not mistaken for a swap. A platform that reports
 * neither cannot answer the question, and the descriptor-identity check around
 * the read stands on its own there.
 */
function isSameFile(left: SettingsStat, right: SettingsStat): boolean {
	if (left.dev === undefined || left.ino === undefined) return true;
	if (right.dev === undefined || right.ino === undefined) return true;
	return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function contentHash(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

function modeFrom(stat: SettingsStat | undefined): number {
	return stat === undefined ? DEFAULT_SETTINGS_FILE_MODE : stat.mode & 0o777;
}

/**
 * Confirm the path still names the file the descriptor holds.
 *
 * Between the open and the end of the read another process may rename a
 * different file — or a symlink — onto the path. The descriptor kept reading
 * the original inode, so the text is sound, but acting on it as "the current
 * settings.json" would be wrong.
 */
function assertPathStillNamesSource(path: string, descriptorStat: SettingsStat, fs: SettingsFs): void {
	let pathStat: SettingsStat;
	try {
		pathStat = fs.lstatSync(path);
	} catch (error) {
		if (isMissing(error)) throw new Error("settings.json was replaced while it was being read");
		throw error;
	}
	if (pathStat.isSymbolicLink()) throw new Error("settings.json source must not be a symbolic link");
	if (!isSameFile(pathStat, descriptorStat)) throw new Error("settings.json was replaced while it was being read");
}

/**
 * Read the settings source through one stable descriptor.
 *
 * The descriptor is opened once and stat'd on both sides of the read, so a
 * source that was truncated, rewritten, or swapped mid-read is refused instead
 * of being parsed as if it were whole.
 */
function readSource(path: string, fs: SettingsFs): SettingsDocumentSource {
	let fd: number;
	try {
		fd = fs.openSync(path, READ_SOURCE_FLAGS);
	} catch (error) {
		if (isMissing(error)) return { witness: { exists: false }, mode: DEFAULT_SETTINGS_FILE_MODE };
		if (isSymlinkOpenRefusal(error)) throw new Error("settings.json source must not be a symbolic link");
		throw error;
	}
	try {
		const before = fs.fstatSync(fd);
		if (before.isSymbolicLink()) throw new Error("settings.json source must not be a symbolic link");
		if (!before.isFile()) throw new Error("settings.json source must be a regular file");

		const rawText = fs.readFdSync(fd);

		const after = fs.fstatSync(fd);
		if (sourceIdentity(before) !== sourceIdentity(after)) {
			throw new Error("settings.json changed while it was being read");
		}
		assertPathStillNamesSource(path, after, fs);

		return {
			witness: {
				exists: true,
				sourceIdentity: sourceIdentity(after),
				contentHash: contentHash(rawText),
				content: rawText,
			},
			mode: modeFrom(after),
			rawText,
		};
	} finally {
		closeQuietly(fs, fd);
	}
}

/** Parse one already-captured source without normalizing its root object. */
function parseSettingsSource(path: string, source: SettingsDocumentSource): SettingsDocument {
	if (!source.witness.exists) {
		return { path, state: "not-found", witness: source.witness, mode: source.mode };
	}
	try {
		const parsedValue = JSON.parse(source.rawText ?? "") as unknown;
		if (!isRecord(parsedValue)) throw new Error("settings.json root must be a JSON object");
		return {
			path,
			state: "loaded",
			witness: source.witness,
			rawText: source.rawText,
			parsed: parsedValue,
			mode: source.mode,
		};
	} catch (error) {
		throw new Error(`settings.json is malformed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Read a source and retain the parsed root object without normalizing it. */
export function readSettingsDocument(path: string, fs: SettingsFs = nodeSettingsFs): SettingsDocument {
	return parseSettingsSource(path, readSource(path, fs));
}

/** Read a source while allowing the extension loader to fall back on malformed JSON. */
export function readSettingsDocumentForLoad(path: string, fs: SettingsFs = nodeSettingsFs): SettingsDocument {
	const source = readSource(path, fs);
	try {
		return parseSettingsSource(path, source);
	} catch (error) {
		return {
			path,
			state: "malformed",
			witness: source.witness,
			rawText: source.rawText,
			mode: source.mode,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

const PATCHABLE_FIELDS = new Set([
	"defaultModel",
	"autoRouteLow",
	"autoRouteHigh",
	"defaultMode",
	"defaultBrevity",
	"maxContextChars",
	"maxOutputChars",
]);

/** Patch one known scalar and preserve every other parsed root field verbatim. */
export function patchSettingsDocument(document: SettingsDocument, field: string, value: unknown): string {
	if (document.state === "malformed") throw new Error("settings.json is malformed; refusing to patch it");
	if (!PATCHABLE_FIELDS.has(field)) throw new Error(`settings field is not patchable: ${field}`);
	const root: Record<string, unknown> = document.parsed ? { ...document.parsed } : {};
	if (value === undefined) delete root[field];
	else root[field] = value;
	validateSettingsDocumentForWrite(root);
	return `${JSON.stringify(root, null, 2)}\n`;
}

/** Compare source witnesses without relying on mtime alone. */
export function settingsDocumentConflict(
	before: SettingsFileWitness,
	after: SettingsFileWitness,
): string | undefined {
	if (!before.exists && after.exists) return "settings.json was created on disk since it was read";
	if (before.exists && !after.exists) return "settings.json was removed on disk since it was read";
	if (!before.exists && !after.exists) return undefined;
	if (before.sourceIdentity !== after.sourceIdentity) return "settings.json was replaced on disk since it was read";
	if (before.contentHash !== after.contentHash || before.content !== after.content) {
		return "settings.json changed on disk since it was read";
	}
	return undefined;
}

function closeQuietly(fs: SettingsFs, fd: number | undefined): void {
	if (fd === undefined) return;
	try {
		fs.closeSync(fd);
	} catch {
		// Preserve the original read/write/rename failure.
	}
}

function unlinkQuietly(fs: SettingsFs, path: string): void {
	try {
		fs.unlinkSync(path);
	} catch (error) {
		if (!isMissing(error)) {
			// Cleanup is best effort and must not hide the original failure.
		}
	}
}

function fsyncDirectory(path: string, fs: SettingsFs): void {
	let fd: number | undefined;
	try {
		fd = fs.openSync(path, "r");
		fs.fsyncSync(fd);
	} catch {
		// Directory fsync is unavailable on some platforms/filesystems. The file
		// fsync and atomic rename remain mandatory; directory durability is best effort.
	} finally {
		closeQuietly(fs, fd);
	}
}

/**
 * Patch replacement bytes into a fixed same-directory exclusive temp file,
 * fsync them, revalidate the source immediately before rename, then atomically
 * replace the target. There is intentionally no retry: a conflict is surfaced.
 */
export function writeSettingsDocumentAtomically(
	path: string,
	document: SettingsDocument,
	content: string,
	fs: SettingsFs = nodeSettingsFs,
): void {
	if (document.state === "malformed") throw new Error("settings.json is malformed; refusing to overwrite it");
	const initial = readSource(path, fs);
	const initialConflict = settingsDocumentConflict(document.witness, initial.witness);
	if (initialConflict) throw new Error(`${initialConflict}; not overwriting a stale copy`);

	const temporaryPath = join(dirname(path), `.${basename(path)}${SETTINGS_TEMP_SUFFIX}`);
	const targetMode = document.state === "loaded" ? document.mode : DEFAULT_SETTINGS_FILE_MODE;
	// Encode once. Byte counts from `writeSync` are byte offsets into these
	// bytes; using them to slice the original string would split a multi-byte
	// character and corrupt the file.
	const bytes = Buffer.from(content, "utf8");
	let fd: number | undefined;
	let ownsTemporary = false;
	let renamed = false;
	try {
		fd = fs.openSync(temporaryPath, "wx", targetMode);
		ownsTemporary = true;
		// `O_CREAT` masks the requested mode with the process umask, so a
		// restrictive umask would silently narrow an inherited 0640 file. The
		// exclusive create already proved this descriptor is ours, so setting
		// the mode through the descriptor cannot touch anyone else's file.
		fs.fchmodSync(fd, targetMode);
		let offset = 0;
		while (offset < bytes.length) {
			const written = fs.writeSync(fd, bytes, offset);
			if (!Number.isInteger(written) || written <= 0) throw new Error("settings.json temp write made no progress");
			offset += written;
		}
		fs.fsyncSync(fd);
		closeQuietly(fs, fd);
		fd = undefined;

		const immediate = readSource(path, fs);
		const immediateConflict = settingsDocumentConflict(document.witness, immediate.witness);
		if (immediateConflict) throw new Error(`${immediateConflict}; not overwriting a stale copy`);

		fs.renameSync(temporaryPath, path);
		renamed = true;
		ownsTemporary = false;
		fsyncDirectory(dirname(path), fs);
	} finally {
		closeQuietly(fs, fd);
		if (ownsTemporary && !renamed) unlinkQuietly(fs, temporaryPath);
	}
}

/** Build replacement bytes from one selected field, then persist them safely. */
export function patchAndWriteSettingsDocument(
	path: string,
	document: SettingsDocument,
	field: string,
	value: unknown,
	fs: SettingsFs = nodeSettingsFs,
): void {
	writeSettingsDocumentAtomically(path, document, patchSettingsDocument(document, field, value), fs);
}
