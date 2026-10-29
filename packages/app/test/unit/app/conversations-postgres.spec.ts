/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { DataSource } from 'typeorm';
import { afterEach, expect, it } from 'vitest';
import { MemoryConversationStore, defineAgent } from '@chamvi/core';
import type { ConversationScope, IChannel } from '@chamvi/core';
import { STORE_ENTITIES, STORE_MIGRATIONS, TypeormConversationStore } from '@chamvi/store-typeorm';
import { ControllableClock } from '@chamvi/test-kit';
import {
    AppToken,
    configModule,
    createApp,
    engineModule,
    storeModule,
} from '@chamvi/app';
import { buildModuleHarness } from '@chamvi/app/testing';
import { TOKENS, deferred } from '../../utils/app.ts';
import { createTestDatabaseUrl, describePostgres } from '../../utils/database.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { textModel } from '../../utils/model.ts';

const identity = {
    agent: 'helper',
    channel: 'chat',
    account: 'main',
    chat: 'example',
    audience: 'direct',
};

describePostgres('app conversation PostgreSQL lifecycle', () => {
    const cleanup: Array<() => Promise<unknown>> = [];
    afterEach(async () => {
        for (const close of cleanup.reverse()) await close();
        cleanup.length = 0;
    });

    it('postgres_reuses_existing_data_source', async () => {
        const dataSource = new DataSource({
            type: 'postgres',
            url: await createTestDatabaseUrl(),
            entities: STORE_ENTITIES,
            migrations: STORE_MIGRATIONS,
        });
        await dataSource.initialize();
        cleanup.push(() => dataSource.destroy());
        const clock = new ControllableClock();
        const harness = buildModuleHarness({ modules: [configModule({ clock, logger: createRecordingLogger(clock) }), storeModule({ dataSource })] });
        harness.context.conversations = { authorize: () => true };
        cleanup.push(() => harness.stop());
        await harness.setup();
        const conversations = harness.container.resolve(AppToken.CONVERSATIONS);
        expect(conversations).toBeInstanceOf(TypeormConversationStore);
        await conversations.resolve(identity);
        expect(await dataSource.query('SELECT count(*)::int AS count FROM chamvi_conversations')).toEqual([{ count: 1 }]);
        await harness.stop();
        expect(dataSource.isInitialized).toBe(true);
    });

    it('check_writes_nothing even when conversation schema has not been installed', async () => {
        const url = await createTestDatabaseUrl();
        const app = createApp({ conversations: { authorize: () => true }, modules: [configModule({ logger: createRecordingLogger() })] });
        cleanup.push(() => app.stop());
        await app.check({ env: { DATABASE_URL: url, CHAMVI_TOKENS: TOKENS } });
        const admin = new DataSource({ type: 'postgres', url });
        await admin.initialize();
        cleanup.push(() => admin.destroy());
        expect(await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).toEqual([]);
    });

    it('migrate_contains_tables with recall disabled', async () => {
        const url = await createTestDatabaseUrl();
        const app = createApp({ modules: [configModule({ logger: createRecordingLogger() })] });
        await app.migrate({ env: { DATABASE_URL: url } });
        const admin = new DataSource({ type: 'postgres', url });
        await admin.initialize();
        cleanup.push(() => admin.destroy());
        const rows: Array<{ tablename: string }> = await admin.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'chamvi_conversation%' ORDER BY tablename");
        expect(rows.map((row) => row.tablename)).toEqual(['chamvi_conversation_items', 'chamvi_conversation_notes', 'chamvi_conversation_operations', 'chamvi_conversations']);
    });

    it('stop_awaits_memory_writes_before_datasource_close', async () => {
        const entered = deferred();
        const release = deferred();
        class DelayedConversations extends MemoryConversationStore {
            override async endTurn(scope: ConversationScope, runId: string, ids: string[]) {
                entered.resolve();
                await release.promise;
                await super.endTurn(scope, runId, ids);
            }
        }
        const conversations = new DelayedConversations();
        const chat: IChannel = { name: 'chat' };
        const clock = new ControllableClock();
        const harness = buildModuleHarness({
            env: { DATABASE_URL: await createTestDatabaseUrl() },
            agents: [defineAgent({
                name: 'helper',
                model: textModel(),
                instructions: 'Help.',
                conversation: true,
                channels: [{
                    channel: 'chat',
                    id: 'message',
                    options: {},
                }],
            })],
            modules: [configModule({ clock, logger: createRecordingLogger(clock) }), storeModule(), engineModule(), {
                name: 'test:chat',
                async setup(container) { container.registerMany(AppToken.CHANNELS, { useValue: chat }); },
            }],
        });
        harness.context.conversations = { authorize: () => true, store: conversations };
        cleanup.push(async () => { release.resolve(); await harness.stop(); });
        await harness.setup();
        const dataSource = harness.container.resolve(AppToken.DATA_SOURCE);
        const engine = harness.container.resolve(AppToken.ENGINE);
        await engine.channelContext(chat).dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            payload: {},
        }, {
            account: 'main',
            chat: 'example',
            audience: 'direct',
            text: 'hello',
        });
        await entered.promise;
        let stopped = false;
        const stopping = harness.stop().then(() => { stopped = true; });
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        expect(stopped).toBe(false);
        expect(dataSource.isInitialized).toBe(true);
        release.resolve();
        await stopping;
        expect(dataSource.isInitialized).toBe(false);
    });
});
