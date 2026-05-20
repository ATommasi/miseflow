import { App, TFile, TFolder } from "obsidian";
import { PantrySettings } from "../settings";

/** Collect markdown files under a folder without calling vault.getMarkdownFiles(). */
export function collectMarkdownFiles(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === "md") {
			files.push(child);
		} else if (child instanceof TFolder) {
			files.push(...collectMarkdownFiles(child));
		}
	}
	return files;
}

/**
 * Markdown files under the user's configured recipe folders, or the
 * entire vault root when no folders are configured.
 */
export function listMarkdownFilesInRecipeFolders(
	app: App,
	settings: PantrySettings,
): TFile[] {
	const folders = settings.recipeFolders
		.map((f) => f.replace(/\/+$/, "").trim())
		.filter(Boolean);

	if (folders.length === 0) {
		return collectMarkdownFiles(app.vault.getRoot());
	}

	const seen = new Set<string>();
	const out: TFile[] = [];
	for (const folderPath of folders) {
		const folder = app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) continue;
		for (const file of collectMarkdownFiles(folder)) {
			if (seen.has(file.path)) continue;
			seen.add(file.path);
			out.push(file);
		}
	}
	return out;
}
