/**
 * Explorer UI helpers.
 *
 * Green-themed widget, progress indicator, Ctrl+C cancel wiring, tool call/result rendering.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor, DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

export type ExplorerWidgetContent = {
	title: string;
	statusColor: "accent" | "success" | "error";
	message: string;
	detail?: string;
	elapsed: string;
	markdown?: string;
};

type ExplorerWidgetState = {
	status: "running" | "done" | "error";
	message: string;
	detail: string;
	startedAt: number;
	elapsed: number;
	markdown?: string;
};

const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const WAITING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function green(text: string): string {
	return `${GREEN}${text}${RESET}`;
}

function shorten(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function createExplorerWidget(content: ExplorerWidgetContent) {
	return (_tui: any, theme: any) => {
		const container = new Container();
		const borderFn = (text: string) => green(text);

		container.addChild(new Text("", 0, 0));
		container.addChild(new DynamicBorder(borderFn));
		const header = new Text("", 1, 0);
		container.addChild(header);
		const markdown = new Markdown("", 1, 0, getMarkdownTheme(), {
			color: (text: string) => theme.fg("customMessageText", text),
		});
		container.addChild(markdown);
		container.addChild(new DynamicBorder(borderFn));

		return {
			render(width: number): string[] {
				const title =
					content.statusColor === "accent"
						? green(content.title)
						: theme.fg(content.statusColor, content.title);
				const lines = [
					`${title}${theme.fg("dim", `  ${shorten(content.message, 44)}`)}${theme.fg("dim", `  ${content.elapsed}`)}`,
				];

				header.setText(lines.join("\n"));
				markdown.setText(content.markdown ?? "");
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
		};
	};
}

function setExplorerWidget(ctx: any, state: ExplorerWidgetState, formatDuration: (ms: number) => string) {
	ctx.ui.setWidget(
		"explorer",
		createExplorerWidget({
			title: "🧭 Explorer",
			statusColor: state.status === "running" ? "accent" : state.status === "done" ? "success" : "error",
			message: state.message,
			detail: state.detail,
			elapsed: formatDuration(state.elapsed),
			markdown: state.markdown,
		}),
	);
}

export function startExplorerUi(ctx: any, message: string, formatDuration: (ms: number) => string) {
	const state: ExplorerWidgetState = {
		status: "running",
		message: message || "Exploring...",
		detail: "Navigating the codebase.",
		startedAt: Date.now(),
		elapsed: 0,
	};

	let timer: ReturnType<typeof setInterval> | undefined;
	const refresh = () => {
		state.elapsed = Date.now() - state.startedAt;
		setExplorerWidget(ctx, state, formatDuration);
	};

	ctx.ui.setWorkingMessage("Exploring...");
	ctx.ui.setWorkingIndicator({ frames: WAITING_SPINNER_FRAMES, intervalMs: 80 });
	ctx.ui.setStatus("explorer", "🧭 Explorer navigating...");
	refresh();
	timer = setInterval(refresh, 1000);

	return {
		update(detail: string) {
			state.status = "running";
			state.detail = detail;
			ctx.ui.setStatus("explorer", `🧭 Explorer navigating... ${formatDuration(Date.now() - state.startedAt)}`);
			refresh();
		},
		finish(status: "done" | "error", detail: string, markdown?: string) {
			if (timer) clearInterval(timer);
			timer = undefined;
			state.status = status;
			state.message = status === "done" ? "Complete" : "Error";
			state.detail = detail;
			state.markdown = markdown;
			ctx.ui.setStatus("explorer", undefined);
			refresh();
		},
		clear() {
			if (timer) clearInterval(timer);
			timer = undefined;
			ctx.ui.setStatus("explorer", undefined);
			ctx.ui.setWidget("explorer", undefined);
		},
		clearWorking() {
			ctx.ui.setWorkingMessage(undefined);
			ctx.ui.setWorkingIndicator();
		},
	};
}

class ExplorerAwareEditor extends CustomEditor {
	constructor(
		tui: any,
		theme: any,
		keybindings: any,
		private readonly isExplorerActive: () => boolean,
		private readonly abortExplorer: () => void,
	) {
		super(tui, theme, keybindings);
	}

	handleInput(data: string): void {
		if (this.isExplorerActive() && matchesKey(data, "ctrl+c")) {
			this.abortExplorer();
			return;
		}
		super.handleInput(data);
	}
}

export function registerExplorerCancelEditor(
	pi: ExtensionAPI,
	isExplorerActive: () => boolean,
	cancelExplorer: () => void,
) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) =>
			new ExplorerAwareEditor(tui, theme, keybindings, isExplorerActive, () => {
				cancelExplorer();
				ctx.abort();
				ctx.ui.notify("Explorer cancelled.", "info");
			}),
		);
	});
}

export function registerExplorerUi(
	pi: ExtensionAPI,
	isExplorerActive: () => boolean,
	cancelExplorer: () => void,
) {
	registerExplorerCancelEditor(pi, isExplorerActive, cancelExplorer);
}

export type ExplorerUiHandle = {
	update: (detail: string) => void;
	finish: (status: "done" | "error", detail: string, markdown?: string) => void;
	clear: () => void;
};

export async function withExplorerUi<T>(
	ctx: any,
	query: string,
	formatDuration: (ms: number) => string,
	run: (ui: ExplorerUiHandle) => Promise<T>,
): Promise<T> {
	const explorerUi = startExplorerUi(ctx, query, formatDuration);
	const ui: ExplorerUiHandle = {
		update: (detail) => explorerUi.update(detail),
		finish: (status, detail, markdown) => explorerUi.finish(status, detail, markdown),
		clear: () => explorerUi.clear(),
	};
	try {
		return await run(ui);
	} finally {
		explorerUi.clearWorking();
	}
}

export function renderExplorerCall(_args: any, theme: any) {
	return new Text(theme.fg("success", "🧭 Explorer"), 0, 0);
}

export function renderExplorerResult(result: any, isPartial: boolean, _theme: any) {
	if (isPartial) {
		return new Text(green("🧭 Explorer navigating..."), 0, 0);
	}

	const text = result.content[0];
	const content = text?.type === "text" ? text.text : JSON.stringify(result.content, null, 2);
	return new Markdown(content, 0, 0, getMarkdownTheme());
}

export default function (_pi: ExtensionAPI) {
	// UI helper only. The live Explorer extension owns activation.
}
