import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { buildPrompt, MODEL, type ExplorerParams } from "./agent";
import { registerExplorerTool } from "./tool";

export type ExplorerResult = {
	answer: string;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	durationMs: number;
	model: string;
};

let activeExplorerCancel: (() => void) | undefined;

function hasActiveExplorer(): boolean {
	return Boolean(activeExplorerCancel);
}

function cancelActiveExplorer() {
	activeExplorerCancel?.();
}

function truncate(text: string, maxChars = 60_000): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Explorer output truncated: ${text.length - maxChars} characters omitted.]`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(1, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function killProcess(child: ReturnType<typeof spawn>) {
	if (!child.pid) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		return;
	}
	child.kill("SIGTERM");
}

function spawnAgent(prompt: string, cwd: string) {
	const fixedArgs = ["-p", "--trust", "--model", MODEL, "--workspace", cwd, "--output-format", "json"];

	if (process.platform !== "win32") {
		return spawn("agent", [...fixedArgs, prompt], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
			shell: true,
		});
	}

	// On Windows, cmd.exe cannot pass multiline or non-ASCII strings through %* into
	// powershell -File. We bypass cmd.exe by spawning PowerShell directly and reading
	// the prompt from an environment variable, which handles newlines and Unicode natively.
	const envKey = `_PI_EXPLORER_${Date.now()}`;
	const safeArgs = fixedArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(" ");
	const psCommand = `$p = [System.Environment]::GetEnvironmentVariable('${envKey}'); & agent ${safeArgs} $p`;

	return spawn("powershell.exe", ["-NoProfile", "-Command", psCommand], {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, [envKey]: prompt },
		shell: false,
	});
}

async function runCursorExplorer(
	params: ExplorerParams,
	cwd: string,
	signal: AbortSignal | undefined,
	onProgress: (text: string) => void,
): Promise<ExplorerResult> {
	const startedAt = Date.now();
	const prompt = buildPrompt(params, cwd);

	let stdout = "";
	let stderr = "";

	const child = spawnAgent(prompt, cwd);

	const abortExplorer = () => killProcess(child);
	activeExplorerCancel = abortExplorer;
	if (signal?.aborted) abortExplorer();
	else signal?.addEventListener("abort", abortExplorer, { once: true });

	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});

	const progressTimer = setInterval(() => {
		onProgress(`Still exploring (${formatDuration(Date.now() - startedAt)}).`);
	}, 15_000);

	const exitCode = await new Promise<number | null>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (code) => resolve(code));
	}).finally(() => {
		clearInterval(progressTimer);
		signal?.removeEventListener("abort", abortExplorer);
		if (activeExplorerCancel === abortExplorer) activeExplorerCancel = undefined;
	});

	if (signal?.aborted) {
		throw new Error("Explorer cancelled.");
	}

	let answer = "";
	try {
		const parsed = JSON.parse(stdout.trim());
		if (parsed.is_error) throw new Error(parsed.result ?? "Explorer returned an error.");
		answer = typeof parsed.result === "string" ? parsed.result : stdout.trim();
	} catch (err) {
		if (exitCode !== 0) {
			const detail = stderr.trim() || stdout.trim();
			throw new Error(detail || (err instanceof Error ? err.message : String(err)));
		}
		answer = stdout.trim() || stderr.trim() || "(explorer returned no output)";
	}

	return {
		answer: truncate(answer),
		stdout: truncate(stdout),
		stderr: truncate(stderr),
		exitCode,
		durationMs: Date.now() - startedAt,
		model: MODEL,
	};
}

export default function explorerExtension(pi: ExtensionAPI) {
	registerExplorerTool(pi, {
		formatDuration,
		hasActiveExplorer,
		cancelActiveExplorer,
		runCursorExplorer,
	});
}
