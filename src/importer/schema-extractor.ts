import { scrapeRecipe } from "recipe-scrapers";

export interface RecipeGroup {
	name: string | null;
	items: string[];
}

export interface ImportedRecipe {
	title: string;
	description: string;
	image: string;
	servings: string;
	prepTime: number | null;
	cookTime: number | null;
	totalTime: number | null;
	ingredientGroups: RecipeGroup[];
	instructionGroups: RecipeGroup[];
	url: string;
	calories: number | null;
	protein: number | null;
	fat: number | null;
	carbs: number | null;
}

/**
 * Extract structured recipe data from raw HTML using recipe-scrapers.
 * Returns null if extraction fails or no recipe data is found.
 *
 * The library returns times already in minutes (not ISO 8601), ingredients
 * and instructions as grouped arrays of { name, items[] } objects.
 */
export async function extractRecipe(
	html: string,
	url: string,
): Promise<ImportedRecipe | null> {
	const result = await scrapeRecipe(html, url, { safeParse: true });

	if (!result.success) {
		return null;
	}

	const r = result.data;

	// The type says Map<string,string> but parse() serialises it to a plain
	// object via Object.fromEntries before validation. Normalise either form.
	const nutrientObj: Record<string, string> =
		r.nutrients instanceof Map
			? Object.fromEntries<string>(r.nutrients)
			: (r.nutrients as unknown as Record<string, string>) ?? {};

	return {
		title: r.title ?? "",
		description: r.description ?? "",
		image: r.image ?? "",
		servings: r.yields ?? "",
		prepTime: r.prepTime ?? null,
		cookTime: r.cookTime ?? null,
		totalTime: r.totalTime ?? null,
		ingredientGroups: toGroups(r.ingredients),
		instructionGroups: toGroups(r.instructions),
		url,
		calories: parseNutrient(nutrientObj, "calories"),
		protein: parseNutrient(nutrientObj, "proteinContent"),
		fat: parseNutrient(nutrientObj, "fatContent"),
		carbs: parseNutrient(nutrientObj, "carbohydrateContent"),
	};
}

/** Extract the leading integer from a nutrient string like "19 grams fat" → 19 */
function parseNutrient(nutrients: Record<string, string>, key: string): number | null {
	const raw = nutrients[key];
	if (!raw) return null;
	const match = raw.match(/(\d+(?:\.\d+)?)/);
	if (!match) return null;
	const n = parseFloat(match[1] ?? "");
	return Number.isFinite(n) ? Math.round(n) : null;
}

type RawGroup = { name: string | null; items: { value: string }[] };

function toGroups(raw: RawGroup[]): RecipeGroup[] {
	return raw.map((g) => ({
		name: g.name,
		items: g.items.map((i) => i.value),
	}));
}
