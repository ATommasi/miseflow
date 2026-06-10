/**
 * High-glycemic-index ingredient detection.
 *
 * The shipped dictionary is a list of regex patterns matched against the
 * cleaned ingredient name. Patterns are case-insensitive. Users can
 * customise the list in Settings → Diabetic mode (only visible when the
 * mode is turned on). The dictionary is intentionally conservative —
 * widely-cited GI ≥ 70 foods only — so a false positive doesn't make
 * users tune out the warnings.
 *
 * GI values vary across studies, preparations, and cultivars, so this is
 * treated as guidance rather than fact; the final dictionary is in the
 * user's hands.
 */

import type { NameMatcher } from "./matcher";

/**
 * Default high-GI dictionary, shipped as a single string so users see
 * the same `#`-comment formatting they'll edit in settings. Stored here
 * (not in settings.ts) because settings.ts shouldn't carry domain knowledge.
 */
export const DEFAULT_GI_DICTIONARY = `# High glycemic index (GI ≥ 70) ingredients.
# One regex per line, case-insensitive. Lines starting with # are comments.
# Edit freely - your changes survive plugin updates.

# Refined grains
\\bwhite\\s+rice\\b
\\bjasmine\\s+rice\\b
\\bbasmati\\s+rice\\b
\\bsushi\\s+rice\\b
\\binstant\\s+rice\\b
\\bwhite\\s+bread\\b
\\bbaguette\\b
\\bbagels?\\b
\\b(saltine|soda)\\s+crackers?\\b
\\binstant\\s+oat(meal)?s?\\b
\\bcornflakes?\\b
\\brice\\s+(crispies|cakes?|puffs?)\\b
\\bpretzels?\\b

# Starchy preparations
\\bmashed\\s+potato(es)?\\b
\\bfrench\\s+fries\\b
\\bbaked\\s+potato(es)?\\b

# Sugars and syrups
\\bgranulated\\s+sugar\\b
\\bbrown\\s+sugar\\b
\\bpowdered\\s+sugar\\b
\\bcorn\\s+syrup\\b
\\bhigh.?fructose\\s+corn\\s+syrup\\b
\\bglucose\\b
\\bdextrose\\b
\\bmaltose\\b

# Sugary foods and drinks
\\bdonuts?\\b
\\bsoda\\b
\\bsoft\\s+drinks?\\b

# Fruits with high GI
\\bwatermelon\\b
\\bdates?\\b
`;

export interface CompiledPattern {
	source: string;
	regex: RegExp;
}

export interface CompiledGiDictionary {
	patterns: CompiledPattern[];
	errors: string[];
}

/**
 * Parse and compile a user-editable dictionary string in one pass.
 * Comment and blank lines are skipped. Invalid regexes are collected
 * into `errors` rather than thrown — a typo shouldn't take down the
 * recipe view.
 */
export function compileGiDictionary(text: string): CompiledGiDictionary {
	const patterns: CompiledPattern[] = [];
	const errors: string[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		try {
			patterns.push({ source: line, regex: new RegExp(line, "i") });
		} catch (err) {
			errors.push(`${line} - ${err instanceof Error ? err.message : "invalid regex"}`);
		}
	}
	return { patterns, errors };
}

/** Returns compiled patterns, silently dropping invalid lines. */
export function parseGiDictionary(text: string): CompiledPattern[] {
	return compileGiDictionary(text).patterns;
}

/** Returns any invalid lines so the settings UI can surface them. */
export function validateGiDictionary(text: string): string[] {
	return compileGiDictionary(text).errors;
}

/**
 * Returns true if any pattern in the compiled dictionary matches the
 * supplied ingredient name. Caller should pass an already-cleaned name
 * (no quantity, no markdown, no trailing tags).
 *
 * Use compileGiDictionary once and cache the result; don't recompile per call.
 */
export function isHighGi(
	name: string,
	dictionary: readonly CompiledPattern[],
): boolean {
	if (!name) return false;
	return dictionary.some((entry) => entry.regex.test(name));
}

/**
 * Wrap a compiled dictionary as a NameMatcher for use alongside other
 * per-ingredient checks (e.g. detectMeatTemp).
 */
export function createGiMatcher(
	dictionary: readonly CompiledPattern[],
): NameMatcher<true> {
	return (name) => (isHighGi(name, dictionary) ? true : null);
}
