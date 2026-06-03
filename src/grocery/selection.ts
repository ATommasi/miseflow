import { App, TFile } from "obsidian";
import { readCookedCount, readLastMade } from "../parser/recipe-meta";
import { PantrySettings, RECIPE_FRONTMATTER } from "../settings";

/**
 * Stamps a recipe's "last made" date to the given date string and, when
 * `trackCookedCount` is enabled and the date differs from the previous
 * value, increments `cookedCount`. Does not touch the selection property.
 *
 * Returns the new cooked count when it was incremented, otherwise null.
 */
export async function stampRecipeCooked(
	app: App,
	file: TFile,
	date: string,
	settings: PantrySettings,
): Promise<{ newCount: number | null }> {
	if (!settings.trackLastMade) return { newCount: null };
	let newCount: number | null = null;
	await app.fileManager.processFrontMatter(
		file,
		(fm: Record<string, unknown>) => {
			const key = settings.lastMadeProperty.trim() || "lastMade";
			const previous = readLastMade(fm, key);
			fm[key] = date;

			if (settings.trackCookedCount && previous !== date) {
				const current = readCookedCount(fm);
				newCount = current + 1;
				fm[RECIPE_FRONTMATTER.cookedCount] = newCount;
			}
		},
	);
	return { newCount };
}
