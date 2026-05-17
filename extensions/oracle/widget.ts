/**
 * Oracle UI helpers.
 *
 * This file owns the terminal layout, progress widget, spinner state, and tool
 * result rendering. The tool wiring only decides when to call these helpers.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor, DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

export type OracleWidgetContent = {
	title: string;
	statusColor: "accent" | "success" | "error";
	message: string;
	detail?: string;
	elapsed: string;
	markdown?: string;
};

type OracleWidgetState = {
	status: "running" | "done" | "error";
	message: string;
	detail: string;
	startedAt: number;
	elapsed: number;
	markdown?: string;
};

const PURPLE = "\x1b[35m";
const RESET = "\x1b[0m";
const WAITING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function purple(text: string): string {
	return `${PURPLE}${text}${RESET}`;
}

function shorten(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function createOracleWidget(content: OracleWidgetContent) {
	return (_tui: any, theme: any) => {
		const container = new Container();
		const borderFn = (text: string) => purple(text);

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
				const title = content.statusColor === "accent"
					? purple(content.title)
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

function setOracleWidget(ctx: any, state: OracleWidgetState, formatDuration: (ms: number) => string) {
	ctx.ui.setWidget(
		"oracle",
		createOracleWidget({
			title: "🔮 Oracle",
			statusColor: state.status === "running" ? "accent" : state.status === "done" ? "success" : "error",
			message: state.message,
			detail: state.detail,
			elapsed: formatDuration(state.elapsed),
			markdown: state.markdown,
		}),
	);
}

export function startOracleUi(ctx: any, message: string, formatDuration: (ms: number) => string) {
	const state: OracleWidgetState = {
		status: "running",
		message: message || "Reviewing...",
		detail: "Consulting a second opinion.",
		startedAt: Date.now(),
		elapsed: 0,
	};

	let timer: ReturnType<typeof setInterval> | undefined;
	const refresh = () => {
		state.elapsed = Date.now() - state.startedAt;
		setOracleWidget(ctx, state, formatDuration);
	};

	ctx.ui.setWorkingMessage("Waiting...");
	ctx.ui.setWorkingIndicator({ frames: WAITING_SPINNER_FRAMES, intervalMs: 80 });
	ctx.ui.setStatus("oracle", "🔮 Oracle thinking...");
	refresh();
	timer = setInterval(refresh, 1000);

	return {
		update(detail: string) {
			state.status = "running";
			state.detail = detail;
			ctx.ui.setStatus("oracle", `🔮 Oracle thinking... ${formatDuration(Date.now() - state.startedAt)}`);
			refresh();
		},
		finish(status: "done" | "error", detail: string, markdown?: string) {
			if (timer) clearInterval(timer);
			timer = undefined;
			state.status = status;
			state.message = status === "done" ? "Complete" : "Error";
			state.detail = detail;
			state.markdown = markdown;
			ctx.ui.setStatus("oracle", undefined);
			refresh();
		},
		clear() {
			if (timer) clearInterval(timer);
			timer = undefined;
			ctx.ui.setStatus("oracle", undefined);
			ctx.ui.setWidget("oracle", undefined);
		},
		clearWorking() {
			ctx.ui.setWorkingMessage(undefined);
			ctx.ui.setWorkingIndicator();
		},
	};
}

class OracleAwareEditor extends CustomEditor {
	constructor(
		tui: any,
		theme: any,
		keybindings: any,
		private readonly isOracleActive: () => boolean,
		private readonly abortOracle: () => void,
	) {
		super(tui, theme, keybindings);
	}

	handleInput(data: string): void {
		if (this.isOracleActive() && matchesKey(data, "ctrl+c")) {
			this.abortOracle();
			return;
		}

		super.handleInput(data);
	}
}

export function registerOracleCancelEditor(pi: ExtensionAPI, isOracleActive: () => boolean, cancelOracle: () => void) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) =>
			new OracleAwareEditor(tui, theme, keybindings, isOracleActive, () => {
				cancelOracle();
				ctx.abort();
				ctx.ui.notify("Oracle cancelled.", "info");
			}),
		);
	});
}

export function renderOracleCall(theme: any) {
	return new Text(theme.fg("accent", "🔮 Oracle"), 0, 0);
}

export function renderOracleResult(result: any, isPartial: boolean, theme: any) {
	if (isPartial) {
		return new Text(`${theme.fg("accent", "🔮 Oracle thinking...")}`, 0, 0);
	}

	const text = result.content[0];
	const content = text?.type === "text" ? text.text : JSON.stringify(result.content, null, 2);
	return new Markdown(content, 0, 0, getMarkdownTheme());
}

export default function (_pi: ExtensionAPI) {
	// UI helper only. The live Oracle extension owns activation and copy.
}
