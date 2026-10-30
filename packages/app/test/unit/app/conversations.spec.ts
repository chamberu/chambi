/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryConversationRepository, createMemoryStore, defineAgent } from '@chamvi/core';
import type { Engine, IConversationRepository } from '@chamvi/core';
import { ControllableClock, textModel  } from '@chamvi/test-kit';
import type { IContainer } from 'eldin';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    AppToken,
    configModule,
    createApp,
    storeModule,
} from '@chamvi/app';
import type { AppOptions, IApp } from '@chamvi/app';
import { TOKENS } from '../../utils/app.ts';
import { createRecordingLogger } from '../../utils/logger.ts';

const identity = {
    agent: 'helper',
    channel: 'chat',
    account: 'main',
    chat: 'example',
    audience: 'direct',
};
const apps: IApp[] = [];

afterEach(async () => {
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    apps.length = 0;
});

function build(conversations?: AppOptions['conversations'], store?: IConversationRepository) {
    const clock = new ControllableClock(new Date('2026-10-28T00:00:00Z'));
    const logger = createRecordingLogger(clock);
    let container: IContainer;
    const app = createApp({
        agents: [defineAgent({
            name: 'helper',
            instructions: 'Help.',
            model: textModel(),
            conversation: conversations !== undefined,
        })],
        ...(conversations !== undefined && { conversations }),
        modules: [
            configModule({ clock, logger }),
            ...(store ? [storeModule({ store: { ...createMemoryStore({ clock }), conversations: store } })] : []),
            {
                name: 'test:capture',
                async setup(value) {
                    container = value;
                },
            },
        ],
    });

    apps.push(app);

    return {
        app,
        clock,
        logger,
        container: () => container!,
    };
}

const env = { CHAMVI_TOKENS: TOKENS };

describe('app conversation capability', () => {
    it('disabled_default_keeps_memory_inactive', async () => {
        const built = build();

        await built.app.check({ env });
        expect(built.container().resolve(AppToken.STORE).conversations).toBeInstanceOf(MemoryConversationRepository);
        expect(built.container().has(AppToken.DATA_SOURCE)).toBe(false);
    });

    it('custom_store_respected and check_writes_nothing', async () => {
        const calls: PropertyKey[] = [];
        const custom = new Proxy(new MemoryConversationRepository(), {
            get(target, key) {
                const value = Reflect.get(target, key);

                return typeof value === 'function' ? (...args: unknown[]) => {
                    calls.push(key);

                    return value.apply(target, args);
                } : value;
            },
        }) as IConversationRepository;
        const built = build({ authorize: () => true }, custom);

        await built.app.check({ env });
        expect(built.container().resolve(AppToken.STORE).conversations!).toBe(custom);
        expect(calls).toEqual([]);
    });

    it('memory_store_warns_no_restart_durability and uses app clock', async () => {
        const built = build({ authorize: () => true });

        await built.app.check({ env });

        const store = built.container().resolve(AppToken.STORE).conversations!;

        expect(store).toBeInstanceOf(MemoryConversationRepository);

        const engine = built.container().resolve(AppToken.ENGINE) as Engine;

        expect(await engine.inspectConversation(identity)).toBeUndefined();

        const scope = await store.resolve(identity);
        const begun = await store.beginTurn(scope, 'clock-run', 'hello', {
            maxItems: 20,
            maxHistoryBytes: 32768,
            maxNotesBytes: 8192,
            maxItemBytes: 16384,
            retentionMs: 10000,
            maxStoredItems: 1000,
        });

        expect(begun.kind === 'ready' && begun.snapshot.createdAt).toEqual(built.clock.now());
        expect(built.logger.entries.some((entry) => entry.level === 'warn' && /conversation.*restart/i.test(entry.msg))).toBe(true);
    });

    it('two_apps_no_global_context', async () => {
        const first = build({ authorize: () => true });
        const second = build({ authorize: () => false });

        await first.app.check({ env });
        await second.app.check({ env });

        const firstRepository = first.container().resolve(AppToken.STORE).conversations!;
        const secondRepository = second.container().resolve(AppToken.STORE).conversations!;

        expect(firstRepository).not.toBe(secondRepository);
        await firstRepository.resolve(identity);
        expect(await secondRepository.findOne(identity)).toBeUndefined();
    });

    it('copies limits before later caller mutation', async () => {
        const limits = { maxItems: 1 };
        const built = build({ authorize: () => true, limits });

        limits.maxItems = -1;
        await expect(built.app.check({ env })).resolves.toEqual({ issues: [] });
    });

    it.each([null, 42])('rejects malformed limits without replacing them with defaults: %s', async (limits) => {
        const built = build({ authorize: () => true, limits: limits as never });

        await expect(built.app.check({ env })).rejects.toMatchObject({ code: 'invalid_agent_definition' });
    });

    it('requires a conversation authorizer', () => {
        expect(() => build({} as AppOptions['conversations'])).toThrow(/authoriz/i);
    });
});
