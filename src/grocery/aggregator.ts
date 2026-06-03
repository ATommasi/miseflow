import { ingredientKey } from "../parser/ingredient";
import { MiseFlowSettings } from "../settings";
import {
	GroceryItem,
	GroceryItemSource,
	OneOffItem,
	RecipeIngredient,
} from "../types";
import { categorize } from "./categorizer";

interface BuildOptions {
	recipeIngredients: RecipeIngredient[];
	oneOffs: OneOffItem[];
	settings: MiseFlowSettings;
	checkedKeys: Record<string, boolean>;
}

/** Per-key bookkeeping for tags collected during aggregation. */
type ItemWithTags = GroceryItem & { _tags: string[] };

/**
 * Combine recipe ingredients and one-off items into a deduplicated grocery list.
 * Items are merged when their normalised name and unit match. Quantities are
 * summed when both sides have a quantity; otherwise the existing value wins
 * (so "2 cups flour" + "flour" becomes "2 cups flour" with multiple sources).
 */
export function buildGroceryList(opts: BuildOptions): GroceryItem[] {
	const map = new Map<string, ItemWithTags>();

	for (const ing of opts.recipeIngredients) {
		const key = ingredientKey(ing.name, ing.unit);
		mergeInto(map, key, {
			name: ing.name,
			unit: ing.unit,
			quantity: ing.quantity,
			tags: ing.tags,
			source: {
				type: "recipe",
				label: ing.sourceName,
				path: ing.sourcePath,
			},
		});
	}

	for (const item of opts.oneOffs) {
		const key = ingredientKey(item.name, item.unit);
		mergeInto(map, key, {
			name: item.name,
			unit: item.unit,
			quantity: item.quantity,
			tags: [],
			source: {
				type: "one-off",
				label: "Added manually",
			},
			categoryOverride: item.category ?? null,
		});
	}

	const result: GroceryItem[] = [];
	for (const item of map.values()) {
		const checked = opts.checkedKeys[item.key] === true;
		const category =
			item.category ||
			categorize(
				item.name,
				item._tags,
				opts.settings.categoryOverrides,
				opts.settings.categorySource,
			);
		result.push({
			key: item.key,
			name: item.name,
			unit: item.unit,
			quantity: item.quantity,
			sources: item.sources,
			category,
			checked,
		});
	}

	return result;
}

interface MergePayload {
	name: string;
	unit: string;
	quantity: number | null;
	tags: string[];
	source: GroceryItemSource;
	categoryOverride?: string | null;
}

function mergeInto(
	map: Map<string, ItemWithTags>,
	key: string,
	payload: MergePayload,
): void {
	const existing = map.get(key);
	if (!existing) {
		map.set(key, {
			key,
			name: payload.name,
			unit: payload.unit,
			quantity: payload.quantity,
			category: payload.categoryOverride ?? "",
			sources: [payload.source],
			checked: false,
			_tags: [...payload.tags],
		});
		return;
	}

	if (payload.quantity !== null) {
		existing.quantity =
			existing.quantity === null
				? payload.quantity
				: existing.quantity + payload.quantity;
	}

	if (payload.categoryOverride && !existing.category) {
		existing.category = payload.categoryOverride;
	}

	if (
		!existing.sources.some(
			(s) => s.type === payload.source.type && s.label === payload.source.label,
		)
	) {
		existing.sources.push(payload.source);
	}

	for (const tag of payload.tags) existing._tags.push(tag);
}

/**
 * Group items for display.
 *
 * Returns an ordered list of [groupName, items] pairs. Items inside each group
 * are sorted alphabetically by name.
 */
export function groupForDisplay(
	items: GroceryItem[],
	settings: MiseFlowSettings,
): Array<[string, GroceryItem[]]> {
	const grouping = settings.grouping;
	const sortedItems = [...items].sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
	);

	if (grouping === "none") {
		return [["All items", sortedItems]];
	}

	// "By source": split by source type. Recipe contributions → Meal Plan (quantities
	// summed across all recipes). One-off contributions → One-off items. An item with
	// both sources appears in both groups with its source-specific quantity.
	if (grouping === "source") {
		const mealPlan: GroceryItem[] = [];
		const oneOffs: GroceryItem[] = [];
		for (const item of sortedItems) {
			const recipeSources = item.sources.filter((s) => s.type === "recipe");
			const oneOffSource = item.sources.find((s) => s.type === "one-off");

			if (recipeSources.length > 0) {
				// Sum quantities across all recipe sources for this item.
				let recipeQty: number | null = null;
				for (const src of recipeSources) {
					if (src.quantity != null) {
						recipeQty = (recipeQty ?? 0) + src.quantity;
					}
				}
				mealPlan.push({
					...item,
					quantity: recipeQty ?? item.quantity,
					sources: recipeSources,
				});
			}

			if (oneOffSource) {
				oneOffs.push({
					...item,
					quantity: oneOffSource.quantity ?? item.quantity,
					sources: [oneOffSource],
				});
			}

			// Purely manual item with no source annotation.
			if (recipeSources.length === 0 && !oneOffSource) {
				oneOffs.push(item);
			}
		}
		const result: Array<[string, GroceryItem[]]> = [];
		if (mealPlan.length > 0) result.push(["From Meal Plan", mealPlan]);
		if (oneOffs.length > 0) result.push(["Manually added items", oneOffs]);
		return result;
	}

	// "By recipe": split by source so each group shows only its own quantities.
	// Ground Beef (1 lb from Bolognese + 1 lb manual) → Bolognese: 1 lb, One-off: 1 lb.
	// Items spanning multiple recipes appear in each with their recipe-specific quantity.
	if (grouping === "recipe") {
		const groups = new Map<string, GroceryItem[]>();
		for (const item of sortedItems) {
			const recipeSources = item.sources.filter((s) => s.type === "recipe");
			const oneOffSource = item.sources.find((s) => s.type === "one-off");

			// Add to each recipe group with that recipe's quantity.
			const seenRecipes = new Set<string>();
			for (const source of recipeSources) {
				if (seenRecipes.has(source.label)) continue;
				seenRecipes.add(source.label);
				const splitItem: GroceryItem = {
					...item,
					quantity: source.quantity ?? item.quantity,
					sources: [source],
				};
				pushTo(groups, source.label, splitItem);
			}

			// If there's a one-off contribution, also add it to "Manually added items"
			// with just the manually-added quantity.
			if (oneOffSource) {
				const splitItem: GroceryItem = {
					...item,
					quantity: oneOffSource.quantity ?? item.quantity,
					sources: [oneOffSource],
				};
				pushTo(groups, "Manually added items", splitItem);
			}

			// Purely manual item (no recipe source).
			if (recipeSources.length === 0 && !oneOffSource) {
				pushTo(groups, "Manually added items", item);
			}
		}
		const entries = [...groups.entries()];
		const manuallyAddedEntry = entries.find(([k]) => k === "Manually added items");
		const recipeEntries = entries
			.filter(([k]) => k !== "Manually added items")
			.sort(([a], [b]) => a.localeCompare(b));
		return manuallyAddedEntry ? [...recipeEntries, manuallyAddedEntry] : recipeEntries;
	}

	// Default: category grouping.
	const groups = new Map<string, GroceryItem[]>();
	for (const item of sortedItems) {
		pushTo(groups, item.category || "Other", item);
	}

	// When auto-sort is on (or no manual order exists), sort all alphabetically.
	if (settings.categoryAutoSort || settings.categoryOrder.length === 0) {
		return [...groups.keys()].sort().map((k) => [k, groups.get(k) ?? []]);
	}

	const orderedKeys: string[] = [];
	for (const key of settings.categoryOrder) {
		if (groups.has(key)) orderedKeys.push(key);
	}
	const remaining = [...groups.keys()]
		.filter((k) => !orderedKeys.includes(k))
		.sort();
	return [...orderedKeys, ...remaining].map((k) => [k, groups.get(k) ?? []]);
}

function pushTo(map: Map<string, GroceryItem[]>, key: string, item: GroceryItem) {
	const arr = map.get(key);
	if (arr) arr.push(item);
	else map.set(key, [item]);
}
