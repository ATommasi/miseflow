export interface ParsedIngredient {
	/** Numeric quantity, if one was parsed. */
	quantity: number | null;
	/** Unit string as written, e.g. "cup", "tsp", "lb". Empty when unitless. */
	unit: string;
	/** Normalised ingredient name, lower-cased and trimmed. */
	name: string;
	/** Trailing Obsidian-style tags found on the line (without the leading #). */
	tags: string[];
	/** Original raw line (without leading bullet markers). */
	raw: string;
}

export interface RecipeIngredient extends ParsedIngredient {
	/** Source recipe path for traceability. */
	sourcePath: string;
	/** Source recipe display name. */
	sourceName: string;
}

export interface OneOffItem {
	id: string;
	name: string;
	quantity: number | null;
	unit: string;
	category: string | null;
}

/**
 * A single line in the grocery list, after consolidation.
 * Keyed uniquely by (name + unit).
 */
export interface GroceryItem {
	key: string;
	name: string;
	unit: string;
	quantity: number | null;
	category: string;
	/** Where the item came from. Recipes contribute display names; one-offs are flagged. */
	sources: GroceryItemSource[];
	/** Whether the user has checked this item off while shopping. */
	checked: boolean;
}

export interface GroceryItemSource {
	type: "recipe" | "one-off";
	label: string;
	/** Recipe file path, when type === "recipe". */
	path?: string;
}

export type GroupingMode = "category" | "recipe" | "none";

/**
 * Where a grocery item's category comes from.
 *   - "dictionary": built-in keyword dictionary (with user overrides applied first)
 *   - "tag":        the trailing #tag on the recipe line; falls back to "Other" when absent
 *   - "tag-then-dictionary": prefer the recipe's #tag, fall back to the dictionary
 */
export type CategorySource = "dictionary" | "tag" | "tag-then-dictionary";

export interface CategoryOverride {
	/** Lower-cased ingredient name (or substring) to match. */
	match: string;
	/** Category to assign when matched. */
	category: string;
}

/**
 * A group of ingredients under an optional subheading within the
 * ingredients section (e.g. "For the Bolognese Sauce").
 */
export interface IngredientGroup {
	/** Subheading text, or null when ingredients appear before any subheading. */
	heading: string | null;
	/** Raw markdown list lines belonging to this group. */
	lines: string[];
}

/**
 * A group of instruction steps under an optional subheading within the
 * instructions section (e.g. "1. Roast the Garlic", "Sauté the Aromatics").
 */
export interface InstructionGroup {
	/** Subheading text, or null when steps appear before any subheading. */
	heading: string | null;
	/** Heading level (3, 4, …), or 0 when no heading. */
	headingLevel: number;
	/** Parsed step bodies (markdown, list marker stripped). */
	steps: string[];
}

/**
 * Nutrition totals for a recipe as written. All fields are optional
 * (null when the user hasn't filled them in).
 */
export interface RecipeNutrition {
	calories: number | null;
	protein: number | null;
	fat: number | null;
	carbs: number | null;
}
