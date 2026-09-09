/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { intersectPanel, multiplyMatrices, SpatialPanel } from './spatialMath.js';
import { XRFrame, XRLayer, XRSelectEvent, XRSession, XRSpace, XRWindow } from './xrTypes.js';

export interface HorizonPanel extends SpatialPanel {
	readonly canvas: HTMLCanvasElement;
	activate(u: number, v: number): void;
}

export interface HorizonXRGraphics {
	makeCompatible(context: WebGLRenderingContext): Promise<void>;
	createLayer(session: XRSession, context: WebGLRenderingContext, window: Window): XRLayer;
}

const browserGraphics: HorizonXRGraphics = {
	makeCompatible: context => (context as WebGLRenderingContext & { makeXRCompatible(): Promise<void> }).makeXRCompatible(),
	createLayer: (session, context, window) => {
		const Layer = (window as XRWindow).XRWebGLLayer;
		if (!Layer) { throw new Error(localize('horizon.layer', "WebXR graphics layers are unavailable.")); }
		return new Layer(session, context);
	}
};

/** A small WebGL renderer that shares canvas surfaces and hit targets with the desktop preview. */
export class HorizonRenderer extends Disposable {
	private readonly gl: WebGLRenderingContext;
	private readonly textures: WebGLTexture[] = [];
	private readonly cursor: WebGLTexture;
	private readonly matrixLocation: WebGLUniformLocation;
	private session: XRSession | undefined;
	private space: XRSpace | undefined;
	private layer: XRLayer | undefined;
	private anchor: Float32Array | undefined;
	private inverseAnchor: Float32Array | undefined;
	private dirty = true;
	private disposed = false;
	private ending: Promise<void> = Promise.resolve();

	constructor(private readonly panels: readonly HorizonPanel[], private readonly onEnd: () => void, private readonly onError: (error: Error) => void, private readonly graphics: HorizonXRGraphics = browserGraphics) {
		super();
		try {
			const canvas = panels[0].canvas.ownerDocument.createElement('canvas');
			const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
			if (!gl) {
				throw new Error(localize('horizon.webgl', "WebGL is unavailable in this browser."));
			}
			this.gl = gl;
			this._register(toDisposable(() => gl.getExtension('WEBGL_lose_context')?.loseContext()));
			this._register(addDisposableListener(canvas, 'webglcontextlost', event => {
				event.preventDefault();
				this.onError(new Error(localize('horizon.contextLost', "The graphics context was lost. Exit and reopen the immersive editor.")));
				this.dispose();
			}));
			const program = gl.createProgram();
			const buffer = gl.createBuffer();
			if (!program || !buffer) {
				throw new Error(localize('horizon.resources', "Unable to allocate graphics resources."));
			}
			this._register(toDisposable(() => { gl.deleteProgram(program); gl.deleteBuffer(buffer); }));
			const sources = [
				[gl.VERTEX_SHADER, 'attribute vec3 position; attribute vec2 uv; uniform mat4 matrix; varying vec2 texcoord; void main() { texcoord = uv; gl_Position = matrix * vec4(position, 1.0); }'],
				[gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D surface; varying vec2 texcoord; void main() { gl_FragColor = texture2D(surface, texcoord); }']
			] as const;
			for (const [type, source] of sources) {
				const shader = gl.createShader(type);
				if (!shader) {
					throw new Error(localize('horizon.shader', "Unable to create a graphics shader."));
				}
				this._register(toDisposable(() => gl.deleteShader(shader)));
				gl.shaderSource(shader, source);
				gl.compileShader(shader);
				if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
					throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL shader compilation failed');
				}
				gl.attachShader(program, shader);
			}
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program linking failed');
			}
			gl.useProgram(program);
			const matrixLocation = gl.getUniformLocation(program, 'matrix');
			if (!matrixLocation) {
				throw new Error('Missing WebGL matrix uniform');
			}
			this.matrixLocation = matrixLocation;
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			const position = gl.getAttribLocation(program, 'position');
			const uv = gl.getAttribLocation(program, 'uv');
			gl.enableVertexAttribArray(position);
			gl.enableVertexAttribArray(uv);
			gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 20, 0);
			gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12);
			for (const panel of panels) {
				this.textures.push(this.createTexture(panel.canvas));
			}
			const cursorCanvas = canvas.ownerDocument.createElement('canvas');
			cursorCanvas.width = cursorCanvas.height = 32;
			const context = cursorCanvas.getContext('2d')!;
			context.fillStyle = '#000000';
			context.beginPath();
			context.arc(16, 16, 15, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = '#ffffff'; // Dual contrast reticle must remain visible over arbitrary source text.
			context.beginPath();
			context.arc(16, 16, 10, 0, Math.PI * 2);
			context.fill();
			this.cursor = this.createTexture(cursorCanvas);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	private createTexture(canvas: HTMLCanvasElement): WebGLTexture {
		const gl = this.gl;
		const texture = gl.createTexture();
		if (!texture) {
			throw new Error(localize('horizon.texture', "Unable to allocate a panel texture."));
		}
		this._register(toDisposable(() => gl.deleteTexture(texture)));
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
		return texture;
	}

	/** The caller requests the session directly from a user gesture and hands ownership to this renderer. */
	async start(session: XRSession): Promise<void> {
		if (this.disposed) {
			await session.end();
			return;
		}
		this.session = session;
		this._register(addDisposableListener(session, 'end', () => {
			this.session = undefined;
			this.dispose();
			this.onEnd();
		}));
		const gl = this.gl;
		await this.graphics.makeCompatible(gl);
		if (this.disposed) { return; }
		this.layer = this.graphics.createLayer(session, gl, this.panels[0].canvas.ownerDocument.defaultView!);
		session.updateRenderState({ baseLayer: this.layer });
		this.space = await session.requestReferenceSpace('local');
		if (this.disposed) { return; }
		this._register(addDisposableListener(session, 'select', event => {
			const select = event as XRSelectEvent;
			if (session.visibilityState !== 'visible' || !this.space || !this.inverseAnchor) { return; }
			const pose = select.frame.getPose(select.inputSource.targetRaySpace, this.space);
			if (!pose) { return; }
			const ray = multiplyMatrices(this.inverseAnchor, pose.transform.matrix);
			for (const panel of this.panels) {
				const hit = intersectPanel(ray, panel);
				if (hit) { panel.activate(hit.u, hit.v); break; }
			}
		}));
		session.requestAnimationFrame(this.renderFrame);
	}

	invalidate(): void { this.dirty = true; }
	recenter(): void { this.anchor = this.inverseAnchor = undefined; }

	private readonly renderFrame = (_time: number, frame: XRFrame): void => {
		const { session, space, layer, gl } = this;
		if (!session || !space || !layer || this.disposed) { return; }
		try {
			session.requestAnimationFrame(this.renderFrame);
			const pose = frame.getViewerPose(space);
			if (!pose) { return; }
			if (!this.anchor) {
				this.anchor = new Float32Array(pose.transform.matrix);
				this.inverseAnchor = new Float32Array(pose.transform.inverse.matrix);
			}
			gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
			gl.clearColor(0.025, 0.035, 0.055, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			if (this.dirty) {
				this.panels.forEach((panel, index) => {
					gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panel.canvas);
				});
				this.dirty = false;
			}
			const cursors: SpatialPanel[] = [];
			if (session.visibilityState === 'visible') {
				for (const source of session.inputSources) {
					const input = frame.getPose(source.targetRaySpace, space);
					if (!input) { continue; }
					const ray = multiplyMatrices(this.inverseAnchor!, input.transform.matrix);
					for (const panel of this.panels) {
						const hit = intersectPanel(ray, panel);
						if (hit) {
							cursors.push({ x: panel.x + (hit.u - 0.5) * panel.width, y: panel.y + (0.5 - hit.v) * panel.height, z: panel.z + 0.002, width: 0.018, height: 0.018 });
							break;
						}
					}
				}
			}
			for (const view of pose.views) {
				const viewport = layer.getViewport(view);
				gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
				gl.uniformMatrix4fv(this.matrixLocation, false, multiplyMatrices(multiplyMatrices(view.projectionMatrix, view.transform.inverse.matrix), this.anchor));
				this.panels.forEach((panel, index) => this.draw(panel, this.textures[index]));
				cursors.forEach(cursor => this.draw(cursor, this.cursor));
			}
		} catch (error) {
			this.onError(error instanceof Error ? error : new Error(String(error)));
			this.dispose();
		}
	};

	private draw(panel: SpatialPanel, texture: WebGLTexture): void {
		const { gl } = this;
		const left = panel.x - panel.width / 2;
		const right = panel.x + panel.width / 2;
		const top = panel.y + panel.height / 2;
		const bottom = panel.y - panel.height / 2;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
			left, top, panel.z, 0, 0, left, bottom, panel.z, 0, 1,
			right, top, panel.z, 1, 0, right, bottom, panel.z, 1, 1
		]), gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	async stop(): Promise<void> {
		this.dispose();
		await this.ending;
	}

	override dispose(): void {
		if (this.disposed) { return; }
		this.disposed = true;
		const session = this.session;
		this.session = undefined;
		if (session) { this.ending = session.end().catch(error => this.onError(error)); }
		super.dispose();
	}
}
