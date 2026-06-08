import { App, Events, Notice, TFile } from "obsidian";
import {
	ingredientKey,
	normaliseName,
	parseIngredientLine,
} from "../parser/ingredient";
import { parseRecipeFile } from "../parser/recipe";
import { formatQuantity } from "../parser/quantity";
import { MiseFlowSettings } from "../settings";
import { GroceryItem, MealPlanEntry, OneOffItem } from "../types";
import { groupForDisplay } from "./aggregator";
import {
	addToGroceryNote,
	GroceryContribution,
	insertMealPlanEntry,
	parseMealPlanNote,
	readGroceryNoteItems,
	removeFromGroceryNote,
	removeMealPlanEntry,
	resetGroceryNoteChecks,
	toggleGroceryNoteItemChecked,
} from "./note-writer";
import { resolveNotePath } from "../utils/paths";

export interface SaveSink {
	readonly settings: MiseFlowSettings;
	save(): Promise<void>;
}

/**
 * Owns the in-memory grocery/meal-plan state and broadcasts change events so
 * views can re-render. All persistence funnels through `sink.save()` (plugin
 * data file) and the note-writer (vault notes).
 */
export class GroceryListManager extends Events {
	private items: GroceryItem[] = [];
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

	getMealPlanEntries(): MealPlanEntry[] {
		return this.sink.settings.state.mealPlanEntries ?? [];
	}

	// -------------------------------------------------------------------------
	// Meal plan
	// -------------------------------------------------------------------------

	/**
	 * Add a recipe to the meal plan with optional day/meal-type and a set of
	 * selected ingredient contributions. Writes both notes and triggers a refresh.
	 */
	async addToMealPlan(
		recipePath: string,
		day: string | undefined,
		mealType: string | undefined,
		contributions: Record<string, GroceryContribution>,
	): Promise<void> {
		const path = recipePath.trim();
		if (!path) return;

		const today = localDateISO();
		const entry: MealPlanEntry = {
			recipePath: path,
			day: day?.trim() || undefined,
			mealType: mealType?.trim() || undefined,
			addedDate: today,
			contributions,
		};

		const entries = this.sink.settings.state.mealPlanEntries ?? [];
		// Replace existing entry for this recipe if it exists.
		const idx = entries.findIndex((e) => e.recipePath === path);
		if (idx !== -1) {
			// Remove its old contributions from grocery note before replacing.
			await removeFromGroceryNote(this.app, entries[idx]!.contributions, this.sink.settings);
			entries.splice(idx, 1);
		}
		entries.push(entry);
		this.sink.settings.state.mealPlanEntries = entries;
		await this.sink.save();

		await insertMealPlanEntry(this.app, entry, this.sink.settings);
		await addToGroceryNote(this.app, contributions, this.sink.settings);

		await this.rebuild();
		this.trigger("changed");

		const name = recipeBasename(this.app, path);
		const parts = [entry.day, entry.mealType].filter(Boolean).join(" — ");
		new Notice(
			parts
				? `${name} added to meal plan (${parts}).`
				: `${name} added to meal plan.`,
		);
	}

	/**
	 * Add ingredients directly to the grocery list without creating a meal plan entry.
	 * Items will appear as "manually added" in the grocery list.
	 */
	async addToGroceryOnly(
		contributions: Record<string, GroceryContribution>,
	): Promise<void> {
		if (Object.keys(contributions).length === 0) return;

		await addToGroceryNote(this.app, contributions, this.sink.settings);
		await this.rebuild();
		this.trigger("changed");

		const count = Object.keys(contributions).length;
		new Notice(
			`${count} ingredient${count === 1 ? "" : "s"} added to grocery list.`,
		);
	}

	/**
	 * Remove a recipe from the meal plan, subtracting its ingredient
	 * contributions from the grocery note.
	 */
	async removeFromMealPlan(recipePath: string): Promise<void> {
		const path = recipePath.trim();
		if (!path) return;

		const entries = this.sink.settings.state.mealPlanEntries ?? [];
		const idx = entries.findIndex((e) => e.recipePath === path);
		if (idx === -1) return;

		const entry = entries[idx]!;
		entries.splice(idx, 1);
		this.sink.settings.state.mealPlanEntries = entries;
		await this.sink.save();

		await removeMealPlanEntry(this.app, path, this.sink.settings);
		await removeFromGroceryNote(this.app, entry.contributions, this.sink.settings);

		await this.rebuild();
		this.trigger("changed");

		const name = recipeBasename(this.app, path);
		new Notice(`${name} removed from meal plan.`);
	}

	/**
	 * Read the meal plan note and reconcile with plugin state.
	 * Adds entries for new [[wikilinks]] found in the note; removes entries
	 * for lines that were deleted. Does not touch the grocery note (we can't
	 * know what ingredients the user wants for manually-added entries).
	 */
	async syncFromMealPlanNote(): Promise<void> {
		const path = resolveNotePath(this.sink.settings.mealPlanNotePath.trim() || "Meal Plan.md");
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const text = await this.app.vault.read(file);
		const sections = parseMealPlanNote(text);

		// Collect all wikilinks currently in the note.
		const inNote = new Map<string, { day?: string; mealType?: string }>();
		for (const section of sections) {
			for (const line of section.lines) {
				if (!line.wikilink) continue;
				const resolved = this.app.metadataCache.getFirstLinkpathDest(
					line.wikilink,
					path,
				);
				const resolvedPath = resolved?.path ?? line.wikilink;
				inNote.set(resolvedPath, { day: line.day, mealType: line.mealType });
			}
		}

		const entries = this.sink.settings.state.mealPlanEntries ?? [];
		let changed = false;

		// Remove entries whose recipe is no longer in the note.
		const toRemove = entries.filter((e) => !inNote.has(e.recipePath));
		for (const entry of toRemove) {
			const idx = entries.indexOf(entry);
			if (idx !== -1) entries.splice(idx, 1);
			changed = true;
		}

		// Add entries for new wikilinks not yet in state.
		// Also back-fill auto-add for existing entries with no contributions when the feature is enabled.
		for (const [resolvedPath, meta] of inNote) {
			const existingEntry = entries.find((e) => e.recipePath === resolvedPath);
			const hasContributions = existingEntry && Object.keys(existingEntry.contributions).length > 0;

			if (existingEntry && hasContributions) continue;

			let contributions: Record<string, GroceryContribution> = {};

			if (this.sink.settings.autoAddIngredientsOnSync) {
				const recipeFile = this.app.vault.getAbstractFileByPath(resolvedPath);
				if (recipeFile instanceof TFile && recipePassesTagFilter(this.app, recipeFile, this.sink.settings.autoAddIngredientsTag)) {
					const ingredients = await parseRecipeFile(this.app, recipeFile, this.sink.settings);
					for (const ing of ingredients) {
						const key = ingredientKey(ing.name, ing.unit);
						contributions[key] = { name: normaliseName(ing.name), unit: ing.unit, quantity: ing.quantity };
					}
					await addToGroceryNote(this.app, contributions, this.sink.settings);
				}
			}

			if (existingEntry) {
				existingEntry.contributions = contributions;
			} else {
				entries.push({
					recipePath: resolvedPath,
					day: meta.day,
					mealType: meta.mealType,
					addedDate: localDateISO(),
					contributions,
				});
			}
			changed = true;
		}

		if (changed) {
			this.sink.settings.state.mealPlanEntries = entries;
			await this.sink.save();
			await this.rebuild();
			this.trigger("changed");
		}
	}

	// -------------------------------------------------------------------------
	// Grocery list state
	// -------------------------------------------------------------------------

	/**
	 * Rebuild the in-memory item list from the grocery note + one-offs.
	 * Coalesces concurrent calls.
	 */
	async refresh(): Promise<void> {
		if (this.rebuildPromise) return this.rebuildPromise;
		this.rebuildPromise = this.rebuild()
			.then(() => {
				this.rebuildPromise = null;
				this.trigger("changed");
			})
			.catch((err) => {
				this.rebuildPromise = null;
				console.error("miseflow: refresh failed", err);
			});
		return this.rebuildPromise;
	}


	/**
	 * Rebuild in-memory items from the grocery note (source of truth).
	 * One-offs are already in the note; plugin state's oneOffs array is
	 * used only for source labelling (to know which items have a remove button).
	 */
	private async rebuild(): Promise<void> {
		const noteItems = await readGroceryNoteItems(this.app, this.sink.settings);

		// Build per-key recipe attribution: key → [{name, quantity}]
		const recipeSourcesByKey = new Map<
			string,
			Array<{ name: string; path: string; quantity: number | null }>
		>();
		for (const entry of this.sink.settings.state.mealPlanEntries ?? []) {
			const file = this.app.vault.getAbstractFileByPath(entry.recipePath);
			const name =
				file instanceof TFile
					? file.basename
					: entry.recipePath.split("/").pop()?.replace(/\.md$/i, "") ??
					entry.recipePath;
			for (const [key, contrib] of Object.entries(entry.contributions)) {
				const existing = recipeSourcesByKey.get(key);
				const src = { name, path: entry.recipePath, quantity: contrib.quantity };
				if (existing) existing.push(src);
				else recipeSourcesByKey.set(key, [src]);
			}
		}

		const oneOffByKey = new Map<string, OneOffItem>(
			this.sink.settings.state.oneOffs.map((o) => [
				ingredientKey(o.name, o.unit),
				o,
			]),
		);

		const items: GroceryItem[] = [];
		for (const [key, data] of noteItems) {
			const recipeSources = recipeSourcesByKey.get(key);
			const oneOff = oneOffByKey.get(key);
			const sources = [];
			if (recipeSources && recipeSources.length > 0) {
				for (const { name, path, quantity } of recipeSources) {
					sources.push({ type: "recipe" as const, label: name, path, quantity });
				}
			} else if (!oneOff) {
				// Added directly to note — no source attribution in plugin state.
				sources.push({ type: "one-off" as const, label: "Added manually", quantity: data.quantity });
			}
			if (oneOff) {
				sources.push({ type: "one-off" as const, label: "Added manually", quantity: oneOff.quantity });
			}
			items.push({
				key,
				name: data.name,
				unit: data.unit,
				quantity: data.quantity,
				category: data.category,
				sources,
				checked: data.checked,
			});
		}

		this.items = items;
	}

	/** Flip the checked state of an item — writes directly to the grocery note. */
	async toggleChecked(key: string, checked: boolean): Promise<void> {
		await toggleGroceryNoteItemChecked(this.app, key, checked, this.sink.settings);
		const item = this.items.find((i) => i.key === key);
		if (item) item.checked = checked;
		if (checked && this.sink.settings.autoCollapseCompleted) {
			this.applyAutoCollapse(key);
		}
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

	/** Add a one-off item — persists to plugin state AND writes to the grocery note. */
	async addOneOff(item: Omit<OneOffItem, "id">): Promise<void> {
		const trimmedName = item.name.trim();
		if (!trimmedName) return;
		const unit = item.unit.trim();
		const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const newItem: OneOffItem = {
			id,
			name: trimmedName,
			quantity: item.quantity,
			unit,
			category: item.category?.trim() || null,
		};
		this.sink.settings.state.oneOffs.push(newItem);
		await this.sink.save();

		const key = ingredientKey(trimmedName, unit);
		await addToGroceryNote(
			this.app,
			{ [key]: { name: normaliseName(trimmedName), unit, quantity: item.quantity } },
			this.sink.settings,
		);

		await this.rebuild();
		this.trigger("changed");
		new Notice(`${titleCase(trimmedName)} added to grocery list.`);
	}

	/** Update a one-off — patches the grocery note to reflect the change. */
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

		// Capture old contribution before mutating.
		const oldKey = ingredientKey(item.name, item.unit);
		const oldContrib = { name: normaliseName(item.name), unit: item.unit, quantity: item.quantity };

		if (updates.name !== undefined) {
			const trimmed = updates.name.trim();
			if (trimmed) item.name = trimmed;
		}
		if (updates.quantity !== undefined) item.quantity = updates.quantity;
		if (updates.unit !== undefined) item.unit = updates.unit.trim();
		if (updates.category !== undefined)
			item.category = updates.category?.trim() || null;

		await this.sink.save();

		// Remove old contribution and add new one.
		await removeFromGroceryNote(this.app, { [oldKey]: oldContrib }, this.sink.settings);
		const newKey = ingredientKey(item.name, item.unit);
		await addToGroceryNote(
			this.app,
			{ [newKey]: { name: normaliseName(item.name), unit: item.unit, quantity: item.quantity } },
			this.sink.settings,
		);

		await this.rebuild();
		this.trigger("changed");
	}

	/** Remove a one-off — subtracts its contribution from the grocery note. */
	async removeOneOff(id: string): Promise<void> {
		const item = this.sink.settings.state.oneOffs.find((o) => o.id === id);
		if (!item) return;

		const key = ingredientKey(item.name, item.unit);
		const contrib = { name: normaliseName(item.name), unit: item.unit, quantity: item.quantity };

		this.sink.settings.state.oneOffs = this.sink.settings.state.oneOffs.filter(
			(o) => o.id !== id,
		);
		await this.sink.save();

		await removeFromGroceryNote(this.app, { [key]: contrib }, this.sink.settings);
		await this.rebuild();
		this.trigger("changed");
	}

	/** Remove an ingredient from the grocery note by its key. */
	async removeFromGroceryByKey(key: string): Promise<void> {
		const item = this.items.find((i) => i.key === key);
		if (!item) return;

		const contrib = {
			name: normaliseName(item.name),
			unit: item.unit,
			quantity: item.quantity,
		};

		await removeFromGroceryNote(this.app, { [key]: contrib }, this.sink.settings);
		await this.rebuild();
		this.trigger("changed");

		new Notice(`${titleCase(item.name)} removed from grocery list.`);
	}

	/**
	 * Distinct categories currently known: configured order plus any extras
	 * from active items.
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

	/**
	 * Clear everything: all meal plan entries, one-offs, checks, and both notes.
	 */
	async clearAll(): Promise<{ recipesCleared: number; oneOffsCleared: number }> {
		const recipesCleared = (this.sink.settings.state.mealPlanEntries ?? []).length;
		const oneOffsCleared = this.sink.settings.state.oneOffs.length;

		this.sink.settings.state.mealPlanEntries = [];
		this.sink.settings.state.oneOffs = [];
		this.sink.settings.state.collapsedGroups = {};
		await this.sink.save();

		// Overwrite notes with empty content.
		const { mealPlanNotePath, groceryListNotePath } = this.sink.settings;
		await writeEmptyNote(this.app, resolveNotePath(mealPlanNotePath || "Meal Plan.md"), "# Meal Plan\n");
		await writeEmptyNote(this.app, resolveNotePath(groceryListNotePath || "Grocery List.md"), "# Grocery List\n");

		this.items = [];
		this.trigger("changed");

		new Notice(
			`Meal plan cleared (${recipesCleared} recipe${recipesCleared === 1 ? "" : "s"}, ${oneOffsCleared} one-off${oneOffsCleared === 1 ? "" : "s"}).`,
		);
		return { recipesCleared, oneOffsCleared };
	}

	/** Reset all checkboxes to unchecked — writes directly to the grocery note. */
	async resetChecks(): Promise<void> {
		await resetGroceryNoteChecks(this.app, this.sink.settings);
		this.sink.settings.state.collapsedGroups = {};
		await this.sink.save();
		await this.rebuild();
		this.trigger("changed");
	}
}

function localDateISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

async function writeEmptyNote(app: App, path: string, content: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		await app.vault.create(path, content);
	}
}

/**
 * Helper for parsing a free-form one-off entry like "2 cans black beans".
 */
export function parseOneOffEntry(
	input: string,
): { name: string; quantity: number | null; unit: string } | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const parsed = parseIngredientLine(trimmed);
	if (!parsed) return null;
	return { name: parsed.name, quantity: parsed.quantity, unit: parsed.unit };
}

/** Re-exported for callers that want to compute a key directly. */
export { ingredientKey, normaliseName, formatQuantity };

function recipeBasename(app: App, recipePath: string): string {
	const file = app.vault.getAbstractFileByPath(recipePath);
	if (file instanceof TFile) return file.basename;
	const slash = recipePath.lastIndexOf("/");
	const base = slash >= 0 ? recipePath.slice(slash + 1) : recipePath;
	return base.replace(/\.md$/i, "");
}

function recipePassesTagFilter(app: App, file: TFile, tagFilter: string): boolean {
	const filter = tagFilter.trim().replace(/^#/, "").toLowerCase();
	if (!filter) return true;

	const cache = app.metadataCache.getFileCache(file);
	const tags: string[] = [];

	const fm = cache?.frontmatter?.tags;
	if (Array.isArray(fm)) {
		tags.push(...fm.map((t: string) => String(t).replace(/^#/, "").toLowerCase()));
	} else if (typeof fm === "string") {
		tags.push(fm.replace(/^#/, "").toLowerCase());
	}

	for (const t of cache?.tags ?? []) {
		tags.push(t.tag.replace(/^#/, "").toLowerCase());
	}

	return tags.includes(filter);
}

function titleCase(name: string): string {
	return name.replace(
		/(^|[\s-])([a-z])/g,
		(_match, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
	);
}
