import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { OracleParams } from "./agent";
import type { OracleControl, OracleResult } from "./logic";
import { renderOracleCall, renderOracleResult, startOracleUi } from "./widget";

const ORACLE_PARAMS = Type.Object({
	question: Type.String({
		description: "The focused question or task for the oracle to analyze.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Relevant context, observations, errors, constraints, or prior analysis.",
		}),
	),
	files: Type.Optional(
		Type.Array(Type.String(), {
			description: "Relevant file paths the oracle should pay special attention to.",
		}),
	),
});

type OracleToolDeps = {
	formatControlForAgent: (control: OracleControl) => string;
	formatDuration: (ms: number) => string;
	runCodexOracle: (
		params: OracleParams,
		cwd: string,
		signal: AbortSignal | undefined,
		onProgress: (text: string) => void,
	) => Promise<OracleResult>;
};

export function registerOracleTool(pi: ExtensionAPI, deps: OracleToolDeps) {
	pi.registerTool({
		name: "oracle",
		label: "Oracle",
		description:
			"Ask a slower, more expensive GPT-5.4 high-reasoning second-opinion agent for complex debugging, subtle logic review, architecture/refactor decisions, or deep analysis. Avoid oracle for routine edits, formatting, simple lookups, or day-to-day coding tasks. The oracle runs Codex in read-only mode and should not mutate files. The oracle result is rendered directly for the user and returned to the calling agent; do not repeat it verbatim unless the user explicitly asks.",
		promptSnippet:
			"Ask GPT-5.4 high-reasoning Codex for read-only second opinions. The result is printed for the user and passed back to you; use it internally without restating it verbatim.",
		promptGuidelines: [
			"Use oracle when a complex bug, subtle logic review, architecture choice, or backwards-compatible refactor would benefit from an independent GPT-5.4 high-reasoning second opinion.",
			"Avoid oracle for routine edits, formatting, simple questions, or normal code changes because it is slower and more expensive than the main agent.",
			"When using oracle, ask a focused question and include relevant files, commands, errors, constraints, and your current hypothesis.",
			"After oracle returns, treat its response as internal input. Do not speak as the oracle and do not repeat/summarize the oracle response back to the user; pi already rendered it for them.",
			"Oracle tool results include AGENT_CONTROL. If it says INFORMATION, stop and do not call more tools. If it says IMPLEMENT, continue with the provided task and files.",
		],
		parameters: ORACLE_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const oracleUi = startOracleUi(ctx, params.question, deps.formatDuration);

			try {
				const result = await deps.runCodexOracle(params, ctx.cwd, signal, oracleUi.update);

				if (result.exitCode !== 0) {
					throw new Error(
						`Oracle Codex exited with code ${result.exitCode}.\n\nSTDERR:\n${result.stderr}\n\nSTDOUT:\n${result.stdout}`,
					);
				}

				oracleUi.finish("done", `Completed in ${deps.formatDuration(result.durationMs)}.`);
				oracleUi.clear();

				const answer = `Completed in ${deps.formatDuration(result.durationMs)}.\n\n${deps.formatControlForAgent(result.control)}\n\n${result.answer}`;
				return {
					content: [{ type: "text", text: answer }],
					details: { ...result, question: params.question, files: params.files ?? [] },
					terminate: result.control.action === "INFORMATION",
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				oracleUi.finish("error", message);
				oracleUi.clear();
				throw new Error(`Oracle failed: ${message}`);
			} finally {
				oracleUi.clearWorking();
			}
		},
		renderCall(_args, theme) {
			return renderOracleCall(theme);
		},
		renderResult(result, { isPartial }, theme) {
			return renderOracleResult(result, isPartial, theme);
		},
	});
}
