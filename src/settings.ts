import { DEFAULT_GI_DICTIONARY } from "./parser/glycemic";
import {
	CategoryOverride,
	CategorySource,
	GroupingMode,
	MealPlanEntry,
	OneOffItem,
} from "./types";

export interface MiseFlowSettings {
	/** Folder paths (vault-relative) to scan for recipes. Empty array = entire vault. */
	recipeFolders: string[];
	/** Vault-relative path for the meal plan note. */
	mealPlanNotePath: string;
	/** Vault-relative path for the grocery list note. */
	groceryListNotePath: string;
	/** Heading whose bullet list contains the recipe's ingredients. */
	ingredientsHeading: string;
	/** Heading whose ordered list contains the recipe's cooking steps. */
	instructionsHeading: string;
	/** How items should be grouped in the grocery list view. */
	grouping: GroupingMode;
	/** Where each item's category comes from. */
	categorySource: CategorySource;
	/** When true, categories are sorted alphabetically; manual order is ignored. */
	categoryAutoSort: boolean;
	/** Manual category order used when categoryAutoSort is false. */
	categoryOrder: string[];
	/** User-defined category overrides applied before the built-in categorizer. */
	categoryOverrides: CategoryOverride[];
	/** Auto-collapse a section when its last unchecked item gets checked. */
	autoCollapseCompleted: boolean;
	/** Auto-open notes whose `type` matches `recipeTypeValue` in the recipe view. */
	autoOpenRecipeView: boolean;
	/** The frontmatter `type` value that triggers the recipe view (default: "recipe"). */
	recipeTypeValue: string;
	/** How nutrition values are displayed in the recipe view. */
	nutritionDisplay: NutritionDisplay;
	/** Whether frontmatter nutrition values are stored as recipe totals or per-serving values. */
	nutritionSource: NutritionSource;
	/** Show a "Mark as cooked" button in the recipe view action bar. */
	showMarkCookedButton: boolean;
	/** When true, clicking "Mark as cooked" prompts for a date instead of using today. */
	markCookedAskDate: boolean;
	/** When true, writes today's date to a recipe's frontmatter when it's added to the grocery list. */
	trackLastMade: boolean;
	/** Frontmatter property name used to record the last time a recipe was added to the grocery list. */
	lastMadeProperty: string;
	/** When true, increments `cookedCount` whenever `lastMade` is stamped to a new day. */
	trackCookedCount: boolean;
	/** Frontmatter property name that stores a recipe's allergens. Accepts CSV text or YAML list. */
	allergensProperty: string;
	/** Allergen tags the user wants to be warned about (lowercase). */
	myAllergens: string[];
	/** Show unsafe internal temperature warnings on meat ingredients in the recipe view. */
	showMeatTempWarnings: boolean;
	/** Recipes cooked within this many days are excluded from the meal recommender. */
	suggestionDayWindow: number;
	/** Default number of suggestions the recommender surfaces. */
	suggestionCount: number;
	/** Master toggle for diabetes-aware features (currently the high-GI ingredient badges). */
	diabeticMode: boolean;
	/** User-editable high-GI dictionary as raw text. One regex per line, `#` comments. */
	giDictionary: string;
	/** Persisted state - kept in the same data file so a single saveData() round-trip is enough. */
	state: MiseFlowSavedState;
}

export type NutritionDisplay = "per-serving" | "total";
export type NutritionSource = "recipe-total" | "per-serving";

export interface MiseFlowSavedState {
	/** Planned meals — each recipe with optional day, meal type, and ingredient contributions. */
	mealPlanEntries: MealPlanEntry[];
	/** One-off shopping items the user has added manually. */
	oneOffs: OneOffItem[];
	/**
	 * Map from grouping section name to whether the user has it collapsed.
	 * Missing entries default to expanded.
	 */
	collapsedGroups: Record<string, boolean>;
}

export const DEFAULT_CATEGORY_ORDER = [
	"Produce",
	"Herb",
	"Bread",
	"Meat",
	"Seafood",
	"Dairy",
	"Cheese",
	"Egg",
	"Pasta",
	"Grain",
	"Canned",
	"Broth",
	"Sauce",
	"Condiment",
	"Oil",
	"Seasoning",
	"Baking",
	"MiseFlow",
	"Snack",
	"Frozen",
	"Beverage",
	"Drinks",
	"Alcohol",
	"Foreign",
	"Household",
	"Other",
];

export const DEFAULT_SETTINGS: MiseFlowSettings = {
	recipeFolders: [],
	mealPlanNotePath: "Meal Plan.md",
	groceryListNotePath: "Grocery List.md",
	ingredientsHeading: "Ingredients",
	instructionsHeading: "Instructions",
	grouping: "category",
	categorySource: "dictionary",
	categoryAutoSort: true,
	categoryOrder: [...DEFAULT_CATEGORY_ORDER],
	categoryOverrides: [],
	autoCollapseCompleted: true,
	autoOpenRecipeView: true,
	recipeTypeValue: "recipe",
	nutritionDisplay: "per-serving",
	nutritionSource: "recipe-total",
	showMarkCookedButton: true,
	markCookedAskDate: false,
	trackLastMade: true,
	lastMadeProperty: "lastMade",
	trackCookedCount: true,
	allergensProperty: "allergens",
	myAllergens: [],
	showMeatTempWarnings: true,
	suggestionDayWindow: 14,
	suggestionCount: 5,
	diabeticMode: false,
	giDictionary: DEFAULT_GI_DICTIONARY,
	state: {
		mealPlanEntries: [],
		oneOffs: [],
		collapsedGroups: {},
	},
};

/**
 * Frontmatter property names the recipe view reads and writes.
 * Kept as a constant so anywhere we touch frontmatter uses the same keys.
 */
export const RECIPE_FRONTMATTER = {
	type: "type",
	image: "image",
	multiplier: "multiplier",
	servings: "servings",
	calories: "calories",
	protein: "protein",
	fat: "fat",
	carbs: "carbs",
	diet: "diet",
	allergens: "allergens",
	prepTime: "prepTime",
	cookTime: "cookTime",
	totalTime: "totalTime",
	favorite: "favorite",
	cookedCount: "cookedCount",
} as const;
