# MiseFlow

> *Mise en place* — the culinary practice of preparing everything before you cook.

MiseFlow is an [Obsidian](https://obsidian.md) plugin that turns your recipe notes into a full meal planning and shopping system. Plan your week, build your grocery list from only the ingredients you actually need, and view your recipes as interactive cards while you cook.

---

## Features

### Meal Planning

- **Meal plan note** — Your meal plan lives in a real vault note (configurable path). The plugin reads and writes it automatically; you can also edit it by hand and the plugin picks up the changes.
- **Add recipes to your plan** with an optional day (Mon–Sun) and meal type (Breakfast, Lunch, Dinner, Snack). Pick exactly the ingredients you need at add-time — nothing is added blindly.
- **Ingredient selection** — When adding a recipe, a modal shows the full ingredient list with checkboxes. Nothing is selected by default; tick only what you need to buy.

### Grocery List

- **Note-backed** — Your grocery list is stored as a readable Markdown note (`# Grocery List`, sections per category, `- [ ]` checkboxes). Edit it directly or let the plugin manage it.
- **Smart merging** — Ingredients from multiple recipes (and one-off items) are merged by name + unit. `1 lb beef` from Bolognese + `1 lb beef` added manually = `2 lb beef`.
- **Grouping modes** — Switch between *By category*, *By recipe* (split per-recipe quantities), *By source* (Meal Plan vs Manually Added), and *Flat list* at any time.
- **One-off items** — Add anything not tied to a recipe via *Add item*. One-offs are written to the grocery note and merged correctly with recipe quantities.
- **Export** — Copy the grocery list as plain text, a Markdown checklist, or grouped by category.

### Shopping Assistant

Open the **Shopping Assistant** panel (ribbon icon or command) to:

- See how many meals are planned this week with a link to open the meal plan note
- Check off grocery items as you shop — checkbox state is stored in the note (`- [x]`)
- Reset checks between shopping trips
- Add one-off items and remove them with a right-click or long-press

### Recipe View

Open any recipe note in the **Recipe View** for a clean cooking experience:

- **Hero image** — Set `image:` frontmatter to a vault file or URL
- **Portion multiplier** — Scale the recipe up or down; quantities update in the recipe view and in the grocery list
- **Nutrition panel** — Calories, protein, fat, and carbs from frontmatter. Configure whether your values are per-serving or recipe totals
- **Timing badges** — `prepTime`, `cookTime` shown as at-a-glance badges
- **Diet tags** — `diet: vegan` or `diet: [vegan, gluten-free]` displayed as badges
- **Last made date** — Stamped automatically when you add a recipe to your meal plan
- **Allergen warning** — Red banner if the recipe's allergens overlap with your personal list
- **Meat temperature badges** — Safe internal temperature guidance on meat ingredients (toggleable)
- **High-GI badges** — Optional warning badges on high glycemic index ingredients (configurable dictionary)
- **Mark as cooked** — Record a cook with today's date (or a custom date) from the recipe view
- **Add to meal plan** — Add the recipe to your plan directly from the recipe view

### Recipe Library

- **Meal suggester** — Surfaces recipes you haven't cooked recently, with optional filters for favourites and allergens
- **Cooking stats** — Leaderboard of your most-cooked recipes
- **Favourites** — Star a recipe with one click; `favorite: true` is written to frontmatter

---

## Frontmatter Reference

| Property | Description |
|----------|-------------|
| `type` | Set to your configured recipe type value (default `recipe`) to enable recipe view auto-open |
| `image` | Hero image — vault file path, wikilink, or URL |
| `multiplier` | Portion scale factor (default `1`) |
| `servings` | Number of servings |
| `calories` / `protein` / `fat` / `carbs` | Nutrition values |
| `prepTime` / `cookTime` / `totalTime` | Times in minutes |
| `diet` | Diet tags — string or list (e.g. `vegan`, `[vegan, gluten-free]`) |
| `allergens` | Allergen list — CSV text or YAML list (property name configurable in settings) |
| `favorite` | `true` to mark as favourite |
| `lastMade` | Auto-stamped date (YYYY-MM-DD) when added to meal plan |
| `cookedCount` | Auto-incremented cook count |

---

## Settings Overview

| Section | Key settings |
|---------|-------------|
| **Notes & Storage** | Meal plan note path, grocery list note path |
| **Recipe Library** | Recipe folders (vault folder autocomplete), recipe type value, ingredients/instructions heading |
| **Shopping** | Default grouping, auto-collapse completed sections |
| **Categories** | Category source, alphabetical vs custom order, category overrides |
| **Cooking & Tracking** | Mark as cooked button, last made tracking, cooked count |
| **Nutrition** | Display mode (per serving / total), source mode |
| **Meal Suggestions** | Day window, suggestion count |
| **Health & Safety** | Allergens property name, my allergens list, meat temp warnings, high-GI warnings |

---

## Meal Plan Note Format

```markdown
# Meal Plan

## Unscheduled
- [ ] [[Chicken Soup]]

## Monday
- [ ] [[Oatmeal]] — Breakfast
- [ ] [[Bolognese]] — Dinner

## Wednesday
- [ ] [[Chicken Tikka Masala]] — Dinner
```

Items can be checked off (`- [x]`) to mark them as cooked. Add recipes manually to any day section and the plugin will sync them into its state.

---

## Grocery List Note Format

```markdown
# Grocery List

## Meat
- [ ] 2 lb ground beef

## Canned
- [ ] 1 can crushed tomatoes

## Produce
- [ ] 1 onion
- [ ] 3 cloves garlic
```

Check items off while shopping. The Shopping Assistant panel mirrors the note's checked state in real time.

---

## Credits

MiseFlow is a fork of [Pantry](https://github.com/TheEkrizdis/obsidian-pantry) by TheEkrizdis, significantly extended and rewritten by [Adam Tommasi](https://github.com/ATommasi).
