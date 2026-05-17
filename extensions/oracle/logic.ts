import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, MODEL, type OracleParams, REASONING } from "./agent";
import { registerOracleTool } from "./tool";
import { registerOracleCancelEditor } from "./widget";

export type OracleControl = {
	action: "INFORMATION" | "IMPLEMENT";
	reason?: string;
	files: string[];
	task: string | null;
};

export type OracleResult = {
	answer: string;
	control: OracleControl;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	durationMs: number;
	model: string;
	reasoning: string;
};

let activeOracleCancel: (() => void) | undefined;

const DEFAULT_CONTROL: OracleControl = {
	action: "INFORMATION",
	reason: "No valid AGENT_CONTROL block was found. Failing closed.",
	files: [],
	task: null,
};

function hasActiveOracle(): boolean {
	return Boolean(activeOracleCancel);
}

function cancelActiveOracle() {
	activeOracleCancel?.();
}

function truncate(text: string, maxChars = 60_000): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Oracle output truncated: ${text.length - maxChars} characters omitted.]`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(1, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function normalizeControl(value: unknown): OracleControl {
	if (!value || typeof value !== "object") return DEFAULT_CONTROL;
	const raw = value as Record<string, unknown>;
	const action = raw.action === "IMPLEMENT" ? "IMPLEMENT" : "INFORMATION";
	const files = Array.isArray(raw.files) ? raw.files.filter((file): file is string => typeof file === "string") : [];
	const task = typeof raw.task === "string" && raw.task.trim() ? raw.task.trim() : null;
	const reason = typeof raw.reason === "string" ? raw.reason : undefined;

	if (action === "IMPLEMENT" && !task) {
		return {
			action: "INFORMATION",
			reason: reason ?? "IMPLEMENT was requested without a concrete task. Failing closed.",
			files,
			task: null,
		};
	}

	return { action, reason, files, task };
}

function extractOracleControl(answer: string): { answer: string; control: OracleControl } {
	const match = answer.match(/<AGENT_CONTROL>\s*([\s\S]*?)\s*<\/AGENT_CONTROL>/i);
	if (!match) return { answer, control: DEFAULT_CONTROL };

	try {
		const parsed = JSON.parse(match[1] ?? "{}");
		return {
			answer: answer.replace(match[0], "").trim(),
			control: normalizeControl(parsed),
		};
	} catch {
		return {
			answer: answer.replace(match[0], "").trim(),
			control: DEFAULT_CONTROL,
		};
	}
}

function formatControlForAgent(control: OracleControl): string {
	if (control.action === "IMPLEMENT") {
		const files = control.files.length > 0 ? `\nFiles suggested by oracle:\n${control.files.map((file) => `- ${file}`).join("\n")}` : "";
		return `AGENT_CONTROL: IMPLEMENT\nContinue working. Implement this task from the oracle:\n${control.task}${files}`;
	}

	return "AGENT_CONTROL: INFORMATION\nStop after this oracle result. Do not call additional tools or implement changes unless the user explicitly asks in a new message.";
}

function killProcess(child: ReturnType<typeof spawn>) {
	if (!child.pid) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		return;
	}
	child.kill("SIGTERM");
}

async function runCodexOracle(
	params: OracleParams,
	cwd: string,
	signal: AbortSignal | undefined,
	onProgress: (text: string) => void,
): Promise<OracleResult> {
	const startedAt = Date.now();
	const tempDir = await mkdtemp(join(tmpdir(), "pi-oracle-"));
	const outputFile = join(tempDir, "last-message.md");
	const prompt = buildPrompt(params, cwd);

	const args = [
		"exec",
		"--model",
		MODEL,
		"-c",
		`model_reasoning_effort=${REASONING}`,
		"--skip-git-repo-check",
		"--sandbox",
		"read-only",
		"--cd",
		cwd,
		"--output-last-message",
		outputFile,
		"-",
	];

	let stdout = "";
	let stderr = "";

	try {
		const child = spawn("codex", args, {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});

		const abortOracle = () => killProcess(child);
		activeOracleCancel = abortOracle;
		if (signal?.aborted) abortOracle();
		else signal?.addEventListener("abort", abortOracle, { once: true });

		child.stdin.write(prompt);
		child.stdin.end();

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});

		const progressTimer = setInterval(() => {
			const elapsed = formatDuration(Date.now() - startedAt);
			onProgress(`Still reviewing (${elapsed}).`);
		}, 15_000);

		const exitCode = await new Promise<number | null>((resolve, reject) => {
			child.on("error", reject);
			child.on("close", (code) => resolve(code));
		}).finally(() => {
			clearInterval(progressTimer);
			signal?.removeEventListener("abort", abortOracle);
			if (activeOracleCancel === abortOracle) activeOracleCancel = undefined;
		});

		if (signal?.aborted) {
			throw new Error("Oracle cancelled.");
		}

		let answer = "";
		try {
			answer = await readFile(outputFile, "utf8");
		} catch {
			answer = stdout.trim();
		}

		const extracted = extractOracleControl(answer.trim() || stdout.trim() || stderr.trim() || "(oracle returned no output)");

		return {
			answer: truncate(extracted.answer),
			control: extracted.control,
			stdout: truncate(stdout),
			stderr: truncate(stderr),
			exitCode,
			durationMs: Date.now() - startedAt,
			model: MODEL,
			reasoning: REASONING,
		};
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

export default function oracleExtension(pi: ExtensionAPI) {
	registerOracleCancelEditor(pi, hasActiveOracle, cancelActiveOracle);
	registerOracleTool(pi, {
		formatControlForAgent,
		formatDuration,
		runCodexOracle,
	});
}
