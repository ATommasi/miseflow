<p align="center">
	<img align="center" width="250" alt="miseflow-final" src="https://github.com/user-attachments/assets/1bd14075-406d-42af-b005-9a245a714811" />
</p>

> **Early Release**
> MiseFlow is fresh out of the oven. Expect a few rough edges while the recipe develops. If you find a bug or have an idea, please open an issue.

# MiseFlow 🍳

> *Mise en place* - the culinary practice of preparing everything before you cook.

MiseFlow transforms Obsidian into a complete meal planning, grocery shopping, and recipe management system.

Plan your week, generate grocery lists from only the ingredients you actually need, track your cooking history, and view recipes in a clean cooking interface designed for real kitchens.

Everything stays in your vault.

Everything stays in Markdown.

No subscriptions. No cloud lock-in. No exporting your data someday.

Just recipes, notes, and food.

---

## Why MiseFlow?

Most recipe apps want to own your recipes.

MiseFlow doesn't.

Your meal plan is a note.

Your grocery list is a note.

Your recipes are notes.

The plugin simply connects everything together and handles the tedious parts for you.

If you're already storing recipes in Obsidian, MiseFlow helps turn them into a complete cooking workflow.

---

# 🗓️ Plan Your Meals

Build your weekly meal plan directly from your recipe collection.

<img width="562" alt="Meal Planning" src="https://github.com/user-attachments/assets/f6e8f65f-7029-4d74-935b-041968de6c42" />

### Features

* Schedule meals by day of the week
* Organize by Breakfast, Lunch, Dinner, or Snack
* Choose exactly which ingredients you need
* Automatically track recipes you've cooked
* Edit your meal plan manually or through the plugin
* Store everything in a normal Markdown note

No hidden database. No proprietary format.

---

# 🛒 Build Smarter Grocery Lists

Turn your meal plan into a grocery list in seconds.

### Grocery List Features

* Automatically combine duplicate ingredients
* Merge quantities across recipes
* Add one-off shopping items
* Organize by category, recipe, source, or flat list
* Export as plain text or Markdown
* Edit directly inside the grocery list note

For example:

* 1 lb ground beef
* 1 lb ground beef

Becomes:

* 2 lb ground beef

Because nobody needs duplicate grocery list clutter.

---

# 🛍️ Shop Without the Chaos

The Shopping Assistant keeps your grocery trip organized.

<img width="844" alt="Shopping Assistant" src="https://github.com/user-attachments/assets/486f04ac-171e-4aa0-91c2-c169356ef034" />

### Shopping Assistant Features

* Check items off while shopping
* Automatically sync checkbox state back to your note
* Add one-off items on the fly
* Reset completed lists for your next trip
* Jump directly to your meal plan

Everything remains synced with your Markdown grocery list.

---

# 👨‍🍳 Cook Without Scrolling Through Notes

When it's time to cook, open a recipe in the dedicated Recipe View.

<img width="830" alt="Recipe View" src="https://github.com/user-attachments/assets/8261ff5a-22e9-4ab7-9289-b901267bd5ac" />

### Recipe View Features

* Beautiful hero images
* Ingredient lists optimized for cooking
* Portion scaling and quantity adjustment
* Nutrition information
* Prep and cook time badges
* Diet labels
* Allergen warnings
* Safe meat temperature guidance
* High-GI ingredient warnings
* One-click meal planning
* Cooking history tracking

Designed to be readable from across the kitchen instead of forcing you to bounce around a giant note.

---

# 📚 Build Your Personal Cookbook

MiseFlow helps you maintain a living recipe collection.

### Library Features

* Favorite recipes
* Most-cooked statistics
* Last-made tracking
* Meal suggestions
* Recently neglected recipes
* Allergen-aware recommendations

Over time your vault becomes more than a recipe folder. It becomes a cooking history.

---

# ✨ Everything Lives In Markdown

MiseFlow uses regular Obsidian notes.

That means:

* Your data remains future-proof
* Your recipes are searchable
* Your recipes work with Dataview
* Your recipes work with backlinks
* Your recipes work with your existing vault structure
* You can always access your data without the plugin

Your recipes belong to you.

---

# 🚀 Who Is MiseFlow For?

MiseFlow is a great fit if:

* You already keep recipes in Obsidian
* You meal plan regularly
* You make grocery lists every week
* You want ownership of your recipe data
* You prefer Markdown over cloud services

MiseFlow may not be the right fit if:

* You want a hosted recipe service
* You don't use Obsidian
* You prefer fully managed meal-planning platforms

---

# Installation

1. Open Obsidian Settings
2. Navigate to Community Plugins
3. Browse for "MiseFlow"
4. Install and enable the plugin
5. Configure your recipe folders and note locations

You're ready to cook.

---

# Frontmatter Reference

| Property | Description |
|----------|-------------|
| `type` | Set to your configured recipe type value (default `recipe`) to enable recipe view auto-open |
| `image` | Hero image - vault file path, wikilink, or URL |
| `multiplier` | Portion scale factor (default `1`) |
| `servings` | Number of servings |
| `calories` / `protein` / `fat` / `carbs` | Nutrition values |
| `prepTime` / `cookTime` / `totalTime` | Times in minutes |
| `diet` | Diet tags - string or list (e.g. `vegan`, `[vegan, gluten-free]`) |
| `allergens` | Allergen list - CSV text or YAML list (property name configurable in settings) |
| `favorite` | `true` to mark as favourite |
| `lastMade` | Auto-stamped date (YYYY-MM-DD) when added to meal plan |
| `cookedCount` | Auto-incremented cook count |
---


# Credits

MiseFlow is a fork of [Pantry](https://github.com/Ekrizdis367/obsidian-pantry) by TheEkrizdis, significantly extended and rewritten by [Adam Tommasi](https://github.com/ATommasi).

