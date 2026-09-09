/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/horizon.css';
import { $, addDisposableListener, append, getActiveWindow } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { getCodeEditor, ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { CursorColumns } from '../../../../editor/common/core/cursorColumns.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { localize } from '../../../../nls.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { HorizonPanel, HorizonRenderer } from './horizonRenderer.js';
import { XRSystem } from './xrTypes.js';
import { runHorizonEdit } from './horizonEditing.js';

interface HitTarget { x: number; y: number; width: number; height: number; run(): void }

/** Three canvas panels shared by the immersive session and its pointer-accessible preview. */
export class HorizonWorkbench extends Disposable {
	private readonly host: HTMLElement;
	private readonly message: HTMLElement;
	private readonly enter: HTMLButtonElement;
	private readonly renderer = this._register(new MutableDisposable<HorizonRenderer>());
	private readonly editorListeners = this._register(new DisposableStore());
	private readonly panels: HorizonPanel[] = [];
	private readonly targets = new Map<HTMLCanvasElement, HitTarget[]>();
	private editor: ICodeEditor | null = null;
	private firstLine = 1;
	private firstColumn = 0;
	private filePage = 0;
	private shifted = false;
	private selecting = false;
	private entering = false;
	private disposed = false;

	constructor(
		private readonly onClose: () => void,
		@IEditorService private readonly editorService: IEditorService,
		@IThemeService private readonly themeService: IThemeService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
	) {
		super();
		const window = getActiveWindow();
		const previousFocus = window.document.activeElement;
		this.host = append(layoutService.activeContainer, $('.horizon-workbench'));
		this.host.setAttribute('role', 'dialog');
		this.host.setAttribute('aria-modal', 'true');
		this.host.setAttribute('aria-label', localize('horizon.title', "Horizon Immersive Editor"));
		this._register(toDisposable(() => {
			this.host.remove();
			if (previousFocus instanceof window.HTMLElement && previousFocus.isConnected) { previousFocus.focus(); }
		}));
		const header = append(this.host, $('header'));
		append(header, $('h1')).textContent = localize('horizon.heading', "Immersive Editor");
		this.enter = append(header, $('button'));
		this.enter.textContent = localize('horizon.enter', "Enter VR with Hands");
		this._register(addDisposableListener(this.enter, 'click', () => void this.enterVR()));
		const close = append(header, $('button'));
		close.textContent = localize('horizon.close', "Close");
		this._register(addDisposableListener(close, 'click', () => this.onClose()));
		this.message = append(this.host, $('p'));
		this.message.setAttribute('role', 'status');
		this.message.textContent = localize('horizon.instructions', "Preview: click the panels. In VR: point at a control and pinch. Open files in VS Code before entering. Changes edit your real files; use Save to write them.");
		const surfaces = append(this.host, $('.horizon-surfaces'));
		const definitions = [
			{ x: -1.08, y: 0.18, z: -1.8, width: 0.52, height: 0.9, pixels: [520, 900], label: localize('horizon.files', "Open Files") },
			{ x: 0, y: 0.18, z: -1.8, width: 1.5, height: 0.9, pixels: [1500, 900], label: localize('horizon.code', "Code Editor") },
			{ x: 0, y: -0.61, z: -1.65, width: 1.5, height: 0.56, pixels: [1500, 560], label: localize('horizon.keyboard', "Coding Keyboard") }
		];
		for (const definition of definitions) {
			const canvas = append(surfaces, window.document.createElement('canvas'));
			canvas.width = definition.pixels[0];
			canvas.height = definition.pixels[1];
			canvas.setAttribute('aria-label', definition.label);
			const panel: HorizonPanel = { ...definition, canvas, activate: (u, v) => this.activate(canvas, u, v) };
			this.panels.push(panel);
			this._register(addDisposableListener(canvas, 'click', (event: MouseEvent) => {
				const rect = canvas.getBoundingClientRect();
				panel.activate((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
			}));
		}
		this._register(addDisposableListener(this.host, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Escape') { this.onClose(); }
			if (event.key === 'Tab') {
				event.preventDefault();
				(window.document.activeElement === this.enter ? close : this.enter).focus();
			}
		}));
		this._register(this.editorService.onDidActiveEditorChange(() => this.bindEditor()));
		this._register(this.editorService.onDidEditorsChange(() => this.paint()));
		this._register(this.themeService.onDidColorThemeChange(() => this.paint()));
		this.bindEditor();
		this.enter.focus();
	}

	private bindEditor(): void {
		this.editorListeners.clear();
		this.editor = getCodeEditor(this.editorService.activeTextEditorControl);
		this.firstLine = 1;
		this.firstColumn = 0;
		this.selecting = false;
		if (this.editor) {
			this.editorListeners.add(this.editor.onDidChangeModelContent(() => this.paint()));
			this.editorListeners.add(this.editor.onDidChangeCursorSelection(() => this.paint()));
			this.editorListeners.add(this.editor.onDidChangeModel(() => this.bindEditor()));
			this.editorListeners.add(this.editor.onDidChangeConfiguration(() => this.paint()));
			this.editorListeners.add(this.editor.onDidDispose(() => { this.editor = null; this.paint(); }));
		}
		this.paint();
	}

	private async enterVR(): Promise<void> {
		if (this.entering || this.renderer.value) { return; }
		const window = this.host.ownerDocument.defaultView!;
		const xr = (window.navigator as Navigator & { xr?: XRSystem }).xr;
		if (!window.isSecureContext || !xr) {
			this.message.textContent = localize('horizon.unavailable', "VR requires HTTPS (or localhost), a WebXR browser, and a headset. The pointer preview remains available.");
			return;
		}
		this.entering = true;
		this.enter.disabled = true;
		try {
			// Keep requestSession in the click's user activation, before any asynchronous work.
			const session = await xr.requestSession('immersive-vr', { requiredFeatures: ['local', 'hand-tracking'] });
			if (this.disposed) { await session.end(); return; }
			try {
				const renderer = new HorizonRenderer(this.panels, () => {
					this.renderer.clear();
					this.enter.disabled = false;
				}, error => this.showError(error));
				this.renderer.value = renderer;
				await renderer.start(session);
			} catch (error) {
				await session.end().catch(() => { });
				throw error;
			}
		} catch (error) {
			this.renderer.clear();
			this.enter.disabled = false;
			this.message.textContent = localize('horizon.failed', "Could not enter VR: {0}. Enable hand tracking and allow the browser's VR permission, then try again.", error instanceof Error ? error.message : String(error));
		} finally {
			this.entering = false;
		}
	}

	private activate(canvas: HTMLCanvasElement, u: number, v: number): void {
		const x = u * canvas.width;
		const y = v * canvas.height;
		const target = this.targets.get(canvas)?.find(target => x >= target.x && x < target.x + target.width && y >= target.y && y < target.y + target.height);
		if (target) { target.run(); this.paint(); }
	}

	private color(id: string): string {
		return this.themeService.getColorTheme().getColor(id)?.toString() ?? this.themeService.getColorTheme().getColor('editor.foreground')!.toString();
	}

	private surface(index: number, title: string): CanvasRenderingContext2D {
		const canvas = this.panels[index].canvas;
		this.targets.set(canvas, []);
		const context = canvas.getContext('2d')!;
		context.fillStyle = this.color('editor.background');
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.strokeStyle = this.color('focusBorder');
		context.lineWidth = 2;
		context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
		context.fillStyle = this.color('editor.foreground');
		context.font = '600 28px sans-serif';
		context.textBaseline = 'middle';
		context.fillText(title, 24, 36, canvas.width - 48);
		return context;
	}

	private button(context: CanvasRenderingContext2D, label: string, x: number, y: number, width: number, run: () => void, selected = false): void {
		context.fillStyle = this.color(selected ? 'button.background' : 'button.secondaryBackground');
		context.fillRect(x, y, width, 64);
		context.strokeStyle = this.color('contrastBorder');
		context.strokeRect(x, y, width, 64);
		context.fillStyle = this.color(selected ? 'button.foreground' : 'button.secondaryForeground');
		context.font = '24px sans-serif';
		context.fillText(label, x + 12, y + 32, width - 24);
		this.targets.get(context.canvas)!.push({ x, y, width, height: 64, run });
	}

	private paint(): void {
		if (this.disposed || this.panels.length !== 3) { return; }
		this.paintFiles();
		this.paintCode();
		this.paintKeyboard();
		this.renderer.value?.invalidate();
	}

	private paintFiles(): void {
		const context = this.surface(0, localize('horizon.openFiles', "Open Files"));
		const files = this.editorService.getEditors(EditorsOrder.SEQUENTIAL);
		this.filePage = Math.min(this.filePage, Math.max(0, Math.ceil(files.length / 8) - 1));
		files.slice(this.filePage * 8, this.filePage * 8 + 8).forEach((file, index) => {
			this.button(context, `${file.editor.isDirty() ? '● ' : ''}${file.editor.getName()}`, 24, 88 + index * 80, 472, () => {
				void this.editorService.openEditor(file.editor, { preserveFocus: true }, file.groupId).catch(error => this.showError(error));
			}, file.editor === this.editorService.activeEditor);
		});
		this.button(context, localize('horizon.previous', "Previous"), 24, 740, 228, () => { this.filePage = Math.max(0, this.filePage - 1); });
		this.button(context, localize('horizon.next', "Next"), 268, 740, 228, () => { this.filePage++; });
		context.fillStyle = this.color('descriptionForeground');
		context.font = '22px sans-serif';
		context.fillText(localize('horizon.filePage', "Page {0} of {1}", this.filePage + 1, Math.max(1, Math.ceil(files.length / 8))), 24, 850);
	}

	private paintCode(): void {
		this.panels[1].activate = (u, v) => this.activate(this.panels[1].canvas, u, v);
		const model = this.editor?.getModel();
		const readOnly = this.editor?.getOption(EditorOption.readOnly);
		const name = model ? this.editorService.activeEditor?.getName() ?? '' : localize('horizon.noFile', "Open a Text File in VS Code");
		const context = this.surface(1, readOnly ? localize('horizon.readOnly', "{0} — Read Only", name) : name);
		const actions: [string, () => void][] = [
			[localize('horizon.save', "Save"), () => void this.save()],
			[localize('horizon.undo', "Undo"), () => { if (!readOnly) { void model?.undo(); } }],
			[localize('horizon.redo', "Redo"), () => { if (!readOnly) { void model?.redo(); } }],
			[localize('horizon.up', "Page Up"), () => { this.firstLine = Math.max(1, this.firstLine - 16); }],
			[localize('horizon.down', "Page Down"), () => { this.firstLine += 16; }],
			[localize('horizon.recenter', "Recenter"), () => this.renderer.value?.recenter()],
			[localize('horizon.exit', "Exit VR"), () => { this.renderer.clear(); this.enter.disabled = false; }]
		];
		actions.forEach(([label, run], index) => this.button(context, label, 24 + index * 208, 72, 192, run));
		if (!model || !this.editor) { return; }
		this.firstLine = Math.max(1, Math.min(this.firstLine, Math.max(1, model.getLineCount() - 15)));
		const selection = this.editor.getSelection();
		const tabSize = model.getOptions().tabSize;
		const cell = 18;
		for (let row = 0; row < 16 && this.firstLine + row <= model.getLineCount(); row++) {
			const line = this.firstLine + row;
			const text = model.getLineContent(line);
			const y = 164 + row * 42;
			context.font = '28px monospace';
			context.fillStyle = this.color('editorLineNumber.foreground');
			context.fillText(String(line), 24, y + 20, 64);
			if (selection && line >= selection.startLineNumber && line <= selection.endLineNumber) {
				const start = line === selection.startLineNumber ? selection.startColumn : 1;
				const end = line === selection.endLineNumber ? selection.endColumn : text.length + 1;
				const left = 112 + (CursorColumns.visibleColumnFromColumn(text, start, tabSize) - this.firstColumn) * cell;
				const right = 112 + (CursorColumns.visibleColumnFromColumn(text, end, tabSize) - this.firstColumn) * cell;
				context.fillStyle = this.color('editor.selectionBackground');
				context.fillRect(Math.max(112, left), y, Math.max(0, Math.min(1476, right) - Math.max(112, left)), 40);
			}
			context.save();
			context.beginPath();
			context.rect(112, y, 1364, 42);
			context.clip();
			context.fillStyle = this.color('editor.foreground');
			let column = CursorColumns.columnFromVisibleColumn(text, this.firstColumn, tabSize);
			for (const character of text.slice(column - 1)) {
				const visible = CursorColumns.visibleColumnFromColumn(text, column, tabSize);
				if (visible > this.firstColumn + 78) { break; }
				if (character !== '\t') { context.fillText(character, 112 + (visible - this.firstColumn) * cell, y + 20); }
				column += character.length;
			}
			if (selection?.positionLineNumber === line) {
				context.fillStyle = this.color('editorCursor.foreground');
				context.fillRect(112 + (CursorColumns.visibleColumnFromColumn(text, selection.positionColumn, tabSize) - this.firstColumn) * cell, y, 3, 38);
			}
			context.restore();
		}
		// Code hit coordinates are handled as a single surface to retain character-level positioning.
		const panel = this.panels[1];
		panel.activate = (u, v) => {
			const x = u * panel.canvas.width;
			const y = v * panel.canvas.height;
			if (x >= 112 && x < 1476 && y >= 164 && y < 836 && this.editor?.getModel() === model) {
				const lineNumber = Math.min(model.getLineCount(), this.firstLine + Math.floor((y - 164) / 42));
				const column = CursorColumns.columnFromVisibleColumn(model.getLineContent(lineNumber), this.firstColumn + Math.round((x - 112) / cell), tabSize);
				const position = model.validatePosition({ lineNumber, column });
				const anchor = this.selecting ? this.editor.getSelection()?.getSelectionStart() : position;
				this.editor.setSelection(Selection.fromPositions(anchor ?? position, position));
				this.paint();
			} else { this.activate(panel.canvas, u, v); }
		};
		context.fillStyle = this.color('descriptionForeground');
		context.font = '22px sans-serif';
		context.fillText(localize('horizon.position', "Line {0}, Column {1} · Point and pinch to place the cursor", selection?.positionLineNumber ?? 1, selection?.positionColumn ?? 1), 24, 868);
	}

	private paintKeyboard(): void {
		const context = this.surface(2, localize('horizon.keyboardTitle', "Point and Pinch to Type"));
		const rows = this.shifted
			? ['~!@#$%^&*()_+', 'QWERTYUIOP{}|', 'ASDFGHJKL:"', 'ZXCVBNM<>?']
			: ['`1234567890-=', 'qwertyuiop[]\\', 'asdfghjkl;\'', 'zxcvbnm,./'];
		rows.forEach((row, rowIndex) => {
			[...row].forEach((character, index) => this.button(context, character, 24 + index * 112, 80 + rowIndex * 80, 96, () => this.edit('type', character)));
		});
		const actions: [string, () => void, boolean?][] = [
			[localize('horizon.shift', "Shift"), () => { this.shifted = !this.shifted; }, this.shifted],
			[localize('horizon.space', "Space"), () => this.edit('type', ' ')],
			[localize('horizon.enterKey', "Enter"), () => this.edit('type', '\n')],
			[localize('horizon.tab', "Tab"), () => this.edit('tab')],
			[localize('horizon.backspace', "Backspace"), () => this.edit('deleteLeft')],
			[localize('horizon.select', "Select"), () => { this.selecting = !this.selecting; }, this.selecting],
			[localize('horizon.left', "Scroll Left"), () => { this.firstColumn = Math.max(0, this.firstColumn - 30); }],
			[localize('horizon.right', "Scroll Right"), () => { this.firstColumn += 30; }]
		];
		actions.forEach(([label, run, selected], index) => this.button(context, label, 24 + index * 184, 420, 168, run, selected));
		context.fillStyle = this.color('descriptionForeground');
		context.font = '22px sans-serif';
		context.fillText(this.selecting ? localize('horizon.selecting', "Selection on: pinch another text position to extend the selection.") : localize('horizon.typing', "Pinch a key once to insert. Shift locks uppercase and symbols. Save writes the active file."), 24, 524);
	}

	private edit(command: string, text?: string): void {
		if (this.editor) {
			runHorizonEdit(this.editor, command, text);
			const position = this.editor.getPosition();
			if (position) {
				if (position.lineNumber < this.firstLine || position.lineNumber >= this.firstLine + 16) { this.firstLine = Math.max(1, position.lineNumber - 8); }
				const model = this.editor.getModel()!;
				const visible = CursorColumns.visibleColumnFromColumn(model.getLineContent(position.lineNumber), position.column, model.getOptions().tabSize);
				if (visible < this.firstColumn || visible >= this.firstColumn + 74) { this.firstColumn = Math.max(0, visible - 36); }
			}
		}
	}

	private async save(): Promise<void> {
		const pane = this.editorService.activeEditorPane;
		if (!pane?.input) { return; }
		// Save As, conflicts and extension-provided save participants can show DOM dialogs.
		// Return to the browser before saving so those dialogs remain reachable with hands.
		await this.renderer.value?.stop();
		this.renderer.clear();
		this.enter.disabled = false;
		this.host.hidden = true;
		try {
			const result = await this.editorService.save({ editor: pane.input, groupId: pane.group.id });
			this.message.textContent = result.success ? localize('horizon.saved', "Saved. Select Enter VR with Hands to return.") : localize('horizon.notSaved', "Save was canceled or could not complete. Your edits remain in VS Code.");
		} catch (error) { this.showError(error); } finally {
			this.host.hidden = false;
			this.enter.focus();
		}
	}

	private showError(error: Error): void {
		this.renderer.clear();
		this.enter.disabled = false;
		this.message.textContent = error.message;
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}
}
