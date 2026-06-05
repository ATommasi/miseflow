import { App, TFile } from "obsidian";
import { ingredientKey, parseIngredientLine } from "../parser/ingredient";
import { splitBodyAroundIngredients, stripFrontmatter } from "../parser/recipe";
import { MiseFlowSettings } from "../settings";
import { GroceryContribution } from "../grocery/note-writer";

export interface SelectedIngredient {
	key: string;
	name: string;
	unit: string;
	quantity: number | null;
}

/**
 * Load all ingredients from a recipe file, deduplicated by ingredientKey.
 */
export async function loadRecipeIngredients(
	app: App,
	file: TFile,
	settings: MiseFlowSettings,
): Promise<SelectedIngredient[]> {
	const contents = await app.vault.cachedRead(file);
	const body = stripFrontmatter(contents);
	const { ingredientGroups } = splitBodyAroundIngredients(
		body,
		settings.ingredientsHeading,
	);

	const result: SelectedIngredient[] = [];
	const seen = new Set<string>();

	for (const group of ingredientGroups) {
		for (const raw of group.lines) {
			const parsed = parseIngredientLine(raw);
			if (!parsed) continue;
			const key = ingredientKey(parsed.name, parsed.unit);
			if (seen.has(key)) continue;
			seen.add(key);
			result.push({
				key,
				name: parsed.name,
				unit: parsed.unit,
				quantity: parsed.quantity,
			});
		}
	}

	return result;
}

/**
 * Build grocery contributions from selected ingredients.
 */
export function buildContributions(
	ingredients: SelectedIngredient[],
	selectedKeys: Set<string>,
): Record<string, GroceryContribution> {
	const result: Record<string, GroceryContribution> = {};
	for (const ing of ingredients) {
		if (!selectedKeys.has(ing.key)) continue;
		result[ing.key] = {
			name: ing.name,
			unit: ing.unit,
			quantity: ing.quantity,
		};
	}
	return result;
}

/**
 * Convert ingredient name to title case for display.
 */
export function titleCase(name: string): string {
	return name.replace(
		/(^|[\s-])([a-z])/g,
		(_match, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
	);
}
