/**
 * Editor — /sub, /subcont, /subrm, /subclear with live widgets
 *
 * Spawns background Pi SDK editor agents (no external coding CLI). Each agent has a
 * persistent Pi session, can read/search/edit/write files, and reports completion
 * back to the main model as a follow-up message.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	DynamicBorder,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as os from "node:os";
import * as path from "node:path";
import { applyExtensionDefaults } from "../minimal/themeMap.ts";

type SubStatus = "running" | "done" | "error" | "interrupted";

interface PersistedSubState {
	id: number;
	status: SubStatus;
	task: string;
	lastText: string;
	toolCount: number;
	elapsed: number;
	sessionFile: string;
	turnCount: number;
	updatedAt: number;
}

type NativeAgentSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

interface SubState extends PersistedSubState {
	textChunks: string[];
	session?: NativeAgentSession;
}

interface Snapshot {
	version: 1;
	nextId: number;
	agents: PersistedSubState[];
}

const CUSTOM_STATE_TYPE = "native-subagent-state";
const CUSTOM_RESULT_TYPE = "native-subagent-result";
const SUBAGENT_MODEL_ID = "gpt-5.5";
const SUBAGENT_THINKING = "low";
const SUBAGENT_TOOLS = ["read", "edit", "write", "grep", "find", "ls"];

const SUBAGENT_SYSTEM_APPEND = `You are an editor background subagent delegated by the main model.

Your job:
- Complete the delegated coding task directly in the current working directory.
- You may read, search, edit, and write files.
- Do not ask the user questions unless the task is impossible without clarification.
- Keep your final response concise: list files changed and anything the main model must know.
- You do not have bash. Use read, edit, write, grep, find, and ls only.`;

function makeSubagentSessionDir(): string {
	return path.join(os.homedir(), ".pi", "agent", "sessions", "native-subagents");
}

function toPersisted(state: SubState): PersistedSubState {
	return {
		id: state.id,
		status: state.status,
		task: state.task,
		lastText: state.textChunks.join("") || state.lastText || "",
		toolCount: state.toolCount,
		elapsed: state.elapsed,
		sessionFile: state.sessionFile,
		turnCount: state.turnCount,
		updatedAt: Date.now(),
	};
}

function extractMessageText(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (part?.type === "text" && typeof part.text === "string") return part.text;
			if (part?.type === "thinking" && typeof part.thinking === "string") return part.thinking;
			return "";
		})
		.filter(Boolean)
		.join("");
}

function resolveSubagentModel(ctx: ExtensionContext): Model<any> | undefined {
	return (
		ctx.modelRegistry.find("openai-codex", SUBAGENT_MODEL_ID) ??
		ctx.modelRegistry.find("openai", SUBAGENT_MODEL_ID) ??
		ctx.modelRegistry.getAll().find((model) => model.id === SUBAGENT_MODEL_ID)
	);
}

function restoreSnapshot(ctx: ExtensionContext): Snapshot | undefined {
	let snapshot: Snapshot | undefined;
	for (const entry of ctx.sessionManager.getBranch() as any[]) {
		if (entry.type === "custom" && entry.customType === CUSTOM_STATE_TYPE) {
			snapshot = entry.data as Snapshot;
		}
	}
	return snapshot?.version === 1 ? snapshot : undefined;
}

function widgetKey(id: number): string {
	return `editor-${id}`;
}

export default function (pi: ExtensionAPI) {
	const agents: Map<number, SubState> = new Map();
	let nextId = 1;
	let widgetCtx: ExtensionContext | undefined;
	let shuttingDown = false;

	function persistSnapshot() {
		try {
			const snapshot: Snapshot = {
				version: 1,
				nextId,
				agents: Array.from(agents.values()).map(toPersisted),
			};
			pi.appendEntry(CUSTOM_STATE_TYPE, snapshot);
		} catch {
			// Runtime can be stale during reload/shutdown; best-effort persistence only.
		}
	}

	function updateWidgets() {
		const ctx = widgetCtx;
		if (!ctx?.hasUI) return;

		for (const [id, state] of Array.from(agents.entries())) {
			ctx.ui.setWidget(widgetKey(id), (_tui: any, theme: any) => {
				const container = new Container();
				const borderFn = (s: string) => theme.fg("dim", s);
				const content = new Text("", 1, 0);

				container.addChild(new Text("", 0, 0));
				container.addChild(new DynamicBorder(borderFn));
				container.addChild(content);
				container.addChild(new DynamicBorder(borderFn));

				return {
					render(width: number): string[] {
						const statusColor = state.status === "running" ? "accent"
							: state.status === "done" ? "success"
							: state.status === "interrupted" ? "warning"
							: "error";
						const statusIcon = state.status === "running" ? "●"
							: state.status === "done" ? "✓"
							: state.status === "interrupted" ? "!"
							: "✗";

						const taskPreview = state.task.length > 48 ? `${state.task.slice(0, 45)}...` : state.task;
						const turnLabel = state.turnCount > 1 ? theme.fg("dim", ` · Turn ${state.turnCount}`) : "";
						const seconds = Math.round(state.elapsed / 1000);
						const header = theme.fg(statusColor, `${statusIcon} Editor #${state.id}`) +
							turnLabel +
							theme.fg("dim", `  ${taskPreview}`) +
							theme.fg("dim", `  (${seconds}s)`) +
							theme.fg("dim", ` | Tools: ${state.toolCount}`);

						const lines = [truncateToWidth(header, Math.max(1, width - 2))];
						const fullText = state.textChunks.join("") || state.lastText;
						const lastLine = fullText.split("\n").filter((line) => line.trim()).pop() || "";
						if (lastLine) lines.push(truncateToWidth(theme.fg("muted", `  ${lastLine}`), Math.max(1, width - 2)));

						content.setText(lines.join("\n"));
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
				};
			});
		}
	}

	async function stopAgent(state: SubState, status: SubStatus = "interrupted") {
		state.status = status;
		await state.session?.abort().catch(() => {});
		state.session?.dispose();
		state.session = undefined;
		state.updatedAt = Date.now();
		updateWidgets();
	}

	async function createSdkSession(state: SubState, ctx: ExtensionContext): Promise<NativeAgentSession> {
		const model = resolveSubagentModel(ctx);
		if (!model) throw new Error(`Could not find model ${SUBAGENT_MODEL_ID}. Check Pi model configuration.`);

		const resourceLoader = new DefaultResourceLoader({
			cwd: ctx.cwd,
			agentDir: getAgentDir(),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			appendSystemPrompt: [SUBAGENT_SYSTEM_APPEND],
		});
		await resourceLoader.reload();

		const sessionManager = state.sessionFile
			? SessionManager.open(state.sessionFile, makeSubagentSessionDir(), ctx.cwd)
			: SessionManager.create(ctx.cwd, makeSubagentSessionDir());

		const { session } = await createAgentSession({
			cwd: ctx.cwd,
			agentDir: getAgentDir(),
			model,
			thinkingLevel: SUBAGENT_THINKING,
			authStorage: ctx.modelRegistry.authStorage,
			modelRegistry: ctx.modelRegistry,
			resourceLoader,
			tools: SUBAGENT_TOOLS,
			sessionManager,
		});

		state.sessionFile = session.sessionFile ?? state.sessionFile;
		return session;
	}

	async function runSubagent(state: SubState, prompt: string, ctx: ExtensionContext) {
		const startTime = Date.now();
		const timer = setInterval(() => {
			state.elapsed = Date.now() - startTime;
			updateWidgets();
		}, 1000);

		try {
			const session = await createSdkSession(state, ctx);
			if (!agents.has(state.id) || shuttingDown || state.status !== "running") {
				session.dispose();
				return;
			}
			if (!state.sessionFile && session.sessionFile) state.sessionFile = session.sessionFile;
			state.session = session;
			persistSnapshot();

			const unsubscribe = session.subscribe((event: any) => {
				if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
					state.textChunks.push(event.assistantMessageEvent.delta || "");
					updateWidgets();
				} else if (event.type === "message_end" && event.message?.role === "assistant") {
					const text = extractMessageText(event.message);
					if (text) state.lastText = text;
					updateWidgets();
				} else if (event.type === "tool_execution_start") {
					state.toolCount++;
					updateWidgets();
				}
			});

			try {
				await session.prompt(prompt);
			} finally {
				unsubscribe();
			}

			if (agents.has(state.id) && !shuttingDown) {
				state.status = "done";
			}
		} catch (err) {
			if (agents.has(state.id) && !shuttingDown) {
				state.status = state.status === "interrupted" ? "interrupted" : "error";
				state.textChunks.push(`\nError: ${err instanceof Error ? err.message : String(err)}`);
			}
		} finally {
			clearInterval(timer);
			state.elapsed = Date.now() - startTime;
			state.session?.dispose();
			state.session = undefined;
			state.lastText = state.textChunks.join("") || state.lastText;
			state.updatedAt = Date.now();
			persistSnapshot();
			updateWidgets();

			if (!shuttingDown && agents.has(state.id)) {
				const result = state.lastText || state.textChunks.join("") || "(no text response)";
				const statusLabel = state.status === "done" ? "finished" : state.status;
				ctx.ui.notify(
					`Editor #${state.id} ${statusLabel} in ${Math.round(state.elapsed / 1000)}s`,
					state.status === "done" ? "success" : state.status === "interrupted" ? "warning" : "error",
				);

				try {
					pi.sendMessage({
						customType: CUSTOM_RESULT_TYPE,
						content: `Editor #${state.id}${state.turnCount > 1 ? ` (Turn ${state.turnCount})` : ""} ${statusLabel} task:\n${prompt}\n\nSession: ${state.sessionFile}\nTools used: ${state.toolCount}\nElapsed: ${Math.round(state.elapsed / 1000)}s\n\nResult:\n${result.slice(0, 8000)}${result.length > 8000 ? "\n\n... [truncated]" : ""}`,
						display: true,
						details: toPersisted(state),
					}, { deliverAs: "followUp", triggerTurn: true });
				} catch {
					// Runtime may be stale during shutdown/reload.
				}
			}
		}
	}

	function startAgent(task: string, ctx: ExtensionContext, existing?: SubState): SubState {
		widgetCtx = ctx;
		const state: SubState = existing ?? {
			id: nextId++,
			status: "running",
			task,
			lastText: "",
			textChunks: [],
			toolCount: 0,
			elapsed: 0,
			sessionFile: "",
			turnCount: 1,
			updatedAt: Date.now(),
		};

		state.status = "running";
		state.task = task;
		state.lastText = "";
		state.textChunks = [];
		state.toolCount = 0;
		state.elapsed = 0;
		state.updatedAt = Date.now();
		agents.set(state.id, state);
		persistSnapshot();
		updateWidgets();
		runSubagent(state, task, ctx);
		return state;
	}

	function listAgents(): string {
		if (agents.size === 0) return "No editor agents.";
		return Array.from(agents.values())
			.map((s) => `#${s.id} [${s.status.toUpperCase()}] (Turn ${s.turnCount}) - ${s.task}\n  session: ${s.sessionFile || "pending"}`)
			.join("\n");
	}

	pi.registerTool({
		name: "subagent_create",
		label: "Editor Subagent Create",
		description: "Spawn an editor subagent: a native Pi background agent for medium-to-large code edits, refactors, and implementation work. It can read, search, edit, and write files. Returns immediately; the result is delivered as a follow-up message.",
		promptSnippet: "Spawn an editor subagent for medium-to-large code changes, refactors, and independent implementation work silos",
		promptGuidelines: [
			"Use subagent_create as an editor subagent when medium-to-large code changes, refactors, migrations, test additions, or multi-file implementation work can be delegated.",
			"Use subagent_create to develop independent work silos in parallel. Spawn multiple editor subagents when tasks can be split cleanly by file, component, feature, or concern.",
			"Give each subagent a complete, bounded task with target files, constraints, and expected output. Avoid overlapping edits across subagents unless coordination is explicit.",
			"Do not use subagent_create for simple read-only investigation or tiny edits; use direct tools or explorer instead.",
		],
		parameters: Type.Object({
			task: Type.String({ description: "Complete task description for the subagent" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			const state = startAgent(args.task, ctx);
			return {
				content: [{ type: "text", text: `Editor #${state.id} spawned with ${SUBAGENT_MODEL_ID}:${SUBAGENT_THINKING}. It can use ${SUBAGENT_TOOLS.join(", ")}.` }],
				details: toPersisted(state),
			};
		},
	});

	pi.registerTool({
		name: "subagent_continue",
		label: "Editor Subagent Continue",
		description: "Continue an existing editor subagent conversation using its persistent session. Use this for follow-up edits, fixes, or review after a subagent finishes. Returns immediately; the result is delivered as a follow-up message.",
		promptSnippet: "Continue an existing editor subagent by ID for follow-up edits or refinement",
		promptGuidelines: ["Use subagent_continue to give follow-up instructions to an existing editor subagent after it finishes, especially for fixes, refinements, or additional edits in the same work silo."],
		parameters: Type.Object({
			id: Type.Number({ description: "Subagent ID" }),
			prompt: Type.String({ description: "Follow-up prompt or new instructions" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			const state = agents.get(args.id);
			if (!state) return { content: [{ type: "text", text: `Error: No editor agent #${args.id} found.` }] };
			if (state.status === "running") return { content: [{ type: "text", text: `Error: Editor #${args.id} is still running.` }] };
			state.turnCount++;
			startAgent(args.prompt, ctx, state);
			return {
				content: [{ type: "text", text: `Editor #${args.id} continuing in background.` }],
				details: toPersisted(state),
			};
		},
	});

	pi.registerTool({
		name: "subagent_remove",
		label: "Editor Remove",
		description: "Remove an editor agent from the widget list. If it is running, abort it first.",
		parameters: Type.Object({
			id: Type.Number({ description: "Subagent ID" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx = ctx;
			const state = agents.get(args.id);
			if (!state) return { content: [{ type: "text", text: `Error: No editor agent #${args.id} found.` }] };
			if (state.status === "running") await stopAgent(state);
			ctx.ui.setWidget(widgetKey(args.id), undefined);
			agents.delete(args.id);
			persistSnapshot();
			return { content: [{ type: "text", text: `Editor #${args.id} removed.` }] };
		},
	});

	pi.registerTool({
		name: "subagent_list",
		label: "Editor List",
		description: "List active and finished editor agents with IDs, tasks, status, and session files.",
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: listAgents() }] }),
	});

	pi.registerCommand("sub", {
		description: "Spawn an editor agent with live widget: /sub <task>",
		handler: async (args, ctx) => {
			const task = args?.trim();
			if (!task) return ctx.ui.notify("Usage: /sub <task>", "error");
			const state = startAgent(task, ctx);
			ctx.ui.notify(`Editor #${state.id} started.`, "info");
		},
	});

	pi.registerCommand("subcont", {
		description: "Continue an existing editor agent: /subcont <number> <prompt>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const trimmed = args?.trim() ?? "";
			const spaceIdx = trimmed.indexOf(" ");
			if (spaceIdx === -1) return ctx.ui.notify("Usage: /subcont <number> <prompt>", "error");

			const id = parseInt(trimmed.slice(0, spaceIdx), 10);
			const prompt = trimmed.slice(spaceIdx + 1).trim();
			if (Number.isNaN(id) || !prompt) return ctx.ui.notify("Usage: /subcont <number> <prompt>", "error");

			const state = agents.get(id);
			if (!state) return ctx.ui.notify(`No editor agent #${id} found.`, "error");
			if (state.status === "running") return ctx.ui.notify(`Editor #${id} is still running.`, "warning");

			state.turnCount++;
			startAgent(prompt, ctx, state);
			ctx.ui.notify(`Continuing editor agent #${id} (Turn ${state.turnCount}).`, "info");
		},
	});

	pi.registerCommand("subrm", {
		description: "Remove an editor agent widget: /subrm <number>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const id = parseInt(args?.trim() ?? "", 10);
			if (Number.isNaN(id)) return ctx.ui.notify("Usage: /subrm <number>", "error");

			const state = agents.get(id);
			if (!state) return ctx.ui.notify(`No editor agent #${id} found.`, "error");
			if (state.status === "running") await stopAgent(state);
			ctx.ui.setWidget(widgetKey(id), undefined);
			agents.delete(id);
			persistSnapshot();
			ctx.ui.notify(`Editor #${id} removed.`, "info");
		},
	});

	pi.registerCommand("subclear", {
		description: "Clear all editor agent widgets",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			let interrupted = 0;
			for (const [id, state] of Array.from(agents.entries())) {
				if (state.status === "running") {
					await stopAgent(state);
					interrupted++;
				}
				ctx.ui.setWidget(widgetKey(id), undefined);
			}
			const total = agents.size;
			agents.clear();
			nextId = 1;
			persistSnapshot();
			ctx.ui.notify(
				total === 0 ? "No editor agents to clear." : `Cleared ${total} editor agent${total === 1 ? "" : "s"}${interrupted ? ` (${interrupted} interrupted)` : ""}.`,
				total === 0 ? "info" : "success",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		shuttingDown = false;
		widgetCtx = ctx;
		applyExtensionDefaults(import.meta.url, ctx);

		for (const [id, state] of Array.from(agents.entries())) {
			if (state.status === "running") await stopAgent(state);
			ctx.ui.setWidget(widgetKey(id), undefined);
		}
		agents.clear();
		nextId = 1;

		const snapshot = restoreSnapshot(ctx);
		if (snapshot) {
			nextId = snapshot.nextId;
			for (const item of snapshot.agents) {
				const restoredStatus = item.status === "running" ? "interrupted" : item.status;
				agents.set(item.id, {
					...item,
					status: restoredStatus,
					lastText: item.lastText || (item.status === "running" ? "Restored after restart/reload. Use /subcont to continue." : ""),
					textChunks: [],
				});
			}
			nextId = Math.max(nextId, ...Array.from(agents.keys()).map((id) => id + 1));
			updateWidgets();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		shuttingDown = true;
		for (const [id, state] of Array.from(agents.entries())) {
			if (state.status === "running") {
				state.status = "interrupted";
				state.lastText = state.lastText || "Interrupted by session shutdown/reload. Use /subcont to continue.";
				await stopAgent(state, "interrupted");
			}
			ctx.ui.setWidget(widgetKey(id), undefined);
		}
		persistSnapshot();
	});
}
