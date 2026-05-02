import { App, Events, Notice, TFile } from "obsidian";
import {
	ingredientKey,
	normaliseName,
	parseIngredientLine,
} from "../parser/ingredient";
import {
	findSelectedRecipes,
	parseRecipeFile,
} from "../parser/recipe";
import { PantrySettings } from "../settings";
import { GroceryItem, OneOffItem, RecipeIngredient } from "../types";
import { buildGroceryList, groupForDisplay } from "./aggregator";

export interface SaveSink {
	readonly settings: PantrySettings;
	save(): Promise<void>;
}

/**
 * Owns the in-memory grocery list and broadcasts change events so views can
 * re-render. All persistence funnels through `sink.save()` which is expected
 * to write the plugin data file.
 */
export class GroceryListManager extends Events {
	private items: GroceryItem[] = [];
	private recipeIngredients: RecipeIngredient[] = [];
	private selectedRecipes: TFile[] = [];
	private rebuildPromise: Promise<void> | null = null;

	constructor(
		private readonly app: App,
		private readonly sink: SaveSink,
	) {
		super();
	}

	getItems(): GroceryItem[] {
		return this.items;
	}

	getOneOffs(): OneOffItem[] {
		return this.sink.settings.state.oneOffs;
	}

	/** Markdown files currently flagged with the selection property, sorted by name. */
	getSelectedRecipes(): TFile[] {
		return this.selectedRecipes;
	}

	/**
	 * Rebuild the grocery list from selected recipes and one-off items.
	 * Concurrent calls coalesce so spamming the refresh button is safe.
	 */
	async refresh(): Promise<void> {
		if (this.rebuildPromise) return this.rebuildPromise;
		this.rebuildPromise = (async () => {
			try {
				const files = findSelectedRecipes(this.app, this.sink.settings);
				const allIngredients: RecipeIngredient[] = [];
				for (const file of files) {
					try {
						const parsed = await parseRecipeFile(
							this.app,
							file,
							this.sink.settings,
						);
						allIngredients.push(...parsed);
					} catch (err) {
						console.error(
							`pantry: failed to parse ${file.path}`,
							err,
						);
					}
				}
				this.recipeIngredients = allIngredients;
				this.selectedRecipes = [...files].sort((a, b) =>
					a.basename.localeCompare(b.basename, undefined, {
						sensitivity: "base",
					}),
				);
				this.rebuildItems();
				await this.pruneStaleCheckedKeys();
			} finally {
				this.rebuildPromise = null;
			}
			this.trigger("changed");
		})();
		return this.rebuildPromise;
	}

	/** Flip the checked state of an item and persist it. */
	async toggleChecked(key: string, checked: boolean): Promise<void> {
		const map = this.sink.settings.state.checkedKeys;
		if (checked) {
			map[key] = true;
		} else {
			delete map[key];
		}
		const item = this.items.find((i) => i.key === key);
		if (item) item.checked = checked;
		if (checked && this.sink.settings.autoCollapseCompleted) {
			this.applyAutoCollapse(key);
		}
		await this.sink.save();
		this.trigger("changed");
	}

	/** Whether the named display group is currently collapsed. */
	isGroupCollapsed(name: string): boolean {
		return this.sink.settings.state.collapsedGroups[name] === true;
	}

	/** Set the collapsed state for a group and persist it. */
	async setGroupCollapsed(name: string, collapsed: boolean): Promise<void> {
		const map = this.sink.settings.state.collapsedGroups;
		const current = map[name] === true;
		if (current === collapsed) return;
		if (collapsed) {
			map[name] = true;
		} else {
			delete map[name];
		}
		await this.sink.save();
		this.trigger("changed");
	}

	/**
	 * After checking an item, find every group it belongs to and collapse any
	 * that are now fully checked. Only triggers on the transition to fully-checked
	 * (because this only runs when an item flips from unchecked to checked).
	 */
	private applyAutoCollapse(toggledKey: string): void {
		const groups = groupForDisplay(this.items, this.sink.settings);
		const collapsed = this.sink.settings.state.collapsedGroups;
		for (const [name, groupItems] of groups) {
			if (!groupItems.some((i) => i.key === toggledKey)) continue;
			if (collapsed[name] === true) continue;
			if (groupItems.every((i) => i.checked)) {
				collapsed[name] = true;
			}
		}
	}

	/** Add a one-off item to the list and persist it. */
	async addOneOff(item: Omit<OneOffItem, "id">): Promise<void> {
		const trimmedName = item.name.trim();
		if (!trimmedName) return;
		const id = `${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		this.sink.settings.state.oneOffs.push({
			id,
			name: trimmedName,
			quantity: item.quantity,
			unit: item.unit.trim(),
			category: item.category?.trim() || null,
		});
		await this.sink.save();
		this.rebuildItems();
		this.trigger("changed");
	}

	/** Update fields on an existing one-off item by id. Only provided fields change. */
	async updateOneOff(
		id: string,
		updates: {
			name?: string;
			quantity?: number | null;
			unit?: string;
			category?: string | null;
		},
	): Promise<void> {
		const item = this.sink.settings.state.oneOffs.find((o) => o.id === id);
		if (!item) return;
		if (updates.name !== undefined) {
			const trimmed = updates.name.trim();
			if (trimmed) item.name = trimmed;
		}
		if (updates.quantity !== undefined) {
			item.quantity = updates.quantity;
		}
		if (updates.unit !== undefined) {
			item.unit = updates.unit.trim();
		}
		if (updates.category !== undefined) {
			item.category = updates.category?.trim() || null;
		}
		await this.sink.save();
		this.rebuildItems();
		await this.pruneStaleCheckedKeys();
		this.trigger("changed");
	}

	/**
	 * Distinct categories currently known to the user: the configured
	 * `categoryOrder` plus any extra categories actively assigned to items.
	 * Sorted with the configured order first, then anything new alphabetically.
	 */
	getKnownCategories(): string[] {
		const ordered = this.sink.settings.categoryOrder ?? [];
		const seen = new Set<string>(ordered);
		const extra: string[] = [];
		for (const item of this.items) {
			const cat = item.category?.trim();
			if (!cat || seen.has(cat)) continue;
			seen.add(cat);
			extra.push(cat);
		}
		extra.sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
		return [...ordered, ...extra];
	}

	/** Remove a one-off item by id and persist. */
	async removeOneOff(id: string): Promise<void> {
		const before = this.sink.settings.state.oneOffs.length;
		this.sink.settings.state.oneOffs =
			this.sink.settings.state.oneOffs.filter((o) => o.id !== id);
		if (this.sink.settings.state.oneOffs.length === before) return;
		await this.sink.save();
		this.rebuildItems();
		this.trigger("changed");
	}

	/**
	 * Clear the entire shopping list:
	 *   - unset the selection property on every recipe currently flagged
	 *   - drop all one-off items
	 *   - drop all checked-off state
	 */
	async clearAll(): Promise<{ recipesCleared: number; oneOffsCleared: number }> {
		const files = findSelectedRecipes(this.app, this.sink.settings);
		let recipesCleared = 0;
		for (const file of files) {
			try {
				await this.unsetSelectionProperty(file);
				recipesCleared++;
			} catch (err) {
				console.error(
					`pantry: failed to deselect ${file.path}`,
					err,
				);
			}
		}

		const oneOffsCleared = this.sink.settings.state.oneOffs.length;
		this.sink.settings.state.oneOffs = [];
		this.sink.settings.state.checkedKeys = {};
		this.sink.settings.state.collapsedGroups = {};
		await this.sink.save();

		this.recipeIngredients = [];
		this.selectedRecipes = [];
		this.items = [];
		this.trigger("changed");

		new Notice(
			`Grocery list cleared (${recipesCleared} recipe${recipesCleared === 1 ? "" : "s"}, ${oneOffsCleared} one-off${oneOffsCleared === 1 ? "" : "s"}).`,
		);
		return { recipesCleared, oneOffsCleared };
	}

	/** Reset only the checked state, keeping the list intact. */
	async resetChecks(): Promise<void> {
		this.sink.settings.state.checkedKeys = {};
		this.sink.settings.state.collapsedGroups = {};
		for (const item of this.items) item.checked = false;
		await this.sink.save();
		this.trigger("changed");
	}

	private rebuildItems(): void {
		this.items = buildGroceryList({
			recipeIngredients: this.recipeIngredients,
			oneOffs: this.sink.settings.state.oneOffs,
			settings: this.sink.settings,
			checkedKeys: this.sink.settings.state.checkedKeys,
		});
	}

	private async pruneStaleCheckedKeys(): Promise<void> {
		const live = new Set(this.items.map((i) => i.key));
		const map = this.sink.settings.state.checkedKeys;
		let changed = false;
		for (const key of Object.keys(map)) {
			if (!live.has(key)) {
				delete map[key];
				changed = true;
			}
		}
		if (changed) await this.sink.save();
	}

	private async unsetSelectionProperty(file: TFile): Promise<void> {
		const property = this.sink.settings.selectionProperty;
		await this.app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				if (fm[property] !== undefined) {
					fm[property] = false;
				}
			},
		);
	}
}

/**
 * Helper for parsing a free-form one-off entry like "2 cans black beans" so
 * the modal doesn't need to know about ingredient grammar.
 */
export function parseOneOffEntry(
	input: string,
): { name: string; quantity: number | null; unit: string } | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const parsed = parseIngredientLine(trimmed);
	if (!parsed) return null;
	return {
		name: parsed.name,
		quantity: parsed.quantity,
		unit: parsed.unit,
	};
}

/** Re-exported for callers that want to compute a key directly. */
export { ingredientKey, normaliseName };
