/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { readConfigFile } from '../../../src/models/file.ts';
import { readModelSettings } from '../../../src/models/settings.ts';
import type { ProviderConfig } from '../../../src/models/types.ts';

describe('readModelSettings', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'chamvi-settings-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    async function writeConfig(content: unknown, name = 'chamvi.json'): Promise<string> {
        const path = join(cwd, name);

        await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));

        return path;
    }

    function read(input: {
        env?: Record<string, string | undefined>;
        model?: string;
        providers?: Record<string, ProviderConfig>;
    } = {}) {
        return readModelSettings({
            env: input.env ?? {},
            cwd,
            model: input.model,
            providers: input.providers,
        });
    }

    describe('default model', () => {
        it('takes the code default', async () => {
            const { settings, issues } = await read({ model: 'a/m1' });

            expect(issues).toEqual([]);
            expect(settings.model).toEqual({ ref: 'a/m1', source: 'code' });
        });

        it('lets the file override code', async () => {
            await writeConfig({ model: 'a/m2' });

            const { settings } = await read({ model: 'a/m1' });

            expect(settings.model).toEqual({ ref: 'a/m2', source: 'file' });
            expect(settings.configFile).toBe(join(cwd, 'chamvi.json'));
        });

        it('lets CHAMVI_MODEL override file and code', async () => {
            await writeConfig({ model: 'a/m2' });

            const { settings } = await read({ model: 'a/m1', env: { CHAMVI_MODEL: 'a/m3' } });

            expect(settings.model).toEqual({ ref: 'a/m3', source: 'env' });
        });

        it('has none without any source', async () => {
            const { settings } = await read();

            expect(settings.model).toBeUndefined();
            expect(settings.configFile).toBeUndefined();
        });
    });

    describe('merge', () => {
        it('merges per field across sources', async () => {
            const { settings, issues } = await read({
                providers: { router: { type: 'openai-compatible', baseURL: 'http://router:20128/v1' } },
                env: { CHAMVI_PROVIDER_ROUTER_API_KEY: 'sk-router' },
            });

            expect(issues).toEqual([]);

            const router = settings.providers.get('router');

            expect(router).toEqual({
                name: 'router',
                type: 'openai-compatible',
                apiKey: 'sk-router',
                baseURL: 'http://router:20128/v1',
                headers: {},
                sources: {
                    type: 'code',
                    apiKey: 'env',
                    baseURL: 'code',
                    headers: {},
                },
            });
        });

        it('replaces a provider wholesale when a higher source sets another type', async () => {
            const { settings, issues } = await read({
                providers: {
                    p: {
                        type: 'openai-compatible',
                        apiKey: 'sk-code',
                        baseURL: 'http://x:1/v1',
                    },
                },
                env: { CHAMVI_PROVIDER_P_TYPE: 'anthropic', CHAMVI_PROVIDER_P_API_KEY: 'sk-env' },
            });

            expect(issues).toEqual([]);

            const p = settings.providers.get('p');

            expect(p?.type).toBe('anthropic');
            expect(p?.apiKey).toBe('sk-env');
            expect(p?.baseURL).toBeUndefined();
            expect(p?.sources).toEqual({
                type: 'env',
                apiKey: 'env',
                headers: {},
            });
        });

        it('drops a lower source apiKey on a type change', async () => {
            const { settings, issues } = await read({
                providers: { p: { type: 'anthropic', apiKey: 'sk-code' } },
                env: { CHAMVI_PROVIDER_P_TYPE: 'openai-compatible', CHAMVI_PROVIDER_P_BASE_URL: 'http://x:1/v1' },
            });

            expect(issues).toEqual([]);
            expect(settings.providers.get('p')?.apiKey).toBeUndefined();
        });

        it('keeps the lower fields when a higher source repeats the type', async () => {
            await writeConfig({ providers: { p: { type: 'anthropic', baseURL: 'https://proxy.example/v1' } } });

            const { settings, issues } = await read({ providers: { p: { type: 'anthropic', apiKey: 'sk-code' } } });

            expect(issues).toEqual([]);

            const p = settings.providers.get('p');

            expect(p?.apiKey).toBe('sk-code');
            expect(p?.baseURL).toBe('https://proxy.example/v1');
            expect(p?.sources).toEqual({
                type: 'file',
                apiKey: 'code',
                baseURL: 'file',
                headers: {},
            });
        });

        it('merges header names lower-cased', async () => {
            const { settings, issues } = await read({
                providers: {
                    r: {
                        type: 'openai-compatible',
                        baseURL: 'http://x:1/v1',
                        headers: { 'X-Team': 'a', 'X-Other': { env: 'OTHER' } },
                    },
                },
                env: { CHAMVI_PROVIDER_R_HEADER_X_TEAM: 'b', OTHER: 'o' },
            });

            expect(issues).toEqual([]);

            const r = settings.providers.get('r');

            expect(r?.headers).toEqual({ 'x-team': 'b', 'x-other': 'o' });
            expect(r?.sources.headers).toEqual({ 'x-team': 'env', 'x-other': 'code' });
        });
    });

    describe('env binding', () => {
        it('declares an env-only provider through _TYPE', async () => {
            const { settings, issues } = await read({
                env: {
                    CHAMVI_PROVIDER_TEAM_A_TYPE: 'anthropic',
                    CHAMVI_PROVIDER_TEAM_A_API_KEY: 'sk-a',
                },
            });

            expect(issues).toEqual([]);
            expect(settings.providers.get('team-a')).toMatchObject({
                name: 'team-a',
                type: 'anthropic',
                apiKey: 'sk-a',
                sources: { type: 'env', apiKey: 'env' },
            });
        });

        it('refuses a variable of a provider no source declares', async () => {
            const { settings, issues } = await read({ env: { CHAMVI_PROVIDER_ROUTR_API_KEY: 'sk-secret-value' } });

            expect(issues).toEqual([{
                provider: 'routr',
                message: 'CHAMVI_PROVIDER_ROUTR_API_KEY names provider "routr", which no source declares; ' +
                    'set CHAMVI_PROVIDER_ROUTR_TYPE or fix the name.',
            }]);
            expect(settings.providers.size).toBe(0);
        });

        it('binds a variable to the longest declared name', async () => {
            const { settings, issues } = await read({
                providers: {
                    a: { type: 'openai-compatible', baseURL: 'http://a:1/v1' },
                    'a-header': { type: 'openai-compatible', baseURL: 'http://b:1/v1' },
                },
                env: { CHAMVI_PROVIDER_A_HEADER_API_KEY: 'sk-ah' },
            });

            expect(issues).toEqual([]);
            expect(settings.providers.get('a-header')?.apiKey).toBe('sk-ah');
            expect(settings.providers.get('a')?.apiKey).toBeUndefined();
            expect(settings.providers.get('a')?.headers).toEqual({});
        });

        it('lets a declared name win over _TYPE discovery', async () => {
            const { settings, issues } = await read({
                providers: { a: { type: 'openai-compatible', baseURL: 'http://a:1/v1' } },
                env: { CHAMVI_PROVIDER_A_HEADER_X_TYPE: 'v' },
            });

            expect(issues).toEqual([]);
            expect(settings.providers.get('a')?.headers).toEqual({ 'x-type': 'v' });
            expect(settings.providers.has('a-header-x')).toBe(false);
        });

        it('binds the other variables of an env-only provider', async () => {
            const { settings, issues } = await read({
                env: {
                    CHAMVI_PROVIDER_ROUTER_TYPE: 'openai-compatible',
                    CHAMVI_PROVIDER_ROUTER_BASE_URL: 'http://9router:20128/v1',
                    CHAMVI_PROVIDER_ROUTER_HEADER_X_TEAM: 'a',
                },
            });

            expect(issues).toEqual([]);
            expect(settings.providers.get('router')).toMatchObject({
                baseURL: 'http://9router:20128/v1',
                headers: { 'x-team': 'a' },
                sources: { baseURL: 'env', headers: { 'x-team': 'env' } },
            });
        });

        it('refuses an unknown type without echoing it', async () => {
            const { issues } = await read({ env: { CHAMVI_PROVIDER_X_TYPE: 'nope-type' } });

            expect(issues).toHaveLength(1);
            expect(issues[0]?.provider).toBe('x');
            expect(issues[0]?.message).toContain('CHAMVI_PROVIDER_X_TYPE');
            expect(JSON.stringify(issues)).not.toContain('nope-type');
        });

        it('refuses a bad base URL naming the variable', async () => {
            const { settings, issues } = await read({
                env: {
                    CHAMVI_PROVIDER_R_TYPE: 'openai-compatible',
                    CHAMVI_PROVIDER_R_BASE_URL: 'http://user:pw@x/v1',
                },
            });

            expect(issues).toHaveLength(1);
            expect(issues[0]?.message).toContain('CHAMVI_PROVIDER_R_BASE_URL');
            expect(JSON.stringify(issues)).not.toContain('pw@');
            expect(settings.providers.has('r')).toBe(false);
        });

        it('treats an empty variable as unset', async () => {
            const { issues, settings } = await read({ env: { CHAMVI_PROVIDER_ROUTR_API_KEY: '' } });

            expect(issues).toEqual([]);
            expect(settings.providers.size).toBe(0);
        });
    });

    describe('implicit providers', () => {
        it('creates anthropic from ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL', async () => {
            const { settings, issues } = await read({
                env: {
                    ANTHROPIC_API_KEY: 'sk-ant',
                    ANTHROPIC_BASE_URL: 'https://proxy.example/v1',
                },
            });

            expect(issues).toEqual([]);
            expect(settings.providers.get('anthropic')).toEqual({
                name: 'anthropic',
                type: 'anthropic',
                apiKey: 'sk-ant',
                baseURL: 'https://proxy.example/v1',
                headers: {},
                sources: {
                    type: 'implicit',
                    apiKey: 'implicit',
                    baseURL: 'implicit',
                    headers: {},
                },
            });
        });

        it('creates nothing from AI_GATEWAY_API_KEY', async () => {
            const { settings } = await read({ env: { AI_GATEWAY_API_KEY: 'gw' } });

            expect(settings.providers.size).toBe(0);
        });

        it('creates nothing from a key only in process.env', async () => {
            const previous = process.env.ANTHROPIC_API_KEY;

            process.env.ANTHROPIC_API_KEY = 'sk-process';

            try {
                const { settings } = await read({ env: {} });

                expect(settings.providers.size).toBe(0);
            } finally {
                if (previous === undefined) {
                    delete process.env.ANTHROPIC_API_KEY;
                } else {
                    process.env.ANTHROPIC_API_KEY = previous;
                }
            }
        });

        it('lets a declared provider ignore the bare variables', async () => {
            const { settings, issues } = await read({
                providers: { openai: { type: 'openai', apiKey: 'sk-code' } },
                env: { OPENAI_API_KEY: 'sk-bare', OPENAI_BASE_URL: 'https://bare.example/v1' },
            });

            expect(issues).toEqual([]);

            const openai = settings.providers.get('openai');

            expect(openai?.apiKey).toBe('sk-code');
            expect(openai?.baseURL).toBeUndefined();
            expect(openai?.sources.type).toBe('code');
        });
    });

    describe('requirements', () => {
        it('needs an apiKey for a key-bearing type', async () => {
            const { settings, issues } = await read({ env: { CHAMVI_PROVIDER_TEAM_A_TYPE: 'anthropic' } });

            expect(issues).toEqual([{
                provider: 'team-a',
                message: 'Provider "team-a" (anthropic) needs CHAMVI_PROVIDER_TEAM_A_API_KEY.',
            }]);
            expect(settings.providers.has('team-a')).toBe(false);
        });

        it('allows a keyless openai-compatible provider', async () => {
            const { settings, issues } = await read({ providers: { local: { type: 'openai-compatible', baseURL: 'http://ollama:11434/v1' } } });

            expect(issues).toEqual([]);
            expect(settings.providers.get('local')?.apiKey).toBeUndefined();
        });

        it('needs a baseURL for openai-compatible', async () => {
            const { issues } = await read({ providers: { local: { type: 'openai-compatible' } } });

            expect(issues).toHaveLength(1);
            expect(issues[0]?.provider).toBe('local');
            expect(issues[0]?.message).toContain('CHAMVI_PROVIDER_LOCAL_BASE_URL');
        });

        it('reports an unset { env } secret and leaves the provider out', async () => {
            const { settings, issues } = await read({
                providers: {
                    'team-a': { type: 'anthropic', apiKey: { env: 'TEAM_A_KEY' } },
                    ok: { type: 'anthropic', apiKey: 'sk-ok' },
                },
            });

            expect(issues).toHaveLength(1);
            expect(issues[0]?.provider).toBe('team-a');
            expect(issues[0]?.message).toContain('TEAM_A_KEY');
            expect(settings.providers.has('team-a')).toBe(false);
            expect(settings.providers.has('ok')).toBe(true);
        });

        it('collects every issue', async () => {
            const { issues } = await read({
                providers: { a: { type: 'anthropic' }, b: { type: 'openai' } },
                env: { CHAMVI_PROVIDER_ROUTR_API_KEY: 'x' },
            });

            expect(issues.map((issue) => issue.provider).sort()).toEqual(['a', 'b', 'routr']);
        });

        it('refuses a bad code provider name and an unknown code type', async () => {
            const { settings, issues } = await read({
                providers: {
                    Bad_Name: { type: 'anthropic', apiKey: 'k' },
                    x: { type: 'nope' as never, apiKey: 'k' },
                },
            });

            expect(issues).toHaveLength(2);
            expect(settings.providers.size).toBe(0);
        });
    });

    describe('config file', () => {
        it('reads CHAMVI_CONFIG_FILE relative to cwd', async () => {
            await mkdir(join(cwd, 'conf'));
            await writeConfig({ providers: { r: { type: 'openai-compatible', baseURL: 'http://r:1/v1' } } }, 'conf/c.json');

            const { settings, issues } = await read({ env: { CHAMVI_CONFIG_FILE: 'conf/c.json' } });

            expect(issues).toEqual([]);
            expect(settings.configFile).toBe(join(cwd, 'conf/c.json'));
            expect(settings.providers.get('r')?.sources.type).toBe('file');
        });

        it('reports a named missing file', async () => {
            const { issues } = await read({ env: { CHAMVI_CONFIG_FILE: join(cwd, 'missing.json') } });

            expect(issues).toHaveLength(1);
            expect(issues[0]?.message).toContain('CHAMVI_CONFIG_FILE');
        });

        it('reports bad JSON', async () => {
            await writeConfig('{ "model": ');

            const { issues } = await read();

            expect(issues).toHaveLength(1);
            expect(issues[0]?.message).toContain('chamvi.json');
        });

        it('reports a bad shape', async () => {
            await writeConfig({ model: 42 });

            const { issues } = await read();

            expect(issues).toHaveLength(1);
            expect(issues[0]?.message).toContain('model');
        });

        it('reads { file } secrets relative to cwd', async () => {
            await writeFile(join(cwd, 'key.txt'), 'sk-from-file\n');
            await writeConfig({ providers: { a: { type: 'anthropic', apiKey: { file: 'key.txt' } } } });

            const { settings, issues } = await read();

            expect(issues).toEqual([]);
            expect(settings.providers.get('a')?.apiKey).toBe('sk-from-file');
        });

        it('ignores remotes', async () => {
            await writeConfig({ remotes: { other: { url: 'https://x' } } });

            const { issues } = await read();

            expect(issues).toEqual([]);
        });
    });

    it('never puts a secret value into an issue', async () => {
        await writeConfig({
            providers: {
                f: {
                    type: 'openai-compatible',
                    baseURL: 'http://f:1/v1',
                    apiKey: 'sk-literal-secret',
                },
            },
        });

        const { issues } = await read({
            providers: {
                c: {
                    type: 'anthropic',
                    apiKey: { env: 'UNSET_VAR' },
                    baseURL: 'https://u:pw-secret@x/v1',
                },
            },
            env: {
                CHAMVI_PROVIDER_ROUTR_API_KEY: 'sk-env-secret',
                CHAMVI_PROVIDER_Q_TYPE: 'secret-type',
            },
        });

        expect(issues.length).toBeGreaterThan(0);

        const text = JSON.stringify(issues);

        for (const value of ['sk-literal-secret', 'pw-secret', 'sk-env-secret', 'secret-type']) {
            expect(text).not.toContain(value);
        }
    });
});

describe('readConfigFile', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'chamvi-config-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    async function file(content: unknown): Promise<string> {
        const path = join(cwd, 'chamvi.json');

        await writeFile(path, JSON.stringify(content));

        return path;
    }

    it('returns model and providers', async () => {
        const path = await file({
            model: 'router/cc/m',
            providers: {
                router: {
                    type: 'openai-compatible',
                    baseURL: 'http://9router:20128/v1',
                    apiKey: { env: 'ROUTER_KEY' },
                    headers: { 'x-team': 'a', 'X-Token': { file: 'token.txt' } },
                },
            },
        });

        await expect(readConfigFile(path)).resolves.toEqual({
            model: 'router/cc/m',
            providers: {
                router: {
                    type: 'openai-compatible',
                    baseURL: 'http://9router:20128/v1',
                    apiKey: { env: 'ROUTER_KEY' },
                    headers: { 'x-team': 'a', 'x-token': { file: 'token.txt' } },
                },
            },
        });
    });

    it('refuses a literal apiKey', async () => {
        const path = await file({
            providers: {
                router: {
                    type: 'openai-compatible',
                    baseURL: 'http://r:1/v1',
                    apiKey: 'sk-x',
                },
            },
        });
        const promise = readConfigFile(path);

        await expect(promise).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(promise).rejects.toThrow(
            'chamvi.json: providers.router.apiKey must be { "env": "<VAR>" } or { "file": "<path>" }, not a literal.',
        );
    });

    it('refuses a literal Authorization header', async () => {
        const path = await file({
            providers: {
                r: {
                    type: 'openai-compatible',
                    baseURL: 'http://r:1/v1',
                    headers: { Authorization: 'Bearer x' },
                },
            },
        });

        await expect(readConfigFile(path)).rejects.toThrow(
            'chamvi.json: providers.r.headers.Authorization must be { "env": "<VAR>" } or { "file": "<path>" }, not a literal.',
        );
    });

    it('refuses an unknown type', async () => {
        const path = await file({ providers: { r: { type: 'nope' } } });

        await expect(readConfigFile(path)).rejects.toThrow(/providers\.r\.type/);
    });

    it('refuses a bad provider name', async () => {
        const path = await file({ providers: { Router_1: { type: 'anthropic', apiKey: { env: 'K' } } } });

        await expect(readConfigFile(path)).rejects.toThrow(/providers\.Router_1/);
    });

    it('refuses an unknown provider field', async () => {
        const path = await file({ providers: { r: { type: 'openai-compatible', baseUrl: 'http://r:1/v1' } } });

        await expect(readConfigFile(path)).rejects.toThrow(/providers\.r\.baseUrl/);
    });

    it('refuses a bad base URL naming the field', async () => {
        const path = await file({ providers: { r: { type: 'openai-compatible', baseURL: 'ftp://r/v1' } } });

        await expect(readConfigFile(path)).rejects.toThrow(/providers\.r\.baseURL/);
    });

    it('returns empty providers for an empty object', async () => {
        const path = await file({});

        await expect(readConfigFile(path)).resolves.toEqual({ providers: {} });
    });
});
