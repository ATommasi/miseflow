import {
	App,
	Modal,
	Notice,
	Setting,
	TFile,
	normalizePath,
} from "obsidian";
import {
	ExportFormat,
	exportFormatLabel,
	exportGroceryList,
} from "../grocery/export";
import { GroceryListManager } from "../grocery/manager";
import { MiseFlowSettings } from "../settings";

interface ExportModalDeps {
	getSettings: () => MiseFlowSettings;
	manager: GroceryListManager;
}

/**
 * Lets the user copy the current grocery list manually or append it
 * to an existing note. The preview updates live so they can switch
 * formats without reopening the modal.
 */
export class ExportListModal extends Modal {
	private format: ExportFormat = "checklist";
	private includeChecked = true;
	private targetPath = "";
	private previewEl!: HTMLTextAreaElement;

	constructor(
		app: App,
		private readonly deps: ExportModalDeps,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("mise-export-modal");
		this.titleEl.setText("Export grocery list");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName("Format")
			.addDropdown((dd) => {
				dd.addOption("plain", exportFormatLabel("plain"));
				dd.addOption("checklist", exportFormatLabel("checklist"));
				dd.addOption("grouped", exportFormatLabel("grouped"));
				dd.setValue(this.format);
				dd.onChange((value) => {
					this.format = value as ExportFormat;
					this.refreshPreview();
				});
			});

		new Setting(contentEl)
			.setName("Include checked items")
			.setDesc(
				"When off, items already crossed off are omitted from the export.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.includeChecked).onChange((value) => {
					this.includeChecked = value;
					this.refreshPreview();
				}),
			);

		contentEl.createEl("p", {
			cls: "mise-export-hint",
			text: "Select the text below and copy with your system shortcut, or append it to a note.",
		});

		this.previewEl = contentEl.createEl("textarea", {
			cls: "mise-export-preview",
		});
		this.previewEl.readOnly = true;
		this.previewEl.rows = 10;
		this.refreshPreview();

		new Setting(contentEl)
			.setName("Append to note")
			.setDesc("Vault-relative path. Leave blank to copy from the preview only.")
			.addText((text) =>
				text
					.setPlaceholder("Shopping/2026-04-24.md")
					.setValue(this.targetPath)
					.onChange((value) => {
						this.targetPath = value;
					}),
			);

		const footer = contentEl.createDiv({ cls: "mise-export-footer" });

		const appendBtn = footer.createEl("button", {
			cls: "mod-cta",
			text: "Append to note",
			attr: { type: "button" },
		});
		appendBtn.addEventListener("click", () => {
			void this.appendToNote();
		});

		footer.createEl("button", { text: "Close", attr: { type: "button" } }).addEventListener("click", () => {
			this.close();
		});
	}

	private buildContent(): string {
		const items = this.deps.manager.getItems();
		return exportGroceryList(
			items,
			this.deps.getSettings(),
			this.format,
			{ includeChecked: this.includeChecked },
		);
	}

	private refreshPreview(): void {
		const content = this.buildContent();
		this.previewEl.value = content || "(grocery list is empty)";
	}

	private async appendToNote(): Promise<void> {
		const raw = this.targetPath.trim();
		if (!raw) {
			new Notice("Enter a note path to append to.");
			return;
		}
		const content = this.buildContent();
		if (!content) {
			new Notice("Nothing to export - the list is empty.");
			return;
		}
		const path = normalizePath(
			raw.toLowerCase().endsWith(".md") ? raw : `${raw}.md`,
		);
		try {
			let file = this.app.vault.getAbstractFileByPath(path);
			if (!file) {
				file = await this.app.vault.create(path, "");
			}
			if (!(file instanceof TFile)) {
				new Notice("Target path is not a Markdown file.");
				return;
			}
			// Use vault.process so the read-and-append happens atomically
			// against any concurrent writes to the same note.
			await this.app.vault.process(file, (existing) => {
				const sep = existing && !existing.endsWith("\n\n") ? "\n\n" : "";
				return `${existing}${sep}${content}\n`;
			});
			new Notice(`Appended to ${file.path}.`);
			this.close();
		} catch (err) {
			console.error("miseflow: append failed", err);
			new Notice("Couldn't append to note.");
		}
	}
}
