/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { consoleChannel } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { AppToken, ModuleName } from '../../module/constants.ts';
import type { ConsoleChannelModuleOptions } from './types.ts';

/**
 * Contributes `consoleChannel(options)` to `AppToken.CHANNELS` (out only):
 * tools reach it through `ctx.channels.findOne('console')`, and approvals a
 * tool requests on it are written to the console. Named `chamvi:console`,
 * or `chamvi:console:<name>` for a channel of another name.
 */
export class ConsoleChannelModule implements IModule {
    readonly name: string;

    protected options: ConsoleChannelModuleOptions;

    constructor(options: ConsoleChannelModuleOptions = {}) {
        this.options = options;
        this.name = options.name === undefined ? ModuleName.CONSOLE : `${ModuleName.CONSOLE}:${options.name}`;
    }

    async setup(container: IContainer): Promise<void> {
        if (container.resolve(AppToken.CONTEXT).mode === 'migrate') {
            return;
        }

        container.registerMany(AppToken.CHANNELS, { useValue: consoleChannel(this.options) });
    }
}

export function consoleChannelModule(options?: ConsoleChannelModuleOptions): IModule {
    return new ConsoleChannelModule(options);
}
