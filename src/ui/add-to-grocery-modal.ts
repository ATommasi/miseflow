import { App, Modal, TFile } from "obsidian";
import { formatQuantity } from "../parser/quantity";
import { MiseFlowSettings } from "../settings";
import { GroceryContribution } from "../grocery/note-writer";
import { GroceryItem } from "../types";
import {
	type SelectedIngredient,
	loadRecipeIngredients,
	buildContributions,
	titleCase,
} from "./modal-ingredient-helpers";

interface AddToGroceryDeps {
	getSettings: () => MiseFlowSettings;
	getGroceryItems: () => GroceryItem[];
	onConfirm: (contributions: Record<string, GroceryContribution>) => Promise<void>;
	removeFromGroceryByKey: (key: string) => Promise<void>;
}

export class AddToGroceryModal extends Modal {
	private file: TFile;
	private deps: AddToGroceryDeps;
	private selectedKeys = new Set<string>();
	private initiallyOnList = new Set<string>();
	private allIngredients: SelectedIngredient[] = [];

	constructor(app: App, file: TFile, deps: AddToGroceryDeps) {
		super(app);
		this.file = file;
		this.deps = deps;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mise-grocery-modal");

		contentEl.createEl("h2", { text: `Manage grocery list` });
		contentEl.createEl("p", {
			cls: "mise-meal-plan-modal-recipe",
			text: this.file.basename,
		});

		// --- Ingredient list ---
		const settings = this.deps.getSettings();
		await this.loadIngredients(settings);

		// Check which ingredients are already on the grocery list
		const groceryItems = this.deps.getGroceryItems();
		const groceryKeys = new Set(groceryItems.map((item) => item.key));
		for (const ing of this.allIngredients) {
			if (groceryKeys.has(ing.key)) {
				this.initiallyOnList.add(ing.key);
				this.selectedKeys.add(ing.key);
			}
		}

		const ingSection = contentEl.createDiv({ cls: "mise-modal-ingredients" });
		ingSection.createEl("h3", { text: "Ingredients" });

		const controls = ingSection.createDiv({ cls: "mise-modal-ingredient-controls" });
		const selectAll = controls.createEl("button", {
			text: "Select all",
			cls: "mise-modal-control-btn",
			attr: { type: "button" },
		});
		const deselectAll = controls.createEl("button", {
			text: "Deselect all",
			cls: "mise-modal-control-btn",
			attr: { type: "button" },
		});

		const listEl = ingSection.createEl("ul", { cls: "mise-modal-ingredient-list" });
		const checkboxes: HTMLInputElement[] = [];

		for (const ing of this.allIngredients) {
			const li = listEl.createEl("li", { cls: "mise-modal-ingredient-item" });
			const cb = li.createEl("input", { type: "checkbox" });
			cb.dataset.key = ing.key;
			cb.checked = this.selectedKeys.has(ing.key);
			cb.addEventListener("change", () => {
				if (cb.checked) this.selectedKeys.add(ing.key);
				else this.selectedKeys.delete(ing.key);
			});
			checkboxes.push(cb);

			const qtyStr = [formatQuantity(ing.quantity), ing.unit]
				.filter(Boolean)
				.join(" ");
			if (qtyStr) {
				li.createSpan({ cls: "mise-modal-ingredient-qty", text: qtyStr });
			}
			li.createSpan({ cls: "mise-modal-ingredient-name", text: titleCase(ing.name) });
		}

		if (this.allIngredients.length === 0) {
			ingSection.createEl("p", {
				cls: "mise-modal-empty",
				text: "No ingredients found in this recipe.",
			});
		}

		selectAll.addEventListener("click", () => {
			for (const cb of checkboxes) {
				cb.checked = true;
				this.selectedKeys.add(cb.dataset.key ?? "");
			}
		});
		deselectAll.addEventListener("click", () => {
			for (const cb of checkboxes) {
				cb.checked = false;
			}
			this.selectedKeys.clear();
		});

		// --- Actions ---
		const actions = contentEl.createDiv({ cls: "mise-modal-actions" });
		const cancelBtn = actions.createEl("button", {
			text: "Cancel",
			cls: "mise-modal-cancel",
			attr: { type: "button" },
		});
		cancelBtn.addEventListener("click", () => this.close());

		const confirmBtn = actions.createEl("button", {
			text: "Save changes",
			cls: "mise-modal-confirm mod-cta",
			attr: { type: "button" },
		});
		confirmBtn.addEventListener("click", async () => {
			confirmBtn.disabled = true;
			try {
				await this.applyChanges();
			} finally {
				this.close();
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async loadIngredients(settings: MiseFlowSettings): Promise<void> {
		this.allIngredients = await loadRecipeIngredients(
			this.app,
			this.file,
			settings,
		);
	}

	private async applyChanges(): Promise<void> {
		// Find items to add (now selected, but weren't initially on list)
		const toAdd = new Set<string>();
		for (const key of this.selectedKeys) {
			if (!this.initiallyOnList.has(key)) {
				toAdd.add(key);
			}
		}

		// Find items to remove (were on list, but now unselected)
		const toRemove = new Set<string>();
		for (const key of this.initiallyOnList) {
			if (!this.selectedKeys.has(key)) {
				toRemove.add(key);
			}
		}

		// Add new items
		if (toAdd.size > 0) {
			const contributions = buildContributions(
				this.allIngredients.filter((ing) => toAdd.has(ing.key)),
				toAdd,
			);
			await this.deps.onConfirm(contributions);
		}

		// Remove unchecked items
		for (const key of toRemove) {
			await this.deps.removeFromGroceryByKey(key);
		}
	}
}
