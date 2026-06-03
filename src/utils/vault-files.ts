import { App, TFile, TFolder } from "obsidian";
import { MiseFlowSettings } from "../settings";

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
	settings: MiseFlowSettings,
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

/**
 * Normalizes a recipe type token by trimming whitespace, converting to
 * lowercase, and handling Obsidian link syntax ([[Target File|Alias]]).
 */
export function normalizeRecipeTypeToken(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";

	if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
		const inner = trimmed.slice(2, -2).trim();
		const pipeIndex = inner.indexOf("|");
		const hashIndex = inner.indexOf("#");
		let cutoff = inner.length;
		if (pipeIndex >= 0) cutoff = Math.min(cutoff, pipeIndex);
		if (hashIndex >= 0) cutoff = Math.min(cutoff, hashIndex);
		return inner.slice(0, cutoff).trim().toLowerCase();
	}

	return trimmed.toLowerCase();
}

/**
 * Returns true if a frontmatter type value (string or string array) matches
 * the normalised target token.
 */
export function frontmatterTypeMatches(value: unknown, target: string): boolean {
	if (typeof value === "string") {
		return normalizeRecipeTypeToken(value) === target;
	}

	if (Array.isArray(value)) {
		return value.some((item) => {
			if (typeof item !== "string") return false;
			return normalizeRecipeTypeToken(item) === target;
		});
	}

	return false;
}
