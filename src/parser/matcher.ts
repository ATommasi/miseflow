/**
 * A compiled check against an ingredient name.
 * Returns a typed value on match, null otherwise.
 *
 * detectMeatTemp and the GI matcher satisfy this shape, as should any
 * future per-ingredient annotation (allergens, cuisines, dietary flags, etc).
 */
export type NameMatcher<T> = (name: string) => T | null;
