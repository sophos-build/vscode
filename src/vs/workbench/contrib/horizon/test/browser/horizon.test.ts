/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { withTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { runHorizonEdit } from '../../browser/horizonEditing.js';
import { intersectPanel, multiplyMatrices } from '../../browser/spatialMath.js';
import '../../../../../editor/browser/coreCommands.js';

suite('Horizon immersive editor', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	const panel = { x: 0, y: 0, z: -2, width: 2, height: 1 };

	test('hand ray maps the center and top-left edge to canvas coordinates', () => {
		const edge = new Float32Array(identity);
		edge[12] = -1;
		edge[13] = 0.5;
		assert.deepStrictEqual([intersectPanel(identity, panel), intersectPanel(edge, panel)], [
			{ u: 0.5, v: 0.5, distance: 2 }, { u: 0, v: 0, distance: 2 }
		]);
	});

	test('rejects rays outside the panel, parallel to it, behind it, or pointing away', () => {
		const outside = new Float32Array(identity);
		outside[12] = 1.01;
		const parallel = new Float32Array(identity);
		parallel[10] = 0;
		const behind = new Float32Array(identity);
		behind[14] = -3;
		const away = new Float32Array(identity);
		away[10] = -1;
		assert.deepStrictEqual([outside, parallel, behind, away].map(ray => intersectPanel(ray, panel)), [undefined, undefined, undefined, undefined]);
	});

	test('translated and rotated reference spaces preserve pointing coordinates', () => {
		const anchor = new Float32Array([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3, 2, 1, 1]);
		const inverse = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, -2, -3, 1]);
		assert.deepStrictEqual(intersectPanel(multiplyMatrices(inverse, anchor), panel), { u: 0.5, v: 0.5, distance: 2 });
	});

	test('typing replaces a selection in the real model and supports undo/redo', () => {
		withTestCodeEditor('const value = 1;', {}, editor => {
			editor.setSelection(new Selection(1, 15, 1, 16));
			runHorizonEdit(editor, 'type', '42');
			const typed = editor.getValue();
			editor.getModel()!.undo();
			const undone = editor.getValue();
			editor.getModel()!.redo();
			assert.deepStrictEqual([typed, undone, editor.getValue()], ['const value = 42;', 'const value = 1;', 'const value = 42;']);
		});
	});

	test('read-only models reject virtual keyboard edits', () => {
		withTestCodeEditor('protected', { readOnly: true }, editor => {
			editor.setPosition({ lineNumber: 1, column: 10 });
			runHorizonEdit(editor, 'type', 'x');
			runHorizonEdit(editor, 'deleteLeft');
			assert.strictEqual(editor.getValue(), 'protected');
		});
	});

	test('backspace treats a surrogate pair as one character', () => {
		withTestCodeEditor('a😀', {}, editor => {
			editor.setPosition({ lineNumber: 1, column: 4 });
			runHorizonEdit(editor, 'deleteLeft');
			assert.strictEqual(editor.getValue(), 'a');
		});
	});

	test('virtual keyboard applies text at every cursor', () => {
		withTestCodeEditor('a\nb', {}, editor => {
			editor.setSelections([new Selection(1, 2, 1, 2), new Selection(2, 2, 2, 2)]);
			runHorizonEdit(editor, 'type', ';');
			assert.strictEqual(editor.getValue(), 'a;\nb;');
		});
	});
});
