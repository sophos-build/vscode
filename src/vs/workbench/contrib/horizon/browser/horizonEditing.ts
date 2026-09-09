/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';

/** Operates on the actual editor, preserving VS Code's undo, language and read-only behavior. */
export function runHorizonEdit(editor: ICodeEditor, command: string, text?: string): void {
	if (!editor.hasModel() || editor.getOption(EditorOption.readOnly)) { return; }
	editor.trigger('horizon', command, text === undefined ? undefined : { text });
}
