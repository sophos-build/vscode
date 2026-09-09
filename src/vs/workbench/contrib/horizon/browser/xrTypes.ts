/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The subset of WebXR used here, scoped to this module until lib.dom includes WebXR.
export interface XRSpace { readonly __space: never }
export interface XRTransform { readonly matrix: Float32Array; readonly inverse: { readonly matrix: Float32Array } }
export interface XRView { readonly projectionMatrix: Float32Array; readonly transform: XRTransform }
export interface XRInputSource { readonly targetRaySpace: XRSpace }
export interface XRFrame {
	getViewerPose(space: XRSpace): { readonly views: readonly XRView[]; readonly transform: XRTransform } | null;
	getPose(space: XRSpace, base: XRSpace): { readonly transform: XRTransform } | null;
}
export interface XRSelectEvent extends Event { readonly frame: XRFrame; readonly inputSource: XRInputSource }
export interface XRLayer {
	readonly framebuffer: WebGLFramebuffer;
	getViewport(view: XRView): { x: number; y: number; width: number; height: number };
}
export interface XRSession extends EventTarget {
	readonly inputSources: readonly XRInputSource[];
	readonly visibilityState: string;
	requestReferenceSpace(type: 'local'): Promise<XRSpace>;
	updateRenderState(state: { baseLayer: XRLayer }): void;
	requestAnimationFrame(callback: (time: number, frame: XRFrame) => void): number;
	end(): Promise<void>;
}
export interface XRSystem {
	requestSession(mode: 'immersive-vr', options: { requiredFeatures: string[] }): Promise<XRSession>;
}
export interface XRWindow extends Window {
	XRWebGLLayer?: new (session: XRSession, context: WebGLRenderingContext) => XRLayer;
}
