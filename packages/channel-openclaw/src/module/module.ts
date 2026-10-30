/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    AppToken,
    ModuleName,
    approvalUrlOf,
    envString,
    envUrl,
} from '@chamvi/app';
import type { IContainer, IModule } from '@chamvi/app';
import { OPENCLAW_CHANNEL_NAME } from '../channel/constants.ts';
import { openclawChannel } from '../channel/module.ts';
import type { OpenclawChannelOptions } from '../channel/types.ts';
import { ERROR_PREFIX, VARIABLES } from './constants.ts';
import { readDelivery } from './helpers.ts';
import type { OpenclawModuleOptions } from './types.ts';

type EnvOption = keyof typeof VARIABLES;

/**
 * Contributes `openclawChannel()` to `AppToken.CHANNELS`, options resolved
 * and checked when the factory is called; tools reach it with
 * `ctx.channels.findOne(name)`.
 */
export class OpenclawModule implements IModule {
    readonly name: string;

    readonly dependencies = [ModuleName.CONFIG];

    protected options: Omit<OpenclawChannelOptions, 'clock'> & Pick<Partial<OpenclawChannelOptions>, 'clock'>;

    constructor(input: OpenclawModuleOptions = {}) {
        const { env: given, ...options } = input;
        const env = given ?? process.env;
        const fromEnv = new Set<EnvOption>();
        const read = <T>(key: EnvOption, given: T | undefined, reader: () => T): T => {
            if (typeof given !== 'undefined') {
                return given;
            }

            fromEnv.add(key);

            return reader();
        };

        const hooksPath = read('hooksPath', options.hooksPath, () => envString(env, VARIABLES.hooksPath));
        const agentId = read('agentId', options.agentId, () => envString(env, VARIABLES.agentId));

        if (typeof options.deliver === 'undefined') {
            fromEnv.add('deliver.channel').add('deliver.to').add('deliver.accountId');
        }

        this.options = {
            ...options,
            baseUrl: read('baseUrl', options.baseUrl, () => envUrl(env, VARIABLES.baseUrl, { required: true, protocols: ['http:', 'https:'] })),
            hooksToken: read('hooksToken', options.hooksToken, () => envString(env, VARIABLES.hooksToken, { required: true })),
            deliver: options.deliver ?? readDelivery(env),
            ...(typeof hooksPath === 'string' && { hooksPath }),
            ...(typeof agentId === 'string' && { agentId }),
        };
        this.name = `chamvi:channel:${options.name ?? OPENCLAW_CHANNEL_NAME}`;
        this.check(fromEnv);
    }

    /**
     * Runs openclawChannel()'s option checks now, so a malformed value fails when the
     * factory is called; an error about a value read from env names the variable.
     */
    protected check(fromEnv: ReadonlySet<EnvOption>): void {
        try {
            openclawChannel(this.options);
        } catch (error) {
            if (error instanceof InvalidAgentDefinitionError && error.message.startsWith(ERROR_PREFIX)) {
                const rule = error.message.slice(ERROR_PREFIX.length);
                const key = [...fromEnv].find((option) => rule.startsWith(`${option} `));

                if (key) {
                    throw new InvalidAgentDefinitionError(`${VARIABLES[key]}${rule.slice(key.length)}`);
                }
            }

            throw error;
        }
    }

    async setup(container: IContainer): Promise<void> {
        const approvalUrl = this.options.approvalUrl ?? approvalUrlOf(container.resolve(AppToken.CONFIG));
        const channel = openclawChannel({
            ...this.options,
            ...(approvalUrl && { approvalUrl }),
            clock: this.options.clock ?? container.resolve(AppToken.CLOCK),
        });

        container.registerMany(AppToken.CHANNELS, { useValue: channel });
    }
}

/**
 * The OpenClaw channel module. Reads `OPENCLAW_BASE_URL`,
 * `OPENCLAW_HOOKS_TOKEN`, `OPENCLAW_CHANNEL`, `OPENCLAW_TO` (required),
 * `OPENCLAW_HOOKS_PATH`, `OPENCLAW_AGENT_ID` and `OPENCLAW_ACCOUNT_ID` from
 * `options.env ?? process.env` now; options win.
 */
export function openclawModule(options?: OpenclawModuleOptions): IModule {
    return new OpenclawModule(options);
}
