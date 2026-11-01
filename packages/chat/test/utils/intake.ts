/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { Chat } from 'chat';
import { Engine, createMemoryStore } from '@chamvi/core';
import type {
    Agent,
    ConversationAccess,
    IStore,
    Run,
} from '@chamvi/core';
import { chatChannel, createChatIngressAdapter } from '@chamvi/chat';
import type { ChatChannel, ChatChannelOptions, ChatIngress } from '@chamvi/chat';
import { ControllableClock } from '@chamvi/test-kit';
import { createFakeAdapter } from './adapter.ts';
import type { FakeAdapter } from './adapter.ts';
import { createMemoryState, createRecordingLogger } from './chat.ts';

export type IntakeFixture = {
    adapter: FakeAdapter;
    ingress: ChatIngress;
    chat: Chat;
    clock: ControllableClock;
    store: IStore;
    engine: Engine;
    channel: ChatChannel;
    /** what the channel's onError got */
    errors: unknown[];
    /** what the engine's onError got */
    engineErrors: unknown[];
    /** the conversation authorize calls */
    access: ConversationAccess[];
    runs(): Promise<Run[]>;
};

export type IntakeFixtureInput = {
    agents: (channel: ChatChannel) => Agent[];
    patch?: Partial<ChatChannelOptions>;
    /** replaces the memory store (a recording or failing proxy over it) */
    store?: (store: ReturnType<typeof createMemoryStore>) => IStore;
    /** the conversation policy; default allow */
    authorize?: (access: ConversationAccess) => boolean | Promise<boolean>;
};

/** A chat channel with the real intake over the fake adapter, on an Engine with a memory store (conversations included). */
export function createIntakeFixture(input: IntakeFixtureInput): IntakeFixture {
    const clock = new ControllableClock(new Date('2026-11-01T09:00:00Z'));
    const adapter = createFakeAdapter();
    const ingress = createChatIngressAdapter(adapter);
    const chat = new Chat({
        userName: 'chamvi',
        adapters: { [ingress.name]: ingress },
        state: createMemoryState(),
        logger: createRecordingLogger(),
        concurrency: 'concurrent',
    });
    const errors: unknown[] = [];
    const engineErrors: unknown[] = [];
    const access: ConversationAccess[] = [];
    const channel = chatChannel({
        chat,
        adapters: [ingress],
        allowMessage: () => true,
        onError: (error) => {
            errors.push(error);
        },
        ...input.patch,
    });
    const memory = createMemoryStore({ clock });
    const store = input.store ? input.store(memory) : memory;
    const engine = new Engine({
        store,
        agents: input.agents(channel),
        channels: [channel],
        clock,
        conversations: {
            authorize: (item) => {
                access.push(item);

                return input.authorize ? input.authorize(item) : true;
            },
        },
        onError: (error) => {
            engineErrors.push(error);
        },
    });

    return {
        adapter,
        ingress,
        chat,
        clock,
        store,
        engine,
        channel,
        errors,
        engineErrors,
        access,
        runs: async () => (await memory.runs.find({})).data,
    };
}

/** lets queued promise work run (no timers) */
export function flush(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}
