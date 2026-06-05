import { Notice, setIcon } from "obsidian";

// ── Duration regex ─────────────────────────────────────────────────────────────
// Range patterns come first so "10-15 minutes" matches as a whole before
// "15 minutes" can be matched by the single-value patterns.
//
// Group map:
//  1,2  range hours (lo, hi)
//  3,4  range minutes (lo, hi)
//  5,6  range seconds (lo, hi)
//  7,8  single hours [+ optional minutes]
//  9    single minutes
//  10   single seconds
const DURATION_RE =
	/\b(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b|\b(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b|\b(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b|\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)(?:\s+(?:and\s+)?(\d+)\s*(?:minutes?|mins?))?\b|\b(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b|\b(\d+)\s*(?:seconds?|secs?)\b/gi;

function pickRange(a: number, b: number, pref: "max" | "min"): number {
	return pref === "max" ? Math.max(a, b) : Math.min(a, b);
}

function matchToSeconds(m: RegExpExecArray, rangeDefault: "max" | "min"): number {
	if (m[1] !== undefined)
		return pickRange(
			Math.round(parseFloat(m[1]) * 3600),
			Math.round(parseFloat(m[2]!) * 3600),
			rangeDefault,
		);
	if (m[3] !== undefined)
		return pickRange(
			Math.round(parseFloat(m[3]) * 60),
			Math.round(parseFloat(m[4]!) * 60),
			rangeDefault,
		);
	if (m[5] !== undefined)
		return pickRange(parseInt(m[5], 10), parseInt(m[6]!, 10), rangeDefault);
	if (m[7] !== undefined)
		return Math.round(parseFloat(m[7]) * 3600 + parseFloat(m[8] ?? "0") * 60);
	if (m[9] !== undefined)
		return Math.round(parseFloat(m[9]) * 60);
	return parseInt(m[10] ?? "0", 10);
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0)
		return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Accept MM:SS, H:MM:SS, or a plain number (treated as minutes).
function parseTimeInput(raw: string): number | null {
	const v = raw.trim();
	const parts = v.split(":");
	if (parts.length === 2) {
		const mm = parseInt(parts[0]!, 10);
		const ss = parseInt(parts[1]!, 10);
		if (!isNaN(mm) && !isNaN(ss) && ss < 60) return mm * 60 + ss;
	}
	if (parts.length === 3) {
		const hh = parseInt(parts[0]!, 10);
		const mm = parseInt(parts[1]!, 10);
		const ss = parseInt(parts[2]!, 10);
		if (!isNaN(hh) && !isNaN(mm) && !isNaN(ss) && mm < 60 && ss < 60)
			return hh * 3600 + mm * 60 + ss;
	}
	const n = parseFloat(v);
	if (!isNaN(n) && n > 0) return Math.round(n * 60);
	return null;
}

// ── Global state ───────────────────────────────────────────────────────────────
const activeIntervals = new Set<number>();
const activeWidgets = new Set<TimerWidget>();
let tray: HTMLElement | null = null;

function getTray(): HTMLElement {
	if (!tray || !document.body.contains(tray)) {
		tray = document.createElement("div");
		tray.className = "mise-timer-tray";
		document.body.appendChild(tray);
	}
	return tray;
}

function maybeRemoveTray(): void {
	if (tray && tray.childElementCount === 0) {
		tray.remove();
		tray = null;
	}
}

export function clearAllTimers(): void {
	for (const id of activeIntervals) window.clearInterval(id);
	activeIntervals.clear();
	for (const w of activeWidgets) w.destroy();
	activeWidgets.clear();
	tray?.remove();
	tray = null;
}

// ── Public options ─────────────────────────────────────────────────────────────
export interface TimerOptions {
	autoStart: boolean;
	compact: boolean;
	rangeDefault: "max" | "min";
	incrementSeconds: number;
	recipeName: string;
	onOpenRecipe: () => void;
}

// ── TimerWidget ────────────────────────────────────────────────────────────────
class TimerWidget {
	private remaining: number;
	private totalSeconds: number;
	private running = false;
	private isEditingTime = false;
	private isCompact: boolean;
	private intervalId: number | null = null;
	private readonly el: HTMLElement;
	private displayEl!: HTMLElement;
	private playBtn!: HTMLElement;
	private compactBtn!: HTMLElement;
	private readonly cleanupFns: Array<() => void> = [];

	constructor(
		private readonly anchorBtn: HTMLElement,
		initialSeconds: number,
		private readonly label: string,
		private readonly options: TimerOptions,
	) {
		this.totalSeconds = initialSeconds;
		this.remaining = initialSeconds;
		this.isCompact = options.compact;
		this.el = this.build();
		getTray().appendChild(this.el);
		activeWidgets.add(this);
		anchorBtn.addClass("is-active");
		if (options.autoStart) this.start();
	}

	private build(): HTMLElement {
		const el = document.createElement("div");
		el.className = "mise-timer-widget";
		if (this.isCompact) el.addClass("is-compact");

		// ── Handle (drag + info) ──────────────────────────────────────────
		const handle = el.createDiv({ cls: "mise-timer-handle" });

		const recipeLink = handle.createEl("button", {
			cls: "mise-timer-recipe-link",
			attr: { type: "button", title: this.options.recipeName },
			text: this.options.recipeName,
		});
		recipeLink.addEventListener("click", (e) => {
			e.stopPropagation();
			this.options.onOpenRecipe();
		});

		const labelEl = handle.createDiv({ cls: "mise-timer-label", text: this.label });
		labelEl.title = this.label;

		// ── Time row: display + steppers ──────────────────────────────────
		const timeRow = handle.createDiv({ cls: "mise-timer-time-row" });

		this.displayEl = timeRow.createDiv({
			cls: "mise-timer-display",
			text: formatTime(this.remaining),
			attr: { title: "Click to edit" },
		});
		this.displayEl.addEventListener("click", () => this.startTimeEdit());

		const steppers = timeRow.createDiv({ cls: "mise-timer-steppers" });
		const upBtn = steppers.createEl("button", {
			cls: "mise-timer-step clickable-icon",
			attr: { type: "button", "aria-label": "Increase time" },
		});
		setIcon(upBtn, "chevron-up");
		upBtn.addEventListener("click", () =>
			this.adjustTime(this.options.incrementSeconds),
		);

		const downBtn = steppers.createEl("button", {
			cls: "mise-timer-step clickable-icon",
			attr: { type: "button", "aria-label": "Decrease time" },
		});
		setIcon(downBtn, "chevron-down");
		downBtn.addEventListener("click", () =>
			this.adjustTime(-this.options.incrementSeconds),
		);

		this.setupDrag(handle);

		// ── Controls ──────────────────────────────────────────────────────
		const controls = el.createDiv({ cls: "mise-timer-controls" });

		this.playBtn = controls.createEl("button", {
			cls: "mise-timer-play clickable-icon",
			attr: { type: "button", "aria-label": "Start timer" },
		});
		setIcon(this.playBtn, "play");
		this.playBtn.addEventListener("click", () => this.toggle());

		const resetBtn = controls.createEl("button", {
			cls: "mise-timer-reset clickable-icon",
			attr: { type: "button", "aria-label": "Reset timer" },
		});
		setIcon(resetBtn, "rotate-ccw");
		resetBtn.addEventListener("click", () => this.reset());

		this.compactBtn = controls.createEl("button", {
			cls: "mise-timer-compact clickable-icon",
			attr: { type: "button", "aria-label": "Compact view" },
		});
		setIcon(this.compactBtn, "minimize-2");
		this.compactBtn.addEventListener("click", () => this.toggleCompact());

		const closeBtn = controls.createEl("button", {
			cls: "mise-timer-close clickable-icon",
			attr: { type: "button", "aria-label": "Close timer" },
		});
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => this.close());

		return el;
	}

	private startTimeEdit(): void {
		if (this.isEditingTime) return;
		this.isEditingTime = true;
		const wasRunning = this.running;
		if (wasRunning) this.pause();

		const input = document.createElement("input");
		input.type = "text";
		input.className = "mise-timer-display mise-timer-display-edit";
		input.value = formatTime(this.remaining);

		const parent = this.displayEl.parentElement!;
		parent.replaceChild(input, this.displayEl);
		input.focus();
		input.select();

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			const parsed = parseTimeInput(input.value);
			if (parsed !== null && parsed > 0) {
				this.remaining = parsed;
				this.totalSeconds = parsed;
			}
			this.displayEl.textContent = formatTime(this.remaining);
			parent.replaceChild(this.displayEl, input);
			this.isEditingTime = false;
			if (wasRunning && this.remaining > 0) this.start();
		};

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); commit(); }
			if (e.key === "Escape") {
				e.preventDefault();
				committed = true;
				parent.replaceChild(this.displayEl, input);
				this.isEditingTime = false;
				if (wasRunning) this.start();
			}
		});
		input.addEventListener("blur", commit);
	}

	private adjustTime(deltaSecs: number): void {
		const wasDone = this.remaining <= 0;
		this.remaining = Math.max(0, this.remaining + deltaSecs);
		this.totalSeconds = Math.max(0, this.totalSeconds + deltaSecs);
		this.displayEl.textContent = formatTime(this.remaining);
		if (wasDone && this.remaining > 0) this.el.removeClass("is-done");
	}

	private setupDrag(handle: HTMLElement): void {
		let dragging = false;
		let startClientX = 0;
		let startClientY = 0;
		let startLeft = 0;
		let startTop = 0;
		let activePointerId: number | null = null;

		const onDown = (e: PointerEvent) => {
			if ((e.target as HTMLElement).closest("button, input")) return;
			if (e.pointerType === "mouse" && e.button !== 0) return;
			e.preventDefault();

			const rect = this.el.getBoundingClientRect();
			if (this.el.parentElement !== document.body) {
				this.el.setCssProps({
					position: "fixed",
					left: `${rect.left}px`,
					top: `${rect.top}px`,
					bottom: "",
					right: "",
				});
				document.body.appendChild(this.el);
				maybeRemoveTray();
			}
			startLeft = rect.left;
			startTop = rect.top;
			startClientX = e.clientX;
			startClientY = e.clientY;
			dragging = true;
			activePointerId = e.pointerId;
			handle.setPointerCapture(e.pointerId);
			handle.addClass("is-dragging");
		};

		const onMove = (e: PointerEvent) => {
			if (!dragging) return;
			if (activePointerId !== null && e.pointerId !== activePointerId) return;
			this.el.setCssProps({
				left: `${startLeft + (e.clientX - startClientX)}px`,
				top: `${startTop + (e.clientY - startClientY)}px`,
			});
		};

		const onUp = (e: PointerEvent) => {
			if (!dragging) return;
			if (activePointerId !== null && e.pointerId !== activePointerId) return;
			dragging = false;
			activePointerId = null;
			handle.removeClass("is-dragging");
		};

		handle.addEventListener("pointerdown", onDown);
		handle.addEventListener("pointermove", onMove);
		handle.addEventListener("pointerup", onUp);
		handle.addEventListener("pointercancel", onUp);
		this.cleanupFns.push(() => {
			handle.removeEventListener("pointerdown", onDown);
			handle.removeEventListener("pointermove", onMove);
			handle.removeEventListener("pointerup", onUp);
			handle.removeEventListener("pointercancel", onUp);
		});
	}

	private toggle(): void {
		if (this.running) this.pause(); else this.start();
	}

	private start(): void {
		if (this.remaining <= 0 || this.running) return;
		this.running = true;
		setIcon(this.playBtn, "pause");
		this.playBtn.setAttribute("aria-label", "Pause timer");
		const id = window.setInterval(() => {
			this.remaining--;
			this.displayEl.textContent = formatTime(this.remaining);
			if (this.remaining <= 0) this.finish();
		}, 1000);
		this.intervalId = id;
		activeIntervals.add(id);
	}

	private pause(): void {
		this.running = false;
		setIcon(this.playBtn, "play");
		this.playBtn.setAttribute("aria-label", "Start timer");
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			activeIntervals.delete(this.intervalId);
			this.intervalId = null;
		}
	}

	private reset(): void {
		this.pause();
		this.remaining = this.totalSeconds;
		this.displayEl.textContent = formatTime(this.remaining);
		this.el.removeClass("is-done");
	}

	private finish(): void {
		this.pause();
		this.remaining = 0;
		this.displayEl.textContent = formatTime(0);
		this.el.addClass("is-done");
		playBeep();
		new Notice(`Timer done: ${this.label}`);
	}

	private toggleCompact(): void {
		this.isCompact = !this.isCompact;
		this.el.toggleClass("is-compact", this.isCompact);
		setIcon(this.compactBtn, this.isCompact ? "maximize-2" : "minimize-2");
		this.compactBtn.setAttribute(
			"aria-label",
			this.isCompact ? "Full view" : "Compact view",
		);
	}

	private close(): void {
		this.pause();
		for (const fn of this.cleanupFns) fn();
		this.anchorBtn.removeClass("is-active");
		this.el.remove();
		activeWidgets.delete(this);
		maybeRemoveTray();
	}

	destroy(): void {
		this.pause();
		for (const fn of this.cleanupFns) fn();
		this.el.remove();
	}
}

// ── Audio beep ─────────────────────────────────────────────────────────────────
function playBeep(): void {
	try {
		const ctx = new AudioContext();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.type = "sine";
		osc.frequency.setValueAtTime(880, ctx.currentTime);
		gain.gain.setValueAtTime(0.4, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
		osc.start(ctx.currentTime);
		osc.stop(ctx.currentTime + 1.2);
		osc.onended = () => void ctx.close();
	} catch {
		// AudioContext unavailable — fail silently
	}
}

// ── DOM post-processor ─────────────────────────────────────────────────────────
export function processTimerButtons(
	container: HTMLElement,
	options: TimerOptions,
): void {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) textNodes.push(node as Text);

	for (const textNode of textNodes) {
		const text = textNode.data;
		DURATION_RE.lastIndex = 0;
		if (!DURATION_RE.test(text)) continue;
		DURATION_RE.lastIndex = 0;

		const parent = textNode.parentNode;
		if (!parent) continue;

		const fragment = document.createDocumentFragment();
		let cursor = 0;
		let match: RegExpExecArray | null;

		while ((match = DURATION_RE.exec(text)) !== null) {
			if (match.index > cursor)
				fragment.appendChild(
					document.createTextNode(text.slice(cursor, match.index)),
				);

			const seconds = matchToSeconds(match, options.rangeDefault);
			const label = match[0];
			const btn = document.createElement("button");
			btn.className = "mise-timer-btn";
			btn.type = "button";
			setIcon(btn, "timer");
			btn.append(document.createTextNode(" " + label));
			btn.dataset.seconds = String(seconds);
			btn.setAttribute("aria-label", `Start timer: ${label}`);
			btn.addEventListener("click", () => {
				new TimerWidget(btn, seconds, label, options);
			});

			fragment.appendChild(btn);
			cursor = match.index + match[0].length;
		}

		if (cursor < text.length)
			fragment.appendChild(document.createTextNode(text.slice(cursor)));

		parent.replaceChild(fragment, textNode);
	}
}
