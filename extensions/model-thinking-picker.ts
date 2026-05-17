import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import {
  Container,
  type Focusable,
  type KeybindingsManager,
  SelectList,
  type SelectItem,
  Spacer,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

type PickerResult = ThinkingLevel | undefined;

type Theme = {
  fg: (name: string, text: string) => string;
  bold?: (text: string) => string;
};

type ThinkingItem = {
  level: ThinkingLevel;
  description: string;
};

const LEVELS: ThinkingItem[] = [
  { level: "off", description: "No extra thinking" },
  { level: "minimal", description: "Fastest thinking" },
  { level: "low", description: "Light thinking" },
  { level: "medium", description: "Balanced thinking" },
  { level: "high", description: "Deeper thinking" },
  { level: "xhigh", description: "Maximum thinking" },
];

class ThinkingPicker extends Container implements Focusable {
  private selectList: SelectList;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  constructor(
    private tui: TUI,
    theme: Theme,
    private keybindings: KeybindingsManager,
    currentModel: Model<any> | undefined,
    currentThinkingLevel: ThinkingLevel,
    done: (result: PickerResult) => void,
  ) {
    super();

    const current = currentModel
      ? (clampThinkingLevel(currentModel, currentThinkingLevel) as ThinkingLevel)
      : currentThinkingLevel;
    const supported = currentModel ? getSupportedThinkingLevels(currentModel) : LEVELS.map((item) => item.level);
    const items: SelectItem[] = LEVELS.filter((item) => supported.includes(item.level)).map((item) => ({
      value: item.level,
      label: item.level === current ? `${item.level} ✓` : item.level,
      description: item.description,
    }));
    const currentIndex = Math.max(
      0,
      items.findIndex((item) => item.value === current),
    );

    this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    this.addChild(new Text(theme.fg("accent", theme.bold ? theme.bold("Select Thinking") : "Select Thinking")));

    const modelText = currentModel
      ? `Model: ${currentModel.name ?? currentModel.id}`
      : "No active model; showing all thinking levels";
    this.addChild(new Text(theme.fg("muted", modelText)));
    this.addChild(new Spacer(1));

    this.selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text.replace("commands", "thinking levels")),
    });
    this.selectList.setSelectedIndex(currentIndex);
    this.selectList.onSelect = (item) => done(item.value as ThinkingLevel);
    this.selectList.onCancel = () => done(undefined);
    this.addChild(this.selectList);

    this.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
    this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    const originalHandleInput = this.handleInput.bind(this);
    this.handleInput = (data: string) => {
      originalHandleInput(data);
      this.tui.requestRender();
    };
  }

  handleInput(data: string): void {
    if (
      this.selectListInput(data) ||
      data === "up" ||
      data === "down" ||
      data === "enter" ||
      data === "escape" ||
      data === "ctrl+c"
    ) {
      this.selectList.handleInput(data);
    }
  }

  private selectListInput(data: string): boolean {
    return (
      this.keybindings.matches(data, "tui.select.up") ||
      this.keybindings.matches(data, "tui.select.down") ||
      this.keybindings.matches(data, "tui.select.confirm") ||
      this.keybindings.matches(data, "tui.select.cancel")
    );
  }
}

export default function (pi: ExtensionAPI) {
  async function openPicker(ctx: any): Promise<void> {
    if (!ctx.hasUI) return;

    const result = await ctx.ui.custom<PickerResult>((tui, theme, keybindings, done) => {
      return new ThinkingPicker(tui, theme, keybindings, ctx.model, pi.getThinkingLevel(), done);
    });

    if (!result) return;

    pi.setThinkingLevel(result);
    ctx.ui.notify(`Thinking: ${result}`, "info");
  }

  pi.registerCommand("thinking", {
    description: "Select thinking level",
    handler: async (_args, ctx) => openPicker(ctx),
  });

  pi.registerShortcut("ctrl+shift+l", {
    description: "Open thinking picker",
    handler: async (ctx) => openPicker(ctx),
  });
}
