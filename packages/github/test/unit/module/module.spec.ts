/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
    InvalidAgentDefinitionError,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import {
    createGithubApp,
    github,
    injectGithubContext,
    provideGithubContext,
} from '@chamvi/github';
import { ControllableClock, createFakeGithub } from '@chamvi/test-kit';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    AppToken,
    configModule,
    engineModule,
    httpModule,
    staticTokensModule,
    storeModule,
} from '@chamvi/app';
import { createModuleHarness } from '@chamvi/app/testing';
import type { ModuleHarness } from '@chamvi/app/testing';
import type { ILifecycleHook, IModule } from '@chamvi/app';
import { githubModule } from '@chamvi/github/module';
import { mockModel, textModel } from '../../utils/model.ts';
import {
    TOKENS,
    createRecordingLogger,
    freePort,
} from '../../utils/module.ts';

const clock = new ControllableClock(new Date('2026-10-20T10:00:00Z'));
const fake = createFakeGithub({ appId: '1', clock });

function githubEnv(patch: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
        GITHUB_APP_ID: '1',
        GITHUB_APP_PRIVATE_KEY: fake.privateKey,
        GITHUB_WEBHOOK_SECRET: 'a',
        ...patch,
    };
}

function sign(body: string, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

let harnesses: ModuleHarness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
});

describe('githubModule', () => {
    it('reads env when called', async () => {
        const module = githubModule({ env: githubEnv({ GITHUB_APP_SLUG: 'my-app', GITHUB_INSTALLATION_ID: '7' }) });

        expect(module.name).toBe('chamvi:github');
        expect(module.app.appId).toBe('1');
        expect(module.app.installationId).toBe(7);
        expect(await module.app.botLogin()).toBe('my-app[bot]');
    });

    it('a missing variable names it', () => {
        expect(() => githubModule({ env: githubEnv({ GITHUB_WEBHOOK_SECRET: '' }) }))
            .toThrow(new InvalidAgentDefinitionError('GITHUB_WEBHOOK_SECRET is required.'));
        expect(() => githubModule({ env: githubEnv({ GITHUB_APP_ID: undefined }) }))
            .toThrow('GITHUB_APP_ID is required.');
    });

    it.each([
        ['GITHUB_API_URL', 'https://ghe.example.com/api/v3?access_token=s3cr3t', 's3cr3t'],
        ['GITHUB_APP_SLUG', 'Secret-Slug', 'Secret-Slug'],
    ])('a malformed %s names it and never echoes the value', (name, value, secret) => {
        let error: unknown;

        try {
            githubModule({ env: githubEnv({ [name]: value }) });
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message).toMatch(new RegExp(`^${name} must `));
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).toMatch(/\.$/);
    });

    it('a private key error never echoes the key', () => {
        const key = 'not-a-key-but-a-secret-value';
        let error: unknown;

        try {
            githubModule({ env: githubEnv({ GITHUB_APP_PRIVATE_KEY: key }) });
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message).toContain('GITHUB_APP_PRIVATE_KEY');
        expect((error as Error).message).not.toContain(key);
    });

    it('a malformed GITHUB_INSTALLATION_ID names it', () => {
        expect(() => githubModule({ env: githubEnv({ GITHUB_INSTALLATION_ID: '0' }) }))
            .toThrow('GITHUB_INSTALLATION_ID must be at least 1.');
    });

    it('comma-separated secrets', () => {
        const { app } = githubModule({ env: githubEnv({ GITHUB_WEBHOOK_SECRET: 'a,b' }) });
        const body = '{"zen":"hi"}';
        const bytes = new TextEncoder().encode(body);

        expect(app.verifySignature(bytes, sign(body, 'b'))).toBe(true);
        expect(app.verifySignature(bytes, sign(body, 'a'))).toBe(true);
        expect(app.verifySignature(bytes, sign(body, 'c'))).toBe(false);
    });

    it('literal \\n in the key works', () => {
        const escaped = fake.privateKey.trim().replace(/\n/g, '\\n');

        expect(escaped).not.toContain('\n');
        expect(() => githubModule({ env: githubEnv({ GITHUB_APP_PRIVATE_KEY: escaped }) })).not.toThrow();
    });

    it('explicit options win and need no env', () => {
        const module = githubModule({
            env: {},
            appId: '9',
            privateKey: fake.privateKey,
            webhookSecret: 's',
        });

        expect(module.app.appId).toBe('9');
    });

    it('a given app is used as is', () => {
        const { app } = githubModule({ env: githubEnv() });

        expect(githubModule({ app, env: {} }).app).toBe(app);
    });

    it('contributes the github channel and no route', async () => {
        const harness = await createModuleHarness({
            env: {},
            modules: [configModule({ logger: createRecordingLogger() }), githubModule({ env: githubEnv() })],
        });

        harnesses.push(harness);

        const channels = harness.container.resolveAll(AppToken.CHANNELS);

        expect(channels.map((channel) => channel.name)).toEqual(['github']);
        expect(channels[0]!.in).toBeTypeOf('function');
        expect(channels[0]!.out).toBeTypeOf('function');
        expect(harness.container.resolveAll(AppToken.HTTP_ROUTES)).toEqual([]);
    });

    it('contributes the App\'s git credentials, with the given permissions, unless switched off', async () => {
        const gh = createGithubApp({
            appId: 1,
            privateKey: fake.privateKey,
            webhookSecret: 'webhook-secret',
            clock,
            fetch: fake.fetch,
        });

        fake.installations.set('octo/module-demo', 77);

        const harness = await createModuleHarness({
            env: {},
            modules: [configModule({ logger: createRecordingLogger() }), githubModule({ app: gh, credentials: { permissions: { workflows: 'write' } } })],
        });

        harnesses.push(harness);

        const [source] = harness.container.resolveAll(AppToken.GIT_CREDENTIALS);
        const answer = await source!.get({
            url: 'https://github.com/octo/module-demo.git',
            host: 'github.com',
            path: 'octo/module-demo',
            access: 'write',
            runId: 'r1',
        });

        expect(answer).toMatchObject({ username: 'x-access-token' });

        const exchange = fake.requests.findLast((r) => r.path === '/app/installations/77/access_tokens');

        expect(exchange?.body).toEqual({ repositories: ['module-demo'], permissions: { contents: 'write', workflows: 'write' } });

        const off = await createModuleHarness({
            env: {},
            modules: [configModule({ logger: createRecordingLogger() }), githubModule({ app: gh, credentials: false })],
        });

        harnesses.push(off);
        expect(off.container.resolveAll(AppToken.GIT_CREDENTIALS)).toEqual([]);
    });

    it('takes the channel options', async () => {
        const harness = await createModuleHarness({
            env: {},
            modules: [
                configModule({ logger: createRecordingLogger() }),
                githubModule({ env: githubEnv(), channel: { name: 'github-ent' } }),
            ],
        });

        harnesses.push(harness);
        expect(harness.container.resolveAll(AppToken.CHANNELS).map((channel) => channel.name)).toEqual(['github-ent']);
    });

    it('uses the app store lock for persistent comments and forwards the slot', async () => {
        const fixture = createFakeGithub({
            appId: '1',
            slug: 'chamvi-test',
            clock,
        });
        const gh = createGithubApp({
            appId: '1',
            privateKey: fixture.privateKey,
            webhookSecret: 'a',
            slug: 'chamvi-test',
            installationId: 42,
            clock,
            fetch: fixture.fetch,
        });

        fixture.issues.set('octo/demo#7', { number: 7 });

        const harness = await createModuleHarness({
            env: {},
            modules: [
                configModule({ logger: createRecordingLogger() }),
                githubModule({ app: gh }),
                storeModule(),
            ],
        });

        harnesses.push(harness);

        const store = harness.container.resolve(AppToken.STORE);
        const acquire = vi.spyOn(store.locks, 'acquire').mockResolvedValue(false);
        const [channel] = harness.container.resolveAll(AppToken.CHANNELS);
        const message = {
            kind: 'message' as const,
            key: 'status-1',
            slot: 'status',
            runId: 'r1',
            agent: 'triage',
            body: 'First status',
        };
        const opts = {
            signal: new AbortController().signal,
            trigger: {
                id: 'e1',
                agent: 'triage',
                trigger: 'http',
                channel: 'http',
                payload: {},
                receivedAt: clock.now(),
            },
        };

        await expect(channel!.out!(message, 'octo/demo#7', opts)).rejects.toMatchObject({ code: 'github_request' });
        expect(acquire).toHaveBeenCalledOnce();
        expect(fixture.comments.size).toBe(0);
        acquire.mockRestore();

        await channel!.out!(message, 'octo/demo#7', opts);
        await channel!.out!({
            ...message,
            key: 'status-2',
            body: 'Latest status',
        }, 'octo/demo#7', opts);
        expect(fixture.comments.get('octo/demo#7')).toHaveLength(1);
        expect(fixture.comments.get('octo/demo#7')?.[0]?.body).toContain('Latest status');
    });

    it('links approvals to the UI of CHAMVI_PUBLIC_URL', async () => {
        const gh = createGithubApp({
            appId: '1',
            privateKey: fake.privateKey,
            webhookSecret: 'a',
            slug: 'chamvi-test',
            // an http run has no delivery: the channel comments as the app's installation
            installationId: 42,
            clock,
            fetch: fake.fetch,
        });

        fake.issues.set('octo/demo#7', { number: 7, state: 'open' });

        const harness = await createModuleHarness({
            env: { CHAMVI_PUBLIC_URL: 'https://chamvi.example' },
            modules: [configModule({ logger: createRecordingLogger() }), githubModule({ app: gh, env: {} })],
        });

        harnesses.push(harness);

        const [channel] = harness.container.resolveAll(AppToken.CHANNELS);

        await channel!.out!({
            kind: 'approval',
            key: 'r1:a1',
            runId: 'r1',
            agent: 'triage',
            title: 'Close?',
            body: '',
            approvalId: 'a1',
            expiresAt: new Date('2026-10-21T10:00:00Z'),
        }, 'octo/demo#7', {
            signal: new AbortController().signal,
            trigger: {
                id: 'e1',
                agent: 'triage',
                trigger: 'http',
                channel: 'http',
                payload: {},
                receivedAt: clock.now(),
            },
        });

        const posted = String(fake.comments.get('octo/demo#7')?.[0]?.body);

        expect(posted).toContain('Approve or deny: https://chamvi.example/ui/approvals?run=r1&approval=a1');
    });

    it('end to end', async () => {
        const port = await freePort();
        const agent = defineAgent({
            name: 'triage',
            model: textModel(),
            instructions: 'triage',
            channels: [github.on('issues.opened')],
        });
        const harness = await createModuleHarness({
            env: {
                CHAMVI_TOKENS: TOKENS,
                HOST: '127.0.0.1',
                PORT: String(port),
            },
            agents: [agent],
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule(),
                staticTokensModule(),
                engineModule(),
                httpModule({ metrics: false, rateLimit: false }),
                githubModule({ env: githubEnv({ GITHUB_APP_SLUG: 'chamvi-test' }) }),
            ],
        });

        harnesses.push(harness);

        const body = readFileSync(new URL('../../fixtures/deliveries/issues-opened.json', import.meta.url), 'utf8');
        const response = await fetch(`http://127.0.0.1:${port}/channels/github`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-github-event': 'issues',
                'x-github-delivery': 'd-1',
                'x-hub-signature-256': sign(body, 'a'),
            },
            body,
        });

        expect(response.status).toBe(202);

        const answer = await response.json() as { runs: Array<{ agent: string; runId: string }> };

        expect(answer.runs).toHaveLength(1);
        expect(answer.runs[0]!.agent).toBe('triage');
    });

    it('logs the failed agents of a delivery through the app logger', async () => {
        const port = await freePort();
        const logger = createRecordingLogger();
        const agent = defineAgent({
            name: 'triage',
            model: textModel(),
            instructions: 'triage',
            channels: [github.on('issues.opened', {
                filter: () => {
                    throw new Error('filter broke');
                },
            })],
        });
        const harness = await createModuleHarness({
            env: {
                CHAMVI_TOKENS: TOKENS,
                HOST: '127.0.0.1',
                PORT: String(port),
            },
            agents: [agent],
            modules: [
                configModule({ logger }),
                storeModule(),
                staticTokensModule(),
                engineModule(),
                httpModule({ metrics: false, rateLimit: false }),
                githubModule({ env: githubEnv({ GITHUB_APP_SLUG: 'chamvi-test' }) }),
            ],
        });

        harnesses.push(harness);

        const body = readFileSync(new URL('../../fixtures/deliveries/issues-opened.json', import.meta.url), 'utf8');
        const response = await fetch(`http://127.0.0.1:${port}/channels/github`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-github-event': 'issues',
                'x-github-delivery': 'd-2',
                'x-hub-signature-256': sign(body, 'a'),
            },
            body,
        });

        expect(response.status).toBe(500);

        const entry = logger.entries.find((e) => e.msg === 'github channel error');

        expect(entry?.level).toBe('error');
        expect(JSON.stringify(entry)).toContain('filter broke');
    });

    it('provides the app as context', async () => {
        const module = githubModule({ env: githubEnv() });
        const seen: boolean[] = [];
        const probe = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                seen.push(injectGithubContext(context) === module.app);

                return 'ok';
            },
        });
        const agent = defineAgent({
            name: 'probe',
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'probe',
                        input: {},
                    }],
                },
                { parts: [{ type: 'text', text: 'done' }] },
            ]),
            instructions: 'probe',
            tools: { probe },
        });
        const harness = await createModuleHarness({
            env: {},
            agents: [agent],
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule(),
                engineModule(),
                module,
            ],
        });

        harnesses.push(harness);

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await engine.dispatch({
            agent: 'probe',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });

        await engine.idle();
        expect((await engine.getRun(runId))?.status).toBe('completed');
        expect(seen).toEqual([true]);
        expect(harness.reported).toEqual([]);
    });

    it('reports a refused provide instead of failing setup', async () => {
        const first = githubModule({ env: githubEnv() });
        const module = githubModule({ env: githubEnv() });
        // provides the GitHub context before the module's own engineCreated hook runs
        const earlier: IModule = {
            name: 'earlier',
            async setup(container) {
                const hook: ILifecycleHook = {
                    name: 'earlier',
                    engineCreated: (engine) => provideGithubContext(engine, first.app),
                };

                container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: hook });
            },
        };
        const harness = await createModuleHarness({
            env: {},
            agents: [defineAgent({
                name: 'probe',
                model: textModel('ok'),
                instructions: 'probe',
            })],
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule(),
                engineModule(),
                earlier,
                module,
            ],
        });

        harnesses.push(harness);

        expect(harness.reported).toHaveLength(1);
        expect(harness.reported[0]!.error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((harness.reported[0]!.error as Error).message).toBe('Context "github" is already provided.');
        expect(harness.reported[0]!.context).toEqual({ hook: 'chamvi:github', phase: 'engineCreated' });
    });
});
