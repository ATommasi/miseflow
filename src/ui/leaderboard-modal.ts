import { App, Modal } from "obsidian";
import { leaderboard, listRecipeLibrary } from "../grocery/library";
import { MiseFlowSettings } from "../settings";

interface LeaderboardModalDeps {
	getSettings: () => MiseFlowSettings;
}

/**
 * Read-only leaderboard ranked by `cookedCount`. Useful for spotting
 * household favorites and ones that have fallen off the rotation.
 */
export class LeaderboardModal extends Modal {
	constructor(
		app: App,
		private readonly deps: LeaderboardModalDeps,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("mise-leaderboard-modal");
		this.titleEl.setText("Cooking stats");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const settings = this.deps.getSettings();
		const ranked = leaderboard(listRecipeLibrary(this.app, settings));

		if (ranked.length === 0) {
			contentEl.createDiv({
				cls: "mise-leaderboard-empty",
				text: `No recipes found. Tag a note with type: ${settings.recipeTypeValue} to start tracking.`,
			});
			return;
		}

		const cooked = ranked.filter((e) => e.meta.cookedCount > 0).length;
		contentEl.createDiv({
			cls: "mise-leaderboard-summary",
			text: `${cooked} of ${ranked.length} recipes cooked.`,
		});

		const table = contentEl.createEl("table", {
			cls: "mise-leaderboard-table",
		});
		const head = table.createEl("thead").createEl("tr");
		head.createEl("th", { text: "#" });
		head.createEl("th", { text: "Recipe" });
		head.createEl("th", { text: "Cooked" });
		head.createEl("th", { text: "Last made" });

		const body = table.createEl("tbody");
		ranked.forEach((entry, idx) => {
			const row = body.createEl("tr");
			row.createEl("td", {
				cls: "mise-leaderboard-rank",
				text: `${idx + 1}`,
			});
			const nameCell = row.createEl("td");
			const link = nameCell.createEl("a", {
				cls: "mise-leaderboard-link",
				text: entry.file.basename,
				href: "#",
			});
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				this.close();
				void this.app.workspace
					.getLeaf(false)
					.openFile(entry.file);
			});

			row.createEl("td", {
				cls: "mise-leaderboard-count",
				text: String(entry.meta.cookedCount),
			});
			row.createEl("td", {
				cls: "mise-leaderboard-date",
				text: entry.meta.lastMade ?? "—",
			});
		});
	}
}
