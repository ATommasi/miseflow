/**
 * Meat detection helper used by the recipe view to surface a food-safety
 * warning next to ingredients that need to hit a safe minimum internal
 * temperature.
 *
 * Temperatures follow the USDA "Safe Minimum Internal Temperature" chart:
 * https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart
 */

import type { NameMatcher } from "./matcher";

export interface MeatTemp {
	/** Human-readable category, e.g. "Poultry". */
	category: string;
	/** Safe minimum internal temperature in Fahrenheit. */
	fahrenheit: number;
	/** Safe minimum internal temperature in Celsius. */
	celsius: number;
}

const POULTRY: MeatTemp  = { category: "Poultry",            fahrenheit: 165, celsius: 74 };
const GROUND: MeatTemp   = { category: "Ground meat",        fahrenheit: 160, celsius: 71 };
const PORK: MeatTemp     = { category: "Pork",               fahrenheit: 145, celsius: 63 };
const RED_MEAT: MeatTemp = { category: "Beef / lamb / veal", fahrenheit: 145, celsius: 63 };
const FISH: MeatTemp     = { category: "Fish",               fahrenheit: 145, celsius: 63 };
const SHELLFISH: MeatTemp = { category: "Shellfish",         fahrenheit: 145, celsius: 63 };

/**
 * Keywords per temperature category. Singular forms only — buildCategoryRegex
 * appends `s?` automatically. Keep both forms only for irregular plurals
 * (e.g. "anchovy" / "anchovies").
 *
 * Categories are tested in order, so more-specific categories (GROUND) must
 * appear before the general ones they overlap with (PORK, RED_MEAT).
 */
const CATEGORY_KEYWORDS: { temp: MeatTemp; keywords: string[] }[] = [
	{
		temp: POULTRY,
		keywords: [
			"ground chicken", "ground turkey", "ground duck", "ground poultry",
			"chicken sausage", "turkey sausage", "rotisserie chicken",
			"chicken thigh", "chicken breast", "chicken wing",
			"chicken drumstick", "chicken leg", "chicken tender",
			"chicken", "turkey", "duck", "goose", "cornish hen", "poultry",
		],
	},
	{
		temp: GROUND,
		keywords: [
			"ground beef", "ground pork", "ground lamb", "ground veal", "ground meat",
			"hamburger meat", "hamburger patty", "burger patty",
			"minced beef", "minced pork", "minced lamb",
			"italian sausage", "breakfast sausage", "pork sausage",
			"chorizo", "merguez", "bratwurst", "brat", "sausage",
		],
	},
	{
		temp: PORK,
		keywords: [
			"pork chop", "pork loin", "pork shoulder", "pork tenderloin",
			"pork belly", "pork rib", "baby back rib", "spare rib",
			"pork", "ham", "bacon", "prosciutto", "pancetta", "ribs",
		],
	},
	{
		temp: RED_MEAT,
		keywords: [
			"filet mignon", "flat iron steak", "new york strip", "flank steak",
			"skirt steak", "hanger steak", "chuck roast", "chuck steak",
			"roast beef", "beef stew meat", "beef short rib",
			"ribeye", "sirloin", "tenderloin", "t-bone", "porterhouse",
			"ny strip", "brisket", "steak", "beef",
			"lamb chop", "lamb shoulder", "leg of lamb", "lamb shank", "lamb leg", "lamb",
			"veal",
		],
	},
	{
		temp: FISH,
		keywords: [
			"salmon fillet", "tuna steak", "fish fillet", "fish steak",
			"mahi-mahi", "mahi mahi", "sea bass",
			"salmon", "tuna", "tilapia", "cod", "trout", "halibut",
			"snapper", "swordfish", "branzino", "barramundi",
			"haddock", "pollock", "anchovy", "anchovies", "sardine", "mahi", "fish",
		],
	},
	{
		temp: SHELLFISH,
		keywords: [
			"shrimp", "prawn", "scallop", "crab", "lobster",
			"clam", "mussel", "oyster", "crawfish", "crayfish",
		],
	},
];

/**
 * Words that, when present, indicate a flavoring or pantry staple rather than
 * the meat itself. "Chicken broth", "fish sauce", etc. skip the warning.
 */
const NON_MEAT_QUALIFIERS = [
	"stock", "broth", "bouillon", "consomme", "consommé",
	"sauce", "powder", "extract", "flavor", "flavoring",
	"flavour", "flavouring", "seasoning", "rub", "jerky",
];

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a single regex from a keyword list. Keywords are sorted longest-first
 * so more-specific phrases win over shorter overlapping ones (e.g. "ground
 * chicken" beats "chicken"). The `s?` suffix handles common pluralisation;
 * keep both forms in the keyword list for irregular plurals like
 * "anchovy"/"anchovies".
 */
function buildCategoryRegex(keywords: string[]): RegExp {
	const alts = [...keywords]
		.sort((a, b) => b.length - a.length)
		.map((k) => {
			const esc = escapeRegex(k);
			return /s$/i.test(k) ? esc : `${esc}s?`;
		})
		.join("|");
	return new RegExp(`(?:^|[^a-z0-9])(?:${alts})(?:[^a-z0-9]|$)`, "i");
}

const MEAT_CATEGORIES = CATEGORY_KEYWORDS.map(({ temp, keywords }) => ({
	temp,
	regex: buildCategoryRegex(keywords),
}));

const NON_MEAT_RE = new RegExp(
	`\\b(?:${NON_MEAT_QUALIFIERS.map(escapeRegex).join("|")})\\b`,
	"i",
);

/**
 * Returns the safe internal temperature for an ingredient name, or null if it
 * doesn't look like a meat that needs a warning.
 *
 * Satisfies NameMatcher<MeatTemp>.
 */
export const detectMeatTemp: NameMatcher<MeatTemp> = (name) => {
	const text = name.toLowerCase();
	if (NON_MEAT_RE.test(text)) return null;
	return MEAT_CATEGORIES.find(({ regex }) => regex.test(text))?.temp ?? null;
};
