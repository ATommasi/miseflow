import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { fetchHtml } from "../importer/fetcher";
import { extractRecipe } from "../importer/schema-extractor";
import { buildRecipeNote, titleToFilename } from "../importer/note-builder";
import { MiseFlowSettings } from "../settings";
import { ConfirmModal } from "./confirm-modal";
import { VIEW_TYPE_RECIPE } from "./recipe-view";

export interface ImportRecipeHost {
	getSettings(): MiseFlowSettings;
	saveSettings(): Promise<void>;
}

/**
 * Modal that imports a recipe from a URL into the vault.
 *
 * 1. User enters a URL.
 * 2. MiseFlow fetches the HTML, extracts recipe schema, renders the template.
 * 3. Writes the note to the configured import folder (or first recipe folder).
 */
export class ImportRecipeModal extends Modal {
	private url = "";
	private folder = "";

	constructor(
		app: App,
		private readonly host: ImportRecipeHost,
	) {
		super(app);
		this.folder = this.defaultFolder();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText("Import recipe from URL");

		new Setting(contentEl)
			.setName("Recipe URL")
			.setDesc("Paste the URL of the recipe page.")
			.addText((text) =>
				text
					.setPlaceholder("https://www.example.com/recipes/...")
					.onChange((v) => {
						this.url = v.trim();
					}),
			);

		new Setting(contentEl)
			.setName("Save to folder")
			.setDesc("Vault-relative folder path for the new note.")
			.addText((text) =>
				text
					.setPlaceholder("Recipes")
					.setValue(this.folder)
					.onChange((v) => {
						this.folder = v.trim();
					}),
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Import")
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
		if (!this.url) {
			new Notice("Please enter a URL.");
			return;
		}

		new Notice("Fetching recipe…");

		const html = await fetchHtml(this.url);
		if (!html) {
			new Notice("Could not fetch that URL. Check the address and try again.");
			return;
		}

		const recipe = await extractRecipe(html, this.url);
		if (!recipe || !recipe.title) {
			new Notice(
				"No recipe data found on that page. The site may require a login or render via JavaScript.",
			);
			return;
		}

		const settings = this.host.getSettings();
		const content = await buildRecipeNote(this.app, recipe, settings);
		const filename = titleToFilename(recipe.title) + ".md";
		const folder = this.folder || this.defaultFolder();
		const notePath = folder ? `${folder}/${filename}` : filename;

		const existing = this.app.vault.getAbstractFileByPath(notePath);
		if (existing instanceof TFile) {
			new ConfirmModal(this.app, {
				title: "Note already exists",
				message: `"${filename}" already exists. Overwrite it?`,
				confirmText: "Overwrite",
				destructive: true,
				onConfirm: () => void this.writeNote(notePath, content, true),
			}).open();
			return;
		}

		await this.writeNote(notePath, content, false);
	}

	private async writeNote(
		notePath: string,
		content: string,
		overwrite: boolean,
	): Promise<void> {
		try {
			await ensureFolder(this.app, notePath);

			if (overwrite) {
				const file = this.app.vault.getAbstractFileByPath(notePath);
				if (file instanceof TFile) {
					await this.app.vault.modify(file, content);
				}
			} else {
				await this.app.vault.create(notePath, content);
			}

			this.close();
			new Notice(`Recipe imported: ${notePath.split("/").pop()}`);

			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (file instanceof TFile) {
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.setViewState({
					type: VIEW_TYPE_RECIPE,
					state: { file: file.path },
					active: true,
				});
				void this.app.workspace.revealLeaf(leaf);
			}
		} catch (err) {
			new Notice(`Import failed: ${String(err)}`);
		}
	}

	private defaultFolder(): string {
		const settings = this.host.getSettings();
		if (settings.importFolder) return settings.importFolder;
		return settings.recipeFolders[0] ?? "";
	}
}

async function ensureFolder(app: App, filePath: string): Promise<void> {
	const parts = filePath.split("/");
	parts.pop();
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}
