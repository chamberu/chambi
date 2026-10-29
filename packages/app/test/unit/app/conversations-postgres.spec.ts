/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { DataSource } from 'typeorm';
import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';
import { jsonSchema } from 'ai';
import { defineAgent, defineTool, memoryTools } from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
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
import { mockModel, textModel } from '../../utils/model.ts';

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
        const conversations = harness.container.resolve(AppToken.STORES).conversations!;
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

    it('persists a real conversation run, note, reply and checkpoint under foreign keys', async () => {
        const sent: string[] = [];
        const chat: IChannel = { name: 'chat', out: async (message) => { sent.push(message.body); } };
        const reply = defineTool({
            inputSchema: jsonSchema<{ text: string }>({
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
            }),
            execute: async ({ text }, { context }) => context.channels.findOneOrFail(chat.name).emit({ body: text }),
        });
        const harness = buildModuleHarness({
            env: { DATABASE_URL: await createTestDatabaseUrl() },
            agents: [defineAgent({
                name: 'helper',
                instructions: 'help',
                conversation: true,
                model: mockModel([
                    {
                        parts: [{
                            type: 'tool-call',
                            toolName: 'memory_set',
                            input: { key: 'style', text: 'short answers' },
                        }],
                    },
                    {
                        parts: [{
                            type: 'tool-call',
                            toolName: 'reply',
                            input: { text: 'saved' },
                        }],
                    },
                    { parts: [{ type: 'text', text: 'done' }] },
                ]),
                tools: { ...memoryTools(), reply },
                channels: [{
                    channel: chat.name,
                    id: 'message',
                    options: {},
                }],
            })],
            modules: [configModule({ logger: createRecordingLogger() }), storeModule(), engineModule(), {
                name: 'test:chat',
                async setup(container) { container.registerMany(AppToken.CHANNELS, { useValue: chat }); },
            }],
        });
        harness.context.conversations = { authorize: () => true };
        cleanup.push(() => harness.stop());
        await harness.setup();
        const engine = harness.container.resolve(AppToken.ENGINE);
        const result = await engine.channelContext(chat).dispatchConversation({
            agent: 'helper',
            trigger: 'message',
            address: 'example',
            payload: {},
        }, {
            account: 'main',
            chat: 'example',
            audience: 'direct',
            text: 'remember my style',
        });
        await engine.idle();
        const runs = harness.container.resolve(AppToken.STORES);
        const conversations = harness.container.resolve(AppToken.STORES).conversations!;
        expect((await runs.runs.getRun(result.runId))?.status).toBe('completed');
        expect(sent).toEqual(['saved']);
        const scope = (await conversations.get(identity))!;
        expect((await conversations.getNote(scope, 'style'))?.text).toBe('short answers');
        expect((await conversations.listItems(scope, { limit: 10, offset: 0 })).data.map((item) => item.text)).toEqual(['remember my style', 'saved']);
        expect((await runs.checkpoints.latestCheckpoint(result.runId))?.conversation).toEqual({ scopeId: scope.id, generation: scope.generation });
        const ds = harness.container.resolve(AppToken.DATA_SOURCE);
        expect(await ds.query('SELECT run_id FROM chamvi_conversation_operations')).toEqual([{ run_id: result.runId }]);
        expect(await conversations.activeRun(scope)).toBeUndefined();
    });

    it('stop_awaits_memory_writes_before_datasource_close', async () => {
        const entered = deferred();
        const release = deferred();
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
        harness.context.conversations = { authorize: () => true };
        cleanup.push(async () => { release.resolve(); await harness.stop(); });
        await harness.setup();
        const dataSource = harness.container.resolve(AppToken.DATA_SOURCE);
        const conversations = harness.container.resolve(AppToken.STORES).conversations!;
        const endTurn = conversations.endTurn.bind(conversations);
        vi.spyOn(conversations, 'endTurn').mockImplementation(async (...args) => {
            entered.resolve();
            await release.promise;
            await endTurn(...args);
        });
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
