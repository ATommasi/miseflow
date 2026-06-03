import { App, Modal, TFile, setIcon } from "obsidian";
import { ingredientKey, parseIngredientLine } from "../parser/ingredient";
import { formatQuantity } from "../parser/quantity";
import { splitBodyAroundIngredients, stripFrontmatter } from "../parser/recipe";
import { MiseFlowSettings } from "../settings";
import { GroceryContribution } from "../grocery/note-writer";

const DAYS = [
	"Unscheduled",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];

interface SelectedIngredient {
	key: string;
	name: string;
	unit: string;
	quantity: number | null;
}

interface AddToMealPlanDeps {
	getSettings: () => MiseFlowSettings;
	onConfirm: (
		day: string | undefined,
		mealType: string | undefined,
		contributions: Record<string, GroceryContribution>,
	) => Promise<void>;
}

export class AddToMealPlanModal extends Modal {
	private file: TFile;
	private deps: AddToMealPlanDeps;
	private selectedKeys = new Set<string>();
	private allIngredients: SelectedIngredient[] = [];

	constructor(app: App, file: TFile, deps: AddToMealPlanDeps) {
		super(app);
		this.file = file;
		this.deps = deps;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mise-meal-plan-modal");

		contentEl.createEl("h2", { text: `Add to meal plan` });
		contentEl.createEl("p", {
			cls: "mise-meal-plan-modal-recipe",
			text: this.file.basename,
		});

		// --- Day picker ---
		const dayRow = contentEl.createDiv({ cls: "mise-modal-row" });
		dayRow.createEl("label", { text: "Day", cls: "mise-modal-label" });
		const daySelect = dayRow.createEl("select", { cls: "mise-modal-select" });
		for (const day of DAYS) {
			const opt = daySelect.createEl("option", { text: day, value: day });
			if (day === "Unscheduled") opt.selected = true;
		}

		// --- Meal type ---
		const typeRow = contentEl.createDiv({ cls: "mise-modal-row" });
		typeRow.createEl("label", { text: "Meal", cls: "mise-modal-label" });
		const typeInput = typeRow.createEl("input", {
			cls: "mise-modal-input",
			type: "text",
			placeholder: "Breakfast, Lunch, Dinner, Snack…",
			attr: { list: "mise-meal-types" },
		});
		const datalist = typeRow.createEl("datalist");
		datalist.id = "mise-meal-types";
		for (const mt of MEAL_TYPES) {
			datalist.createEl("option", { value: mt });
		}

		// --- Ingredient list ---
		const settings = this.deps.getSettings();
		await this.loadIngredients(settings);

		const ingSection = contentEl.createDiv({ cls: "mise-modal-ingredients" });
		ingSection.createEl("h3", { text: "Ingredients to buy" });

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
			text: "Add to plan",
			cls: "mise-modal-confirm mod-cta",
			attr: { type: "button" },
		});
		confirmBtn.addEventListener("click", async () => {
			const day =
				daySelect.value === "Unscheduled" ? undefined : daySelect.value;
			const mealType = typeInput.value.trim() || undefined;
			const contributions = this.buildContributions();
			confirmBtn.disabled = true;
			try {
				await this.deps.onConfirm(day, mealType, contributions);
			} finally {
				this.close();
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async loadIngredients(settings: MiseFlowSettings): Promise<void> {
		const contents = await this.app.vault.cachedRead(this.file);
		const body = stripFrontmatter(contents);
		const { ingredientGroups } = splitBodyAroundIngredients(
			body,
			settings.ingredientsHeading,
		);

		const seen = new Set<string>();
		for (const group of ingredientGroups) {
			for (const raw of group.lines) {
				const parsed = parseIngredientLine(raw);
				if (!parsed) continue;
				const key = ingredientKey(parsed.name, parsed.unit);
				if (seen.has(key)) continue;
				seen.add(key);
				this.allIngredients.push({
					key,
					name: parsed.name,
					unit: parsed.unit,
					quantity: parsed.quantity,
				});
			}
		}
	}

	private buildContributions(): Record<string, GroceryContribution> {
		const result: Record<string, GroceryContribution> = {};
		for (const ing of this.allIngredients) {
			if (!this.selectedKeys.has(ing.key)) continue;
			result[ing.key] = {
				name: ing.name,
				unit: ing.unit,
				quantity: ing.quantity,
			};
		}
		return result;
	}
}

function titleCase(name: string): string {
	return name.replace(
		/(^|[\s-])([a-z])/g,
		(_match, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
	);
}
