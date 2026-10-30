/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { AppToken } from '@chamvi/app';
import type { IContainer, IModule } from '@chamvi/app';
import { uiRoutes } from '../routes/module.ts';
import type { UiRoutesOptions } from '../routes/types.ts';
import { UI_MODULE_NAME } from './constants.ts';
import { readAuth } from './helpers.ts';
import type { UiModuleOptions } from './types.ts';

/** Contributes the dashboard's `uiRoutes()` to `AppToken.HTTP_ROUTES`. */
export class UiModule implements IModule {
    readonly name: string = UI_MODULE_NAME;

    protected options: UiRoutesOptions;

    constructor(input: UiModuleOptions = {}) {
        const { env, ...options } = input;

        this.options = {
            ...options,
            auth: options.auth ?? readAuth(env ?? process.env),
        };
    }

    async setup(container: IContainer): Promise<void> {
        for (const route of uiRoutes(this.options)) {
            container.registerMany(AppToken.HTTP_ROUTES, { useValue: route });
        }
    }
}

/**
 * The dashboard module (`/ui` under `CHAMVI_BASE_PATH`). Reads
 * `CHAMVI_UI_AUTHUP_CLIENT_ID`, `CHAMVI_UI_AUTHUP_REALM_ID` and `AUTHUP_URL`
 * from `options.env ?? process.env` now, unless `auth` is given.
 */
export function uiModule(options?: UiModuleOptions): IModule {
    return new UiModule(options);
}
