/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { join } from 'node:path';
import { cron } from '@chamvi/channel-cron';
import { defineAgent } from '@chamvi/core';
import { http } from '@chamvi/http';
import { customProvider } from 'ai';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { createApp, httpModule } from '@chamvi/app';
import type { IApp } from '@chamvi/app';
import { NO_AGENTS_MESSAGE } from '../../../src/modules/agents/constants.ts';
import {
    HTTP_TRIGGER,
    agentFile,
    cronTrigger,
} from '../../utils/agents-dir.ts';
import { TOKENS } from '../../utils/app.ts';
import { createTempDir, writeTree } from '../../utils/folder.ts';
import { textModel } from '../../utils/model.ts';
import { freePort } from '../../utils/port.ts';

const LONG_NAME = 'a'.repeat(62);

describe('IApp.inspect()', () => {
    let temp: { path: string; remove: () => Promise<void> };
    let agentsDir: string;
    let configFile: string;
    const apps: IApp[] = [];

    beforeEach(async () => {
        temp = await createTempDir();
        agentsDir = join(temp.path, 'agents');
        configFile = join(temp.path, 'chamvi.json');
        await writeTree(temp.path, { 'agents/.keep': '' });
    });

    afterEach(async () => {
        await Promise.all(apps.map((app) => app.stop()));
        apps.length = 0;
        await temp.remove();
    });

    function track(app: IApp): IApp {
        apps.push(app);
        return app;
    }

    function testModels() {
        return { test: customProvider({ languageModels: { model: textModel() } }) };
    }

    it('reports the default, the providers and the source of every field', async () => {
        await writeTree(temp.path, {
            'chamvi.json': JSON.stringify({
                providers: {
                    team: { type: 'openai-compatible', baseURL: 'http://router:20128/v1' },
                    claude: { type: 'anthropic', apiKey: { env: 'TEAM_KEY' } },
                },
            }),
        });
        const app = track(createApp({
            model: 'team/m',
            providers: { team: { type: 'openai-compatible', headers: { 'X-Team': 'a' } } },
        }));

        const report = await app.inspect({
            env: {
                CHAMVI_CONFIG_FILE: configFile,
                CHAMVI_AGENTS_DIR: agentsDir,
                CHAMVI_PROVIDER_TEAM_API_KEY: 'sk-team-0001',
                TEAM_KEY: 'sk-claude-0001',
            },
        });

        expect(report.ok).toBe(true);
        expect(report.configFile).toBe(configFile);
        expect(report.model).toEqual({ ref: 'team/m', source: 'code' });
        expect(report.models).toEqual([]);
        const team = report.providers.find((provider) => provider.name === 'team');
        expect(team).toEqual({
            name: 'team',
            type: 'openai-compatible',
            sources: {
                type: 'file',
                apiKey: 'env',
                baseURL: 'file',
                headers: { 'x-team': 'code' },
            },
            baseURL: 'http://router:20128/v1',
            apiKey: true,
            headers: ['x-team'],
        });
        const claude = report.providers.find((provider) => provider.name === 'claude');
        expect(claude).toMatchObject({
            type: 'anthropic',
            apiKey: true,
            headers: [],
            sources: { type: 'file', apiKey: 'file' },
        });
        expect(claude?.error).toBeUndefined();
    });

    it('lists the ids of createApp models', async () => {
        const app = track(createApp({ models: testModels() }));
        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: agentsDir } });
        expect(report.models).toEqual(['test']);
    });

    it('reports code and folder agents with their models', async () => {
        await writeTree(agentsDir, { 'greeter/agent.ts': agentFile('hi', 'test/model') });
        const code = defineAgent({
            name: 'triage',
            model: textModel(),
            instructions: 'x',
        });
        const fallback = defineAgent({ name: 'plain', instructions: 'x' });
        const app = track(createApp({
            agents: [code, fallback],
            model: 'test/model',
            models: testModels(),
        }));

        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: agentsDir } });

        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([]);
        expect(report.agents).toEqual([
            {
                name: 'triage',
                kind: 'code',
                model: 'mock-provider:mock-model-id (object)',
                errors: [],
            },
            {
                name: 'plain',
                kind: 'code',
                model: 'test/model',
                errors: [],
            },
            {
                name: 'greeter',
                kind: 'folder',
                model: 'test/model',
                errors: [],
            },
        ]);
    });

    it('runs only the agent checks the app\'s modules declare', async () => {
        await writeTree(agentsDir, { [`${LONG_NAME}/agent.ts`]: agentFile('x', 'test/model', LONG_NAME, [HTTP_TRIGGER]) });
        const app = track(createApp({ modules: [httpModule({ mcp: false })], models: testModels() }));

        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: agentsDir } });

        expect(report.agents.find((agent) => agent.name === LONG_NAME)?.errors).toEqual([]);
    });

    it('reports folder agents a start would refuse', async () => {
        await writeTree(agentsDir, {
            'lost/agent.ts': agentFile('x', 'nope/m', 'lost'),
            'ticker/agent.ts': agentFile('x', 'test/model', 'ticker', [cronTrigger('not a cron')]),
            [`${LONG_NAME}/agent.ts`]: agentFile('x', 'test/model', LONG_NAME, [HTTP_TRIGGER]),
            'broken/agent.ts': 'export default 42;\n',
            'triage/agent.ts': agentFile('x', 'test/model', 'triage'),
        });
        const code = defineAgent({
            name: 'triage',
            model: textModel(),
            instructions: 'x',
        });
        const app = track(createApp({ agents: [code], models: testModels() }));

        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: agentsDir } });

        expect(report.ok).toBe(false);
        const byName = (name: string, kind: string) => report.agents.find((agent) => agent.name === name && agent.kind === kind);
        expect(byName('triage', 'code')?.errors).toEqual([]);
        expect(byName('lost', 'folder')?.errors).toEqual([expect.stringContaining('nope')]);
        expect(byName('ticker', 'folder')?.errors).toEqual([expect.stringContaining('ticker')]);
        expect(byName(LONG_NAME, 'folder')?.errors).toEqual([expect.stringContaining('MCP tool')]);
        expect(byName('broken', 'folder')).toEqual({
            name: 'broken',
            kind: 'folder',
            errors: [expect.stringContaining('broken')],
        });
        expect(byName('triage', 'folder')?.errors).toEqual([expect.stringContaining('code agent')]);
    });

    it('checks code agents like folder agents', async () => {
        const ticker = defineAgent({
            name: 'ticker',
            model: 'nope/m',
            instructions: 'x',
            channels: [cron.on('* * * * *'), http.on()],
        });
        const app = track(createApp({ agents: [ticker] }));
        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: agentsDir } });
        expect(report.ok).toBe(false);
        expect(report.agents).toEqual([
            {
                name: 'ticker',
                kind: 'code',
                model: 'nope/m',
                errors: [expect.stringContaining('nope')],
            },
        ]);
    });

    it('collects settings issues instead of throwing', async () => {
        const app = track(createApp({
            model: 'missing/m',
            providers: { team: { type: 'anthropic', apiKey: { env: 'UNSET_KEY' } } },
        }));

        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: agentsDir, CHAMVI_PROVIDER_Q_TYPE: 'bogus' } });

        expect(report.ok).toBe(false);
        expect(report.issues.length).toBeGreaterThanOrEqual(2);
        expect(report.issues.join('\n')).toContain('UNSET_KEY');
        expect(report.issues.join('\n')).toContain('missing');
        expect(report.providers.find((provider) => provider.name === 'team')).toBeUndefined();
    });

    it('reports a config error and skips the folders', async () => {
        await writeTree(agentsDir, { 'greeter/agent.ts': agentFile('hi', 'test/model') });
        const app = track(createApp({ models: testModels() }));
        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: agentsDir, PORT: 'nope' } });
        expect(report.ok).toBe(false);
        expect(report.issues).toEqual([expect.stringContaining('PORT')]);
        expect(report.agents).toEqual([]);
    });

    it('reports an agents dir that is no directory', async () => {
        const app = track(createApp({ models: testModels() }));
        const report = await app.inspect({ env: { CHAMVI_AGENTS_DIR: join(temp.path, 'missing') } });
        expect(report.ok).toBe(false);
        expect(report.issues).toEqual([expect.stringContaining('CHAMVI_AGENTS_DIR')]);
    });

    it('agrees with start on an app without agents', async () => {
        const app = track(createApp({}));
        const report = await app.inspect({ env: {} });
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([NO_AGENTS_MESSAGE]);
        expect(report.agents).toEqual([]);
    });

    it('is read-only: no store, repeatable, and start works afterwards', async () => {
        const agent = defineAgent({
            name: 'triage',
            model: textModel(),
            instructions: 'x',
        });
        const app = track(createApp({ agents: [agent] }));
        const env = {
            CHAMVI_AGENTS_DIR: agentsDir,
            DATABASE_URL: 'postgres://chamvi:pw@127.0.0.1:1/chamvi',
        };

        const first = await app.inspect({ env });
        const second = await app.inspect({ env });
        expect(first).toEqual(second);
        expect(first.ok).toBe(true);

        await app.start({
            env: {
                CHAMVI_AGENTS_DIR: agentsDir,
                CHAMVI_TOKENS: TOKENS,
                PORT: String(await freePort()),
                HOST: '127.0.0.1',
            },
        });
    });

    it('never puts a secret into the report', async () => {
        await writeTree(temp.path, { 'chamvi.json': JSON.stringify({ providers: { file: { type: 'openai-compatible', baseURL: 'http://u:p@h/v1?k=s' } } }) });
        const app = track(createApp({
            providers: {
                team: {
                    type: 'openai-compatible',
                    baseURL: 'http://router:1/v1',
                    apiKey: 'sk-inspect-secret-0001',
                    headers: { authorization: 'Bearer hdr-secret-0001' },
                },
                bad: { type: 'openai-compatible', baseURL: 'http://u:p@h/v1?k=s' },
            },
        }));

        const report = await app.inspect({
            env: {
                CHAMVI_CONFIG_FILE: configFile,
                CHAMVI_AGENTS_DIR: agentsDir,
                CHAMVI_PROVIDER_ENVP_TYPE: 'openai-compatible',
                CHAMVI_PROVIDER_ENVP_BASE_URL: 'http://u:p@h/v1?k=s',
                CHAMVI_PROVIDER_ENVP_API_KEY: 'sk-env-secret-0001',
            },
        });

        const json = JSON.stringify(report);
        expect(report.providers.find((provider) => provider.name === 'team')).toMatchObject({ apiKey: true, headers: ['authorization'] });
        for (const secret of ['sk-inspect-secret-0001', 'hdr-secret-0001', 'sk-env-secret-0001', 'http://u:p@h/v1?k=s', 'u:p@', 'k=s']) {
            expect(json).not.toContain(secret);
        }
    });
});
