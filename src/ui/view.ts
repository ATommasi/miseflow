import {
	ButtonComponent,
	EventRef,
	ItemView,
	Menu,
	Notice,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { groupForDisplay } from "../grocery/aggregator";
import { GroceryListManager } from "../grocery/manager";
import { getOrCreateNote } from "../grocery/note-writer";
import { formatQuantity } from "../parser/quantity";
import { MiseFlowSettings } from "../settings";
import { GroceryItem, OneOffItem } from "../types";
import { toTitleCase } from "../utils/text";
import { AddOneOffModal } from "./add-item-modal";
import { ConfirmModal } from "./confirm-modal";
import { ExportListModal } from "./export-modal";
import { resolveNotePath } from "../utils/paths";

export const VIEW_TYPE_GROCERY_LIST = "mise-grocery-list";

interface ViewDeps {
	manager: GroceryListManager;
	getSettings: () => MiseFlowSettings;
	saveSettings: () => Promise<void>;
}

export class GroceryListView extends ItemView {
	private listEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private recipesEl!: HTMLElement;
	private changedRef: EventRef | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: ViewDeps,
	) {
		super(leaf);
		this.icon = "shopping-cart";
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE_GROCERY_LIST;
	}

	getDisplayText(): string {
		return "Shopping assistant";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1];
		if (!root) return;
		root.empty();
		root.addClass("mise-view");

		this.headerEl = root.createDiv({ cls: "mise-header" });
		this.summaryEl = root.createDiv({ cls: "mise-summary" });
		this.recipesEl = root.createDiv({ cls: "mise-recipes" });
		this.listEl = root.createDiv({ cls: "mise-list" });

		this.renderHeader();

		this.changedRef = this.deps.manager.on("changed", () => {
			this.renderList();
		});

		await this.deps.manager.refresh();
		this.renderList();
	}

	onClose(): Promise<void> {
		if (this.changedRef) {
			this.deps.manager.offref(this.changedRef);
			this.changedRef = null;
		}
		return Promise.resolve();
	}

	private renderHeader(): void {
		this.headerEl.empty();

		const titleEl = this.headerEl.createDiv({ cls: "mise-title" });
		titleEl.createSpan({ text: "Shopping Assistant" });

		const actionsEl = this.headerEl.createDiv({ cls: "mise-actions" });

		this.makeIconButton(actionsEl, "refresh-cw", "Sync from meal plan note", async () => {
			await this.deps.manager.syncFromMealPlanNote();
			await this.deps.manager.refresh();
			new Notice("Meal plan synced.");
		});

		this.makeIconButton(actionsEl, "settings-2", "Grouping", (evt) => {
			this.openGroupingMenu(evt);
		});

		this.makeIconButton(actionsEl, "share", "Export grocery list", () => {
			new ExportListModal(this.app, {
				getSettings: this.deps.getSettings,
				manager: this.deps.manager,
			}).open();
		});

		this.makeIconButton(actionsEl, "rotate-ccw", "Reset checks", async () => {
			await this.deps.manager.resetChecks();
			new Notice("Grocery checks reset.");
		});

		const addBtn = new ButtonComponent(actionsEl)
			.setButtonText("Add item")
			.onClick(() => {
				new AddOneOffModal(this.app, this.deps.manager).open();
			});
		addBtn.buttonEl.addClass("mise-add");

		const clearBtn = new ButtonComponent(actionsEl)
			.setButtonText("Clear all")
			.setWarning()
			.onClick(() => {
				new ConfirmModal(this.app, {
					title: "Clear meal plan and grocery list?",
					message:
						"This will clear all grocery list items, the meal plan and grocery notes will also be cleared. This can't be undone.",
					confirmText: "Clear all",
					destructive: true,
					onConfirm: async () => {
						await this.deps.manager.clearAll();
					},
				}).open();
			});
		clearBtn.buttonEl.addClass("mise-clear");
	}

	private openGroupingMenu(evt: MouseEvent | undefined): void {
		const menu = new Menu();
		const settings = this.deps.getSettings();
		const options: Array<[MiseFlowSettings["grouping"], string]> = [
			["category", "By category"],
			["recipe", "By recipe"],
			["source", "By source (Meal Plan vs Manually Added)"],
			["none", "Flat list"],
		];
		for (const [value, label] of options) {
			menu.addItem((item) =>
				item
					.setTitle(label)
					.setChecked(settings.grouping === value)
					.onClick(async () => {
						settings.grouping = value;
						await this.deps.saveSettings();
						this.renderList();
					}),
			);
		}
		if (evt) {
			menu.showAtMouseEvent(evt);
		} else {
			const target = this.headerEl.getBoundingClientRect();
			menu.showAtPosition({ x: target.right, y: target.bottom });
		}
	}

	private makeIconButton(
		parent: HTMLElement,
		icon: string,
		tooltip: string,
		onClick: (evt: MouseEvent) => void | Promise<void>,
	): void {
		const btn = parent.createEl("button", { cls: "clickable-icon" });
		btn.setAttribute("aria-label", tooltip);
		btn.setAttribute("type", "button");
		setIcon(btn, icon);
		btn.addEventListener("click", (evt) => {
			void onClick(evt);
		});
	}


	/**
	 * Creates the list of grocery items, grouped by category or recipe as appropriate. Also renders the summary info at the top.
	 */
	private renderList(): void {
		this.listEl.empty();
		this.recipesEl.empty();
		const items = this.deps.manager.getItems();
		const oneOffs = this.deps.manager.getOneOffs();
		const entries = this.deps.manager.getMealPlanEntries();

		this.renderSummary(items, entries);

		if (items.length === 0) {
			const empty = this.listEl.createDiv({ cls: "mise-empty" });
			empty.createEl("p", {
				text: "Nothing on the grocery list yet.",
			});
			empty.createEl("p", {
				cls: "mise-hint",
				text: "Open the meal plan note to add recipes, then select the ingredients you need.",
			});
			return;
		}

		const settings = this.deps.getSettings();
		const grouped = groupForDisplay(items, settings);
		for (const [groupName, groupItems] of grouped) {
			if (groupItems.length === 0) continue;
			this.renderGroup(groupName, groupItems, oneOffs);
		}
	}

	/** 
	 * Renders a group of grocery items, either by category or by recipe depending on the current grouping setting.
	 * @param groupName The name of the group.
	 * @param groupItems The grocery items in this group.
	 * @param oneOffs The list of one-off items, used to determine whether to show the "remove" button and category context menu for each item.
	*/
	private renderGroup(
		groupName: string,
		groupItems: GroceryItem[],
		oneOffs: OneOffItem[],
	): void {
		const collapsed = this.deps.manager.isGroupCollapsed(groupName);
		const checkedCount = groupItems.filter((i) => i.checked).length;
		const totalCount = groupItems.length;
		const allChecked = totalCount > 0 && checkedCount === totalCount;

		const section = this.listEl.createDiv({ cls: "mise-group" });
		if (collapsed) section.addClass("is-collapsed");
		if (allChecked) section.addClass("is-complete");

		const header = section.createEl("button", {
			cls: "mise-group-header",
		});
		header.setAttribute("type", "button");
		header.setAttribute("aria-expanded", collapsed ? "false" : "true");
		header.setAttribute(
			"aria-label",
			`${collapsed ? "Expand" : "Collapse"} ${groupName}`,
		);

		const chevron = header.createSpan({ cls: "mise-chevron" });
		setIcon(chevron, "chevron-down");

		header.createSpan({
			cls: "mise-group-title",
			text: groupName,
		});

		header.createSpan({
			cls: "mise-group-count",
			text: `${checkedCount}/${totalCount}`,
		});

		header.addEventListener("click", () => {
			void this.deps.manager.setGroupCollapsed(groupName, !collapsed);
		});

		const ul = section.createEl("ul", { cls: "mise-items" });
		for (const item of groupItems) {
			this.renderItem(ul, item, oneOffs, groupName);
		}
	}


	/**
	 * Renders the summary info at the top of the view, including the meal plan summary and grocery list summary.
	 * The meal plan summary includes a link to open the meal plan note, and the grocery list summary includes a link to open the grocery list note.
	 * @param items 
	 * @param entries 
	 */
	private renderSummary(
		items: GroceryItem[],
		entries: import("../types").MealPlanEntry[],
	): void {
		this.summaryEl.empty();

		const settings = this.deps.getSettings();

		// Compact meal plan summary row.
		const planRow = this.summaryEl.createDiv({ cls: "mise-summary-plan" });
		const mealCount = entries.length;
		const countText = mealCount === 0
			? "No meals planned"
			: `${mealCount} meal${mealCount === 1 ? "" : "s"} planned`;
		planRow.createSpan({ cls: "mise-summary-plan-count", text: countText });

		const planLink = planRow.createEl("a", {
			cls: "mise-summary-note-link",
			text: " View meals →",
			href: "#",
		});
		planLink.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.openNote(resolveNotePath(settings.mealPlanNotePath || "Meal Plan.md"), "# Meal Plan\n");
		});

		// Grocery summary row.
		if (items.length > 0) {
			const groceryRow = this.summaryEl.createDiv({ cls: "mise-summary-grocery" });
			const checked = items.filter((i) => i.checked).length;
			groceryRow.createSpan({
				cls: "mise-summary-grocery-count",
				text: `${checked}/${items.length} checked`,
			});
			const groceryLink = groceryRow.createEl("a", {
				cls: "mise-summary-note-link",
				text: " View grocery list →",
				href: "#",
			});
			groceryLink.addEventListener("click", (evt) => {
				evt.preventDefault();
				void this.openNote(resolveNotePath(settings.groceryListNotePath || "Grocery List.md"), "# Grocery List\n");
			});
		}
	}

	/**
	 * Opens a note in the workspace. 
	 * The path is relative to the vault root. If the file doesn't exist, this does nothing.
	 * @param path 
	 */
	private async openNote(path: string, initialContent = ""): Promise<void> {
		const file = await getOrCreateNote(this.app, path, initialContent);
		await this.app.workspace.getLeaf(false).openFile(file);
	}


	/**
	 * Renders a grocery item as a row in the grocery list, including the checkbox, name, quantity/unit, sources, 
	 * and "remove" button if it's linked to a one-off item. 	
	 * Also wires up the checkbox and remove button to update state when clicked.
	 * @param parent 
	 * @param item 
	 * @param oneOffs 
	 * @param groupName
	 */
	private renderItem(
		parent: HTMLElement,
		item: GroceryItem,
		oneOffs: OneOffItem[],
		groupName = "",
	): void {
		const li = parent.createEl("li", { cls: "mise-item" });
		if (item.checked) li.addClass("is-checked");

		const checkbox = li.createEl("input", {
			cls: "mise-checkbox",
			type: "checkbox",
		});
		checkbox.checked = item.checked;
		checkbox.addEventListener("change", () => {
			void this.deps.manager.toggleChecked(item.key, checkbox.checked);
		});

		const body = li.createDiv({ cls: "mise-item-body" });

		const main = body.createDiv({ cls: "mise-item-main" });
		main.createSpan({
			cls: "mise-name",
			text: toTitleCase(item.name),
		});
		const qtyAndUnit = [formatQuantity(item.quantity), item.unit]
			.filter(Boolean)
			.join(" ");
		if (qtyAndUnit) {
			main.createSpan({
				cls: "mise-qty",
				text: ` (${qtyAndUnit})`,
			});
		}

		const meta = body.createDiv({ cls: "mise-meta" });
		const groupLower = groupName.toLowerCase();
		const visibleSources = item.sources.filter((s) => {
			if (s.label.toLowerCase() === groupLower) return false;
			if (s.type === "one-off" && groupLower.includes("manually")) return false;
			return true;
		});
		if (visibleSources.length > 0) {
			const sourceEl = meta.createSpan({ cls: "mise-source" });
			visibleSources.forEach((s, i) => {
				if (i > 0) sourceEl.appendText(", ");
				if (s.type === "recipe" && s.path) {
					const link = sourceEl.createEl("a", {
						cls: "mise-source-link",
						text: s.label,
						href: "#",
					});
					link.addEventListener("click", (evt) => {
						evt.preventDefault();
						evt.stopPropagation();
						const file = this.app.vault.getAbstractFileByPath(s.path!);
						if (file instanceof TFile) {
							void this.app.workspace
								.getLeaf(evt.metaKey || evt.ctrlKey ? "tab" : false)
								.openFile(file);
						}
					});
				} else {
					sourceEl.appendText(s.label);
				}
			});
		}

		const matchingOneOff = oneOffs.find(
			(o) => normaliseEqual(o.name, item.name) && (o.unit || "") === (item.unit || ""),
		);
		if (matchingOneOff) {
			const removeBtn = li.createEl("button", {
				cls: "mise-remove clickable-icon",
			});
			removeBtn.setAttribute("aria-label", "Remove from manually added items");
			removeBtn.setAttribute("type", "button");
			setIcon(removeBtn, "x");
			removeBtn.addEventListener("click", () => {
				void this.deps.manager.removeOneOff(matchingOneOff.id);
			});

			this.attachContextMenu(li, matchingOneOff);
		}
	}

	/**
	 * Wire a row to open the one-off context menu on right-click (desktop)
	 * or long-press (mobile). The long-press timer is cancelled on touch
	 * move/end so quick taps still toggle the checkbox normally.
	 */
	private attachContextMenu(row: HTMLElement, oneOff: OneOffItem): void {
		row.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.openOneOffMenu(oneOff, { x: evt.clientX, y: evt.clientY });
		});

		const LONG_PRESS_MS = 500;
		const MOVE_TOLERANCE_PX = 8;
		let timer: number | null = null;
		let startX = 0;
		let startY = 0;

		const cancel = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		};

		row.addEventListener("touchstart", (evt) => {
			const touch = evt.touches.length === 1 ? evt.touches[0] : null;
			if (!touch) return;
			startX = touch.clientX;
			startY = touch.clientY;
			cancel();
			timer = window.setTimeout(() => {
				timer = null;
				this.openOneOffMenu(oneOff, { x: startX, y: startY });
			}, LONG_PRESS_MS);
		}, { passive: true });

		row.addEventListener("touchmove", (evt) => {
			if (timer === null) return;
			const touch = evt.touches.length === 1 ? evt.touches[0] : null;
			if (!touch) return;
			if (
				Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX ||
				Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX
			) {
				cancel();
			}
		}, { passive: true });

		row.addEventListener("touchend", cancel);
		row.addEventListener("touchcancel", cancel);
	}

	private openOneOffMenu(
		oneOff: OneOffItem,
		position: { x: number; y: number },
	): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Edit item…")
				.setIcon("pencil")
				.onClick(() => {
					new AddOneOffModal(
						this.app,
						this.deps.manager,
						oneOff,
					).open();
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle("Move to category…")
				.setIcon("folder")
				.onClick(() => {
					this.openCategoryMenu(oneOff, position);
				}),
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Remove")
				.setIcon("trash")
				.setWarning(true)
				.onClick(async () => {
					await this.deps.manager.removeOneOff(oneOff.id);
				}),
		);

		menu.showAtPosition(position);
	}

	private openCategoryMenu(
		oneOff: OneOffItem,
		position: { x: number; y: number },
	): void {
		const categories = this.deps.manager.getKnownCategories();
		const current = oneOff.category?.trim() || null;
		const menu = new Menu();

		for (const cat of categories) {
			menu.addItem((item) =>
				item
					.setTitle(cat)
					.setChecked(current === cat)
					.onClick(async () => {
						await this.deps.manager.updateOneOff(oneOff.id, {
							category: cat,
						});
					}),
			);
		}

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Auto-detect")
				.setChecked(current === null)
				.onClick(async () => {
					await this.deps.manager.updateOneOff(oneOff.id, {
						category: null,
					});
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle("New category…")
				.setIcon("plus")
				.onClick(() => {
					new AddOneOffModal(
						this.app,
						this.deps.manager,
						oneOff,
					).open();
				}),
		);

		menu.showAtPosition(position);
	}
}

function normaliseEqual(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}
