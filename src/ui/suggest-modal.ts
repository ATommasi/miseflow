import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import { GroceryListManager } from "../grocery/manager";
import {
	listRecipeLibrary,
	RecipeEntry,
	suggestMeals,
	SuggestionFilters,
} from "../grocery/library";
import { AddToMealPlanModal } from "./add-to-meal-plan-modal";
import { daysSince, formatMinutes } from "../parser/recipe-meta";
import { PantrySettings } from "../settings";

interface SuggestModalDeps {
	getSettings: () => PantrySettings;
	manager: GroceryListManager;
}

/**
 * Picks a handful of recipes the user hasn't cooked recently and offers
 * to add them to the grocery list with one click. Re-rolling reuses the
 * same filters but reshuffles the candidate set.
 */
export class SuggestMealModal extends Modal {
	private filters: SuggestionFilters;

	constructor(
		app: App,
		private readonly deps: SuggestModalDeps,
	) {
		super(app);
		this.filters = {
			favoritesOnly: false,
			hideAllergens:
				deps.getSettings().myAllergens.length > 0,
		};
	}

	onOpen(): void {
		this.modalEl.addClass("pantry-suggest-modal");
		this.titleEl.setText("Suggest a meal");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const settings = this.deps.getSettings();
		const library = listRecipeLibrary(this.app, settings);

		this.renderFilters(contentEl, settings);

		const suggestions = suggestMeals(
			library,
			settings,
			this.filters,
			settings.suggestionCount,
		);

		const list = contentEl.createDiv({ cls: "pantry-suggest-list" });

		if (suggestions.length === 0) {
			list.createDiv({
				cls: "pantry-suggest-empty",
				text: this.emptyMessage(library, settings),
			});
		} else {
			for (const entry of suggestions) {
				this.renderSuggestion(list, entry);
			}
		}

		const footer = contentEl.createDiv({ cls: "pantry-suggest-footer" });
		const reroll = footer.createEl("button", {
			cls: "mod-cta",
			text: "Suggest other meals",
			attr: { type: "button" },
		});
		reroll.addEventListener("click", () => {
			this.render();
		});
	}

	private renderFilters(
		container: HTMLElement,
		settings: PantrySettings,
	): void {
		const filters = container.createDiv({
			cls: "pantry-suggest-filters",
		});

		new Setting(filters)
			.setName("Favorites only")
			.addToggle((toggle) =>
				toggle.setValue(this.filters.favoritesOnly).onChange((value) => {
					this.filters.favoritesOnly = value;
					this.render();
				}),
			);

		if (settings.myAllergens.length > 0) {
			new Setting(filters)
				.setName("Hide recipes with my allergens")
				.addToggle((toggle) =>
					toggle.setValue(this.filters.hideAllergens).onChange((value) => {
						this.filters.hideAllergens = value;
						this.render();
					}),
				);
		}
	}

	private renderSuggestion(parent: HTMLElement, entry: RecipeEntry): void {
		const { file, meta } = entry;
		const card = parent.createDiv({ cls: "pantry-suggest-card" });

		const title = card.createDiv({ cls: "pantry-suggest-card-title" });
		const link = title.createEl("a", {
			cls: "pantry-suggest-card-link",
			text: file.basename,
			href: "#",
		});
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			this.close();
			void this.app.workspace.getLeaf(false).openFile(file);
		});
		if (meta.favorite) {
			const star = title.createSpan({
				cls: "pantry-suggest-card-fav",
			});
			setIcon(star, "star");
			star.setAttribute("title", "Favorite");
		}

		const meta_row = card.createDiv({ cls: "pantry-suggest-card-meta" });
		const days = daysSince(meta.lastMade);
		const lastMadeText =
			days === null
				? "Never made"
				: days === 0
					? "Made today"
					: days === 1
						? "Made yesterday"
						: `${days} days ago`;
		meta_row.createSpan({
			cls: "pantry-suggest-card-meta-item",
			text: lastMadeText,
		});
		if (meta.cookedCount > 0) {
			meta_row.createSpan({
				cls: "pantry-suggest-card-meta-item",
				text: `Cooked ${meta.cookedCount}×`,
			});
		}
		if (meta.times.total !== null) {
			meta_row.createSpan({
				cls: "pantry-suggest-card-meta-item",
				text: formatMinutes(meta.times.total),
			});
		}

		if (meta.diet.length > 0) {
			const tags = card.createDiv({ cls: "pantry-suggest-card-tags" });
			for (const tag of meta.diet) {
				tags.createSpan({
					cls: "pantry-badge pantry-badge-diet",
					text: tag,
				});
			}
		}

		const actions = card.createDiv({ cls: "pantry-suggest-card-actions" });
		const addBtn = actions.createEl("button", {
			cls: "mod-cta",
			text: "Add to meal plan",
			attr: { type: "button" },
		});
		addBtn.addEventListener("click", () => {
			new AddToMealPlanModal(this.app, file, {
				getSettings: this.deps.getSettings,
				onConfirm: async (day, mealType, contributions) => {
					await this.deps.manager.addToMealPlan(
						file.path,
						day,
						mealType,
						contributions,
					);
					addBtn.disabled = true;
					addBtn.setText("Added");
					new Notice(`Added "${file.basename}" to meal plan.`);
				},
			}).open();
		});
	}

	private emptyMessage(
		library: readonly RecipeEntry[],
		settings: PantrySettings,
	): string {
		if (library.length === 0) {
			return `No recipes found. Tag a note with type: ${settings.recipeTypeValue} to populate the library.`;
		}
		const filterBits: string[] = [];
		if (this.filters.favoritesOnly) filterBits.push("favorites only");
		if (this.filters.hideAllergens) filterBits.push("hiding allergens");
		const filtersText = filterBits.length
			? ` (${filterBits.join(", ")})`
			: "";
		return `No fresh suggestions${filtersText}. Try widening the suggestion day window or relaxing the filters.`;
	}
}
