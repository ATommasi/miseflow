import { App, ButtonComponent, Modal } from "obsidian";

export interface ConfirmModalOptions {
	title: string;
	message: string;
	confirmText: string;
	cancelText?: string;
	/** When true, the confirm button is rendered with the warning (destructive) style. */
	destructive?: boolean;
	onConfirm: () => void | Promise<void>;
}

/**
 * Lightweight yes/no modal used to gate destructive actions.
 *
 * The host action (e.g. "Clear list") opens this modal and is only invoked
 * when the user clicks the confirm button. Closing the modal any other way
 * cancels the action silently.
 */
export class ConfirmModal extends Modal {
	constructor(app: App, private readonly options: ConfirmModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.options.title);
		contentEl.empty();
		contentEl.createEl("p", { text: this.options.message });

		const buttonRow = contentEl.createDiv({
			cls: "modal-button-container",
		});

		new ButtonComponent(buttonRow)
			.setButtonText(this.options.cancelText ?? "Cancel")
			.onClick(() => this.close());

		const confirmBtn = new ButtonComponent(buttonRow)
			.setButtonText(this.options.confirmText)
			.onClick(() => {
				this.close();
				void Promise.resolve(this.options.onConfirm());
			});
		if (this.options.destructive) {
			confirmBtn.setWarning();
		} else {
			confirmBtn.setCta();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
