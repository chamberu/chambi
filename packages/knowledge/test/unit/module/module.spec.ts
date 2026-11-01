/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { customProvider } from 'ai';
import type { EmbeddingModel } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { InvalidAgentDefinitionError, createMemoryStore, defineAgent } from '@chamvi/core';
import type { Agent, IClock } from '@chamvi/core';
import { mockEmbeddingModel, mockModel } from '@chamvi/test-kit';
import {
    AppToken,
    ModuleName,
    configModule,
    createLogger,
    engineModule,
    httpModule,
    runHooks,
    staticTokensModule,
    storeModule,
} from '@chamvi/app';
import type { ILogger, IModule } from '@chamvi/app';
import { buildModuleHarness, createModuleHarness } from '@chamvi/app/testing';
import type { ModuleHarness, ModuleHarnessOptions } from '@chamvi/app/testing';
import {
    createMemoryKnowledgeRepository,
    defineKnowledgeSource,
    folder,
    knowledgeCollection,
    knowledgeTools,
} from '@chamvi/knowledge';
import type { KnowledgeCollection, KnowledgeSearchResult } from '@chamvi/knowledge';
import { knowledgeModule } from '@chamvi/knowledge/module';
import {
    gatedModel,
    mapSource,
    waitForCollection,
    waitForReady,
} from '../../utils/indexer.ts';

const TOKEN = 'a-static-token-of-length';
const TOKENS = JSON.stringify([{
    value: TOKEN,
    id: 'ops',
    permissions: ['*'],
}]);

type LogEntry = {
    level: string;
    msg: string;
    [key: string]: unknown;
};

type RecordingLogger = ILogger & {
    entries: LogEntry[];
    /** The raw JSON lines, to check that a value never reached the log. */
    lines: string[];
};

/** The app's JSON line logger at `debug`, its lines kept in memory. */
function createRecordingLogger(clock?: IClock): RecordingLogger {
    const lines: string[] = [];
    const entries: LogEntry[] = [];
    const logger = createLogger({
        level: 'debug',
        clock,
        write: (line) => {
            lines.push(line);
            entries.push(JSON.parse(line) as LogEntry);
        },
    });

    return Object.assign(logger, { entries, lines });
}

/** A loopback port free right now (the OS picks it, then it is released). */
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();

        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;

            server.close(() => resolve(port));
        });
    });
}

const MEMORY_WARNING = 'Knowledge is kept in memory: every restart re-embeds.';

let harnesses: ModuleHarness[] = [];
const dirs: string[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((harness) => harness.stop()));
    harnesses = [];
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const call = (toolName: string, input = {}) => ({
    parts: [{
        type: 'tool-call' as const,
        toolName,
        toolCallId: toolName,
        input,
    }],
});
const done = { parts: [{ type: 'text' as const, text: 'done' }] };

async function docsDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'chamvi-knowledge-module-'));

    dirs.push(dir);
    await writeFile(join(dir, 'refunds.md'), '# Refunds\n\nOur refund policy: a refund is paid within 30 days.\n');
    await writeFile(join(dir, 'pods.md'), '# Pods\n\nKubernetes pods run containers.\n');

    return dir;
}

function readerAgent(): Agent {
    return defineAgent({
        name: 'reader',
        instructions: 'Answer from the docs.',
        model: mockModel([call('knowledge_search', { query: 'refund policy' }), done]),
        tools: knowledgeTools({ collections: ['docs'] }),
    });
}

/** The app's resolver with one provider `mock` handing out `embed`. */
function embeddingProviders(model: EmbeddingModel): ModuleHarnessOptions['models'] {
    return { mock: customProvider({ embeddingModels: { embed: model } }) };
}

function record(name: string, kind: KnowledgeCollection['kind']): KnowledgeCollection {
    const at = new Date('2026-11-01T00:00:00Z');

    return {
        name,
        kind,
        trusted: false,
        generation: 0,
        model: 'mock/embed',
        chunker: 'text-v1',
        status: 'pending',
        createdAt: at,
        updatedAt: at,
    };
}

type HarnessInput = Omit<ModuleHarnessOptions, 'modules'> & {
    knowledge: IModule;
    logger?: RecordingLogger;
    /** Adds the static tokens and the http module (the real `started`/`stopping` path). */
    http?: boolean;
};

async function harnessOf(input: HarnessInput): Promise<ModuleHarness> {
    const {
        knowledge,
        logger,
        http,
        env,
        ...options
    } = input;
    const port = http ? await freePort() : undefined;
    const harness = buildModuleHarness({
        ...options,
        env: {
            ...(port !== undefined && {
                CHAMVI_TOKENS: TOKENS,
                HOST: '127.0.0.1',
                PORT: String(port),
            }),
            ...env,
        },
        modules: [
            configModule({ logger: logger ?? createRecordingLogger() }),
            storeModule(),
            ...(http ? [staticTokensModule()] : []),
            engineModule(),
            ...(http ? [httpModule({ metrics: false, rateLimit: false })] : []),
            knowledge,
        ],
    });

    harnesses.push(harness);
    await harness.setup();

    return harness;
}

describe('knowledgeModule()', () => {
    it('is named chamvi:knowledge and needs the config, store and engine modules', () => {
        const module = knowledgeModule();

        expect(module.name).toBe('chamvi:knowledge');
        expect(module.dependencies).toEqual([ModuleName.CONFIG, ModuleName.STORE, ModuleName.ENGINE]);
    });

    it('has no knowledge before setup', () => {
        expect(() => knowledgeModule().knowledge).toThrow(InvalidAgentDefinitionError);
        expect(() => knowledgeModule().knowledge).toThrow('knowledgeModule().knowledge is available once the app set the module up.');
    });

    it('refuses bad options when the factory is called', () => {
        const model = mockEmbeddingModel();
        const docs = knowledgeCollection('docs', { model, sources: [mapSource(new Map())] });

        expect(() => knowledgeModule('docs' as never)).toThrow(new InvalidAgentDefinitionError('knowledgeModule() options must be an object.'));
        expect(() => knowledgeModule({ collections: docs as never }))
            .toThrow(new InvalidAgentDefinitionError('knowledgeModule() collections must be an array.'));
        expect(() => knowledgeModule({ collections: [docs, docs] }))
            .toThrow(new InvalidAgentDefinitionError('Knowledge collection "docs" is declared twice.'));
        expect(() => knowledgeModule({ collections: [{ ...docs, name: 'Docs' }] })).toThrow(InvalidAgentDefinitionError);
        expect(() => knowledgeModule({ collections: [{ ...docs, sources: [] }] })).toThrow(InvalidAgentDefinitionError);
        expect(() => knowledgeModule({ repository: {} as never }))
            .toThrow(new InvalidAgentDefinitionError('knowledgeModule() repository must be a knowledge repository.'));
        expect(() => knowledgeModule({ owner: '' }))
            .toThrow(new InvalidAgentDefinitionError('knowledgeModule() owner must be a non-empty string.'));
    });

    it('indexes in start mode and the engine\'s tools reach the knowledge', async () => {
        const model = mockEmbeddingModel();
        const repository = createMemoryKnowledgeRepository();
        const module = knowledgeModule({
            repository,
            collections: [knowledgeCollection('docs', { model: 'mock/embed', sources: [folder(await docsDir())] })],
        });
        const harness = await harnessOf({
            knowledge: module,
            http: true,
            agents: [readerAgent()],
            models: embeddingProviders(model),
        });

        // the string ref went through the app's resolver (AppToken.MODELS)
        expect(module.knowledge.collection('docs')?.embedding).toBe(model);
        expect(module.knowledge.repository).toBe(repository);

        const ready = await waitForReady(repository, 'docs');

        expect(ready).toMatchObject({ kind: 'declared', model: 'mock/embed' });
        expect(model.calls.length).toBeGreaterThan(0);

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await engine.dispatch({
            agent: 'reader',
            channel: 'http',
            trigger: 'http',
            payload: {},
        });

        await engine.idle();

        expect((await engine.store.runs.findOne(runId))?.status).toBe('completed');

        const [step] = (await engine.store.steps.find(runId))
            .filter((entry) => entry.kind === 'tool' && entry.name === 'knowledge_search');
        const output = step?.output as KnowledgeSearchResult;

        expect(output.matches[0]).toMatchObject({
            collection: 'docs',
            document: 'refunds.md',
            title: 'Refunds',
        });
    });

    it.each([
        ['a job', { mode: 'job', job: { agent: 'reader' } }],
        ['a check', { check: true }],
    ] as const)('%s never indexes, even when asked to start', async (_, options) => {
        const model = mockEmbeddingModel();
        const repository = createMemoryKnowledgeRepository();
        const harness = await harnessOf({
            ...options,
            knowledge: knowledgeModule({
                repository,
                collections: [knowledgeCollection('docs', { model, sources: [folder(await docsDir())] })],
            }),
            agents: [readerAgent()],
        });

        const hooks = harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS).filter((hook) => hook.name === 'chamvi:knowledge');

        // the module's hook only provides the knowledge: nothing starts or stops indexing
        expect(hooks).toHaveLength(1);
        expect(hooks[0]!.engineCreated).toBeTypeOf('function');
        expect(hooks[0]!.started).toBeUndefined();
        expect(hooks[0]!.stopping).toBeUndefined();

        await runHooks(harness.container, 'started');

        expect(model.calls).toHaveLength(0);
        expect(await repository.findCollections()).toEqual([]);
    });

    it.each([
        ['start', {}],
        ['check', { check: true }],
    ] as const)('a folder that is no directory fails setup (%s)', async (_, options) => {
        const harness = buildModuleHarness({
            ...options,
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule(),
                engineModule(),
                knowledgeModule({
                    repository: createMemoryKnowledgeRepository(),
                    collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [folder('/definitely/not/a/directory')] })],
                }),
            ],
        });

        harnesses.push(harness);

        await expect(harness.setup()).rejects.toThrow(new InvalidAgentDefinitionError(
            'Knowledge collection "docs": folder(): "/definitely/not/a/directory" is no directory.',
        ));
    });

    it.each([
        ['start', {}],
        ['check', { check: true }],
    ] as const)('a managed record of a declared name fails setup (%s)', async (_, options) => {
        const repository = createMemoryKnowledgeRepository();

        await repository.saveCollection(record('docs', 'managed'));

        const harness = buildModuleHarness({
            ...options,
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule(),
                engineModule(),
                knowledgeModule({
                    repository,
                    collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map())] })],
                }),
            ],
        });

        harnesses.push(harness);

        await expect(harness.setup()).rejects.toThrow(new InvalidAgentDefinitionError(
            'Knowledge collection "docs" is managed in the store; a declared collection cannot take its name.',
        ));
        // a check reads, never writes
        expect(await repository.findCollections()).toEqual([record('docs', 'managed')]);
    });

    it('a string model the app cannot resolve fails setup', async () => {
        const harness = buildModuleHarness({
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule(),
                engineModule(),
                knowledgeModule({ collections: [knowledgeCollection('docs', { model: 'nope/embed', sources: [mapSource(new Map())] })] }),
            ],
        });

        harnesses.push(harness);

        const error = await harness.setup().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message).toMatch(/^Knowledge collection "docs": /);
    });

    it.each([
        ['outside dev without a repository', { dev: false, repository: false }, 1],
        ['in dev', { dev: true, repository: false }, 0],
        ['with a repository', { dev: false, repository: true }, 0],
    ] as const)('warns about the memory repository %s', async (_, { dev, repository }, count) => {
        const logger = createRecordingLogger();

        await harnessOf({
            dev,
            logger,
            knowledge: knowledgeModule({
                ...(repository && { repository: createMemoryKnowledgeRepository() }),
                collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map())] })],
            }),
        });

        expect(logger.entries.filter((entry) => entry.level === 'warn' && entry.msg === MEMORY_WARNING)).toHaveLength(count);
    });

    it('logs indexing failures with the collection', async () => {
        const logger = createRecordingLogger();
        const failing = defineKnowledgeSource({
            // eslint-disable-next-line require-yield
            async* documents() {
                throw new Error('source down');
            },
        });
        const harness = await harnessOf({
            logger,
            knowledge: knowledgeModule({
                repository: createMemoryKnowledgeRepository(),
                collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [failing] })],
            }),
        });

        await runHooks(harness.container, 'started');

        await expect.poll(() => logger.entries.find((entry) => entry.msg === 'knowledge error')).toMatchObject({
            level: 'error',
            collection: 'docs',
            error: { message: 'source down' },
        });
    });

    it('stopping aborts indexing', async () => {
        const model = gatedModel();
        const repository = createMemoryKnowledgeRepository();
        const harness = await harnessOf({
            knowledge: knowledgeModule({
                repository,
                collections: [knowledgeCollection('docs', { model, sources: [mapSource(new Map([['a', 'alpha beta']]))] })],
            }),
        });

        await runHooks(harness.container, 'started');
        await expect.poll(() => model.started.length).toBe(1);

        const [call] = model.doEmbedCalls;

        await runHooks(harness.container, 'stopping');

        expect(call?.abortSignal?.aborted).toBe(true);
        expect(harness.reported).toEqual([]);

        const stored = await waitForCollection(repository, 'docs', () => true);

        expect(stored.status).toBe('pending');
        expect(stored.generation).toBe(0);
    });

    it('teardown stops indexing too', async () => {
        const model = gatedModel();
        const harness = await harnessOf({
            knowledge: knowledgeModule({
                repository: createMemoryKnowledgeRepository(),
                collections: [knowledgeCollection('docs', { model, sources: [mapSource(new Map([['a', 'alpha beta']]))] })],
            }),
        });

        await runHooks(harness.container, 'started');
        await expect.poll(() => model.started.length).toBe(1);

        await harness.stop();

        expect(model.doEmbedCalls[0]?.abortSignal?.aborted).toBe(true);
    });

    it('does nothing in migrate mode', async () => {
        const module = knowledgeModule({ collections: [knowledgeCollection('docs', { model: 'nope/embed', sources: [mapSource(new Map())] })] });

        const harness = await createModuleHarness({
            mode: 'migrate',
            // a migrate needs a database URL; the given store is used as is (nothing connects)
            env: { DATABASE_URL: 'postgres://chamvi@127.0.0.1:1/chamvi' },
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule({ store: createMemoryStore() }),
                engineModule(),
                module,
            ],
        });

        harnesses.push(harness);
        expect(() => module.knowledge).toThrow(InvalidAgentDefinitionError);
    });
});
