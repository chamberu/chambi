/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import { assertMcpRunTool, http, httpChannel } from '@chamvi/http';
import {
    ADMIN_TOKEN,
    call,
    createRunAgents,
    createRunTestApp,
    tokenFor,
} from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';
import { callTool, connectMcp, textOf } from '../../utils/mcp.ts';

type TreeNode = { name: string; children: TreeNode[] };

const TreeNodeSchema: z.ZodType<TreeNode> = z.object({
    name: z.string(),
    get children() { return z.array(TreeNodeSchema); },
});

function recursiveAgent() {
    return defineAgent({
        name: 'tree',
        model: textModel(),
        instructions: 'Tree runs.',
        channels: [http.on({ schema: z.object({ root: TreeNodeSchema, alias: TreeNodeSchema }) })],
    });
}

/** Every local `$ref` in `schema`, resolved as a JSON pointer from `root`. */
function resolveRefs(root: unknown, node: unknown = root): unknown[] {
    if (Array.isArray(node)) return node.flatMap((item) => resolveRefs(root, item));
    if (typeof node !== 'object' || node === null) return [];
    const resolved: unknown[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
            expect(value.startsWith('#')).toBe(true);
            const target = value.slice(1).split('/').filter(Boolean)
                .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
                .reduce<unknown>((current, segment) => (current as Record<string, unknown> | undefined)?.[segment], root);
            resolved.push(target);
        } else {
            resolved.push(...resolveRefs(root, value));
        }
    }
    return resolved;
}

function typedAgent() {
    return defineAgent({
        name: 'typed',
        model: textModel(),
        instructions: 'Typed runs.\nSecond line.',
        channels: [http.on({ schema: z.object({ n: z.number() }) })],
    });
}

describe('mcp run_<agent>', () => {
    it('describes structured instructions using only the first nonblank system line', async () => {
        const agents = [defineAgent({
            name: 'structured',
            model: textModel(),
            channels: [http.on()],
            instructions: [
                { role: 'user', content: 'private example' },
                { role: 'system', content: '  \n ' },
                { role: 'assistant', content: 'private answer' },
                { role: 'system', content: '\n  Structured runs.  \nMore.' },
            ],
        }), defineAgent({
            name: 'examples',
            model: textModel(),
            channels: [http.on()],
            instructions: [
                {
                    role: 'user',
                    content: [{
                        type: 'image',
                        image: new Uint8Array([1]),
                        mediaType: 'image/png',
                    }],
                },
                { role: 'assistant', content: 'private answer' },
            ],
        })];
        const { app } = createRunTestApp({ agents });
        const client = await connectMcp(app, ADMIN_TOKEN);
        const { tools } = await client.listTools();
        expect(tools.find((entry) => entry.name === 'run_structured')?.description).toBe('Structured runs.');
        expect(tools.find((entry) => entry.name === 'run_examples')?.description).toBe('Starts a run of agent "examples".');
        await client.close();
    });

    it('lists one tool per agent with an http subscription', async () => {
        const { app } = createRunTestApp();
        const client = await connectMcp(app, ADMIN_TOKEN);
        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(['run_echo', 'run_gate']));
        expect(names).not.toContain('run_sweep');
        expect(names).not.toContain('run_hooked');
        await client.close();
    });

    it('lists only the agents the principal may run', async () => {
        const { app } = createRunTestApp();
        const client = await connectMcp(app, tokenFor('agent:echo:run'));
        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toContain('run_echo');
        expect(names).not.toContain('run_gate');
        await client.close();
    });

    it('describes its input, including the payload schema', async () => {
        const { app } = createRunTestApp({ agents: [...createRunAgents(), typedAgent()] });
        const client = await connectMcp(app, ADMIN_TOKEN);
        const { tools } = await client.listTools();
        const echo = tools.find((t) => t.name === 'run_echo')!;
        expect(echo.inputSchema.properties).toHaveProperty('waitSeconds');

        const typed = tools.find((t) => t.name === 'run_typed')!;
        expect(typed.description).toContain('Typed runs.');
        expect(typed.description).not.toContain('Second line.');
        expect(typed.inputSchema.properties?.payload).toMatchObject({
            type: 'object',
            properties: { n: { type: 'number' } },
        });
        await client.close();
    });

    it('dispatches through the http subscription as channel mcp', async () => {
        const { app, store } = createRunTestApp();
        const client = await connectMcp(app, ADMIN_TOKEN);
        const result = await callTool(client, 'run_echo', { payload: { n: 1 } });
        expect(result.isError).toBeFalsy();
        const content = result.structuredContent as { runId: string };
        expect(content).toEqual({
            runId: expect.any(String),
            status: 'queued',
            deduplicated: false,
        });
        expect((await store.runs.findOne(content.runId))?.trigger).toMatchObject({
            agent: 'echo',
            trigger: 'http',
            channel: 'mcp',
            payload: { n: 1 },
        });
        await client.close();
    });

    it('dedupes an idempotencyKey within mcp, not across transports', async () => {
        const { app, store } = createRunTestApp();
        const client = await connectMcp(app, ADMIN_TOKEN);
        const first = await callTool(client, 'run_echo', { idempotencyKey: 'k-1' });
        const second = await callTool(client, 'run_echo', { idempotencyKey: 'k-1' });
        expect(second.structuredContent).toMatchObject({
            runId: (first.structuredContent as { runId: string }).runId,
            status: 'queued',
            deduplicated: true,
        });

        await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN, body: { idempotencyKey: 'k-1' } });
        expect((await store.runs.find({ agent: 'echo' })).total).toBe(2);
        await client.close();
    });

    it('rejects an invalid payload without dispatching', async () => {
        const { app, store } = createRunTestApp({ agents: [...createRunAgents(), typedAgent()] });
        const client = await connectMcp(app, ADMIN_TOKEN);
        const result = await callTool(client, 'run_typed', { payload: { n: 'x' } });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('payload');
        expect((await store.runs.find({ agent: 'typed' })).total).toBe(0);
        await client.close();
    });

    it('rejects unknown arguments', async () => {
        const { app, store } = createRunTestApp();
        const client = await connectMcp(app, ADMIN_TOKEN);
        const result = await callTool(client, 'run_echo', { extra: 1 });
        expect(result.isError).toBe(true);
        expect((await store.runs.find({})).total).toBe(0);
        await client.close();
    });

    it('advertises a recursive payload schema whose refs resolve from the tool schema', async () => {
        const { app, store } = createRunTestApp({ agents: [...createRunAgents(), recursiveAgent()] });
        const client = await connectMcp(app, ADMIN_TOKEN);
        const { tools } = await client.listTools();
        const tree = tools.find((t) => t.name === 'run_tree')!;
        const targets = resolveRefs(tree.inputSchema);
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) expect(target).toMatchObject({ type: 'object' });

        const payload = {
            root: { name: 'a', children: [{ name: 'b', children: [] }] },
            alias: { name: 'c', children: [] },
        };
        const result = await callTool(client, 'run_tree', { payload });
        expect(result.isError, textOf(result)).toBeFalsy();
        const { runId } = result.structuredContent as { runId: string };
        expect((await store.runs.findOne(runId))?.trigger.payload).toEqual(payload);

        const invalid = await callTool(client, 'run_tree', { payload: { root: { name: 'a', children: [{ name: 1 }] }, alias: payload.alias } });
        expect(invalid.isError).toBe(true);
        await client.close();
    });

    it('converts the payload schema once, not per request', async () => {
        const schema = z.object({ n: z.number() });
        const input = vi.spyOn(schema['~standard'].jsonSchema!, 'input');
        const agent = defineAgent({
            name: 'counted',
            model: textModel(),
            instructions: 'Counted.',
            channels: [http.on({ schema })],
        });
        const { app } = createRunTestApp({ agents: [...createRunAgents(), agent] });
        for (let i = 0; i < 3; i++) {
            const client = await connectMcp(app, ADMIN_TOKEN);
            await client.listTools();
            await callTool(client, 'run_counted', { payload: { n: i } });
            await client.close();
        }
        expect(input).toHaveBeenCalledTimes(1);
    });

    it('fails the app when run_<agent> would exceed the 64 characters MCP allows', () => {
        const long = defineAgent({
            name: 'a'.repeat(61),
            model: textModel(),
            instructions: 'Long.',
            channels: [http.on()],
        });
        expect(() => createRunTestApp({ agents: [long] })).toThrow(InvalidAgentDefinitionError);
        expect(() => createRunTestApp({ agents: [long], mcp: false })).not.toThrow();
        const fits = defineAgent({ ...long.definition, name: 'a'.repeat(60) });
        expect(() => createRunTestApp({ agents: [fits] })).not.toThrow();
    });

    it('reports a folder agent whose run_<agent> cannot be built instead of failing the app', async () => {
        const long = defineAgent({
            name: 'a'.repeat(61),
            model: textModel(),
            instructions: 'Long.',
            channels: [http.on()],
        });
        const engine = new Engine({
            store: createMemoryStore(),
            agents: [], 
            channels: [httpChannel()],
        });
        await engine.putAgent(long, { revision: 'h1' });
        const errors: unknown[] = [];

        const { app } = createRunTestApp({ engine, onError: (error) => { errors.push(error); } });

        expect(errors).toEqual([expect.any(InvalidAgentDefinitionError)]);
        const client = await connectMcp(app, ADMIN_TOKEN);
        expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(`run_${long.name}`);
        await client.close();
    });

    it('assertMcpRunTool refuses what createHttpApp refuses', () => {
        const agent = (name: string) => defineAgent({
            name,
            model: textModel(),
            instructions: 'x',
            channels: [http.on()],
        });
        expect(() => assertMcpRunTool(agent('a'.repeat(61)))).toThrow(InvalidAgentDefinitionError);
        expect(() => assertMcpRunTool(agent('a'.repeat(60)))).not.toThrow();
        expect(() => assertMcpRunTool(defineAgent({
            name: 'a'.repeat(64), 
            model: textModel(), 
            instructions: 'x', 
        }))).not.toThrow();
    });

    it('lists run_<agent> for an agent added later', async () => {
        const { app, engine } = createRunTestApp();
        await engine.putAgent(typedAgent());
        const client = await connectMcp(app, ADMIN_TOKEN);
        expect((await client.listTools()).tools.map((t) => t.name)).toContain('run_typed');
        const result = await callTool(client, 'run_typed', { payload: { n: 1 } });
        expect(result.isError, textOf(result)).toBeFalsy();
        await client.close();

        await engine.removeAgent('typed');
        const after = await connectMcp(app, ADMIN_TOKEN);
        expect((await after.listTools()).tools.map((t) => t.name)).not.toContain('run_typed');
        await after.close();
    });

    it('replaces run_<agent> when its agent is replaced', async () => {
        const { app, engine } = createRunTestApp({ agents: [...createRunAgents(), typedAgent()] });
        const first = await connectMcp(app, ADMIN_TOKEN);
        expect((await first.listTools()).tools.find((t) => t.name === 'run_typed')?.description).toContain('Typed runs.');
        await first.close();

        const schema = z.object({ s: z.string() });
        const input = vi.spyOn(schema['~standard'].jsonSchema!, 'input');
        await engine.putAgent(defineAgent({
            name: 'typed',
            model: textModel(),
            instructions: 'Retyped runs.',
            channels: [http.on({ schema })],
        }));
        for (let i = 0; i < 3; i++) {
            const client = await connectMcp(app, ADMIN_TOKEN);
            const typed = (await client.listTools()).tools.find((t) => t.name === 'run_typed')!;
            expect(typed.description).toContain('Retyped runs.');
            expect(typed.inputSchema.properties?.payload).toMatchObject({ properties: { s: { type: 'string' } } });
            await client.close();
        }
        expect(input).toHaveBeenCalledTimes(1);
    });

    it('reports an uncompilable payload schema of a later agent and skips its tool', async () => {
        const errors: unknown[] = [];
        const { app, engine } = createRunTestApp({ onError: (error) => { errors.push(error); } });
        const schema = z.object({ n: z.number() });
        vi.spyOn(schema['~standard'].jsonSchema!, 'input').mockReturnValue({ type: 'nonsense' });
        await engine.putAgent(defineAgent({
            name: 'broken',
            model: textModel(),
            instructions: 'Broken.',
            channels: [http.on({ schema })],
        }));
        await engine.putAgent(defineAgent({
            name: 'a'.repeat(61),
            model: textModel(),
            instructions: 'Long.',
            channels: [http.on()],
        }));
        for (let i = 0; i < 2; i++) {
            const client = await connectMcp(app, ADMIN_TOKEN);
            const names = (await client.listTools()).tools.map((t) => t.name);
            expect(names).toContain('run_echo');
            expect(names).not.toContain('run_broken');
            expect(names).not.toContain(`run_${'a'.repeat(61)}`);
            await client.close();
        }
        expect(errors).toHaveLength(2);
        expect(errors[0]).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((errors[0] as Error).message).toContain('"broken"');
        expect(errors[1]).toBeInstanceOf(InvalidAgentDefinitionError);
    });
});
