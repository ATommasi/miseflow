import { App, Modal, Notice, Setting } from "obsidian";
import { GroceryListManager, parseOneOffEntry } from "../grocery/manager";
import { OneOffItem } from "../types";

/**
 * Modal that adds or edits a one-off item on the grocery list.
 *
 * - In add mode: shows a "Quick entry" field that parses a free-form line
 *   ("2 cans black beans") into name/quantity/unit, plus structured fields.
 * - In edit mode: hides the quick-entry field and prefills the structured
 *   fields from the existing item; "Add" becomes "Save" and changes are
 *   persisted via `updateOneOff` instead of `addOneOff`.
 */
export class AddOneOffModal extends Modal {
	private quickEntry = "";
	private name: string;
	private quantityText: string;
	private unit: string;
	private category: string;
	private readonly existing: OneOffItem | null;

	constructor(
		app: App,
		private readonly manager: GroceryListManager,
		existing?: OneOffItem,
	) {
		super(app);
		this.existing = existing ?? null;
		this.name = existing?.name ?? "";
		this.quantityText =
			existing?.quantity !== null && existing?.quantity !== undefined
				? String(existing.quantity)
				: "";
		this.unit = existing?.unit ?? "";
		this.category = existing?.category ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const editing = this.existing !== null;
		contentEl.createEl("h2", {
			text: editing ? "Edit grocery item" : "Add grocery item",
		});

		if (!editing) {
			new Setting(contentEl)
				.setName("Quick entry")
				.setDesc(
					"Type a full line like \"2 cans black beans\". Leave blank to use the fields below.",
				)
				.addText((text) =>
					text
						.setPlaceholder("Type a quantity, unit, and name")
						.onChange((value) => {
							this.quickEntry = value;
						}),
				);
		}

		new Setting(contentEl).setName("Name").addText((text) =>
			text
				.setPlaceholder("Item name")
				.setValue(this.name)
				.onChange((value) => {
					this.name = value;
				}),
		);

		new Setting(contentEl).setName("Quantity").addText((text) =>
			text
				.setPlaceholder("Number")
				.setValue(this.quantityText)
				.onChange((value) => {
					this.quantityText = value;
				}),
		);

		new Setting(contentEl).setName("Unit").addText((text) =>
			text
				.setPlaceholder("Optional unit")
				.setValue(this.unit)
				.onChange((value) => {
					this.unit = value;
				}),
		);

		new Setting(contentEl)
			.setName("Category")
			.setDesc("Optional. Leave blank to auto-detect.")
			.addText((text) =>
				text
					.setPlaceholder("Produce")
					.setValue(this.category)
					.onChange((value) => {
						this.category = value;
					}),
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText(editing ? "Save" : "Add")
					.setCta()
					.onClick(() => {
						void this.submit();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		let name = this.name.trim();
		let quantity: number | null = parseQuantityField(this.quantityText);
		let unit = this.unit.trim();

		if (!this.existing && this.quickEntry.trim()) {
			const parsed = parseOneOffEntry(this.quickEntry);
			if (!parsed) {
				new Notice("Could not parse that entry.");
				return;
			}
			name = parsed.name;
			quantity = parsed.quantity;
			unit = parsed.unit;
		}

		if (!name) {
			new Notice("Please enter an item name.");
			return;
		}

		const category = this.category.trim() || null;

		if (this.existing) {
			await this.manager.updateOneOff(this.existing.id, {
				name,
				quantity,
				unit,
				category,
			});
		} else {
			await this.manager.addOneOff({
				name,
				quantity,
				unit,
				category,
			});
		}
		this.close();
	}
}

function parseQuantityField(input: string): number | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}
