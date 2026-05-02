/**
 * Capitalise the first letter of every space- or hyphen-separated word so
 * stored, lower-cased ingredient names render as "Ground Beef" or
 * "All-Purpose Flour" without losing apostrophe-ed words like "shepherd's".
 */
export function toTitleCase(name: string): string {
	return name.replace(
		/(^|[\s-])([a-z])/g,
		(_match, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
	);
}
