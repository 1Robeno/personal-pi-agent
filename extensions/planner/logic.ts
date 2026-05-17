import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildPrompt, MODEL, REASONING, SANDBOX } from "./agent";
import { registerPlannerTool } from "./tool";

export type PlannerResult = {
	planPath: string;
	answer: string;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	durationMs: number;
	model: string;
};

let activePlannerCancel: (() => void) | undefined;

function hasActivePlanner(): boolean {
	return Boolean(activePlannerCancel);
}

function cancelActivePlanner() {
	activePlannerCancel?.();
}

function truncate(text: string, maxChars = 60_000): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Planner output truncated: ${text.length - maxChars} characters omitted.]`;
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

async function runCodexPlanner(
	sessionContext: string,
	task: string,
	planPath: string,
	cwd: string,
	signal: AbortSignal | undefined,
	onProgress: (text: string) => void,
): Promise<PlannerResult> {
	const startedAt = Date.now();
	const tempDir = await mkdtemp(join(tmpdir(), "pi-planner-"));
	const outputFile = join(tempDir, "plan.md");
	const prompt = buildPrompt(sessionContext, task, cwd);

	const args = [
		"exec",
		"--model", MODEL,
		"-c", `model_reasoning_effort=${REASONING}`,
		"--skip-git-repo-check",
		"--sandbox", SANDBOX,
		"--cd", cwd,
		"--output-last-message", outputFile,
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

		const abortPlanner = () => killProcess(child);
		activePlannerCancel = abortPlanner;
		if (signal?.aborted) abortPlanner();
		else signal?.addEventListener("abort", abortPlanner, { once: true });

		child.stdin.write(prompt);
		child.stdin.end();

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => { stdout += chunk; });
		child.stderr.on("data", (chunk: string) => { stderr += chunk; });

		const progressTimer = setInterval(() => {
			onProgress(`Still planning (${formatDuration(Date.now() - startedAt)}).`);
		}, 15_000);

		const exitCode = await new Promise<number | null>((resolve, reject) => {
			child.on("error", reject);
			child.on("close", (code) => resolve(code));
		}).finally(() => {
			clearInterval(progressTimer);
			signal?.removeEventListener("abort", abortPlanner);
			if (activePlannerCancel === abortPlanner) activePlannerCancel = undefined;
		});

		if (signal?.aborted) throw new Error("Planner cancelled.");
		if (exitCode !== 0) {
			throw new Error(`Codex exited with code ${exitCode}.\n\nSTDERR:\n${stderr}\n\nSTDOUT:\n${stdout}`);
		}

		let planContent = "";
		try {
			planContent = await readFile(outputFile, "utf8");
		} catch {
			planContent = stdout.trim();
		}

		if (!planContent.trim()) {
			throw new Error(`Planner produced no output.\n\nSTDERR:\n${stderr}`);
		}

		const absPath = join(cwd, planPath);
		await mkdir(dirname(absPath), { recursive: true });
		await writeFile(absPath, planContent.trim(), "utf8");

		return {
			planPath,
			answer: truncate(planContent),
			stdout: truncate(stdout),
			stderr: truncate(stderr),
			exitCode,
			durationMs: Date.now() - startedAt,
			model: MODEL,
		};
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

export default function plannerExtension(pi: ExtensionAPI) {
	registerPlannerTool(pi, {
		formatDuration,
		hasActivePlanner,
		cancelActivePlanner,
		runCodexPlanner,
	});
}
