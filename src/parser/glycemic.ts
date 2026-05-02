/**
 * High-glycemic-index ingredient detection.
 *
 * The shipped dictionary is a list of regex patterns matched against the
 * cleaned ingredient name. Patterns are case-insensitive. Users can
 * customise the list in Settings → Diabetic mode (only visible when the
 * mode is turned on). The dictionary is intentionally conservative -
 * widely-cited GI ≥ 70 foods only - so a false positive doesn't make
 * users tune out the warnings.
 *
 * GI values vary across studies, preparations, and even cultivars, so
 * we treat this as guidance rather than fact and leave the final
 * dictionary in the user's hands.
 */

/**
 * Default high-GI dictionary, shipped as a single string so users see
 * the same `#`-comment formatting they'll edit in settings. Stored
 * here (not in settings.ts) because settings.ts shouldn't carry
 * domain knowledge.
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

interface CompiledPattern {
	source: string;
	regex: RegExp;
}

/**
 * Parse the user-editable dictionary string into compiled regexes.
 * Comment and blank lines are skipped. Invalid regexes are skipped
 * silently rather than throwing - we don't want a typo to take down
 * the recipe view. Callers can validate independently before saving.
 */
export function parseGiDictionary(text: string): CompiledPattern[] {
	const out: CompiledPattern[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		try {
			out.push({ source: line, regex: new RegExp(line, "i") });
		} catch {
			// invalid regex - skip
		}
	}
	return out;
}

/**
 * Validate a dictionary string and return any invalid lines so the
 * settings UI can surface them. Returns an empty array if every
 * non-comment line compiles.
 */
export function validateGiDictionary(text: string): string[] {
	const errors: string[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		try {
			new RegExp(line, "i");
		} catch (err) {
			const reason = err instanceof Error ? err.message : "invalid regex";
			errors.push(`${line} - ${reason}`);
		}
	}
	return errors;
}

/**
 * Returns true if any pattern in the compiled dictionary matches the
 * supplied ingredient name. Caller is expected to pass an already
 * cleaned name (no quantity, no markdown, no trailing tags).
 */
export function isHighGi(
	name: string,
	dictionary: readonly CompiledPattern[],
): boolean {
	if (!name) return false;
	for (const entry of dictionary) {
		if (entry.regex.test(name)) return true;
	}
	return false;
}
