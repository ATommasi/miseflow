import { App, moment, TFile } from "obsidian";
import { MiseFlowSettings } from "../settings";
import { ImportedRecipe, RecipeGroup } from "./schema-extractor";

const DEFAULT_TEMPLATE = `---
type: {{recipeType}}
image: {{image}}
source: {{url}}
servings: {{servings}}
prepTime: {{prepTime}}
cookTime: {{cookTime}}
totalTime: {{totalTime}}
{{caloriesProperty}}: {{calories}}
{{proteinProperty}}: {{protein}}
{{fatProperty}}: {{fat}}
{{carbsProperty}}: {{carbs}}
{{allergensProperty}}:
---

{{description}}

## {{ingredientsHeading}}

{{ingredients}}

## {{instructionsHeading}}

{{instructions}}
`;

/**
 * Build the markdown content for an imported recipe note.
 *
 * If `settings.importTemplatePath` is set, reads that vault note as the
 * template. Falls back to the built-in default template.
 *
 * Tokens use `{{name}}` syntax, consistent with the rest of MiseFlow.
 */
export async function buildRecipeNote(
	app: App,
	recipe: ImportedRecipe,
	settings: MiseFlowSettings,
): Promise<string> {
	const templateText = await loadTemplate(app, settings.importTemplatePath ?? "");
	return renderTemplate(templateText, recipe, settings);
}

async function loadTemplate(app: App, templatePath: string): Promise<string> {
	const trimmed = templatePath.trim();
	if (!trimmed) return DEFAULT_TEMPLATE;

	const file = app.vault.getAbstractFileByPath(trimmed);
	if (file instanceof TFile) {
		return await app.vault.read(file);
	}
	return DEFAULT_TEMPLATE;
}

function renderTemplate(
	template: string,
	recipe: ImportedRecipe,
	settings: MiseFlowSettings,
): string {
	const tokens: Record<string, string> = {
		title: recipe.title,
		description: recipe.description,
		image: recipe.image,
		url: recipe.url,
		servings: recipe.servings,
		prepTime: recipe.prepTime !== null ? String(recipe.prepTime) : "",
		cookTime: recipe.cookTime !== null ? String(recipe.cookTime) : "",
		totalTime: recipe.totalTime !== null ? String(recipe.totalTime) : "",
		// Sites always publish nutrition per serving. If the user stores recipe
		// totals in frontmatter, multiply up by the parsed serving count.
		...nutritionTokens(recipe, settings),
		ingredients: flattenIngredients(
			recipe.ingredientGroups,
			groupHeadingPrefix(template, "ingredients"),
		),
		instructions: flattenInstructions(
			recipe.instructionGroups,
			groupHeadingPrefix(template, "instructions"),
		),
		date: moment().format("YYYY-MM-DD"),
		// Settings-derived tokens
		recipeType: settings.recipeTypeValue,
		allergensProperty: settings.allergensProperty,
		caloriesProperty: settings.caloriesProperty,
		proteinProperty: settings.proteinProperty,
		fatProperty: settings.fatProperty,
		carbsProperty: settings.carbsProperty,
		ingredientsHeading: settings.ingredientsHeading,
		instructionsHeading: settings.instructionsHeading,
	};

	return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key] ?? "");
}

/**
 * Scan the template for the heading immediately above {{token}} and return
 * a heading prefix one level deeper. E.g. `## Ingredients` → `###`.
 * Defaults to `###` if no heading is found.
 */
function groupHeadingPrefix(template: string, token: string): string {
	const lines = template.split("\n");
	const tokenIdx = lines.findIndex((l) => l.includes(`{{${token}}}`));
	if (tokenIdx !== -1) {
		for (let i = tokenIdx - 1; i >= 0; i--) {
			const match = lines[i]?.match(/^(#{1,6})\s/);
			if (match) {
				const deeper = Math.min((match[1]?.length ?? 2) + 1, 6);
				return "#".repeat(deeper);
			}
		}
	}
	return "###";
}

function flattenIngredients(groups: RecipeGroup[], headingPrefix: string): string {
	return groups
		.flatMap((group) => [
			...(group.name ? [`${headingPrefix} ${group.name}`] : []),
			...group.items.map((i) => `- ${i}`),
		])
		.join("\n");
}

function flattenInstructions(groups: RecipeGroup[], headingPrefix: string): string {
	let stepNum = 0;
	return groups
		.flatMap((group) => [
			...(group.name ? [`${headingPrefix} ${group.name}`] : []),
			...group.items.map((step) => `${++stepNum}. ${step}`),
		])
		.join("\n");
}

/**
 * Resolve nutrition token values, scaling from per-serving (as sites report)
 * to recipe total if the user's nutritionSource setting requires it.
 */
function nutritionTokens(
	recipe: ImportedRecipe,
	settings: MiseFlowSettings,
): Record<string, string> {
	const fields = {
		calories: recipe.calories,
		protein: recipe.protein,
		fat: recipe.fat,
		carbs: recipe.carbs,
	};

	// If storing totals, multiply each value by the serving count.
	// If we can't parse a serving count, leave values as-is (per serving)
	// since that's still a reasonable default.
	if (settings.nutritionSource === "recipe-total") {
		const servingCount = parseServingCount(recipe.servings);
		if (servingCount !== null && servingCount > 0) {
			return Object.fromEntries(
				Object.entries(fields).map(([k, v]) => [
					k,
					v !== null ? String(Math.round(v * servingCount)) : "",
				]),
			);
		}
	}

	return Object.fromEntries(
		Object.entries(fields).map(([k, v]) => [k, v !== null ? String(v) : ""]),
	);
}

/** Parse the leading integer from a yields string like "4 servings" or "6-8". */
function parseServingCount(yields: string): number | null {
	const match = yields.match(/(\d+)/);
	if (!match) return null;
	const n = parseInt(match[1] ?? "", 10);
	return Number.isFinite(n) ? n : null;
}

/** Derive a safe filename from the recipe title. */
export function titleToFilename(title: string): string {
	return (
		title
			.trim()
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.trim() || "Imported Recipe"
	);
}
