import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ExplorerParams } from "./agent";
import type { ExplorerResult } from "./logic";
import { registerExplorerUi, renderExplorerCall, renderExplorerResult, withExplorerUi } from "./widget";

const EXPLORER_PARAMS = Type.Object({
	query: Type.String({
		description: "The specific question, pattern, or flow to explore in the codebase.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Relevant context, prior findings, errors, or constraints for the exploration.",
		}),
	),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description: "Specific file paths or directories to focus the exploration on.",
		}),
	),
});

type ExplorerToolDeps = {
	formatDuration: (ms: number) => string;
	hasActiveExplorer: () => boolean;
	cancelActiveExplorer: () => void;
	runCursorExplorer: (
		params: ExplorerParams,
		cwd: string,
		signal: AbortSignal | undefined,
		onProgress: (text: string) => void,
	) => Promise<ExplorerResult>;
};

export function registerExplorerTool(pi: ExtensionAPI, deps: ExplorerToolDeps) {
	registerExplorerUi(pi, deps.hasActiveExplorer, deps.cancelActiveExplorer);

	pi.registerTool({
		name: "explorer",
		label: "Explorer",
		description:
			"Explore the codebase using a read-only explorer agent. Use for tracing data flows, finding where something is defined or used, understanding project structure, locating hidden dependencies, or answering 'where is X' / 'how does Y work' questions. Findings are returned directly to you — the user sees only the progress widget, not the output.",
		promptSnippet: "Explore the codebase to find, trace, and understand. Findings are returned directly to you.",
		promptGuidelines: [
			"Use explorer to trace data flows, find definitions, understand project structure, or answer questions about how the codebase works.",
			"Avoid explorer for simple file reads you can do directly, or for tasks that require writing code.",
			"When using explorer, ask a focused, specific query and include relevant paths or context.",
			"Explorer findings come back to you as tool output — act on them directly without restating them to the user.",
		],
		parameters: EXPLORER_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return await withExplorerUi(ctx, params.query, deps.formatDuration, async (ui) => {
				try {
					const result = await deps.runCursorExplorer(params, ctx.cwd, signal, ui.update);

					ui.finish("done", `Completed in ${deps.formatDuration(result.durationMs)}.`);
					ui.clear();

					return {
						content: [{ type: "text", text: result.answer }],
						details: { ...result, query: params.query, paths: params.paths ?? [] },
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ui.finish("error", message);
					ui.clear();
					throw new Error(`Explorer failed: ${message}`);
				}
			});
		},
		renderCall(args, theme) {
			return renderExplorerCall(args, theme);
		},
		renderResult(result, { isPartial }, theme) {
			return renderExplorerResult(result, isPartial, theme);
		},
	});
}
