import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import { describe, it } from "node:test";
import {
	ORACLE_DENIED_SEGMENTS,
	ORACLE_EVIDENCE_OPERATIONS,
	ORACLE_MAX_EVIDENCE_REQUESTS,
	ORACLE_MAX_RESULT_CHARS,
	ORACLE_MAX_TOTAL_CHARS,
	ORACLE_MIN_EVIDENCE_REQUESTS,
	PITAJ_HOST_ACTION_MARKER,
	resolveEvidenceRequestLimit,
	containsHostActionMarker,
	consumeEvidenceBudget,
	createOracleBudgetState,
	checkEvidenceBudget,
	formatHostActionMarker,
	isDeniedPath,
	isDeniedSegment,
	parseHostActionMarker,
	resolveRootRelativePath,
	relativeRootPath,
	isPathWithinRoot,
	selectPathApi,
	scanForSecrets,
	truncateEvidenceResult,
	validateOracleRequest,
} from "./oracle-policy.ts";
import { PITAJ_MODES, buildConsultSystemPrompt } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Oracle request / root validation
// ---------------------------------------------------------------------------

describe("oracle request validation", () => {
	it("passes when mode is not oracle regardless of oracleRoot", () => {
		assert.deepEqual(validateOracleRequest({ mode: "answer" }), { ok: true });
		assert.deepEqual(validateOracleRequest({ mode: "answer", oracleRoot: undefined }), { ok: true });
	});

	it("fails when mode is oracle and oracleRoot is missing", () => {
		const result = validateOracleRequest({ mode: "oracle" });
		assert.equal(result.ok, false);
		assert.match(result.reason!, /oracleRoot/i);
		assert.match(result.reason!, /no cwd fallback/i);
	});

	it("fails when mode is oracle and oracleRoot is blank", () => {
		const result = validateOracleRequest({ mode: "oracle", oracleRoot: "   " });
		assert.equal(result.ok, false);
	});

	it("passes when mode is oracle and oracleRoot is a non-empty string", () => {
		assert.deepEqual(validateOracleRequest({ mode: "oracle", oracleRoot: "/repo" }), { ok: true });
	});
});

// ---------------------------------------------------------------------------
// Evidence-request override clamping
// ---------------------------------------------------------------------------

describe("evidence-request override clamping", () => {
	it("returns the hard maximum when no override is given", () => {
		assert.equal(resolveEvidenceRequestLimit(undefined), ORACLE_MAX_EVIDENCE_REQUESTS);
	});

	it("uses the approved nine-request and 18,000-character hard caps", () => {
		assert.equal(ORACLE_MAX_EVIDENCE_REQUESTS, 9);
		assert.equal(ORACLE_MAX_TOTAL_CHARS, 18_000);
	});

	it("clamps values above the hard maximum down to 9", () => {
		assert.equal(resolveEvidenceRequestLimit(10), ORACLE_MAX_EVIDENCE_REQUESTS);
		assert.equal(resolveEvidenceRequestLimit(100), ORACLE_MAX_EVIDENCE_REQUESTS);
	});

	it("clamps values below the minimum up to 1", () => {
		assert.equal(resolveEvidenceRequestLimit(0), ORACLE_MIN_EVIDENCE_REQUESTS);
		assert.equal(resolveEvidenceRequestLimit(-5), ORACLE_MIN_EVIDENCE_REQUESTS);
	});

	it("preserves valid values within 1..9", () => {
		assert.equal(resolveEvidenceRequestLimit(1), 1);
		assert.equal(resolveEvidenceRequestLimit(4), 4);
		assert.equal(resolveEvidenceRequestLimit(9), 9);
	});

	it("rejects fractional and non-finite overrides instead of expanding them", () => {
		for (const value of [2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.throws(() => resolveEvidenceRequestLimit(value), /whole number/, `value ${value}`);
		}
	});
});

// ---------------------------------------------------------------------------
// Evidence budget — 9 succeeds / 10 refuses
// ---------------------------------------------------------------------------

describe("oracle evidence budget", () => {
	it("allows the first nine requests", () => {
		let state = createOracleBudgetState();
		for (let i = 0; i < ORACLE_MAX_EVIDENCE_REQUESTS; i++) {
			const check = checkEvidenceBudget(state);
			assert.equal(check.allowed, true, `request ${i + 1} should be allowed`);
			state = consumeEvidenceBudget(state, 100);
		}
	});

	it("refuses the tenth request", () => {
		let state = createOracleBudgetState();
		for (let i = 0; i < 9; i++) {
			state = consumeEvidenceBudget(state, 100);
		}
		const check = checkEvidenceBudget(state);
		assert.equal(check.allowed, false);
		assert.match(check.reason!, /9\/9 requests used/);
	});

	it("refuses when total chars reach the cap even if requests remain", () => {
		let state = createOracleBudgetState();
		// One request returns enough chars to hit the total cap
		state = consumeEvidenceBudget(state, ORACLE_MAX_TOTAL_CHARS);
		const check = checkEvidenceBudget(state);
		assert.equal(check.allowed, false);
		assert.match(check.reason!, /total chars used/);
	});

	it("invalid and refused requests still consume the request budget", () => {
		let state = createOracleBudgetState();
		// Simulate 9 requests that each returned 0 chars (refused/invalid)
		for (let i = 0; i < 9; i++) {
			state = consumeEvidenceBudget(state, 0);
		}
		const check = checkEvidenceBudget(state);
		assert.equal(check.allowed, false);
		assert.match(check.reason!, /9\/9 requests used/);
	});

	it("respects a caller-supplied override lower than the hard maximum", () => {
		let state = createOracleBudgetState();
		const maxRequests = resolveEvidenceRequestLimit(2);
		state = consumeEvidenceBudget(state, 100);
		state = consumeEvidenceBudget(state, 100);
		const check = checkEvidenceBudget(state, maxRequests);
		assert.equal(check.allowed, false);
		assert.match(check.reason!, /2\/2 requests used/);
	});
});

// ---------------------------------------------------------------------------
// Evidence result truncation
// ---------------------------------------------------------------------------

describe("evidence result truncation", () => {
	it("does not truncate content under the per-result cap", () => {
		const content = "x".repeat(ORACLE_MAX_RESULT_CHARS);
		const result = truncateEvidenceResult(content);
		assert.equal(result.truncated, false);
		assert.equal(result.content, content);
	});

	it("truncates content over the per-result cap and appends a marker", () => {
		const content = "x".repeat(ORACLE_MAX_RESULT_CHARS + 500);
		const result = truncateEvidenceResult(content);
		assert.equal(result.truncated, true);
		assert.ok(result.content.length <= ORACLE_MAX_RESULT_CHARS);
		assert.match(result.content, /truncated \d+ characters/);
	});

	it("respects a custom maxChars", () => {
		const result = truncateEvidenceResult("abcdefghij", 5);
		assert.equal(result.truncated, true);
		assert.equal(result.content.length, 5);
		assert.doesNotMatch(result.content, /truncated/);

		const boundedMarker = truncateEvidenceResult("x".repeat(200), 80);
		assert.ok(boundedMarker.content.length <= 80);
		assert.match(boundedMarker.content, /truncated \d+ characters/);
	});
});

// ---------------------------------------------------------------------------
// Denied path matching
// ---------------------------------------------------------------------------

describe("denied path segment matching", () => {
	it("denies .git", () => {
		assert.equal(isDeniedSegment(".git"), true);
		assert.equal(isDeniedPath("src/.git/config"), true);
	});

	it("denies .env variants case-insensitively", () => {
		assert.equal(isDeniedSegment(".env"), true);
		assert.equal(isDeniedSegment(".ENV"), true);
		assert.equal(isDeniedSegment(".env.local"), true);
		assert.equal(isDeniedSegment(".env.production"), true);
		assert.equal(isDeniedPath("config/.env"), true);
	});

	it("denies .npmrc and .netrc", () => {
		assert.equal(isDeniedSegment(".npmrc"), true);
		assert.equal(isDeniedSegment(".NPMRC"), true);
		assert.equal(isDeniedSegment(".netrc"), true);
		assert.equal(isDeniedPath("home/.npmrc"), true);
	});

	it("denies .aws, .ssh, .docker directories", () => {
		assert.equal(isDeniedPath(".aws/credentials"), true);
		assert.equal(isDeniedPath(".ssh/id_rsa"), true);
		assert.equal(isDeniedPath(".docker/config"), true);
	});

	it("denies credentials*, secret*, token*, password* prefixes", () => {
		assert.equal(isDeniedSegment("credentials.json"), true);
		assert.equal(isDeniedSegment("secrets.yaml"), true);
		assert.equal(isDeniedSegment("token.txt"), true);
		assert.equal(isDeniedSegment("passwords.db"), true);
		assert.equal(isDeniedPath("config/credentials.json"), true);
	});

	it("denies *private*key* patterns", () => {
		assert.equal(isDeniedSegment("my-private-key"), true);
		assert.equal(isDeniedSegment("PRIVATE-KEY"), true);
		assert.equal(isDeniedPath("keys/my-private-key.pem"), true);
	});

	it("denies key file extensions", () => {
		assert.equal(isDeniedSegment("cert.pem"), true);
		assert.equal(isDeniedSegment("server.key"), true);
		assert.equal(isDeniedSegment("client.p12"), true);
		assert.equal(isDeniedSegment("identity.pfx"), true);
		assert.equal(isDeniedPath("tls/server.key"), true);
	});

	it("denies id_rsa and id_ed25519", () => {
		assert.equal(isDeniedSegment("id_rsa"), true);
		assert.equal(isDeniedSegment("id_ed25519"), true);
		assert.equal(isDeniedPath(".ssh/id_rsa"), true);
	});

	it("does not deny normal source paths", () => {
		assert.equal(isDeniedSegment("index.ts"), false);
		assert.equal(isDeniedSegment("helpers.ts"), false);
		assert.equal(isDeniedSegment("src"), false);
		assert.equal(isDeniedPath("src/index.ts"), false);
		assert.equal(isDeniedPath("README.md"), false);
	});

	it("handles backslash-separated paths", () => {
		assert.equal(isDeniedPath("config\\.env"), true);
		assert.equal(isDeniedPath("src\\helpers.ts"), false);
	});
});

// ---------------------------------------------------------------------------
// Secret-pattern redaction / refusal
// ---------------------------------------------------------------------------

describe("secret pattern scanning", () => {
	it("refuses content containing a PEM private key block", () => {
		const content = "some preamble\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
		const result = scanForSecrets(content);
		assert.equal(result.safe, false);
		assert.equal(result.content, "");
		assert.match(result.refusalReason!, /secret pattern/i);
	});

	it("refuses content containing an AWS access key ID", () => {
		const content = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
		const result = scanForSecrets(content);
		assert.equal(result.safe, false);
	});

	it("refuses content containing a GitHub token", () => {
		const content = "GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz";
		const result = scanForSecrets(content);
		assert.equal(result.safe, false);
	});

	it("refuses content containing a password assignment", () => {
		const content = "password: hunter2password";
		const result = scanForSecrets(content);
		assert.equal(result.safe, false);
	});

	it("allows TypeScript password type declarations", () => {
		const declarations = [
			"interface Credentials {\n\tpassword: string;\n}",
			"type Login = { password?: string };",
			"function connect(password: string) { return password.length; }",
			"const shape: { password: string | undefined } = load();",
			"interface Row {\n\tpasswd: string[];\n}",
			'{ "password": null }',
		];
		for (const content of declarations) {
			assert.equal(scanForSecrets(content).safe, true, content);
		}
	});

	it("refuses credential-looking password values in code, JSON, YAML, and env files", () => {
		const credentials = [
			'const config = { password: "hunter2secret" };',
			"PASSWORD=hunter2secret",
			'{ "password": "hunter2secret" }',
			"db:\n  password: s3cr3tvalue",
			"pwd = 'hunter2secret'",
		];
		for (const content of credentials) {
			assert.equal(scanForSecrets(content).safe, false, content);
		}
	});

	it("refuses camel-case and later password assignments without rejecting declarations", () => {
		const bypasses = [
			'const dbPassword = "hunter2secret";',
			'let password: string; password = "hunter2secret";',
			'function f(password: string) { password = "hunter2secret"; }',
		];
		for (const content of bypasses) {
			assert.equal(scanForSecrets(content).safe, false, content);
		}
	});

	it("passes clean content unchanged", () => {
		const content = "export function add(a: number, b: number) { return a + b; }";
		const result = scanForSecrets(content);
		assert.equal(result.safe, true);
		assert.equal(result.content, content);
	});

	it("passes content with short words that look like keys but are not", () => {
		const content = "const token = 'abc'; // too short to match";
		const result = scanForSecrets(content);
		assert.equal(result.safe, true);
	});
});

// ---------------------------------------------------------------------------
// PITAJ_NEEDS_HOST_ACTION marker
// ---------------------------------------------------------------------------

describe("host-action marker formatting and parsing", () => {
	it("formats a marker with action and reason", () => {
		const marker = formatHostActionMarker("run tests", "need to verify the suite passes");
		assert.ok(marker.startsWith(PITAJ_HOST_ACTION_MARKER));
		assert.match(marker, /action: run tests/);
		assert.match(marker, /reason: need to verify the suite passes/);
	});

	it("defaults to 'unspecified' for empty action or reason", () => {
		const marker = formatHostActionMarker("", "");
		assert.match(marker, /action: unspecified/);
		assert.match(marker, /reason: unspecified/);
	});

	it("round-trips through format and parse", () => {
		const action = "run npm test";
		const reason = "verify the test suite is green";
		const marker = formatHostActionMarker(action, reason);
		const parsed = parseHostActionMarker(marker);
		assert.deepEqual(parsed, { action, reason });
	});

	it("parses a marker embedded in preamble text", () => {
		const text = [
			"I cannot run the tests myself.",
			"",
			PITAJ_HOST_ACTION_MARKER,
			"action: run npm test",
			"reason: verify the suite is green",
		].join("\n");
		const parsed = parseHostActionMarker(text);
		assert.deepEqual(parsed, { action: "run npm test", reason: "verify the suite is green" });
	});

	it("returns undefined when no marker is present", () => {
		assert.equal(parseHostActionMarker("just a regular answer"), undefined);
	});

	it("returns undefined when marker has no action or reason fields", () => {
		const text = `${PITAJ_HOST_ACTION_MARKER}\nsome other text`;
		assert.equal(parseHostActionMarker(text), undefined);
	});

	it("containsHostActionMarker detects embedded markers", () => {
		const marker = formatHostActionMarker("write file", "need to persist output");
		assert.equal(containsHostActionMarker(marker), true);
		assert.equal(containsHostActionMarker("no marker here"), false);
	});
});

// ---------------------------------------------------------------------------
// Root-relative path validation (pure string logic — no fs I/O)
// ---------------------------------------------------------------------------

describe("root-relative path validation", () => {
	it("resolves a simple relative path under the root", () => {
		const result = resolveRootRelativePath("/repo", "src/index.ts");
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.ok(result.resolved.startsWith("/repo"));
			assert.ok(result.resolved.endsWith("src/index.ts"));
		}
	});

	it("rejects absolute paths", () => {
		const result = resolveRootRelativePath("/repo", "/etc/passwd");
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.reason, /absolute/i);
	});

	it("rejects traversal outside the root", () => {
		const result = resolveRootRelativePath("/repo", "../../../etc/passwd");
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.reason, /traversal/i);
	});

	it("rejects empty paths", () => {
		const result = resolveRootRelativePath("/repo", "   ");
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.reason, /empty/i);
	});

	it("rejects a path that resolves to the root itself", () => {
		const result = resolveRootRelativePath("/repo", ".");
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.reason, /root itself/i);
	});

	it("normalizes redundant segments but stays under root", () => {
		const result = resolveRootRelativePath("/repo", "src/../src/./index.ts");
		assert.equal(result.ok, true);
	});
});


	describe("portable path flavor", () => {
		it("normalizes Win32 drive paths and rejects drive escapes", () => {
			const inside = resolveRootRelativePath("C:\\work\\repo", "src\\index.ts");
			assert.deepEqual(inside, { ok: true, resolved: "C:\\work\\repo\\src\\index.ts" });
			assert.equal(resolveRootRelativePath("C:\\work\\repo", "..\\other\\x.ts").ok, false);
			assert.equal(resolveRootRelativePath("C:\\work\\repo", "D:\\other\\x.ts").ok, false);
		});

		it("uses component-aware containment rather than string prefixes", () => {
			assert.equal(isPathWithinRoot("C:\\work\\repo", "C:\\work\\repo\\src\\x.ts"), true);
			assert.equal(isPathWithinRoot("C:\\work\\repo", "C:\\work\\repository\\x.ts"), false);
			assert.equal(relativeRootPath("/repo", "/repo/src/x.ts"), "src/x.ts");
			assert.equal(relativeRootPath("/repo", "/repository/x.ts"), undefined);
		});

		it("selects the flavor from the host and the root, never from the candidate", () => {
			const posixHost = { posix, win32, host: posix };
			const windowsHost = { posix, win32, host: win32 };

			assert.equal(selectPathApi("/repo", posixHost), posix);
			assert.equal(selectPathApi("/repo/nested", posixHost), posix);
			// A Win32 host resolves every root with Win32 semantics.
			assert.equal(selectPathApi("/repo", windowsHost), win32);
			// A drive-letter or UNC root is Win32 on any host.
			assert.equal(selectPathApi("C:\\work\\repo", posixHost), win32);
			assert.equal(selectPathApi("\\\\server\\share\\repo", posixHost), win32);
		});

		it("keeps a POSIX root POSIX when a candidate contains a backslash", () => {
			assert.deepEqual(resolveRootRelativePath("/repo", "we\\ird.txt"), { ok: true, resolved: "/repo/we\\ird.txt" });
			assert.equal(relativeRootPath("/repo", "/repo/we\\ird.txt"), "we\\ird.txt");
			assert.equal(isPathWithinRoot("/repo", "/repo/we\\ird.txt"), true);
		});

		it("resolves Win32 roots the same way on a POSIX host fixture", () => {
			const posixHost = { posix, win32, host: posix };
			const api = selectPathApi("C:\\work\\repo", posixHost);
			assert.equal(api.resolve("C:\\work\\repo", "src\\x.ts"), "C:\\work\\repo\\src\\x.ts");
			assert.equal(relativeRootPath("C:\\work\\repo", "C:\\work\\repo\\src\\x.ts", false, posixHost), "src\\x.ts");
			assert.equal(relativeRootPath("C:\\work\\repo", "C:\\work\\other\\x.ts", false, posixHost), undefined);
			assert.equal(resolveRootRelativePath("C:\\work\\repo", "..\\other\\x.ts", posixHost).ok, false);
		});
	});

// ---------------------------------------------------------------------------
// Additive schema / mode compatibility
// ---------------------------------------------------------------------------

describe("additive schema and ordinary-mode compatibility", () => {
	it("includes oracle in PITAJ_MODES without removing existing modes", () => {
		assert.ok(PITAJ_MODES.includes("oracle"));
		assert.ok(PITAJ_MODES.includes("answer"));
		assert.ok(PITAJ_MODES.includes("critique"));
		assert.ok(PITAJ_MODES.includes("debug"));
		assert.ok(PITAJ_MODES.includes("plan"));
		assert.ok(PITAJ_MODES.includes("risk-check"));
	});

	it("buildConsultSystemPrompt is byte-compatible for non-oracle modes", () => {
		// The non-oracle prompt must not mention tools or evidence capabilities
		const prompt = buildConsultSystemPrompt("answer", "short");
		assert.match(prompt, /You do not have tools/);
		assert.doesNotMatch(prompt, /oracle mode/i);
		assert.doesNotMatch(prompt, /pitaj_request_evidence/);
		assert.doesNotMatch(prompt, /PITAJ_NEEDS_HOST_ACTION/);
	});

	it("buildConsultSystemPrompt advertises evidence operations for oracle mode", () => {
		const prompt = buildConsultSystemPrompt("oracle", "normal");
		assert.match(prompt, /oracle mode/i);
		assert.match(prompt, /pitaj_request_evidence/);
		assert.match(prompt, /read_file/);
		assert.match(prompt, /search/);
		assert.match(prompt, /list_files/);
		assert.match(prompt, /git_diff/);
		assert.match(prompt, /PITAJ_NEEDS_HOST_ACTION/);
		assert.match(prompt, /cannot run shell commands/);
	});

	it("oracle prompt does not claim the sidecar has no tools", () => {
		const prompt = buildConsultSystemPrompt("oracle", "short");
		assert.doesNotMatch(prompt, /You do not have tools/);
	});

	it("all four evidence operations are exported", () => {
		assert.deepEqual([...ORACLE_EVIDENCE_OPERATIONS], ["read_file", "search", "list_files", "git_diff"]);
	});

	it("all denied segments are exported", () => {
		assert.ok(ORACLE_DENIED_SEGMENTS.length >= 17);
		assert.ok(ORACLE_DENIED_SEGMENTS.includes(".git"));
		assert.ok(ORACLE_DENIED_SEGMENTS.includes(".env*"));
	});
});
