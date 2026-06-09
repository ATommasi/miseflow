import {
	AbstractInputSuggest,
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFolder,
} from "obsidian";
import { GroceryListManager } from "../grocery/manager";
import {
	DEFAULT_GI_DICTIONARY,
	validateGiDictionary,
} from "../parser/glycemic";
import {
	DEFAULT_CATEGORY_ORDER,
	MiseFlowSettings,
} from "../settings";
import { CategoryOverride } from "../types";

export interface SettingsHost {
	app: App;
	settings: MiseFlowSettings;
	saveSettings(): Promise<void>;
	manager: GroceryListManager;
}

// ---------------------------------------------------------------------------
// Folder autocomplete suggest
// ---------------------------------------------------------------------------

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		return this.app.vault
			.getAllFolders(true)
			.filter((f) =>
				f.path.toLowerCase().includes(query.toLowerCase()),
			)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path || "(vault root)");
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.close();
	}
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

const MANAGER_TRIGGER_KEYS = new Set([
	"grouping",
	"categorySource",
	"categoryAutoSort",
	"allergensProperty",
]);

export class MiseFlowSettingsTab extends PluginSettingTab {
	constructor(
		plugin: Plugin,
		private readonly host: SettingsHost,
	) {
		super(plugin.app, plugin);
	}

	// ── Declarative settings API (Obsidian 1.13.0+) ───────────────────────

	getControlValue(key: string): unknown {
		return (this.host.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.host.settings as unknown as Record<string, unknown>;
		const textDefaults: Record<string, string> = {
			mealPlanNotePath: "Meal Plan.md",
			groceryListNotePath: "Grocery List.md",
			recipeTypeValue: "recipe",
			ingredientsHeading: "Ingredients",
			instructionsHeading: "Instructions",
			ratingProperty: "rating",
			lastMadeProperty: "lastMade",
			caloriesProperty: "calories",
			proteinProperty: "protein",
			fatProperty: "fat",
			carbsProperty: "carbs",
			allergensProperty: "allergens",
		};

		if (typeof value === "string" && key in textDefaults) {
			settings[key] = value.trim() || textDefaults[key]!;
		} else if (key === "autoAddIngredientsTag" && typeof value === "string") {
			settings[key] = value.trim().replace(/^#/, "");
		} else {
			settings[key] = value;
		}

		await this.host.saveSettings();

		if (MANAGER_TRIGGER_KEYS.has(key)) {
			this.host.manager.trigger("changed");
		}

		this.refreshState();
	}

	getSettingDefinitions() {
		const s = this.host.settings;
		return [
			// Logo header
			{
				name: "",
				searchable: false,
				render: (setting: Setting) => {
					setting.settingEl.empty();
					const header = setting.settingEl.createDiv({ cls: "mise-settings-header" });
					header.createEl("img", {
						cls: "mise-settings-logo",
						attr: {
							src: "https://github.com/user-attachments/assets/1bd14075-406d-42af-b005-9a245a714811",
							alt: "MiseFlow",
						},
					});
					header.createEl("a", {
						cls: "mise-settings-bmc",
						text: "☕ buy me a coffee",
						href: "https://buymeacoffee.com/atommasi",
						attr: { target: "_blank", rel: "noopener" },
					});
				},
			},
			// Notes & storage
			{
				type: "group" as const,
				heading: "Notes & storage",
				items: [
					{
						name: "Meal plan note",
						desc: "Vault-relative path of the note where your meal plan is stored. moment.js date tokens supported, e.g. Meal Plan {YYYY-MM-DD}.md.",
						control: { type: "text" as const, key: "mealPlanNotePath", placeholder: "Meal plan.md" },
					},
					{
						name: "Auto-add ingredients on sync",
						desc: "When syncing the meal plan note, automatically extract ingredients from newly discovered recipes and add them to the grocery list.",
						control: { type: "toggle" as const, key: "autoAddIngredientsOnSync" },
					},
					{
						name: "Tag filter",
						desc: "Only auto-add ingredients from recipes that have this tag (e.g. groceryList). Leave empty to auto-add from all recipes.",
						visible: () => s.autoAddIngredientsOnSync,
						control: { type: "text" as const, key: "autoAddIngredientsTag", placeholder: "groceryList" },
					},
					{
						name: "Grocery list note",
						desc: "Vault-relative path of the note where your grocery list is stored. moment.js date tokens supported, e.g. Grocery List {YYYY-MM-DD}.md.",
						control: { type: "text" as const, key: "groceryListNotePath", placeholder: "Grocery list.md" },
					},
				],
			},
			// Recipe library
			{
				type: "group" as const,
				heading: "Recipe library",
				items: [
					{
						name: "Recipe folders",
						desc: "Folders the plugin scans for recipe notes. Leave empty to scan the entire vault.",
						render: (setting: Setting) => {
							setting.settingEl.addClass("mise-settings-has-list");
							this.renderFolderList(
								setting.settingEl,
								s.recipeFolders,
								async (folders) => {
									s.recipeFolders = folders;
									await this.host.saveSettings();
								},
							);
						},
					},
					{
						name: "Recipe type value",
						desc: "Notes whose frontmatter `type` matches this value are treated as recipes. Used for auto-open and the recipe library.",
						control: { type: "text" as const, key: "recipeTypeValue", placeholder: "Recipe" },
					},
				],
			},
			// Recipe view
			{
				type: "group" as const,
				heading: "Recipe view",
				items: [
					{
						name: "Auto-open recipe view",
						desc: "Automatically switch to the recipe card view when you open a note whose `type` matches the value above.",
						control: { type: "toggle" as const, key: "autoOpenRecipeView" },
					},
					{
						name: "Ingredients heading",
						desc: "The heading in your recipe notes that introduces the ingredients list (case-insensitive).",
						control: { type: "text" as const, key: "ingredientsHeading", placeholder: "Ingredients" },
					},
					{
						name: "Instructions heading",
						desc: "The heading in your recipe notes that introduces the cooking steps (case-insensitive).",
						control: { type: "text" as const, key: "instructionsHeading", placeholder: "Instructions" },
					},
					{
						name: "Remove duplicate title",
						desc: "Strip the leading h1 from a recipe note's body if it matches the note title, since the recipe view already shows the title above.",
						control: { type: "toggle" as const, key: "stripBodyTitle" },
					},
					{
						name: "Remove duplicate hero image",
						desc: "Strip inline images from a recipe note's body if they match the frontmatter image, since the recipe view already shows it as a hero image.",
						control: { type: "toggle" as const, key: "stripBodyHeroImage" },
					},
					{
						name: "Rating property",
						desc: "Frontmatter property name used to store a recipe's star rating (1–5). Shown as interactive stars in the mobile recipe header.",
						control: { type: "text" as const, key: "ratingProperty", placeholder: "Rating" },
					},
				],
			},
			// Recipe timers
			{
				type: "group" as const,
				heading: "Recipe timers",
				items: [
					{
						name: "Step timers",
						desc: 'Detect duration phrases in cooking steps (e.g. "bake for 30 minutes") and show a clickable timer button.',
						control: { type: "toggle" as const, key: "enableTimers" },
					},
					{
						name: "Auto-start timers",
						desc: "Start counting down immediately when a timer button is clicked.",
						control: { type: "toggle" as const, key: "timerAutoStart" },
					},
					{
						name: "Compact timers by default",
						desc: "Show timers in compact mode (time only) instead of the full widget. You can toggle per-timer using the resize button.",
						control: { type: "toggle" as const, key: "timerDefaultCompact" },
					},
					{
						name: "Time range default",
						desc: 'When a step says "10–15 minutes", which end of the range to use as the timer default.',
						control: { type: "dropdown" as const, key: "timerRangeDefault", options: { max: "Max", min: "Min" } as Record<string, string> },
					},
					{
						name: "Timer increment",
						desc: "How many minutes the ▲/▼ stepper buttons add or subtract.",
						control: { type: "number" as const, key: "timerIncrementMinutes", placeholder: "1", min: 0.01, step: "any" as const },
					},
				],
			},
			// Shopping
			{
				type: "group" as const,
				heading: "Shopping",
				items: [
					{
						name: "Default grouping",
						desc: "How items are grouped in the shopping assistant. By category is best for supermarket shopping; by recipe is useful for meal prep.",
						control: {
							type: "dropdown" as const,
							key: "grouping",
							options: {
								category: "By category",
								recipe: "By recipe",
								source: "By source (Meal Plan vs Manually Added)",
								none: "Flat list",
							} as Record<string, string>,
						},
					},
					{
						name: "Auto-collapse completed sections",
						desc: "Collapse a category or recipe section automatically once every item in it is checked off.",
						control: { type: "toggle" as const, key: "autoCollapseCompleted" },
					},
				],
			},
			// Categories
			{
				type: "group" as const,
				heading: "Categories",
				items: [
					{
						name: "Category source",
						desc: "Where each grocery item's category comes from. Recipe tags use the trailing #tag on each ingredient line; dictionary uses the built-in keyword matcher.",
						control: {
							type: "dropdown" as const,
							key: "categorySource",
							options: {
								dictionary: "Built-in dictionary",
								tag: "Recipe tags",
								"tag-then-dictionary": "Recipe tags, then dictionary",
							} as Record<string, string>,
						},
					},
					{
						name: "Sort categories alphabetically",
						desc: "When on, categories are sorted a–z automatically. Turn off to set a custom order.",
						control: { type: "toggle" as const, key: "categoryAutoSort" },
					},
					{
						name: "Category order",
						desc: "One category per line, in the order you want them to appear. Categories not listed here appear at the end alphabetically.",
						visible: () => !s.categoryAutoSort,
						render: (setting: Setting) => {
							setting.addTextArea((ta) => {
								ta.setPlaceholder(DEFAULT_CATEGORY_ORDER.join("\n"));
								ta.setValue(s.categoryOrder.join("\n"));
								ta.inputEl.addClass("mise-settings-category-order-textarea");
								ta.onChange(async (value) => {
									s.categoryOrder = value
										.split(/\r?\n/)
										.map((l) => l.trim())
										.filter(Boolean);
									await this.host.saveSettings();
									this.host.manager.trigger("changed");
								});
							});
						},
					},
					{
						name: "Category overrides",
						desc: "Force specific ingredients into a category, regardless of the dictionary or tags. Match is a case-insensitive substring of the ingredient name.",
						render: (setting: Setting) => {
							setting.settingEl.addClass("mise-settings-has-list");
							this.renderOverrideList(
								setting.settingEl,
								s.categoryOverrides,
								async (overrides) => {
									s.categoryOverrides = overrides;
									await this.host.saveSettings();
									this.host.manager.trigger("changed");
								},
							);
						},
					},
					{
						name: "Reset categories",
						desc: "Restore the default category order, re-enable alphabetical sorting, and remove all overrides.",
						render: (setting: Setting) => {
							setting.addButton((btn) =>
								btn.setButtonText("Reset").onClick(async () => {
									s.categoryAutoSort = true;
									s.categoryOrder = [...DEFAULT_CATEGORY_ORDER];
									s.categoryOverrides = [];
									await this.host.saveSettings();
									this.rerender();
									this.host.manager.trigger("changed");
								}),
							);
						},
					},
				],
			},
			// Cooking & tracking
			{
				type: "group" as const,
				heading: "Cooking & tracking",
				items: [
					{
						name: "Show mark as cooked button",
						desc: "Show a button in the recipe view to manually record that you cooked a recipe, updating its last made date and cooked count.",
						control: { type: "toggle" as const, key: "showMarkCookedButton" },
					},
					{
						name: "Ask for date when marking cooked",
						desc: "Open a date picker instead of using today's date when marking a recipe as cooked.",
						control: { type: "toggle" as const, key: "markCookedAskDate" },
					},
					{
						name: "Track last made date",
						desc: "Write today's date to a recipe's frontmatter when it's added to the meal plan. Powers the 'last made' badge in the recipe view.",
						control: { type: "toggle" as const, key: "trackLastMade" },
					},
					{
						name: "Last made property",
						desc: "Frontmatter property name used to store the last made date (yyyy-mm-dd).",
						visible: () => s.trackLastMade,
						control: { type: "text" as const, key: "lastMadeProperty", placeholder: "lastMade" },
					},
					{
						name: "Track cooked count",
						desc: "Increment a `cookedCount` frontmatter field each time a recipe is marked as cooked on a new day. Powers the cooking stats leaderboard.",
						visible: () => s.trackLastMade,
						control: { type: "toggle" as const, key: "trackCookedCount" },
					},
				],
			},
			// Nutrition
			{
				type: "group" as const,
				heading: "Nutrition",
				items: [
					{
						name: "Nutrition display",
						desc: "How nutrition values are shown in the recipe view — as per-serving numbers or as totals for the whole recipe.",
						control: {
							type: "dropdown" as const,
							key: "nutritionDisplay",
							options: { "per-serving": "Per serving", total: "Total" } as Record<string, string>,
						},
					},
					{
						name: "Nutrition source",
						desc: "Whether the nutrition values in your recipe frontmatter are totals for the whole recipe or already per serving.",
						control: {
							type: "dropdown" as const,
							key: "nutritionSource",
							options: { "recipe-total": "Recipe total", "per-serving": "Per serving" } as Record<string, string>,
						},
					},
					{
						name: "Calories property",
						desc: "Frontmatter property name for the calories value.",
						control: { type: "text" as const, key: "caloriesProperty", placeholder: "Calories" },
					},
					{
						name: "Protein property",
						desc: "Frontmatter property name for the protein value (grams).",
						control: { type: "text" as const, key: "proteinProperty", placeholder: "Protein" },
					},
					{
						name: "Fat property",
						desc: "Frontmatter property name for the fat value (grams).",
						control: { type: "text" as const, key: "fatProperty", placeholder: "Fat" },
					},
					{
						name: "Carbs property",
						desc: "Frontmatter property name for the carbs value (grams).",
						control: { type: "text" as const, key: "carbsProperty", placeholder: "Carbs" },
					},
				],
			},
			// Meal suggestions
			{
				type: "group" as const,
				heading: "Meal suggestions",
				items: [
					{
						name: "Suggestion day window",
						desc: "Recipes cooked within this many days are hidden from the meal suggester to encourage variety. Set to 0 to show all recipes.",
						control: { type: "number" as const, key: "suggestionDayWindow", placeholder: "14", min: 0 },
					},
					{
						name: "Suggestion count",
						desc: "How many recipe suggestions to show at once.",
						control: { type: "number" as const, key: "suggestionCount", placeholder: "5", min: 1 },
					},
				],
			},
			// Health & safety
			{
				type: "group" as const,
				heading: "Health & safety",
				items: [
					{
						name: "Allergens property",
						desc: "Frontmatter property that stores a recipe's allergens. Accepts both YAML lists and comma-separated text (e.g. Gluten, dairy).",
						control: { type: "text" as const, key: "allergensProperty", placeholder: "Allergens" },
					},
					{
						name: "My allergens",
						desc: "Recipes containing any of these allergens show a warning in the recipe view and shopping assistant.",
						render: (setting: Setting) => {
							setting.settingEl.addClass("mise-settings-has-list");
							this.renderStringList(
								setting.settingEl,
								s.myAllergens,
								"e.g. gluten",
								async (items) => {
									s.myAllergens = items
										.map((item) => item.trim().toLowerCase())
										.filter(Boolean);
									await this.host.saveSettings();
									this.host.manager.trigger("changed");
								},
							);
						},
					},
					{
						name: "Meat temperature warnings",
						desc: "Show a safe internal temperature badge on meat ingredients in the recipe view.",
						control: { type: "toggle" as const, key: "showMeatTempWarnings" },
					},
					{
						name: "High glycemic index warnings",
						desc: "Show a high-gi badge on ingredients that may cause a rapid blood sugar spike. Informational only — not medical advice.",
						control: { type: "toggle" as const, key: "diabeticMode" },
					},
					{
						name: "High glycemic index dictionary",
						desc: "One regex per line, case-insensitive. Lines starting with # are comments. Matched ingredient names show an up-arrow badge in the recipe view. Gi values vary by source — informational only, not medical advice.",
						visible: () => s.diabeticMode,
						render: (setting: Setting) => {
							const errorEl = setting.settingEl.createDiv({ cls: "mise-settings-gi-errors" });
							setting.addTextArea((ta) => {
								ta.setValue(s.giDictionary);
								ta.inputEl.rows = 12;
								ta.inputEl.addClass("mise-settings-gi-textarea");
								ta.onChange(async (value) => {
									s.giDictionary = value;
									await this.host.saveSettings();
									renderErrors(errorEl, validateGiDictionary(value));
								});
							});
							renderErrors(errorEl, validateGiDictionary(s.giDictionary));
						},
					},
					{
						name: "Reset gi dictionary",
						desc: "Restore the shipped list of commonly cited high-gi foods.",
						visible: () => s.diabeticMode,
						render: (setting: Setting) => {
							setting.addButton((btn) =>
								btn.setButtonText("Reset").onClick(async () => {
									s.giDictionary = DEFAULT_GI_DICTIONARY;
									await this.host.saveSettings();
									this.rerender();
								}),
							);
						},
					},
				],
			},
		];
	}

	// ── Compat helpers ────────────────────────────────────────────────────

	private refreshState(): void {
		const tab = this as unknown as { refreshDomState?(): void; display(): void };
		if (typeof tab.refreshDomState === 'function') {
			tab.refreshDomState();
		} else {
			tab.display();
		}
	}

	private rerender(): void {
		const tab = this as unknown as { update?(): void; display(): void };
		if (typeof tab.update === 'function') {
			tab.update();
		} else {
			tab.display();
		}
	}

	// ── Imperative fallback (Obsidian < 1.13.0) ───────────────────────────

	override display(): void {
		this.renderSettings();
	}

	private renderSettings(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Header: logo + buy me a coffee ───────────────────────────────
		const header = containerEl.createDiv({ cls: "mise-settings-header" });

		header.createEl("img", {
			cls: "mise-settings-logo",
			attr: {
				src: "https://github.com/user-attachments/assets/1bd14075-406d-42af-b005-9a245a714811",
				alt: "MiseFlow",
			},
		});

		header.createEl("a", {
			cls: "mise-settings-bmc",
			text: "☕ buy me a coffee",
			href: "https://buymeacoffee.com/atommasi",
			attr: { target: "_blank", rel: "noopener" },
		});

		// ── Notes & Storage ──────────────────────────────────────────────
		new Setting(containerEl).setName("Notes & storage").setHeading();

		new Setting(containerEl)
			.setName("Meal plan note")
			.setDesc(createMomentDesc("Vault-relative path of the note where your meal plan is stored."))
			.addText((text) =>
				text
					.setPlaceholder("Meal plan.md")
					.setValue(this.host.settings.mealPlanNotePath)
					.onChange(async (value) => {
						this.host.settings.mealPlanNotePath =
							value.trim() || "Meal Plan.md";
							await this.host.saveSettings();
					}),
			);

		// Declare first so the toggle's onChange closure can reference it.
		// The Setting itself is appended to the DOM after the toggle below.
		let tagFilterSetting: Setting;

		new Setting(containerEl)
			.setName("Auto-add ingredients on sync")
			.setDesc(
				"When syncing the meal plan note, automatically extract ingredients from newly discovered recipes and add them to the grocery list.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.autoAddIngredientsOnSync)
					.onChange(async (value) => {
						this.host.settings.autoAddIngredientsOnSync = value;
						await this.host.saveSettings();
						tagFilterSetting.settingEl.style.display = value ? "" : "none";
					}),
			);

		tagFilterSetting = new Setting(containerEl)
			.setName("Tag filter")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Only auto-add ingredients from recipes that have this tag (e.g. groceryList). Leave empty to auto-add from all recipes.",
			)
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
						.setPlaceholder("groceryList")
					.setValue(this.host.settings.autoAddIngredientsTag)
					.onChange(async (value) => {
						this.host.settings.autoAddIngredientsTag =
							value.trim().replace(/^#/, "");
						await this.host.saveSettings();
					}),
			);
		tagFilterSetting.settingEl.style.display =
			this.host.settings.autoAddIngredientsOnSync ? "" : "none";

		new Setting(containerEl)
			.setName("Grocery list note")
			.setDesc(createMomentDesc("Vault-relative path of the note where your grocery list is stored."))
			.addText((text) =>
				text
					.setPlaceholder("Grocery list.md")
					.setValue(this.host.settings.groceryListNotePath)
					.onChange(async (value) => {
						this.host.settings.groceryListNotePath =
							value.trim() || "Grocery List.md";
						await this.host.saveSettings();
					}),
			);

		// ── Recipe Library ───────────────────────────────────────────────
		new Setting(containerEl).setName("Recipe library").setHeading();

		{
			const s = new Setting(containerEl)
				.setName("Recipe folders")
				.setDesc(
					"Folders the plugin scans for recipe notes. Leave empty to scan the entire vault.",
				);
			s.settingEl.addClass("mise-settings-has-list");
			this.renderFolderList(
				s.settingEl,
				this.host.settings.recipeFolders,
				async (folders) => {
					this.host.settings.recipeFolders = folders;
					await this.host.saveSettings();
				},
			);
		}

		new Setting(containerEl)
			.setName("Recipe type value")
			.setDesc(
				"Notes whose frontmatter `type` matches this value are treated as recipes. Used for auto-open and the recipe library.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Recipe")
					.setValue(this.host.settings.recipeTypeValue)
					.onChange(async (value) => {
						this.host.settings.recipeTypeValue =
							value.trim() || "recipe";
						await this.host.saveSettings();
					}),
			);


		// ── Recipe View ─────────────────────────────────────────────────
		new Setting(containerEl).setName("Recipe view").setHeading();

		new Setting(containerEl)
			.setName("Auto-open recipe view")
			.setDesc(
				"Automatically switch to the recipe card view when you open a note whose `type` matches the value above.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.autoOpenRecipeView)
					.onChange(async (value) => {
						this.host.settings.autoOpenRecipeView = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Ingredients heading")
			.setDesc(
				"The heading in your recipe notes that introduces the ingredients list (case-insensitive).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Ingredients")
					.setValue(this.host.settings.ingredientsHeading)
					.onChange(async (value) => {
						this.host.settings.ingredientsHeading =
							value.trim() || "Ingredients";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Instructions heading")
			.setDesc(
				"The heading in your recipe notes that introduces the cooking steps (case-insensitive).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Instructions")
					.setValue(this.host.settings.instructionsHeading)
					.onChange(async (value) => {
						this.host.settings.instructionsHeading =
							value.trim() || "Instructions";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Remove duplicate title")
			.setDesc(
				"Strip the leading h1 from a recipe note's body if it matches the note title, since the recipe view already shows the title above.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.stripBodyTitle)
					.onChange(async (value) => {
						this.host.settings.stripBodyTitle = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Remove duplicate hero image")
			.setDesc(
				"Strip inline images from a recipe note's body if they match the frontmatter image, since the recipe view already shows it as a hero image.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.stripBodyHeroImage)
					.onChange(async (value) => {
						this.host.settings.stripBodyHeroImage = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Rating property")
			.setDesc(
				"Frontmatter property name used to store a recipe's star rating (1–5). Shown as interactive stars in the mobile recipe header.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Rating")
					.setValue(this.host.settings.ratingProperty)
					.onChange(async (value) => {
						this.host.settings.ratingProperty = value.trim() || "rating";
						await this.host.saveSettings();
					}),
			);


		new Setting(containerEl).setName("Recipe timers").setHeading();

		new Setting(containerEl)
			.setName("Step timers")
			.setDesc(
				'Detect duration phrases in cooking steps (e.g. "bake for 30 minutes") and show a clickable timer button.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.enableTimers)
					.onChange(async (value) => {
						this.host.settings.enableTimers = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-start timers")
			.setDesc(
				"Start counting down immediately when a timer button is clicked.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.timerAutoStart)
					.onChange(async (value) => {
						this.host.settings.timerAutoStart = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Compact timers by default")
			.setDesc(
				"Show timers in compact mode (time only) instead of the full widget. You can toggle per-timer using the resize button.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.timerDefaultCompact)
					.onChange(async (value) => {
						this.host.settings.timerDefaultCompact = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Time range default")
			.setDesc(
				'When a step says "10–15 minutes", which end of the range to use as the timer default.',
			)
			.addDropdown((dd) =>
				dd
					.addOptions({ max: "Max", min: "Min" })
					.setValue(this.host.settings.timerRangeDefault)
					.onChange(async (value) => {
						this.host.settings.timerRangeDefault = value as "max" | "min";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Timer increment")
			.setDesc("How many minutes the ▲/▼ stepper buttons add or subtract.")
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(String(this.host.settings.timerIncrementMinutes))
					.onChange(async (value) => {
						const n = parseFloat(value);
						if (isFinite(n) && n > 0) {
							this.host.settings.timerIncrementMinutes = n;
							await this.host.saveSettings();
						}
					}),
			);

		// ── Shopping ─────────────────────────────────────────────────────
		new Setting(containerEl).setName("Shopping").setHeading();

		new Setting(containerEl)
			.setName("Default grouping")
			.setDesc(
				"How items are grouped in the shopping assistant. By category is best for supermarket shopping; by recipe is useful for meal prep.",
			)
			.addDropdown((dd) =>
				dd
					.addOptions({
						category: "By category",
						recipe: "By recipe",
						source: "By source (Meal Plan vs Manually Added)",
						none: "Flat list",
					})
					.setValue(this.host.settings.grouping)
					.onChange(async (value) => {
						this.host.settings.grouping =
							value as MiseFlowSettings["grouping"];
						await this.host.saveSettings();
						this.host.manager.trigger("changed");
					}),
			);

		new Setting(containerEl)
			.setName("Auto-collapse completed sections")
			.setDesc(
				"Collapse a category or recipe section automatically once every item in it is checked off.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.autoCollapseCompleted)
					.onChange(async (value) => {
						this.host.settings.autoCollapseCompleted = value;
						await this.host.saveSettings();
					}),
			);

		// ── Categories ───────────────────────────────────────────────────
		new Setting(containerEl).setName("Categories").setHeading();

		new Setting(containerEl)
			.setName("Category source")
			.setDesc(
				"Where each grocery item's category comes from. Recipe tags use the trailing #tag on each ingredient line; dictionary uses the built-in keyword matcher.",
			)
			.addDropdown((dd) =>
				dd
					.addOptions({
						dictionary: "Built-in dictionary",
						tag: "Recipe tags",
						"tag-then-dictionary": "Recipe tags, then dictionary",
					})
					.setValue(this.host.settings.categorySource)
					.onChange(async (value) => {
						this.host.settings.categorySource =
							value as MiseFlowSettings["categorySource"];
						await this.host.saveSettings();
						this.host.manager.trigger("changed");
					}),
			);

		new Setting(containerEl)
			.setName("Sort categories alphabetically")
			.setDesc(
				"When on, categories are sorted a–z automatically. Turn off to set a custom order.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.categoryAutoSort)
					.onChange(async (value) => {
						this.host.settings.categoryAutoSort = value;
						await this.host.saveSettings();
						this.host.manager.trigger("changed");
						this.renderSettings();
					}),
			);

		if (!this.host.settings.categoryAutoSort) {
			new Setting(containerEl)
				.setName("Category order")
				.setDesc(
					"One category per line, in the order you want them to appear. Categories not listed here appear at the end alphabetically.",
				)
				.addTextArea((ta) => {
					ta.setPlaceholder(DEFAULT_CATEGORY_ORDER.join("\n"));
					ta.setValue(this.host.settings.categoryOrder.join("\n"));
					ta.inputEl.addClass("mise-settings-category-order-textarea");
					ta.onChange(async (value) => {
						this.host.settings.categoryOrder = value
							.split(/\r?\n/)
							.map((s) => s.trim())
							.filter(Boolean);
						await this.host.saveSettings();
						this.host.manager.trigger("changed");
					});
				});
		}

		{
			const s = new Setting(containerEl)
				.setName("Category overrides")
				.setDesc(
					"Force specific ingredients into a category, regardless of the dictionary or tags. Match is a case-insensitive substring of the ingredient name.",
				);
			s.settingEl.addClass("mise-settings-has-list");
			this.renderOverrideList(
				s.settingEl,
				this.host.settings.categoryOverrides,
				async (overrides) => {
					this.host.settings.categoryOverrides = overrides;
					await this.host.saveSettings();
					this.host.manager.trigger("changed");
				},
			);
		}

		new Setting(containerEl)
			.setName("Reset categories")
			.setDesc("Restore the default category order, re-enable alphabetical sorting, and remove all overrides.")
			.addButton((btn) =>
				btn.setButtonText("Reset").onClick(async () => {
					this.host.settings.categoryAutoSort = true;
					this.host.settings.categoryOrder = [...DEFAULT_CATEGORY_ORDER];
					this.host.settings.categoryOverrides = [];
					await this.host.saveSettings();
					this.renderSettings();
					this.host.manager.trigger("changed");
				}),
			);

		// ── Cooking & Tracking ───────────────────────────────────────────
		new Setting(containerEl).setName("Cooking & tracking").setHeading();

		new Setting(containerEl)
			.setName("Show mark as cooked button")
			.setDesc(
				"Show a button in the recipe view to manually record that you cooked a recipe, updating its last made date and cooked count.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.showMarkCookedButton)
					.onChange(async (value) => {
						this.host.settings.showMarkCookedButton = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Ask for date when marking cooked")
			.setDesc(
				"Open a date picker instead of using today's date when marking a recipe as cooked.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.markCookedAskDate)
					.onChange(async (value) => {
						this.host.settings.markCookedAskDate = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Track last made date")
			.setDesc(
				"Write today's date to a recipe's frontmatter when it's added to the meal plan. Powers the 'last made' badge in the recipe view.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.trackLastMade)
					.onChange(async (value) => {
						this.host.settings.trackLastMade = value;
						await this.host.saveSettings();
						this.renderSettings();
					}),
			);

		if (this.host.settings.trackLastMade) {
			new Setting(containerEl)
				.setName("Last made property")
				.setDesc(
					"Frontmatter property name used to store the last made date (yyyy-mm-dd).",
				)
				.addText((text) =>
					text
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						.setPlaceholder("lastMade")
						.setValue(this.host.settings.lastMadeProperty)
						.onChange(async (value) => {
							this.host.settings.lastMadeProperty =
								value.trim() || "lastMade";
							await this.host.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Track cooked count")
				.setDesc(
					"Increment a `cookedCount` frontmatter field each time a recipe is marked as cooked on a new day. Powers the cooking stats leaderboard.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.host.settings.trackCookedCount)
						.onChange(async (value) => {
							this.host.settings.trackCookedCount = value;
							await this.host.saveSettings();
						}),
				);
		}

		// ── Nutrition ────────────────────────────────────────────────────
		new Setting(containerEl).setName("Nutrition").setHeading();

		new Setting(containerEl)
			.setName("Nutrition display")
			.setDesc(
				"How nutrition values are shown in the recipe view — as per-serving numbers or as totals for the whole recipe.",
			)
			.addDropdown((dd) =>
				dd
					.addOptions({
						"per-serving": "Per serving",
						total: "Total",
					})
					.setValue(this.host.settings.nutritionDisplay)
					.onChange(async (value) => {
						this.host.settings.nutritionDisplay =
							value as MiseFlowSettings["nutritionDisplay"];
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Nutrition source")
			.setDesc(
				"Whether the nutrition values in your recipe frontmatter are totals for the whole recipe or already per serving.",
			)
			.addDropdown((dd) =>
				dd
					.addOptions({
						"recipe-total": "Recipe total",
						"per-serving": "Per serving",
					})
					.setValue(this.host.settings.nutritionSource)
					.onChange(async (value) => {
						this.host.settings.nutritionSource =
							value as MiseFlowSettings["nutritionSource"];
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Calories property")
			.setDesc("Frontmatter property name for the calories value.")
			.addText((text) =>
				text
					.setPlaceholder("Calories")
					.setValue(this.host.settings.caloriesProperty)
					.onChange(async (value) => {
						this.host.settings.caloriesProperty = value.trim() || "calories";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Protein property")
			.setDesc("Frontmatter property name for the protein value (grams).")
			.addText((text) =>
				text
					.setPlaceholder("Protein")
					.setValue(this.host.settings.proteinProperty)
					.onChange(async (value) => {
						this.host.settings.proteinProperty = value.trim() || "protein";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Fat property")
			.setDesc("Frontmatter property name for the fat value (grams).")
			.addText((text) =>
				text
					.setPlaceholder("Fat")
					.setValue(this.host.settings.fatProperty)
					.onChange(async (value) => {
						this.host.settings.fatProperty = value.trim() || "fat";
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Carbs property")
			.setDesc("Frontmatter property name for the carbs value (grams).")
			.addText((text) =>
				text
					.setPlaceholder("Carbs")
					.setValue(this.host.settings.carbsProperty)
					.onChange(async (value) => {
						this.host.settings.carbsProperty = value.trim() || "carbs";
						await this.host.saveSettings();
					}),
			);

		// ── Meal Suggestions ─────────────────────────────────────────────
		new Setting(containerEl).setName("Meal suggestions").setHeading();

		new Setting(containerEl)
			.setName("Suggestion day window")
			.setDesc(
				"Recipes cooked within this many days are hidden from the meal suggester to encourage variety. Set to 0 to show all recipes.",
			)
			.addText((text) =>
				text
					.setPlaceholder("14")
					.setValue(String(this.host.settings.suggestionDayWindow))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isFinite(n) && n >= 0) {
							this.host.settings.suggestionDayWindow = Math.round(n);
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Suggestion count")
			.setDesc("How many recipe suggestions to show at once.")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(String(this.host.settings.suggestionCount))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isFinite(n) && n >= 1) {
							this.host.settings.suggestionCount = Math.round(n);
							await this.host.saveSettings();
						}
					}),
			);

		// ── Health & Safety ─────────────────────────────────────────────
		new Setting(containerEl).setName("Health & safety").setHeading();

		new Setting(containerEl)
			.setName("Allergens property")
			.setDesc(
				"Frontmatter property that stores a recipe's allergens. Accepts both YAML lists and comma-separated text (e.g. Gluten, dairy).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Allergens")
					.setValue(this.host.settings.allergensProperty)
					.onChange(async (value) => {
						this.host.settings.allergensProperty =
							value.trim() || "allergens";
						await this.host.saveSettings();
						this.host.manager.trigger("changed");
					}),
			);

		{
			const s = new Setting(containerEl)
				.setName("My allergens")
				.setDesc(
					"Recipes containing any of these allergens show a warning in the recipe view and shopping assistant.",
				);
			s.settingEl.addClass("mise-settings-has-list");
			this.renderStringList(
				s.settingEl,
				this.host.settings.myAllergens,
				"e.g. gluten",
				async (items) => {
					this.host.settings.myAllergens = items
						.map((s) => s.trim().toLowerCase())
						.filter(Boolean);
					await this.host.saveSettings();
					this.host.manager.trigger("changed");
				},
			);
		}

		new Setting(containerEl)
			.setName("Meat temperature warnings")
			.setDesc(
				"Show a safe internal temperature badge on meat ingredients in the recipe view.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.showMeatTempWarnings)
					.onChange(async (value) => {
						this.host.settings.showMeatTempWarnings = value;
						await this.host.saveSettings();
					}),
			);



		new Setting(containerEl)
			.setName("High glycemic index warnings")
			.setDesc(
				"Show a high-gi badge on ingredients that may cause a rapid blood sugar spike. Informational only — not medical advice.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.diabeticMode)
					.onChange(async (value) => {
						this.host.settings.diabeticMode = value;
						await this.host.saveSettings();
						this.renderSettings();
					}),
			);

		if (this.host.settings.diabeticMode) {
			this.renderGiDictionarySetting(containerEl);
		}
	}

	// ── Private helpers ─────────────────────────────────────────────────────

	/**
	 * Renders a folder path list with per-item vault folder autocomplete.
	 */
	private renderFolderList(
		containerEl: HTMLElement,
		folders: string[],
		onChange: (folders: string[]) => Promise<void>,
	): void {
		this.renderStringList(containerEl, folders, "e.g. Recipes/", onChange, true);
	}

	/**
	 * Renders an add/remove string list. When `folderSuggest` is true,
	 * attaches a FolderSuggest to each input for vault folder autocomplete.
	 */
	private renderStringList(
		containerEl: HTMLElement,
		items: string[],
		placeholder: string,
		onChange: (items: string[]) => Promise<void>,
		folderSuggest = false,
	): void {
		const current = [...items];
		const listEl = containerEl.createDiv({ cls: "mise-settings-list" });

		const renderRows = (): void => {
			listEl.empty();

			for (let i = 0; i < current.length; i++) {
				const row = listEl.createDiv({ cls: "mise-settings-list-row" });
				const input = row.createEl("input", {
					cls: "mise-settings-list-input",
					type: "text",
					value: current[i] ?? "",
					attr: { placeholder },
				});

				if (folderSuggest) {
					new FolderSuggest(this.app, input);
				}

				input.addEventListener("change", () => {
					current[i] = input.value.trim();
					void onChange(current.filter(Boolean));
				});

				const removeBtn = row.createEl("button", {
					cls: "mise-settings-list-remove clickable-icon",
					attr: { type: "button", "aria-label": "Remove" },
				});
				removeBtn.setText("×");
				removeBtn.addEventListener("click", () => {
					current.splice(i, 1);
					void onChange([...current]);
					renderRows();
				});
			}

			const addRow = listEl.createDiv({ cls: "mise-settings-list-add-row" });
			const addBtn = addRow.createEl("button", {
				cls: "mise-settings-list-add",
				attr: { type: "button" },
			});
			addBtn.setText("+ add");
			addBtn.addEventListener("click", () => {
				current.push("");
				renderRows();
				// Focus the new input.
				const inputs = listEl.querySelectorAll<HTMLInputElement>(
					".mise-settings-list-input",
				);
				inputs[inputs.length - 1]?.focus();
			});
		};

		renderRows();
	}

	/**
	 * Renders an add/remove list of CategoryOverride rows.
	 * Each row has two inputs: match (substring) and category.
	 */
	private renderOverrideList(
		containerEl: HTMLElement,
		overrides: CategoryOverride[],
		onChange: (overrides: CategoryOverride[]) => Promise<void>,
	): void {
		const current: CategoryOverride[] = overrides.map((o) => ({ ...o }));
		const listEl = containerEl.createDiv({ cls: "mise-settings-list" });
		const knownCategories = this.host.manager.getKnownCategories();

		// Build a datalist for category autocomplete.
		const datalistId = "mise-category-datalist";
		let datalist = containerEl.querySelector<HTMLDataListElement>(
			`#${datalistId}`,
		);
		if (!datalist) {
			datalist = containerEl.createEl("datalist");
			datalist.id = datalistId;
		}
		datalist.empty();
		for (const cat of knownCategories) {
			datalist.createEl("option", { value: cat });
		}

		const renderRows = (): void => {
			listEl.empty();

			for (let i = 0; i < current.length; i++) {
				const entry = current[i]!;
				const row = listEl.createDiv({
					cls: "mise-settings-list-row mise-settings-override-row",
				});

				const matchInput = row.createEl("input", {
					cls: "mise-settings-list-input",
					type: "text",
					value: entry.match,
					attr: { placeholder: "E.g. Chicken" },
				});

				row.createSpan({ cls: "mise-settings-override-arrow", text: "→" });

				const categoryInput = row.createEl("input", {
					cls: "mise-settings-list-input",
					type: "text",
					value: entry.category,
					attr: {
						placeholder: "E.g. Meat",
						list: datalistId,
					},
				});

				const save = async (): Promise<void> => {
					const m = matchInput.value.trim();
					const c = categoryInput.value.trim();
					if (m && c) {
						current[i] = { match: m, category: c };
						await onChange([...current]);
					}
				};

				matchInput.addEventListener("change", () => void save());
				categoryInput.addEventListener("change", () => void save());

				const removeBtn = row.createEl("button", {
					cls: "mise-settings-list-remove clickable-icon",
					attr: { type: "button", "aria-label": "Remove override" },
				});
				removeBtn.setText("×");
				removeBtn.addEventListener("click", () => {
					current.splice(i, 1);
					void onChange([...current]);
					renderRows();
				});
			}

			const addRow = listEl.createDiv({ cls: "mise-settings-list-add-row" });
			const addBtn = addRow.createEl("button", {
				cls: "mise-settings-list-add",
				attr: { type: "button" },
			});
			addBtn.setText("+ add override");
			addBtn.addEventListener("click", () => {
				current.push({ match: "", category: "" });
				renderRows();
				const inputs = listEl.querySelectorAll<HTMLInputElement>(
					".mise-settings-list-input",
				);
				inputs[inputs.length - 2]?.focus();
			});
		};

		renderRows();
	}

	private renderGiDictionarySetting(containerEl: HTMLElement): void {
		const setting = new Setting(containerEl)
			.setName("High glycemic index dictionary")
			.setDesc(
				"One regex per line, case-insensitive. Lines starting with # are comments. Matched ingredient names show an up-arrow badge in the recipe view. Gi values vary by source — informational only, not medical advice.",
			);

		const errorEl = containerEl.createDiv({
			cls: "mise-settings-gi-errors",
		});

		setting.addTextArea((ta) => {
			ta.setValue(this.host.settings.giDictionary);
			ta.inputEl.rows = 12;
			ta.inputEl.addClass("mise-settings-gi-textarea");
			ta.onChange(async (value) => {
				this.host.settings.giDictionary = value;
				await this.host.saveSettings();
				renderErrors(errorEl, validateGiDictionary(value));
			});
		});

		renderErrors(
			errorEl,
			validateGiDictionary(this.host.settings.giDictionary),
		);

		new Setting(containerEl)
			.setName("Reset gi dictionary")
			.setDesc("Restore the shipped list of commonly cited high-gi foods.")
			.addButton((btn) =>
				btn.setButtonText("Reset").onClick(async () => {
					this.host.settings.giDictionary = DEFAULT_GI_DICTIONARY;
					await this.host.saveSettings();
					this.renderSettings();
				}),
			);
	}
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function createMomentDesc(prefix: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	frag.appendText(`${prefix} `);
	const link = frag.createEl("a", {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		text: "moment.js format tokens",
		href: "https://momentjs.com/docs/#/displaying/format/",
		attr: { target: "_blank", rel: "noopener" },
	});
	frag.appendChild(link);
	frag.appendText(" supported, e.g. Meal Plan {YYYY-MM-DD}.md.");
	return frag;
}

function renderErrors(container: HTMLElement, errors: readonly string[]): void {
	container.empty();
	if (errors.length === 0) return;
	container.createDiv({
		cls: "mise-settings-gi-errors-title",
		text: `${errors.length} invalid pattern${errors.length === 1 ? "" : "s"} (skipped):`,
	});
	const list = container.createEl("ul", {
		cls: "mise-settings-gi-errors-list",
	});
	for (const err of errors) {
		list.createEl("li", { text: err });
	}
}
