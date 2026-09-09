/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { HorizonWorkbench } from './horizonWorkbench.js';

class HorizonContribution extends Disposable {
	static readonly ID = 'workbench.contrib.horizon';
	private readonly workbench = this._register(new MutableDisposable<HorizonWorkbench>());

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		super();
		const open = () => {
			if (!this.workbench.value) {
				this.workbench.value = instantiationService.createInstance(HorizonWorkbench, () => this.workbench.clear());
			}
		};
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({ id: 'workbench.action.horizon.open', title: localize2('horizon.open', "Horizon: Open Immersive Editor"), f1: true });
			}
			run(): void { open(); }
		}));
	}
}

registerWorkbenchContribution2(HorizonContribution.ID, HorizonContribution, WorkbenchPhase.AfterRestored);
