/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { HorizonRenderer, HorizonXRGraphics } from '../../browser/horizonRenderer.js';
import { XRFrame, XRInputSource, XRLayer, XRSession, XRSpace } from '../../browser/xrTypes.js';

suite('Horizon WebXR renderer', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	const space = {} as XRSpace;
	const transform = { matrix: identity, inverse: { matrix: identity } };
	const frame: XRFrame = {
		getViewerPose: () => ({ transform, views: [{ transform, projectionMatrix: identity }, { transform, projectionMatrix: identity }] }),
		getPose: () => ({ transform })
	};

	class TestSession extends EventTarget implements XRSession {
		readonly inputSources: XRInputSource[] = [{ targetRaySpace: space }, { targetRaySpace: space }];
		visibilityState = 'visible';
		ended = 0;
		callback: ((time: number, frame: XRFrame) => void) | undefined;
		async requestReferenceSpace(): Promise<XRSpace> { return space; }
		updateRenderState(): void { }
		requestAnimationFrame(callback: (time: number, frame: XRFrame) => void): number { this.callback = callback; return 1; }
		async end(): Promise<void> { this.ended++; this.dispatchEvent(new Event('end')); }
		select(source: XRInputSource): void {
			class SelectEvent extends Event {
				readonly frame = frame;
				readonly inputSource = source;
			}
			this.dispatchEvent(new SelectEvent('select'));
		}
	}

	test('renders stereo frames, selects once per hand, ignores hidden input, and releases the session', async () => {
		const canvas = mainWindow.document.createElement('canvas');
		canvas.width = canvas.height = 64;
		canvas.getContext('2d')!.fillRect(0, 0, 64, 64);
		const hits: number[][] = [];
		const errors: Error[] = [];
		let ended = 0;
		let views = 0;
		let graphicsError: number | undefined;
		const graphics: HorizonXRGraphics = {
			makeCompatible: async () => { },
			createLayer: (_session, gl): XRLayer => {
				const framebuffer = gl.createFramebuffer()!;
				const color = gl.createRenderbuffer()!;
				gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
				gl.bindRenderbuffer(gl.RENDERBUFFER, color);
				gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, 64, 64);
				gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
				disposables.add({ dispose: () => { gl.deleteFramebuffer(framebuffer); gl.deleteRenderbuffer(color); } });
				return {
					framebuffer, getViewport: () => {
						views++;
						graphicsError = gl.getError();
						return { x: 0, y: 0, width: 64, height: 64 };
					}
				};
			}
		};
		const renderer = disposables.add(new HorizonRenderer([
			{ canvas, x: 0, y: 0, z: -0.5, width: 1, height: 1, activate: (u, v) => hits.push([u, v]) }
		], () => ended++, error => errors.push(error), graphics));
		const session = new TestSession();
		await renderer.start(session);
		session.callback!(0, frame);
		session.inputSources.forEach(source => session.select(source));
		session.visibilityState = 'hidden';
		session.select(session.inputSources[0]);
		await session.end();
		session.select(session.inputSources[0]);
		assert.deepStrictEqual({ hits, errors, ended, views, graphicsError, sessionEnds: session.ended }, {
			hits: [[0.5, 0.5], [0.5, 0.5]], errors: [], ended: 1, views: 2, graphicsError: 0, sessionEnds: 1
		});
	});

	test('a session arriving after preview disposal is immediately ended', async () => {
		const canvas = mainWindow.document.createElement('canvas');
		const renderer = disposables.add(new HorizonRenderer([
			{ canvas, x: 0, y: 0, z: -1, width: 1, height: 1, activate: () => { } }
		], () => { }, error => { throw error; }));
		renderer.dispose();
		const session = new TestSession();
		await renderer.start(session);
		assert.deepStrictEqual({ ended: session.ended, callback: session.callback }, { ended: 1, callback: undefined });
	});
});
