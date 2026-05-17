/**
 * Minimal — Model name + context meter in a compact footer
 *
 * Shows model ID and a 10-block context usage bar: [###-------] 30%
 *
 * Usage: pi -e extensions/minimal.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { applyExtensionDefaults } from "./themeMap.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ColorFn = (text: string) => string;

const TRUECOLOR_RESET = "\x1b[39m";
const truecolor = (rgb: [number, number, number]): ColorFn => {
	const [r, g, b] = rgb;
	return (text: string) => `\x1b[38;2;${r};${g};${b}m${text}${TRUECOLOR_RESET}`;
};

const contextColor = (pct: number | null): ColorFn => {
	if (pct === null) return truecolor([148, 163, 184]);
	if (pct >= 80) return truecolor([248, 113, 113]);
	if (pct >= 60) return truecolor([250, 204, 21]);
	return truecolor([34, 197, 94]);
};

const contextPercent = (value: number | null | undefined): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(0, Math.min(100, value));
};

export default function (pi: ExtensionAPI) {
	let thinkingLevel: ThinkingLevel = "off";

	pi.on("thinking_level_select", async (event) => {
		thinkingLevel = event.level;
	});

	pi.on("model_select", async () => {
		thinkingLevel = pi.getThinkingLevel();
	});

	pi.on("session_start", async (_event, ctx) => {
		thinkingLevel = pi.getThinkingLevel();
		applyExtensionDefaults(import.meta.url, ctx);
		ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model?.id || "no-model";
				const currentThinkingLevel = pi.getThinkingLevel() || thinkingLevel;
				const colorThinking = theme.getThinkingBorderColor?.(currentThinkingLevel) ?? ((text: string) => theme.fg("dim", text));
				const usage = ctx.getContextUsage();
				const pct = contextPercent(usage?.percent);
				const filled = pct === null ? 0 : Math.max(0, Math.min(10, Math.round(pct / 10)));
				const empty = 10 - filled;
				const colorContext = contextColor(pct);
				const gauge = colorContext(`${"▰".repeat(filled)}${"▱".repeat(empty)}`);
				const percentText = pct === null ? "?%" : `${Math.round(pct)}%`;

				const left = `${colorContext(" ")}${gauge} ${colorContext(percentText)}`;
				const right = `${theme.fg("dim", `${model} · `)}${colorThinking(currentThinkingLevel)} `;
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}