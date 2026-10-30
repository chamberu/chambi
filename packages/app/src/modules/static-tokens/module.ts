/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomBytes } from 'node:crypto';
import { staticTokens } from '@chamvi/http';
import type { StaticToken } from '@chamvi/http';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { AUTHENTICATOR_ORDER, AppToken, ModuleName } from '../../module/constants.ts';
import {
    DEV_TOKEN_BYTES,
    DEV_TOKEN_ID,
    STATIC_TOKENS_AUTHENTICATOR,
} from './constants.ts';
import type { StaticTokensModuleOptions } from './types.ts';

/**
 * Contributes the static-token authenticator (`options.tokens`, else
 * `CHAMVI_TOKENS`) in `setup`. Without tokens it contributes nothing, except
 * in dev without any other authenticator: then `onReady` (after every module
 * contributed) generates one token with every permission and logs it.
 */
export class StaticTokensModule implements IModule {
    readonly name: string = ModuleName.STATIC_TOKENS;

    readonly dependencies = [ModuleName.CONFIG];

    protected options: StaticTokensModuleOptions;

    constructor(options: StaticTokensModuleOptions = {}) {
        this.options = options;
    }

    async setup(container: IContainer): Promise<void> {
        const config = container.resolve(AppToken.CONFIG);
        const tokens: StaticToken[] = this.options.tokens ?? config.tokens ?? [];

        if (tokens.length > 0) {
            this.contribute(container, tokens);
        }
    }

    async onReady(container: IContainer): Promise<void> {
        const config = container.resolve(AppToken.CONFIG);

        if (!config.dev || container.resolveAll(AppToken.AUTHENTICATORS).length > 0) {
            return;
        }

        const value = randomBytes(DEV_TOKEN_BYTES).toString('base64url');

        container.resolve(AppToken.LOGGER).warn(
            'CHAMVI_TOKENS unset: generated a dev token with every permission for this process; set CHAMVI_TOKENS to choose your own.',
            { token: value },
        );
        this.contribute(container, [{
            value,
            id: DEV_TOKEN_ID,
            permissions: ['*'],
        }]);
    }

    protected contribute(container: IContainer, tokens: StaticToken[]): void {
        container.registerMany(AppToken.AUTHENTICATORS, {
            useValue: {
                name: STATIC_TOKENS_AUTHENTICATOR,
                order: AUTHENTICATOR_ORDER.STATIC_TOKENS,
                authenticator: staticTokens({ tokens }),
            },
        });
    }
}

export function staticTokensModule(options?: StaticTokensModuleOptions): IModule {
    return new StaticTokensModule(options);
}
