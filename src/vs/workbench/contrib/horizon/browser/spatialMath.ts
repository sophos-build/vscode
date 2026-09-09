/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SpatialPanel {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly width: number;
	readonly height: number;
}

export interface PanelHit { readonly u: number; readonly v: number; readonly distance: number }

/** Intersect a WebXR -Z target ray with a front-facing panel. UV starts at the top left. */
export function intersectPanel(matrix: Float32Array, panel: SpatialPanel): PanelHit | undefined {
	const dz = -matrix[10];
	if (dz >= -0.00001) {
		return undefined;
	}
	const distance = (panel.z - matrix[14]) / dz;
	if (distance <= 0) {
		return undefined;
	}
	const u = (matrix[12] - matrix[8] * distance - panel.x) / panel.width + 0.5;
	const v = 0.5 - (matrix[13] - matrix[9] * distance - panel.y) / panel.height;
	return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v, distance } : undefined;
}

/** Multiply column-major transforms, including projection matrices. */
export function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
	const result = new Float32Array(16);
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			for (let k = 0; k < 4; k++) {
				result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
			}
		}
	}
	return result;
}
