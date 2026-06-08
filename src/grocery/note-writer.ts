import { App, TFile } from "obsidian";
import { categorize } from "./categorizer";
import { ingredientKey, normaliseName, parseIngredientLine } from "../parser/ingredient";
import { formatQuantity } from "../parser/quantity";
import { MiseFlowSettings } from "../settings";
import { MealPlanEntry } from "../types";
import { resolveNotePath } from "../utils/paths";

// ---------------------------------------------------------------------------
// Day ordering
// ---------------------------------------------------------------------------

const DAY_ORDER = [
	"unscheduled",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

function dayRank(day: string | undefined): number {
	if (!day) return 0; // Unscheduled
	const idx = DAY_ORDER.indexOf(day.toLowerCase());
	return idx === -1 ? DAY_ORDER.length : idx;
}

// ---------------------------------------------------------------------------
// Meal plan note
// ---------------------------------------------------------------------------

/** Parsed representation of a line in the meal plan note. */
export interface MealPlanLine {
	/** The `[[wikilink]]` target (the inner text, no brackets). */
	wikilink: string;
	day: string | undefined;
	mealType: string | undefined;
	checked: boolean;
	/** Original raw line text (preserved for non-recipe lines). */
	raw: string;
}

const RECIPE_LINE_RE =
	/^(\s*-\s+\[([x ])\]\s+)\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\](?:\s+—\s+(.+))?$/i;

/**
 * Parse a meal plan note body into day sections.
 * Returns an ordered array of [dayHeader, lines[]] pairs where dayHeader is the
 * raw `## Day` text (or `## Unscheduled` for the implicit first section) and
 * lines is a mix of recipe lines and opaque non-recipe lines.
 */
export function parseMealPlanNote(
	body: string,
): Array<{ header: string; lines: MealPlanLine[] }> {
	const rawLines = body.split(/\r?\n/);
	const sections: Array<{ header: string; lines: MealPlanLine[] }> = [];
	let current: { header: string; lines: MealPlanLine[] } | null = null;

	for (const raw of rawLines) {
		const h2 = raw.match(/^##\s+(.+)$/);
		if (h2) {
			if (current) sections.push(current);
			current = { header: (h2[1] ?? "").trim(), lines: [] };
			continue;
		}

		if (!current) {
			current = { header: "Unscheduled", lines: [] };
		}

		const m = raw.match(RECIPE_LINE_RE);
		if (m) {
			const checked = (m[2] ?? " ") === "x";
			const wikilink = (m[3] ?? "").trim();
			const after = (m[4] ?? "").trim();
			// `after` may be "Dinner" or "Breakfast — some other thing" but we
			// treat the whole string after the em-dash as the mealType for now.
			current.lines.push({
				wikilink,
				day: current.header === "Unscheduled" ? undefined : current.header,
				mealType: after || undefined,
				checked,
				raw,
			});
		} else {
			current.lines.push({
				wikilink: "",
				day: current.header === "Unscheduled" ? undefined : current.header,
				mealType: undefined,
				checked: false,
				raw,
			});
		}
	}
	if (current) sections.push(current);
	return sections;
}

/** Render a single meal plan list line. */
function renderMealPlanLine(entry: MealPlanEntry, recipeName: string): string {
	const check = "- [ ] ";
	const link = `[[${recipeName}]]`;
	const suffix = entry.mealType ? ` — ${entry.mealType}` : "";
	return `${check}${link}${suffix}`;
}

/**
 * Surgically insert a new entry line into the meal plan note under the
 * correct day section, creating the section if needed. Returns the updated
 * note text.
 */
export function insertMealPlanEntryIntoText(
	noteText: string,
	entry: MealPlanEntry,
	recipeName: string,
): string {
	const targetHeader = entry.day ?? "Unscheduled";
	const newLine = renderMealPlanLine(entry, recipeName);
	const lines = noteText.split(/\r?\n/);

	// Find the target section header line.
	const headerPattern = new RegExp(
		`^##\\s+${escapeRegExp(targetHeader)}\\s*$`,
		"i",
	);
	const headerIdx = lines.findIndex((l) => headerPattern.test(l));

	if (headerIdx !== -1) {
		// Find the end of this section (next ## heading or EOF).
		let insertIdx = lines.length;
		for (let i = headerIdx + 1; i < lines.length; i++) {
			if (/^##\s/.test(lines[i] ?? "")) {
				insertIdx = i;
				break;
			}
		}
		// Insert before any trailing blank lines at the end of the section.
		while (insertIdx > headerIdx + 1 && (lines[insertIdx - 1] ?? "").trim() === "") {
			insertIdx--;
		}
		lines.splice(insertIdx, 0, newLine);
		return lines.join("\n");
	}

	// Section doesn't exist — create it in the right place.
	const targetRank = dayRank(targetHeader === "Unscheduled" ? undefined : targetHeader);
	let insertSectionIdx = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const h2 = (lines[i] ?? "").match(/^##\s+(.+)$/);
		if (!h2) continue;
		const existingHeader = (h2[1] ?? "").trim();
		const existingRank = dayRank(
			existingHeader.toLowerCase() === "unscheduled" ? undefined : existingHeader,
		);
		if (existingRank > targetRank) {
			insertSectionIdx = i;
			break;
		}
	}

	const newSection = [`## ${targetHeader}`, newLine, ""];
	lines.splice(insertSectionIdx, 0, ...newSection);
	return lines.join("\n");
}

/**
 * Write (or create) the meal plan note from the full entries array.
 * Preserves non-recipe lines (prose, custom notes) within each section.
 */
export async function writeMealPlanNote(
	app: App,
	entries: MealPlanEntry[],
	settings: MiseFlowSettings,
): Promise<void> {
	const path = resolveNotePath(settings.mealPlanNotePath.trim() || "Meal Plan.md");

	// Build a lookup of recipeName → entry for the new set.
	const entryByName = new Map<string, MealPlanEntry>();
	for (const entry of entries) {
		const file = app.vault.getAbstractFileByPath(entry.recipePath);
		const name = file instanceof TFile ? file.basename : entry.recipePath;
		entryByName.set(name.toLowerCase(), entry);
	}

	// Read existing note and preserve non-recipe lines.
	const existingText = await readNoteOrEmpty(app, path);
	const sections = parseMealPlanNote(existingText);

	// Group new entries by day.
	const byDay = new Map<string, MealPlanEntry[]>();
	for (const entry of entries) {
		const key = entry.day ?? "Unscheduled";
		const arr = byDay.get(key);
		if (arr) arr.push(entry);
		else byDay.set(key, [entry]);
	}

	// Sort day keys.
	const allDays = [
		...new Set([
			...Array.from(byDay.keys()),
			...sections.map((s) => s.header),
		]),
	].sort((a, b) => {
		const ra = dayRank(a.toLowerCase() === "unscheduled" ? undefined : a);
		const rb = dayRank(b.toLowerCase() === "unscheduled" ? undefined : b);
		return ra - rb;
	});

	const outputLines: string[] = ["# Meal Plan", ""];

	for (const day of allDays) {
		const dayEntries = byDay.get(day) ?? [];
		// Preserve non-recipe lines from the existing section.
		const existingSection = sections.find(
			(s) => s.header.toLowerCase() === day.toLowerCase(),
		);
		const preservedLines = (existingSection?.lines ?? [])
			.filter((l) => l.wikilink === "" && l.raw.trim() !== "")
			.map((l) => l.raw);

		if (dayEntries.length === 0 && preservedLines.length === 0) continue;

		outputLines.push(`## ${day}`);
		for (const entry of dayEntries) {
			const file = app.vault.getAbstractFileByPath(entry.recipePath);
			const name = file instanceof TFile ? file.basename : entry.recipePath;
			outputLines.push(renderMealPlanLine(entry, name));
		}
		for (const l of preservedLines) {
			outputLines.push(l);
		}
		outputLines.push("");
	}

	await writeNote(app, path, outputLines.join("\n").trimEnd() + "\n");
}

/**
 * Insert a single new entry into the meal plan note without regenerating
 * the whole thing. Preferred when adding via UI.
 */
export async function insertMealPlanEntry(
	app: App,
	entry: MealPlanEntry,
	settings: MiseFlowSettings,
): Promise<void> {
	const path = resolveNotePath(settings.mealPlanNotePath.trim() || "Meal Plan.md");
	const file = app.vault.getAbstractFileByPath(entry.recipePath);
	const recipeName = file instanceof TFile ? file.basename : entry.recipePath;

	const existing = await readNoteOrEmpty(app, path);
	const updated = insertMealPlanEntryIntoText(existing || "# Meal Plan\n", entry, recipeName);
	await writeNote(app, path, updated);
}

/**
 * Remove a recipe from the meal plan note by wikilink name.
 */
export async function removeMealPlanEntry(
	app: App,
	recipePath: string,
	settings: MiseFlowSettings,
): Promise<void> {
	const path = resolveNotePath(settings.mealPlanNotePath.trim() || "Meal Plan.md");
	const file = app.vault.getAbstractFileByPath(recipePath);
	const recipeName = (file instanceof TFile ? file.basename : recipePath).toLowerCase();

	const existing = await readNoteOrEmpty(app, path);
	if (!existing) return;

	const lines = existing.split(/\r?\n/);
	const filtered = lines.filter((raw) => {
		const m = raw.match(RECIPE_LINE_RE);
		if (!m) return true;
		return (m[3] ?? "").trim().toLowerCase() !== recipeName;
	});
	await writeNote(app, path, filtered.join("\n"));
}

// ---------------------------------------------------------------------------
// Grocery list note
// ---------------------------------------------------------------------------

interface GroceryNoteLine {
	/** Parsed ingredient key (name|unit), or "" for non-ingredient lines. */
	key: string;
	name: string;
	unit: string;
	quantity: number | null;
	checked: boolean;
	/** Original raw line. */
	raw: string;
}

interface GroceryNoteSection {
	category: string;
	lines: GroceryNoteLine[];
}

/** Parse the grocery note into sections. */
function parseGroceryNoteText(
	text: string,
): GroceryNoteSection[] {
	const rawLines = text.split(/\r?\n/);
	const sections: GroceryNoteSection[] = [];
	let current: GroceryNoteSection | null = null;

	for (const raw of rawLines) {
		const h2 = raw.match(/^##\s+(.+)$/);
		if (h2) {
			if (current) sections.push(current);
			current = { category: (h2[1] ?? "").trim(), lines: [] };
			continue;
		}
		if (!current) continue; // skip lines before first heading

		const checkboxMatch = raw.match(/^\s*-\s+\[([x ])\]\s+(.+)$/i);
		if (checkboxMatch) {
			const checked = (checkboxMatch[1] ?? " ") === "x";
			const content = (checkboxMatch[2] ?? "").trim();
			const parsed = parseIngredientLine(content);
			if (parsed) {
				current.lines.push({
					key: ingredientKey(parsed.name, parsed.unit),
					name: parsed.name,
					unit: parsed.unit,
					quantity: parsed.quantity,
					checked,
					raw,
				});
				continue;
			}
		}
		current.lines.push({ key: "", name: "", unit: "", quantity: null, checked: false, raw });
	}
	if (current) sections.push(current);
	return sections;
}

/** Render a single grocery list item line. */
function renderGroceryLine(
	name: string,
	unit: string,
	quantity: number | null,
	checked: boolean,
): string {
	const check = checked ? "- [x] " : "- [ ] ";
	const qtyStr = formatQuantity(quantity);
	const parts = [qtyStr, unit].filter(Boolean).join(" ");
	const display = [parts, name].filter(Boolean).join(" ");
	return `${check}${display}`;
}

export interface GroceryContribution {
	name: string;
	unit: string;
	quantity: number | null;
}

/**
 * Merge new ingredient contributions into the grocery note text.
 * Finds existing lines by name+unit and sums quantities; inserts new lines
 * under the correct category section (creating the section if needed).
 */
export function mergeIntoGroceryText(
	noteText: string,
	contributions: Record<string, GroceryContribution>,
	settings: MiseFlowSettings,
): string {
	const sections = parseGroceryNoteText(noteText);
	const remaining = new Map(Object.entries(contributions));

	// Pass 1: update existing lines.
	for (const section of sections) {
		for (const line of section.lines) {
			if (!line.key || !remaining.has(line.key)) continue;
			const contrib = remaining.get(line.key)!;
			remaining.delete(line.key);
			const newQty =
				line.quantity !== null && contrib.quantity !== null
					? line.quantity + contrib.quantity
					: line.quantity ?? contrib.quantity;
			line.quantity = newQty;
			line.raw = renderGroceryLine(line.name, line.unit, newQty, line.checked);
		}
	}

	// Pass 2: insert items that didn't match any existing line.
	for (const [, contrib] of remaining) {
		const category = categorize(
			contrib.name,
			[],
			settings.categoryOverrides,
			settings.categorySource,
		);
		let section = sections.find((s) => s.category === category);
		if (!section) {
			section = { category, lines: [] };
			sections.push(section);
		}
		section.lines.push({
			key: ingredientKey(contrib.name, contrib.unit),
			name: contrib.name,
			unit: contrib.unit,
			quantity: contrib.quantity,
			checked: false,
			raw: renderGroceryLine(contrib.name, contrib.unit, contrib.quantity, false),
		});
	}

	return renderGrocerySections(sections, settings);
}

/**
 * Subtract ingredient contributions from the grocery note text.
 * Reduces quantities; removes lines that would reach zero (or had null qty).
 */
export function removeFromGroceryText(
	noteText: string,
	contributions: Record<string, GroceryContribution>,
	settings: MiseFlowSettings,
): string {
	const sections = parseGroceryNoteText(noteText);
	const toRemove = new Map(Object.entries(contributions));

	for (const section of sections) {
		section.lines = section.lines.filter((line) => {
			if (!line.key || !toRemove.has(line.key)) return true;
			const contrib = toRemove.get(line.key)!;
			if (line.quantity === null || contrib.quantity === null) {
				// Can't subtract — remove the line.
				return false;
			}
			const newQty = line.quantity - contrib.quantity;
			if (newQty <= 0) return false;
			line.quantity = newQty;
			line.raw = renderGroceryLine(line.name, line.unit, newQty, line.checked);
			return true;
		});
	}

	return renderGrocerySections(sections, settings);
}

function renderGrocerySections(
	sections: GroceryNoteSection[],
	settings: MiseFlowSettings,
): string {
	// Sort sections: configured category order first, then alphabetically.
	const order = settings.categoryOrder ?? [];
	const orderMap = new Map(order.map((c, i) => [c, i]));
	const sorted = [...sections].sort((a, b) => {
		const ai = orderMap.get(a.category) ?? Number.MAX_SAFE_INTEGER;
		const bi = orderMap.get(b.category) ?? Number.MAX_SAFE_INTEGER;
		if (ai !== bi) return ai - bi;
		return a.category.localeCompare(b.category);
	});

	const outputLines: string[] = ["# Grocery List", ""];
	for (const section of sorted) {
		const contentLines = section.lines.filter((l) => l.raw.trim() !== "");
		if (contentLines.length === 0) continue;
		outputLines.push(`## ${section.category}`);
		for (const line of contentLines) {
			outputLines.push(line.raw);
		}
		outputLines.push("");
	}
	return outputLines.join("\n").trimEnd() + "\n";
}

/**
 * Add ingredients to the grocery list note. Creates the note if missing.
 */
export async function addToGroceryNote(
	app: App,
	contributions: Record<string, GroceryContribution>,
	settings: MiseFlowSettings,
): Promise<void> {
	if (Object.keys(contributions).length === 0) return;
	const path = resolveNotePath(settings.groceryListNotePath.trim() || "Grocery List.md");
	const existing = await readNoteOrEmpty(app, path);
	const updated = mergeIntoGroceryText(existing || "# Grocery List\n\n", contributions, settings);
	await writeNote(app, path, updated);
}

/**
 * Remove ingredients from the grocery list note, subtracting quantities.
 */
export async function removeFromGroceryNote(
	app: App,
	contributions: Record<string, GroceryContribution>,
	settings: MiseFlowSettings,
): Promise<void> {
	if (Object.keys(contributions).length === 0) return;
	const path = resolveNotePath(settings.groceryListNotePath.trim() || "Grocery List.md");
	const existing = await readNoteOrEmpty(app, path);
	if (!existing) return;
	const updated = removeFromGroceryText(existing, contributions, settings);
	await writeNote(app, path, updated);
}

/**
 * Parse the grocery note and return items as a flat map keyed by
 * ingredientKey, for use when rebuilding the in-memory item list.
 */
export async function readGroceryNoteItems(
	app: App,
	settings: MiseFlowSettings,
): Promise<Map<string, { name: string; unit: string; quantity: number | null; checked: boolean; category: string }>> {
	const path = resolveNotePath(settings.groceryListNotePath.trim() || "Grocery List.md");
	const text = await readNoteOrEmpty(app, path);
	if (!text) return new Map();

	const sections = parseGroceryNoteText(text);
	const result = new Map<string, { name: string; unit: string; quantity: number | null; checked: boolean; category: string }>();
	for (const section of sections) {
		for (const line of section.lines) {
			if (!line.key) continue;
			result.set(line.key, {
				name: line.name,
				unit: line.unit,
				quantity: line.quantity,
				checked: line.checked,
				category: section.category,
			});
		}
	}
	return result;
}

/**
 * Toggle the checked state of a single grocery note line in-place.
 * Finds the line whose parsed key matches and rewrites just that line.
 */
export async function toggleGroceryNoteItemChecked(
	app: App,
	key: string,
	checked: boolean,
	settings: MiseFlowSettings,
): Promise<void> {
	const path = resolveNotePath(settings.groceryListNotePath.trim() || "Grocery List.md");
	const text = await readNoteOrEmpty(app, path);
	if (!text) return;

	const lines = text.split(/\r?\n/);
	let found = false;
	const updated = lines.map((raw) => {
		if (found) return raw;
		const checkboxMatch = raw.match(/^(\s*-\s+\[)[x ](\]\s+.+)$/i);
		if (!checkboxMatch) return raw;
		const content = raw.replace(/^\s*-\s+\[[x ]\]\s+/i, "").trim();
		const parsed = parseIngredientLine(content);
		if (!parsed || ingredientKey(parsed.name, parsed.unit) !== key) return raw;
		found = true;
		return `${checkboxMatch[1]}${checked ? "x" : " "}${checkboxMatch[2]}`;
	});

	if (found) await writeNote(app, path, updated.join("\n"));
}

/**
 * Reset all checkboxes in the grocery note to unchecked.
 */
export async function resetGroceryNoteChecks(
	app: App,
	settings: MiseFlowSettings,
): Promise<void> {
	const path = resolveNotePath(settings.groceryListNotePath.trim() || "Grocery List.md");
	const text = await readNoteOrEmpty(app, path);
	if (!text) return;

	const updated = text.replace(/^(\s*-\s+\[)x(\]\s+)/gim, "$1 $2");
	await writeNote(app, path, updated);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readNoteOrEmpty(app: App, path: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		return await app.vault.read(file);
	}
	return "";
}

async function ensureParentFolders(app: App, filePath: string): Promise<void> {
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

async function writeNote(app: App, path: string, content: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		await ensureParentFolders(app, path);
		await app.vault.create(path, content);
	}
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return the TFile for a note at the given path, creating it with empty
 * content if it doesn't exist yet. Useful for opening notes from the UI.
 */
export async function getOrCreateNote(
	app: App,
	path: string,
	initialContent = "",
): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	await ensureParentFolders(app, path);
	return await app.vault.create(path, initialContent);
}

/** Exported for use in manager.ts when syncing from the note. */
export { normaliseName };
