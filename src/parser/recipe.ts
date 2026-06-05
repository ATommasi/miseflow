import { App, CachedMetadata, TFile } from "obsidian";
import { MiseFlowSettings, RECIPE_FRONTMATTER } from "../settings";
import { listMarkdownFilesInRecipeFolders } from "../utils/vault-files";
import { IngredientGroup, InstructionGroup, RecipeIngredient } from "../types";
import { hasIgnoreTag, parseIngredientLine } from "./ingredient";

/** Returns true if the file lives inside one of the configured folders (or all are empty). */
export function fileInRecipeFolders(file: TFile, folders: string[]): boolean {
	if (folders.length === 0) return true;
	return folders.some((folder) => {
		const f = folder.replace(/\/+$/, "");
		if (!f) return true;
		return file.path === f || file.path.startsWith(`${f}/`);
	});
}

/**
 * Reads the boolean selection flag from a recipe's frontmatter.
 * Accepts true/"true"/"yes"/1 as truthy.
 */
export function isRecipeSelected(
	cache: CachedMetadata | null,
	property: string,
): boolean {
	const fm = cache?.frontmatter as Record<string, unknown> | undefined;
	if (!fm) return false;
	const value: unknown = fm[property];
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		return v === "true" || v === "yes" || v === "1";
	}
	return false;
}


/**
 * Extract ingredient lines from a recipe file's body.
 *
 * Looks for the first heading whose plain text matches `ingredientsHeading`
 * (case-insensitive). Ingredients are list items appearing between that
 * heading and the next heading of equal or higher level.
 *
 * If no matching heading is found, every list item in the document is
 * treated as an ingredient (useful for very short recipes).
 */
export function extractIngredientLines(
	body: string,
	headingName: string,
): string[] {
	const lines = body.split(/\r?\n/);
	const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
	const target = headingName.trim().toLowerCase();

	let startIndex = -1;
	let startLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const match = line.match(headingPattern);
		if (!match) continue;
		const level = (match[1] ?? "").length;
		const title = (match[2] ?? "").trim().toLowerCase();
		if (title === target) {
			startIndex = i + 1;
			startLevel = level;
			break;
		}
	}

	const collected: string[] = [];
	if (startIndex === -1) {
		// Fallback: collect every list item in the file.
		for (const line of lines) {
			if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
				collected.push(line);
			}
		}
		return collected;
	}

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const heading = line.match(headingPattern);
		if (heading && (heading[1] ?? "").length <= startLevel) break;
		if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
			collected.push(line);
		}
	}
	return collected;
}

/**
 * Read a recipe file from disk, extract its ingredients section, and
 * parse each entry into a RecipeIngredient.
 *
 * Quantities are scaled by the recipe's `multiplier` frontmatter value
 * (default 1) so the grocery list reflects the desired portion size.
 */
export async function parseRecipeFile(
	app: App,
	file: TFile,
	settings: MiseFlowSettings,
): Promise<RecipeIngredient[]> {
	const contents = await app.vault.cachedRead(file);
	const body = stripFrontmatter(contents);
	const rawLines = extractIngredientLines(body, settings.ingredientsHeading);

	const cache = app.metadataCache.getFileCache(file);
	const multiplier = readRecipeMultiplier(cache);

	const result: RecipeIngredient[] = [];
	for (const raw of rawLines) {
		const parsed = parseIngredientLine(raw);
		if (!parsed) continue;
		if (hasIgnoreTag(parsed.tags)) continue;
		result.push({
			...parsed,
			quantity:
				parsed.quantity === null ? null : parsed.quantity * multiplier,
			sourcePath: file.path,
			sourceName: file.basename,
		});
	}
	return result;
}

/**
 * Read the `multiplier` frontmatter value as a positive number.
 * Returns 1 when missing, zero, negative, or unparseable.
 */
export function readRecipeMultiplier(cache: CachedMetadata | null): number {
	const fm = cache?.frontmatter as Record<string, unknown> | undefined;
	if (!fm) return 1;
	const raw: unknown = fm[RECIPE_FRONTMATTER.multiplier];
	if (raw === undefined || raw === null) return 1;
	const num = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(num) || num <= 0) return 1;
	return num;
}

/** Strip a leading YAML frontmatter block, if present. */
export function stripFrontmatter(contents: string): string {
	if (!contents.startsWith("---")) return contents;
	const end = contents.indexOf("\n---", 3);
	if (end === -1) return contents;
	const after = contents.indexOf("\n", end + 4);
	if (after === -1) return "";
	return contents.slice(after + 1);
}

/**
 * Strip a leading H1 that duplicates the note title, and/or inline images
 * that duplicate the frontmatter hero image, from the recipe body.
 */
export function stripRedundantBodyContent(
	body: string,
	opts: {
		title: string | null;
		imageValue: string | null;
		stripTitle: boolean;
		stripImage: boolean;
	},
): string {
	let result = body;

	if (opts.stripTitle && opts.title) {
		const normalised = opts.title.trim().toLowerCase();
		const firstH1Match = result.match(/^[ \t]*#[ \t]+(.+)$/m);
		if (firstH1Match && firstH1Match[1]?.trim().toLowerCase() === normalised) {
			result = result.replace(firstH1Match[0], "");
		}
	}

	if (opts.stripImage && opts.imageValue) {
		const target = extractImageTarget(opts.imageValue);
		if (target) {
			const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			// ![[path]], ![[path|alias]], ![[path#anchor]]
			result = result.replace(
				new RegExp(`!\\[\\[${escaped}(?:[#|][^\\]]*)?\\]\\]`, "gi"),
				"",
			);
			// ![alt](path) or ![alt](path "title")
			result = result.replace(
				new RegExp(`!\\[[^\\]]*\\]\\(${escaped}(?:\\s+"[^"]*")?\\)`, "gi"),
				"",
			);
		}
	}

	// Collapse runs of blank lines introduced by removal.
	return result.replace(/\n{3,}/g, "\n\n").trimStart();
}

function extractImageTarget(value: string): string {
	const trimmed = value.trim();
	// Wikilink: [[path]] or ![[path]] with optional alias/anchor
	const wikilink = trimmed.match(/^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
	return wikilink ? (wikilink[1] ?? trimmed).trim() : trimmed;
}

/**
 * Split a recipe body into the markdown that comes before the
 * ingredients section, grouped ingredient lines, and the markdown that
 * comes after. Subheadings within the ingredients section (e.g.
 * "For the Bolognese Sauce") become group headings.
 *
 * If no ingredients heading is found, the entire body is returned in
 * `before` so the recipe view can render it as-is and the multiplier
 * controls still appear (just without scaled quantities).
 */
export function splitBodyAroundIngredients(
	body: string,
	headingName: string,
): { before: string; ingredientGroups: IngredientGroup[]; after: string } {
	const lines = body.split(/\r?\n/);
	const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
	const target = headingName.trim().toLowerCase();

	let headingIndex = -1;
	let headingLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const match = (lines[i] ?? "").match(headingPattern);
		if (!match) continue;
		const level = (match[1] ?? "").length;
		const title = (match[2] ?? "").trim().toLowerCase();
		if (title === target) {
			headingIndex = i;
			headingLevel = level;
			break;
		}
	}

	if (headingIndex === -1) {
		return { before: body, ingredientGroups: [], after: "" };
	}

	const groups: IngredientGroup[] = [];
	let current: IngredientGroup = { heading: null, lines: [] };
	let endIndex = lines.length;

	for (let i = headingIndex + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const heading = line.match(headingPattern);

		if (heading && (heading[1] ?? "").length <= headingLevel) {
			endIndex = i;
			break;
		}

		if (heading) {
			if (current.heading !== null || current.lines.length > 0) {
				groups.push(current);
			}
			current = { heading: (heading[2] ?? "").trim(), lines: [] };
		} else if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
			current.lines.push(line);
		}
	}

	if (current.heading !== null || current.lines.length > 0) {
		groups.push(current);
	}

	const before = lines.slice(0, headingIndex).join("\n").trimEnd();
	const after = lines.slice(endIndex).join("\n").trim();
	return { before, ingredientGroups: groups, after };
}

/**
 * Split an arbitrary block of markdown into the part before the
 * instructions heading, groups of steps (each with an optional
 * subheading and its own numbering), and the part after the
 * instructions section.
 *
 * Subheadings within the instructions section become group headings;
 * step counters reset to 1 for each group. Returns `groups: []` when
 * no heading or no list items are found, and the original input in
 * `before`.
 *
 * Each step string is the raw markdown of that step's body, with any
 * leading list marker removed. Continuation lines (everything between
 * one list marker and the next) are kept so that multi-line steps and
 * sub-bullets render correctly.
 */
export function splitBodyAroundInstructions(
	body: string,
	headingName: string,
): { before: string; groups: InstructionGroup[]; after: string } {
	const lines = body.split(/\r?\n/);
	const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
	const target = headingName.trim().toLowerCase();

	let headingIndex = -1;
	let headingLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const match = (lines[i] ?? "").match(headingPattern);
		if (!match) continue;
		const level = (match[1] ?? "").length;
		const title = (match[2] ?? "").trim().toLowerCase();
		if (title === target) {
			headingIndex = i;
			headingLevel = level;
			break;
		}
	}

	if (headingIndex === -1) {
		return { before: body, groups: [], after: "" };
	}

	let endIndex = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		const heading = (lines[i] ?? "").match(headingPattern);
		if (heading && (heading[1] ?? "").length <= headingLevel) {
			endIndex = i;
			break;
		}
	}

	const sectionLines = lines.slice(headingIndex + 1, endIndex);
	const groups = parseInstructionGroups(sectionLines, headingLevel);

	const before = lines.slice(0, headingIndex).join("\n").trimEnd();
	const after = lines.slice(endIndex).join("\n").trim();
	return { before, groups, after };
}

function parseInstructionGroups(
	sectionLines: string[],
	baseLevel: number,
): InstructionGroup[] {
	const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

	// Segment lines into chunks separated by subheadings.
	type Segment = {
		heading: string | null;
		headingLevel: number;
		lines: string[];
	};
	const segments: Segment[] = [];
	let current: Segment = {
		heading: null,
		headingLevel: 0,
		lines: [],
	};

	for (const line of sectionLines) {
		const headingMatch = line.match(headingPattern);
		if (headingMatch) {
			const level = (headingMatch[1] ?? "").length;
			if (level > baseLevel) {
				if (current.heading !== null || current.lines.length > 0) {
					segments.push(current);
				}
				current = {
					heading: (headingMatch[2] ?? "").trim(),
					headingLevel: level,
					lines: [],
				};
				continue;
			}
		}
		current.lines.push(line);
	}
	if (current.heading !== null || current.lines.length > 0) {
		segments.push(current);
	}

	return segments
		.map((seg) => ({
			heading: seg.heading,
			headingLevel: seg.headingLevel,
			steps: parseStepsFromLines(seg.lines),
		}))
		.filter((g) => g.heading !== null || g.steps.length > 0);
}

function parseStepsFromLines(lines: string[]): string[] {
	const orderedRe = /^\s*\d+\.\s+(.*)$/;
	const unorderedRe = /^\s*[-*+]\s+(.*)$/;

	const startsForPattern = (
		re: RegExp,
	): { idx: number; first: string }[] => {
		const out: { idx: number; first: string }[] = [];
		for (let i = 0; i < lines.length; i++) {
			const m = (lines[i] ?? "").match(re);
			if (m) out.push({ idx: i, first: m[1] ?? "" });
		}
		return out;
	};

	let starts = startsForPattern(orderedRe);
	if (starts.length === 0) {
		starts = startsForPattern(unorderedRe);
	}
	if (starts.length === 0) return [];

	const steps: string[] = [];
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i]!;
		const next = starts[i + 1]?.idx ?? lines.length;
		const parts = [start.first];
		for (let j = start.idx + 1; j < next; j++) {
			parts.push(lines[j] ?? "");
		}
		// Strip trailing horizontal rules that are decorative section dividers.
		const text = parts
			.join("\n")
			.replace(/(\n\s*---+\s*)+$/, "")
			.trim();
		if (text) steps.push(text);
	}
	return steps;
}
