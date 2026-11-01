/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { Chat } from 'chat';
import type { StateAdapter } from 'chat';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { defineAgent } from '@chamvi/core';
import {
    configModule,
    createApp,
    createLogger,
} from '@chamvi/app';
import type { IApp } from '@chamvi/app';
import { chatChannel, createChatIngressAdapter } from '@chamvi/chat';
import { chatModule } from '@chamvi/chat/module';
import { ControllableClock, textModel } from '@chamvi/test-kit';
import { createFakeAdapter } from '../../utils/adapter.ts';
import { createMemoryState, createRecordingLogger } from '../../utils/chat.ts';

const TOKENS = JSON.stringify([{
    value: 'a-static-token-of-length',
    id: 'ops',
    permissions: ['*'],
}]);

const apps: IApp[] = [];

afterEach(async () => {
    await Promise.all(apps.map((app) => app.stop()));
    apps.length = 0;
});

/** the state adapter, every call recorded by method name */
function recordingState(calls: string[]): StateAdapter {
    const state = createMemoryState();

    return new Proxy(state, {
        get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);

            if (typeof value !== 'function') {
                return value;
            }

            return (...args: unknown[]) => {
                calls.push(String(key));

                return (value as (...input: unknown[]) => unknown).apply(target, args);
            };
        },
    });
}

describe('chatModule under start --check', () => {
    it('check_no_sdk_or_auth_writes', async () => {
        const stateCalls: string[] = [];
        const connects: number[] = [];
        const adapter = createFakeAdapter();
        const ingress = createChatIngressAdapter(adapter);
        const chat = new Chat({
            userName: 'chamvi',
            adapters: { [ingress.name]: ingress },
            state: recordingState(stateCalls),
            logger: createRecordingLogger(),
            concurrency: 'concurrent',
        });
        const channel = chatChannel({
            chat,
            adapters: [ingress],
            webhooks: ['fake'],
            allowMessage: () => true,
            connect: async () => {
                connects.push(1);
            },
        });
        const app = createApp({
            agents: [defineAgent({
                name: 'assistant',
                model: textModel(),
                instructions: 'Answer.',
                channels: [channel.on()],
            })],
            modules: [
                configModule({
                    clock: new ControllableClock(new Date('2026-11-01T09:00:00Z')),
                    logger: createLogger({ level: 'error', write: () => undefined }),
                }),
                chatModule({ channel }),
            ],
        });

        apps.push(app);

        await expect(app.check({ env: { CHAMVI_TOKENS: TOKENS, PORT: '4999' } })).resolves.toEqual({ issues: [] });

        expect(adapter.initializeCalls).toBe(0);
        expect(adapter.chat).toBeUndefined();
        expect(connects).toEqual([]);
        expect(stateCalls).toEqual([]);
        expect(adapter.posts).toEqual([]);
        // the check never listened, so nothing served the webhook path either
        expect(adapter.chat).toBeUndefined();
    });
});
