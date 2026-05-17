/**
 * Planner — GPT-5.5 high-reasoning plan generator.
 *
 * Reads full session context, produces a detailed markdown plan,
 * writes it to .docs/plans/MMDD_<name>.md. Blue theme.
 *
 * Load with: `pi -e extensions/planner`
 */
export { default } from "./logic";
