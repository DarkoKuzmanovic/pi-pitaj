import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	DEFAULT_SETTINGS_FILE_MODE,
	createSettingsFs,
	patchSettingsDocument,
	readSettingsDocument,
	settingsDocumentConflict,
	writeSettingsDocumentAtomically,
} from "./settings-persistence.ts";

function directory(): string {
	return mkdtempSync(join(tmpdir(), "pi-pitaj-settings-persistence-"));
}

function settingsPath(): { root: string; path: string } {
	const root = directory();
	return { root, path: join(root, "settings.json") };
}

function temporaryPathFor(root: string): string {
	return join(root, ".settings.json.tmp");
}

describe("settings persistence", () => {
	it("retains unknown root fields and raw aliases while patching only one known field", () => {
		const { path } = settingsPath();
		const raw = '{\n  "defaultModel": "opus",\n  "aliases": { "MiXeD": "provider/model" },\n  "future": { "keep": true }\n}\n';
		writeFileSync(path, raw, "utf8");
		const document = readSettingsDocument(path);

		const patched = patchSettingsDocument(document, "maxOutputChars", 4_000);
		const parsed = JSON.parse(patched) as Record<string, unknown>;
		assert.equal(parsed.defaultModel, "opus");
		assert.deepEqual(parsed.aliases, { MiXeD: "provider/model" });
		assert.deepEqual(parsed.future, { keep: true });
		assert.equal(parsed.maxOutputChars, 4_000);
	});

	it("deletes a cleared known field without dropping unknown fields", () => {
		const { path } = settingsPath();
		writeFileSync(path, '{"maxOutputChars":4000,"aliases":{"raw":"provider/model"},"unknown":1}\n', "utf8");
		const patched = patchSettingsDocument(readSettingsDocument(path), "maxOutputChars", undefined);
		assert.deepEqual(JSON.parse(patched), { aliases: { raw: "provider/model" }, unknown: 1 });
	});


	it("refuses a patch that would preserve invalid known settings", () => {
		for (const [raw, expected] of [
			['{"defaultMode":"oracle","future":true}\n', /defaultMode/],
			['{"maxOutputChars":16001,"future":true}\n', /maxOutputChars/],
			['{"aliases":"not-an-object","future":true}\n', /aliases/],
			['{"autoRouteLow":"missing","future":true}\n', /autoRouteLow/],
			['{"defaultModel":"not-an-alias","future":true}\n', /Unknown pitaj model/],
			['{"defaultModel":"auto","future":true}\n', /defaultModel|reserved|Unknown pitaj model/],
			['{"aliases":{"auto":"provider/model"},"future":true}\n', /reserved alias.*auto/i],
			['{"aliases":{"broken":"not-a-provider-model"},"future":true}\n', /Unknown pitaj model/],
			['{"aliases":{"advise":"provider/model"},"future":true}\n', /reserved alias.*advise/i],
			['{"aliases":{"Foo":"provider/one","foo":"provider/two"},"future":true}\n', /duplicate normalized name.*foo/i],
		] as const) {
			const { path } = settingsPath();
			writeFileSync(path, raw, "utf8");
			const document = readSettingsDocument(path);
			assert.throws(() => patchSettingsDocument(document, "maxContextChars", 12_000), expected);
		}
	});

	it("rejects malformed and non-object JSON documents", () => {
		for (const raw of ["{", "[]", "null", "42", '"text"']) {
			const { path } = settingsPath();
			writeFileSync(path, raw, "utf8");
			assert.throws(() => readSettingsDocument(path), /malformed|object/i);
		}
	});

	it("refuses symlink and non-regular settings sources", () => {
		const { root, path } = settingsPath();
		const target = join(root, "target.json");
		writeFileSync(target, "{}\n", "utf8");
		symlinkSync(target, path);
		assert.throws(() => readSettingsDocument(path), /symbolic link/i);

		unlinkSync(path);
		const directoryPath = join(root, "directory.json");
		// The directory itself is the source path and must not be read as JSON.
		importedMkdir(directoryPath);
		assert.throws(() => readSettingsDocument(directoryPath), /regular file/i);
	});

	it("uses existing mode and defaults new files to 0600", () => {
		const first = settingsPath();
		writeFileSync(first.path, "{}\n", { encoding: "utf8", mode: 0o640 });
		chmodSync(first.path, 0o640);
		const document = readSettingsDocument(first.path);
		writeSettingsDocumentAtomically(first.path, document, '{"changed":true}\n');
		assert.equal(readFileSync(first.path, "utf8"), '{"changed":true}\n');
		assert.equal(readMode(first.path), 0o640);

		const second = settingsPath();
		const missing = readSettingsDocument(second.path);
		writeSettingsDocumentAtomically(second.path, missing, "{}\n");
		assert.equal(readMode(second.path), DEFAULT_SETTINGS_FILE_MODE);
	});

	it("keeps the existing mode and the 0600 default under a restrictive umask", () => {
		// A 0o077 umask would silently narrow an inherited 0640 file to 0600 if
		// the temp file relied on the create mode alone.
		const previousUmask = process.umask(0o077);
		try {
			const first = settingsPath();
			writeFileSync(first.path, "{}\n", { encoding: "utf8", mode: 0o666 });
			chmodSync(first.path, 0o640);
			writeSettingsDocumentAtomically(first.path, readSettingsDocument(first.path), '{"changed":true}\n');
			assert.equal(readFileSync(first.path, "utf8"), '{"changed":true}\n');
			assert.equal(readMode(first.path), 0o640);

			const second = settingsPath();
			writeSettingsDocumentAtomically(second.path, readSettingsDocument(second.path), "{}\n");
			assert.equal(readMode(second.path), DEFAULT_SETTINGS_FILE_MODE);
		} finally {
			process.umask(previousUmask);
		}
	});

	it("rejects absent/create, edit, remove, and same-content inode replacement conflicts", () => {
		const missing = settingsPath();
		const absent = readSettingsDocument(missing.path);
		writeFileSync(missing.path, "{}\n", "utf8");
		assert.throws(() => writeSettingsDocumentAtomically(missing.path, absent, '{"new":true}\n'), /created/);

		const edited = settingsPath();
		writeFileSync(edited.path, "{}\n", "utf8");
		const editedDocument = readSettingsDocument(edited.path);
		writeFileSync(edited.path, '{"other":true}\n', "utf8");
		assert.throws(() => writeSettingsDocumentAtomically(edited.path, editedDocument, '{"new":true}\n'), /replaced|changed/);

		const removed = settingsPath();
		writeFileSync(removed.path, "{}\n", "utf8");
		const removedDocument = readSettingsDocument(removed.path);
		unlinkSync(removed.path);
		assert.throws(() => writeSettingsDocumentAtomically(removed.path, removedDocument, '{"new":true}\n'), /removed/);

		const replaced = settingsPath();
		writeFileSync(replaced.path, "{}\n", "utf8");
		const replacedDocument = readSettingsDocument(replaced.path);
		const replacement = join(replaced.root, "replacement.json");
		writeFileSync(replacement, "{}\n", "utf8");
		renameSync(replacement, replaced.path);
		assert.throws(() => writeSettingsDocumentAtomically(replaced.path, replacedDocument, '{"new":true}\n'), /replaced|changed/);
	});

	it("rechecks the source immediately before rename and cleans its temp after a race", () => {
		const { root, path } = settingsPath();
		writeFileSync(path, "{}\n", "utf8");
		const document = readSettingsDocument(path);
		const baseFs = createSettingsFs();
		let sourceOpens = 0;
		const racingFs = {
			...baseFs,
			openSync(target: string, flags: string | number, mode?: number) {
				// Only the read-only source opens carry numeric flags.
				if (target === path && typeof flags === "number") {
					sourceOpens++;
					// The second source open is the immediate pre-rename recheck.
					if (sourceOpens === 2) writeFileSync(path, '{"raced":true}\n', "utf8");
				}
				return baseFs.openSync(target, flags, mode);
			},
		};

		assert.throws(() => writeSettingsDocumentAtomically(path, document, '{"new":true}\n', racingFs), /changed|replaced/);
		assert.equal(readFileSync(path, "utf8"), '{"raced":true}\n');
		assert.deepEqual(readdirSync(root).sort(), ["settings.json"]);
	});

	it("writes through a fixed exclusive same-directory temp and leaves no temp after success", () => {
		const { root, path } = settingsPath();
		writeFileSync(path, "{}\n", "utf8");
		writeSettingsDocumentAtomically(path, readSettingsDocument(path), '{"ok":true}\n');
		assert.deepEqual(readdirSync(root).sort(), ["settings.json"]);
	});

	it("writes every UTF-8 byte when the filesystem accepts only partial writes", () => {
		const { path } = settingsPath();
		writeFileSync(path, "{}\n", "utf8");
		const document = readSettingsDocument(path);
		const baseFs = createSettingsFs();
		const content = '{"note":"café — 日本語 🚀 ✅"}\n';
		// The point of the fixture: byte length and string length disagree, so a
		// byte count used as a string index would corrupt the output.
		assert.notEqual(Buffer.byteLength(content, "utf8"), content.length);

		const partialFs = {
			...baseFs,
			writeSync(fd: number, data: Uint8Array, offset: number) {
				// Accept at most three bytes at a time, splitting multi-byte
				// characters in the middle.
				const end = Math.min(data.length, offset + 3);
				return baseFs.writeSync(fd, data.subarray(0, end), offset);
			},
		};

		writeSettingsDocumentAtomically(path, document, content, partialFs);
		assert.equal(readFileSync(path, "utf8"), content);
	});

	it("refuses a source whose path is swapped onto another inode while it is being read", () => {
		const { root, path } = settingsPath();
		writeFileSync(path, '{"original":true}\n', "utf8");
		const replacement = join(root, "replacement.json");
		writeFileSync(replacement, '{"replacement":true}\n', "utf8");
		const baseFs = createSettingsFs();
		const swappingFs = {
			...baseFs,
			readFdSync(fd: number) {
				const text = baseFs.readFdSync(fd);
				renameSync(replacement, path);
				return text;
			},
		};

		assert.throws(() => readSettingsDocument(path, swappingFs), /(replaced|changed) while it was being read/);
	});

	it("refuses a source whose path stops naming the read descriptor", () => {
		// Isolates the path-versus-descriptor identity check: the descriptor is
		// untouched, so only the post-read path lookup can refuse this.
		const { path } = settingsPath();
		writeFileSync(path, '{"original":true}\n', "utf8");
		const baseFs = createSettingsFs();
		const swappedPathFs = {
			...baseFs,
			lstatSync(target: string) {
				const stat = baseFs.lstatSync(target);
				return { ...stat, isSymbolicLink: () => false, isFile: () => true, ino: Number(stat.ino ?? 0) + 1 };
			},
		};

		assert.throws(() => readSettingsDocument(path, swappedPathFs), /replaced while it was being read/);
	});

	it("refuses a source path that becomes a symlink while it is being read", () => {
		const { root, path } = settingsPath();
		writeFileSync(path, '{"original":true}\n', "utf8");
		const target = join(root, "target.json");
		writeFileSync(target, '{"target":true}\n', "utf8");
		const baseFs = createSettingsFs();
		const swappingFs = {
			...baseFs,
			readFdSync(fd: number) {
				const text = baseFs.readFdSync(fd);
				unlinkSync(path);
				symlinkSync(target, path);
				return text;
			},
		};

		assert.throws(
			() => readSettingsDocument(path, swappingFs),
			/symbolic link|(replaced|changed) while it was being read/,
		);
	});

	it("refuses a source path that reports as a symlink after the read", () => {
		// Isolates the post-read symlink refusal from the identity comparison.
		const { path } = settingsPath();
		writeFileSync(path, '{"original":true}\n', "utf8");
		const baseFs = createSettingsFs();
		const symlinkedPathFs = {
			...baseFs,
			lstatSync(target: string) {
				const stat = baseFs.lstatSync(target);
				return { ...stat, isSymbolicLink: () => true, isFile: () => false };
			},
		};

		assert.throws(() => readSettingsDocument(path, symlinkedPathFs), /symbolic link/);
	});

	it("preserves the original and removes its own temp when the write, fsync, or rename fails", () => {
		const baseFs = createSettingsFs();
		const failures: Array<[string, (base: ReturnType<typeof createSettingsFs>) => Record<string, unknown>]> = [
			["write", (base) => ({ writeSync: () => 0 })],
			[
				"fsync",
				(base) => ({
					fsyncSync(fd: number) {
						// Only the temp-file fsync fails; the directory fsync is best effort.
						void fd;
						throw new Error("simulated fsync failure");
					},
				}),
			],
			[
				"rename",
				(base) => ({
					renameSync() {
						throw new Error("simulated rename failure");
					},
				}),
			],
		];

		for (const [label, override] of failures) {
			const { root, path } = settingsPath();
			writeFileSync(path, '{"original":true}\n', "utf8");
			const document = readSettingsDocument(path);
			const failingFs = { ...baseFs, ...override(baseFs) } as ReturnType<typeof createSettingsFs>;

			assert.throws(() => writeSettingsDocumentAtomically(path, document, '{"new":true}\n', failingFs), new RegExp(label === "write" ? "no progress" : `simulated ${label} failure`));
			assert.equal(readFileSync(path, "utf8"), '{"original":true}\n', `original must survive a ${label} failure`);
			assert.deepEqual(readdirSync(root).sort(), ["settings.json"], `temp must be cleaned after a ${label} failure`);
		}
	});

	it("refuses to overwrite an existing temp and never deletes a temp it does not own", () => {
		const { root, path } = settingsPath();
		writeFileSync(path, '{"original":true}\n', "utf8");
		const document = readSettingsDocument(path);
		const foreignTemp = temporaryPathFor(root);
		writeFileSync(foreignTemp, "another writer owns this\n", "utf8");

		assert.throws(() => writeSettingsDocumentAtomically(path, document, '{"new":true}\n'), /EEXIST|exists/i);
		assert.equal(readFileSync(foreignTemp, "utf8"), "another writer owns this\n");
		assert.equal(readFileSync(path, "utf8"), '{"original":true}\n');
	});

	it("completes the write when the best-effort directory fsync is unavailable", () => {
		const { root, path } = settingsPath();
		writeFileSync(path, "{}\n", "utf8");
		const document = readSettingsDocument(path);
		const baseFs = createSettingsFs();
		const noDirectoryFsyncFs = {
			...baseFs,
			openSync(target: string, flags: string | number, mode?: number) {
				// The directory fsync is the only open that names the directory.
				if (target === root) throw new Error("simulated EINVAL on directory open");
				return baseFs.openSync(target, flags, mode);
			},
		};

		writeSettingsDocumentAtomically(path, document, '{"ok":true}\n', noDirectoryFsyncFs);
		assert.equal(readFileSync(path, "utf8"), '{"ok":true}\n');
		assert.deepEqual(readdirSync(root).sort(), ["settings.json"]);
	});

	it("exposes pure witness conflict decisions", () => {
		assert.equal(settingsDocumentConflict({ exists: false }, { exists: false }), undefined);
		assert.match(settingsDocumentConflict({ exists: false }, { exists: true, content: "x" }) ?? "", /created/);
		assert.match(settingsDocumentConflict({ exists: true, content: "x" }, { exists: false }) ?? "", /removed/);
		assert.match(settingsDocumentConflict({ exists: true, content: "x" }, { exists: true, content: "y" }) ?? "", /changed/);
	});
});

function readMode(path: string): number {
	// Tests run on a POSIX Node host; retain only permission bits.
	return (createSettingsFs().lstatSync(path).mode ?? 0) & 0o777;
}

function importedMkdir(path: string): void {
	mkdirSync(path);
}
