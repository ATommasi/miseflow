import { moment } from "obsidian";

/**
 * Resolves date tokens in a note path template.
 * Anything inside `{}` is treated as a moment.js format string.
 *   {YYYY-MM-DD}  →  2025-06-07
 *   {MMMM}        →  June
 *   {dddd}        →  Saturday
 *   {x}           →  unix ms timestamp
 */
export function resolveNotePath(template: string, date: Date = new Date()): string {
	const m = moment(date);
	return template.replace(/\{([^}]+)\}/g, (_, fmt) => m.format(fmt));
}
