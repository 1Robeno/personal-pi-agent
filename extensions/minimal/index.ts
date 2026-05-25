/**
 * Minimal — Directory + context meter + model name in a compact footer
 *
 * Shows the current directory, a 4-block context usage bar, model ID, and thinking level.
 *
 * Usage: pi -e extensions/minimal.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { basename } from "node:path";
import { applyExtensionDefaults } from "./themeMap.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ColorFn = (text: string) => string;

const TRUECOLOR_RESET = "\x1b[39m";
const BLOCK = "▰";
const truecolor = (rgb: [number, number, number]): ColorFn => {
	const [r, g, b] = rgb;
	return (text: string) => `\x1b[38;2;${r};${g};${b}m${text}${TRUECOLOR_RESET}`;
};

const dim = truecolor([71, 85, 105]);
const green = truecolor([34, 197, 94]);
const orange = truecolor([251, 146, 60]);
const red = truecolor([248, 113, 113]);

const contextPercent = (value: number | null | undefined): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(0, Math.min(100, value));
};

const contextGauge = (pct: number | null): string => {
	const segments: Array<{ threshold: number; color: ColorFn }> = [
		{ threshold: 0, color: green },
		{ threshold: 25, color: green },
		{ threshold: 50, color: orange },
		{ threshold: 75, color: red },
	];

	if (pct === null) return segments.map(() => dim(BLOCK)).join("");
	return segments.map(({ threshold, color }) => (pct >= threshold ? color(BLOCK) : dim(BLOCK))).join("");
};

const directoryName = (cwd: string): string => basename(cwd) || cwd;

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
		ctx.ui.setFooter((_tui, theme, footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model?.id || "no-model";
				const currentThinkingLevel = pi.getThinkingLevel() || thinkingLevel;
				const colorThinking = theme.getThinkingBorderColor?.(currentThinkingLevel) ?? ((text: string) => theme.fg("dim", text));
				const usage = ctx.getContextUsage();
				const pct = contextPercent(usage?.percent);
				const gauge = contextGauge(pct);
				const cwd = theme.fg("dim", directoryName(ctx.cwd));
				const branch = footerData.getGitBranch();
				const branchText = branch ? theme.fg("dim", ` (${branch})`) : "";

				const left = ` ${cwd}${branchText}`;
				const right = `${gauge}${theme.fg("dim", ` · ${model} · `)}${colorThinking(currentThinkingLevel)} `;
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}