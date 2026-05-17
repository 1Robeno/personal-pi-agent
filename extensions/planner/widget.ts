/**
 * Planner UI helpers. Blue theme, 📋 branding.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor, DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

type PlannerWidgetState = {
	status: "running" | "done" | "error";
	message: string;
	startedAt: number;
	elapsed: number;
};

const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";
const WAITING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function blue(text: string): string {
	return `${BLUE}${text}${RESET}`;
}

function shorten(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function createPlannerWidget(state: PlannerWidgetState, formatDuration: (ms: number) => string) {
	return (_tui: any, theme: any) => {
		const container = new Container();
		const borderFn = (text: string) => blue(text);

		container.addChild(new Text("", 0, 0));
		container.addChild(new DynamicBorder(borderFn));
		const header = new Text("", 1, 0);
		container.addChild(header);
		container.addChild(new DynamicBorder(borderFn));

		return {
			render(width: number): string[] {
				const title =
					state.status === "running"
						? blue("📋 Planner")
						: theme.fg(state.status === "done" ? "success" : "error", "📋 Planner");
				const elapsed = formatDuration(state.elapsed);
				header.setText(`${title}${theme.fg("dim", `  ${shorten(state.message, 44)}`)}${theme.fg("dim", `  ${elapsed}`)}`);
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
		};
	};
}

export function startPlannerUi(ctx: any, message: string, formatDuration: (ms: number) => string) {
	const state: PlannerWidgetState = {
		status: "running",
		message: message || "Planning...",
		startedAt: Date.now(),
		elapsed: 0,
	};

	let timer: ReturnType<typeof setInterval> | undefined;
	const refresh = () => {
		state.elapsed = Date.now() - state.startedAt;
		ctx.ui.setWidget("planner", createPlannerWidget(state, formatDuration));
	};

	ctx.ui.setWorkingMessage("Planning...");
	ctx.ui.setWorkingIndicator({ frames: WAITING_SPINNER_FRAMES, intervalMs: 80 });
	ctx.ui.setStatus("planner", "📋 Planner thinking...");
	refresh();
	timer = setInterval(refresh, 1000);

	return {
		update(detail: string) {
			state.message = detail;
			ctx.ui.setStatus("planner", `📋 Planner thinking... ${formatDuration(Date.now() - state.startedAt)}`);
			refresh();
		},
		finish(status: "done" | "error", detail: string) {
			if (timer) clearInterval(timer);
			timer = undefined;
			state.status = status;
			state.message = detail;
			ctx.ui.setStatus("planner", undefined);
			refresh();
		},
		clear() {
			if (timer) clearInterval(timer);
			timer = undefined;
			ctx.ui.setStatus("planner", undefined);
			ctx.ui.setWidget("planner", undefined);
		},
		clearWorking() {
			ctx.ui.setWorkingMessage(undefined);
			ctx.ui.setWorkingIndicator();
		},
	};
}

class PlannerAwareEditor extends CustomEditor {
	constructor(
		tui: any,
		theme: any,
		keybindings: any,
		private readonly isPlannerActive: () => boolean,
		private readonly abortPlanner: () => void,
	) {
		super(tui, theme, keybindings);
	}

	handleInput(data: string): void {
		if (this.isPlannerActive() && matchesKey(data, "ctrl+c")) {
			this.abortPlanner();
			return;
		}
		super.handleInput(data);
	}
}

export function registerPlannerUi(
	pi: ExtensionAPI,
	isPlannerActive: () => boolean,
	cancelPlanner: () => void,
) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) =>
			new PlannerAwareEditor(tui, theme, keybindings, isPlannerActive, () => {
				cancelPlanner();
				ctx.abort();
				ctx.ui.notify("Planner cancelled.", "info");
			}),
		);
	});
}

export type PlannerUiHandle = {
	update: (detail: string) => void;
	finish: (status: "done" | "error", detail: string) => void;
	clear: () => void;
};

export async function withPlannerUi<T>(
	ctx: any,
	task: string,
	formatDuration: (ms: number) => string,
	run: (ui: PlannerUiHandle) => Promise<T>,
): Promise<T> {
	const plannerUi = startPlannerUi(ctx, task, formatDuration);
	const ui: PlannerUiHandle = {
		update: (detail) => plannerUi.update(detail),
		finish: (status, detail) => plannerUi.finish(status, detail),
		clear: () => plannerUi.clear(),
	};
	try {
		return await run(ui);
	} finally {
		plannerUi.clearWorking();
	}
}

export function renderPlannerCall(_args: any, theme: any) {
	return new Text(theme.fg("accent", "📋 Planner"), 0, 0);
}

export function renderPlannerResult(result: any, isPartial: boolean, _theme: any) {
	if (isPartial) return new Text(blue("📋 Planning..."), 0, 0);
	const text = result.content[0];
	const content = text?.type === "text" ? text.text : JSON.stringify(result.content, null, 2);
	return new Markdown(content, 0, 0, getMarkdownTheme());
}

export default function (_pi: ExtensionAPI) {
	// UI helper only.
}
