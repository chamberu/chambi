/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/* eslint-disable max-classes-per-file */
import { tool } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    ErrorCode,
    ValidationError,
    artifactFilePart,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    AgentDefinition,
    IRunArtifacts,
    Repositories,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { MemoryArtifactRepository, createMemoryRepositories } from '../../../src/repository/index.ts';
import { gateTool, recordApprovals } from '../../utils/approvals.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

const PNG = new Uint8Array([137, 80, 78, 71]);

function setup(
    responses: MockResponse[],
    opts: { repositories?: Repositories; definition?: Partial<AgentDefinition> } = {},
) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = opts.repositories ?? createMemoryRepositories({ clock });
    const model = mockModel(responses);
    const agent = defineAgent({
        name: 'vision',
        instructions: 'You look at files.',
        model,
        ...opts.definition,
    });
    const errors: unknown[] = [];
    const engine = new Engine({
        repositories: store,
        agents: [agent],
        clock,
        onError: (error) => {
            errors.push(error);
        },
    });
    engines.push(engine);
    const notifier = recordApprovals(engine);
    return {
        clock,
        repositories: store,
        model,
        engine,
        notifier,
        errors,
    };
}

const env = (extra: Record<string, unknown> = {}) => ({
    agent: 'vision',
    trigger: 'http',
    channel: 'http' as const,
    payload: { look: true },
    ...extra,
});

type PromptPart = {
    type: string;
    data?: unknown;
    mediaType?: string;
    filename?: string;
    text?: string
};

/** The file parts of the user messages the model got on call `i`. */
function filePartsOf(model: ReturnType<typeof mockModel>, i: number): PromptPart[] {
    const prompt = model.doStreamCalls[i]!.prompt as Array<{ role: string; content: unknown }>;
    return prompt
        .filter((m) => m.role === 'user' && Array.isArray(m.content))
        .flatMap((m) => m.content as PromptPart[])
        .filter((p) => p.type === 'file');
}

/** Bytes of a provider file part, whether the data is bare or tagged. */
function bytesOf(part: PromptPart): number[] {
    const { data } = part;
    if (data instanceof Uint8Array) return Array.from(data);
    const tagged = data as { type: string; data: unknown };
    expect(tagged.type).toBe('data');
    expect(tagged.data).toBeInstanceOf(Uint8Array);
    return Array.from(tagged.data as Uint8Array);
}

function userContentOf(messages: ModelMessage[]) {
    const first = messages[0]!;
    expect(first.role).toBe('user');
    return first.content as Array<Record<string, unknown>>;
}

describe('attachments at dispatch', () => {
    it('stores each attachment as an artifact of the run and puts the metadata on the envelope', async () => {
        const ctx = setup([text('ok')]);
        const { runId } = await ctx.engine.dispatch(env({
            attachments: [
                {
                    mediaType: 'image/png',
                    filename: 'shot.png',
                    data: PNG,
                },
                { mediaType: 'text/plain', data: new Uint8Array([104, 105]) },
            ],
        }));
        const run = (await ctx.repositories.runs.findOne(runId))!;
        const listed = await ctx.repositories.artifacts.find(runId);
        expect(listed).toEqual(run.trigger.attachments);
        expect(run.trigger.attachments?.[0]).toEqual({
            id: `${runId}.0000`,
            runId,
            agent: 'vision',
            mediaType: 'image/png',
            filename: 'shot.png',
            size: 4,
            createdAt: run.createdAt,
        });
        expect(run.trigger.attachments?.[1]?.filename).toBeUndefined();
        expect(Array.from((await ctx.repositories.artifacts.read(run.trigger.attachments![0]!.id))!)).toEqual(Array.from(PNG));
        expect(run.trigger).not.toHaveProperty('attachments.0.data');
    });

    it('lists the attachments in input order', async () => {
        const ctx = setup([text('ok')]);
        const attachments = Array.from({ length: 12 }, (_, i) => ({
            mediaType: 'text/plain',
            filename: `f${i}.txt`,
            data: new Uint8Array([i]),
        }));
        const { runId } = await ctx.engine.dispatch(env({ attachments }));
        const listed = await ctx.repositories.artifacts.find(runId);
        expect(listed.map((a) => a.filename)).toEqual(attachments.map((a) => a.filename));
        expect(listed.map((a) => a.id)).toEqual(attachments.map((_, i) => `${runId}.${String(i).padStart(4, '0')}`));
    });

    it('keeps input order beyond 10000 attachments (the index widens for the whole dispatch)', async () => {
        const ctx = setup([text('ok')]);
        const attachments = Array.from({ length: 10_001 }, () => ({ mediaType: 'text/plain', data: new Uint8Array([1]) }));
        const { runId } = await ctx.engine.dispatch(env({ attachments }));
        const listed = await ctx.repositories.artifacts.find(runId);
        expect(listed[0]!.id).toBe(`${runId}.00000`);
        expect(listed.at(-1)!.id).toBe(`${runId}.10000`);
        expect(listed.map((a) => a.id)).toEqual((await ctx.repositories.runs.findOne(runId))!.trigger.attachments!.map((a) => a.id));
    });

    it('leaves no extra artifacts when two healers of one key race', async () => {
        /** A store whose artifact writes take a round trip, like a database. */
        class SlowArtifactRepository extends MemoryArtifactRepository {
            override async insert(...args: Parameters<MemoryArtifactRepository['insert']>): Promise<boolean> {
                await new Promise<void>((resolve) => { setImmediate(resolve); });
                return super.insert(...args);
            }
        }
        const ctx = setup([text('ok')], { repositories: { ...createMemoryRepositories(), artifacts: new SlowArtifactRepository() } });
        const attachment = (text: string) => ({
            mediaType: 'text/plain',
            filename: `${text}.txt`,
            data: new TextEncoder().encode(text),
        });
        const [a, b] = await Promise.all([
            ctx.engine.dispatch(env({ idempotencyKey: 'k', attachments: [attachment('first')] })),
            ctx.engine.dispatch(env({ idempotencyKey: 'k', attachments: [attachment('second')] })),
        ]);
        expect(a.runId).toBe(b.runId);
        expect([a.deduplicated, b.deduplicated].sort()).toEqual([false, true]);

        const run = (await ctx.repositories.runs.findOne(a.runId))!;
        const listed = await ctx.repositories.artifacts.find(a.runId);
        expect(listed).toHaveLength(1);
        // the run names the artifact that was stored: metadata and bytes agree
        expect(run.trigger.attachments).toEqual(listed);
        const bytes = await ctx.repositories.artifacts.read(listed[0]!.id);
        expect(new TextDecoder().decode(bytes)).toBe(listed[0]!.filename!.replace('.txt', ''));
    });

    it('leaves the envelope without attachments when none are given', async () => {
        const ctx = setup([text('ok')]);
        const { runId } = await ctx.engine.dispatch(env({ attachments: [] }));
        expect((await ctx.repositories.runs.findOne(runId))?.trigger).not.toHaveProperty('attachments');
        expect(await ctx.repositories.artifacts.find(runId)).toEqual([]);
    });

    it('stores nothing for a deduplicated dispatch', async () => {
        const ctx = setup([text('ok')]);
        const first = await ctx.engine.dispatch(env({
            idempotencyKey: 'k',
            attachments: [{ mediaType: 'image/png', data: PNG }],
        }));
        const second = await ctx.engine.dispatch(env({
            idempotencyKey: 'k',
            attachments: [{ mediaType: 'image/png', data: PNG }],
        }));
        expect(second).toEqual({ runId: first.runId, deduplicated: true });
        expect(await ctx.repositories.artifacts.find(first.runId)).toHaveLength(1);
    });

    it.each([
        ['a media type without subtype', { mediaType: 'image', data: PNG }],
        ['an empty media type', { mediaType: '', data: PNG }],
        ['a media type with spaces', { mediaType: 'image/ png', data: PNG }],
        ['data that is no Uint8Array', { mediaType: 'image/png', data: 'iVBORw==' }],
        ['a filename that is no string', {
            mediaType: 'image/png',
            filename: 42,
            data: PNG,
        }],
    ])('rejects %s with a ValidationError before any store write', async (_, attachment) => {
        const ctx = setup([text('ok')]);
        const writes = [
            vi.spyOn(ctx.repositories.idempotency, 'claim'),
            vi.spyOn(ctx.repositories.runs, 'insert'),
            vi.spyOn(ctx.repositories.artifacts, 'insert'),
        ];
        const promise = ctx.engine.dispatch(env({
            idempotencyKey: 'k',
            attachments: [{ mediaType: 'text/plain', data: new Uint8Array([1]) }, attachment],
        }));
        await expect(promise).rejects.toBeInstanceOf(ValidationError);
        await expect(promise).rejects.toMatchObject({ code: ErrorCode.VALIDATION });
        for (const write of writes) expect(write).not.toHaveBeenCalled();
        expect((await ctx.repositories.runs.find({})).total).toBe(0);
    });
});

describe('attachments in the model prompt', () => {
    it('hands the model the bytes as a file part while the checkpoint keeps the marker', async () => {
        const ctx = setup([text('a png')]);
        await ctx.engine.start();
        const { runId } = await ctx.engine.dispatch(env({
            attachments: [{
                mediaType: 'image/png',
                filename: 'shot.png',
                data: PNG,
            }],
        }));
        await ctx.engine.idle();

        const run = (await ctx.repositories.runs.findOne(runId))!;
        expect(run.status).toBe('completed');
        const [artifact] = run.trigger.attachments!;

        const [part] = filePartsOf(ctx.model, 0);
        expect(part).toMatchObject({ mediaType: 'image/png', filename: 'shot.png' });
        expect(bytesOf(part!)).toEqual(Array.from(PNG));

        const checkpoint = (await ctx.repositories.checkpoints.findOne(runId))!;
        const content = userContentOf(checkpoint.messages);
        expect(content[0]).toMatchObject({ type: 'text' });
        expect(content[0]!.text).toContain('"look": true');
        expect(content[1]).toEqual({
            type: 'file',
            mediaType: 'image/png',
            filename: 'shot.png',
            data: `chamvi-artifact:${artifact!.id}`,
        });
    });

    it('keeps the first message a plain string without attachments', async () => {
        const ctx = setup([text('ok')]);
        await ctx.engine.start();
        const { runId } = await ctx.engine.dispatch(env());
        await ctx.engine.idle();
        const checkpoint = (await ctx.repositories.checkpoints.findOne(runId))!;
        expect(typeof checkpoint.messages[0]!.content).toBe('string');
    });

    it('hydrates the attachments again after an approval resume', async () => {
        const deploy = tool({
            inputSchema: z.object({ env: z.string() }),
            execute: async () => 'deployed',
        });
        const ctx = setup([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'deploy',
                    input: { env: 'prod' },
                }],
            },
            text('done'),
        ], {
            definition: {
                tools: () => ({ deploy }),
                hooks: gateTool('deploy'),
            },
        });
        await ctx.engine.start();
        const { runId } = await ctx.engine.dispatch(env({ attachments: [{ mediaType: 'image/png', data: PNG }] }));
        await ctx.engine.idle();
        expect((await ctx.repositories.runs.findOne(runId))?.status).toBe('waiting');

        await ctx.engine.approve(ctx.notifier.calls[0]!.runId, { approvalId: ctx.notifier.calls[0]!.approvalId, approved: true });
        await ctx.engine.idle();

        expect((await ctx.repositories.runs.findOne(runId))?.status).toBe('completed');
        const [part] = filePartsOf(ctx.model, 1);
        expect(bytesOf(part!)).toEqual(Array.from(PNG));
        const checkpoint = (await ctx.repositories.checkpoints.findOne(runId))!;
        expect(userContentOf(checkpoint.messages)[1]!.data).toMatch(/^chamvi-artifact:/);
    });

    it('fails the run with ARTIFACT_NOT_FOUND when an attachment is gone', async () => {
        class LossyRepository extends MemoryArtifactRepository {
            override async read(): Promise<Uint8Array | undefined> {
                return undefined;
            }
        }
        const ctx = setup([text('never')], { repositories: { ...createMemoryRepositories(), artifacts: new LossyRepository() } });
        await ctx.engine.start();
        const { runId } = await ctx.engine.dispatch(env({ attachments: [{ mediaType: 'image/png', data: PNG }] }));
        await ctx.engine.idle();

        const run = (await ctx.repositories.runs.findOne(runId))!;
        expect(run.status).toBe('failed');
        expect(run.error?.code).toBe(ErrorCode.ARTIFACT_NOT_FOUND);
        expect(run.error?.message).toContain(run.trigger.attachments![0]!.id);
        expect(ctx.model.doStreamCalls).toHaveLength(0);
    });
});

describe('tool artifacts', () => {
    it('gives tools artifacts scoped to the run', async () => {
        const scoped: IRunArtifacts[] = [];
        const tools = ({ artifacts }: { artifacts: IRunArtifacts }): ToolSet => {
            scoped.push(artifacts);
            return {
                save: tool({
                    inputSchema: z.object({ body: z.string() }),
                    execute: async ({ body }) => {
                        const artifact = await artifacts.put({
                            mediaType: 'text/markdown',
                            filename: 'report.md',
                            data: new TextEncoder().encode(body),
                        });
                        return artifact.id;
                    },
                }),
            };
        };
        const ctx = setup([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'save',
                    input: { body: '# hi' },
                }],
            },
            text('saved'),
            text('other'),
        ], { definition: { tools } });
        await ctx.engine.start();
        const a = await ctx.engine.dispatch(env({ attachments: [{ mediaType: 'image/png', data: PNG }] }));
        await ctx.engine.idle();
        const b = await ctx.engine.dispatch(env());
        await ctx.engine.idle();
        expect((await ctx.repositories.runs.findOne(a.runId))?.status).toBe('completed');
        expect((await ctx.repositories.runs.findOne(b.runId))?.status).toBe('completed');

        const [ofA, ofB] = scoped;
        const listed = await ofA!.list();
        expect(listed.map((x) => x.mediaType).sort()).toEqual(['image/png', 'text/markdown']);
        const saved = listed.find((x) => x.mediaType === 'text/markdown')!;
        expect(saved).toMatchObject({
            runId: a.runId,
            agent: 'vision',
            filename: 'report.md',
            size: 4,
            createdAt: ctx.clock.now(),
        });
        const got = await ofA!.get(saved.id);
        expect(got?.artifact).toEqual(saved);
        expect(new TextDecoder().decode(got!.data)).toBe('# hi');

        expect(await ofB!.list()).toEqual([]);
        expect(await ofB!.get(saved.id)).toBeUndefined();
        expect(await ofB!.get('missing')).toBeUndefined();
        await expect(ofA!.put({ mediaType: 'nope', data: new Uint8Array() })).rejects.toBeInstanceOf(ValidationError);
    });
});

describe('artifacts in tool results', () => {
    type ToolResultPrompt = { type: string; output?: { type: string; value?: PromptPart[] } };

    /** The file items of the tool results the model got on call `i`. */
    function toolFilesOf(model: ReturnType<typeof mockModel>, i: number): PromptPart[] {
        const prompt = model.doStreamCalls[i]!.prompt as Array<{ role: string; content: unknown }>;
        return prompt
            .filter((m) => m.role === 'tool' && Array.isArray(m.content))
            .flatMap((m) => m.content as ToolResultPrompt[])
            .flatMap((p) => (p.output?.type === 'content' ? p.output.value ?? [] : []))
            .filter((p) => p.type === 'file');
    }

    const screenshot = defineTool<{ name: string }, { artifactId: string; mediaType: string }>({
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }, { context }) => {
            const artifact = await context.artifacts.put({
                mediaType: 'image/png',
                filename: name,
                data: PNG,
            });
            return { artifactId: artifact.id, mediaType: artifact.mediaType };
        },
        toModelOutput: ({ output }) => ({
            type: 'content',
            value: [
                { type: 'text', text: 'the screenshot' },
                artifactFilePart({ id: output.artifactId, mediaType: output.mediaType }),
            ],
        }),
    });

    it('hands the next model call the bytes while steps and checkpoints keep the id', async () => {
        const ctx = setup([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'screenshot',
                    input: { name: 'shot.png' },
                }],
            },
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'screenshot',
                    input: { name: 'again.png' },
                }],
            },
            text('seen'),
        ], { definition: { tools: { screenshot } } });
        await ctx.engine.start();
        const { runId } = await ctx.engine.dispatch(env());
        await ctx.engine.idle();

        expect((await ctx.repositories.runs.findOne(runId))?.status).toBe('completed');
        const [first] = toolFilesOf(ctx.model, 1);
        expect(first).toMatchObject({ mediaType: 'image/png' });
        expect(bytesOf(first!)).toEqual(Array.from(PNG));
        const later = toolFilesOf(ctx.model, 2);
        expect(later).toHaveLength(2);
        for (const part of later) expect(bytesOf(part)).toEqual(Array.from(PNG));

        const checkpoint = JSON.stringify((await ctx.repositories.checkpoints.findOne(runId))!.messages);
        expect(checkpoint).toMatch(/"data":"chamvi-artifact:[0-9a-f-]+"/);
        expect(checkpoint).not.toContain(Buffer.from(PNG).toString('base64'));
        const steps = await ctx.repositories.steps.find(runId);
        expect(steps.filter((s) => s.kind === 'tool').map((s) => Object.keys(s.output as object))).toEqual([
            ['artifactId', 'mediaType'],
            ['artifactId', 'mediaType'],
        ]);
    });

    it('hydrates a tool result file from the checkpoint after an approval resume', async () => {
        const deploy = tool({
            inputSchema: z.object({ env: z.string() }),
            execute: async () => 'deployed',
        });
        const ctx = setup([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'screenshot',
                    input: { name: 'shot.png' },
                }],
            },
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'deploy',
                    input: { env: 'prod' },
                }],
            },
            text('done'),
        ], {
            definition: {
                tools: () => ({ screenshot, deploy }),
                hooks: gateTool('deploy'),
            },
        });
        await ctx.engine.start();
        const { runId } = await ctx.engine.dispatch(env());
        await ctx.engine.idle();
        expect((await ctx.repositories.runs.findOne(runId))?.status).toBe('waiting');

        await ctx.engine.approve(runId, { approvalId: ctx.notifier.calls[0]!.approvalId, approved: true });
        await ctx.engine.idle();

        expect((await ctx.repositories.runs.findOne(runId))?.status).toBe('completed');
        const [part] = toolFilesOf(ctx.model, 2);
        expect(bytesOf(part!)).toEqual(Array.from(PNG));
    });

    it('builds the marker file part of an artifact', () => {
        expect(artifactFilePart({
            id: 'a1',
            mediaType: 'image/png',
            filename: 'x.png',
        })).toEqual({
            type: 'file',
            mediaType: 'image/png',
            filename: 'x.png',
            data: { type: 'data', data: 'chamvi-artifact:a1' },
        });
        expect(artifactFilePart({ id: 'a1', mediaType: 'image/png' })).not.toHaveProperty('filename');
    });
});
