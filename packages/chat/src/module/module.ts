/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { AppToken } from '@chamvi/app';
import type { IContainer, IModule } from '@chamvi/app';
import { isObject } from 'smob';
import { isChatChannel } from '../channel/helpers.ts';
import type { ChatChannel } from '../channel/types.ts';
import type { ChatModuleOptions } from './types.ts';

/**
 * Contributes a prebuilt chat channel to `AppToken.CHANNELS`: the engine
 * starts and stops it with the others, and the http module mounts its `in`
 * (webhook adapters only) at `/channels/<name>`. The module adds no start
 * step, route or env variable and constructs nothing, so `start --check`
 * neither initializes the Chat nor connects.
 */
export class ChatModule implements IModule {
    readonly name: string;

    protected channel: ChatChannel;

    constructor(options: ChatModuleOptions) {
        if (!isObject(options) || !isChatChannel(options.channel)) {
            throw new InvalidAgentDefinitionError('chatModule: channel must be a channel of chatChannel().');
        }

        this.channel = options.channel;
        this.name = `chamvi:channel:${options.channel.name}`;
    }

    async setup(container: IContainer): Promise<void> {
        container.registerMany(AppToken.CHANNELS, { useValue: this.channel });
    }
}

/** The chat channel module: `chatModule({ channel: chatChannel({ ... }) })`. */
export function chatModule(options: ChatModuleOptions): IModule {
    return new ChatModule(options);
}
