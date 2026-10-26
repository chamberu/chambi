/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import * as app from '@chamvi/app';
import * as authup from '@chamvi/app/authup';
import * as testing from '@chamvi/app/testing';
import type {
    AgentReport,
    AppReport,
    IApp,
    ProviderReport,
} from '@chamvi/app';

describe('public api', () => {
    it.each([
        'createApp',
        'isApp',
        'readConfig',
        'approvalUrlOf',
        'createLogger',
        'runHooks',
        'throwIfStopped',
        'envString',
        'envInteger',
        'envBoolean',
        'envUrl',
        'envList',
        'envJson',
        'envOneOf',
        'loadAgent',
        'loadAgents',
        'hashAgentFolder',
        'listAgentFolders',
        'configModule',
        'storeModule',
        'staticTokensModule',
        'consoleChannelModule',
        'engineModule',
        'agentsModule',
        'schedulerModule',
        'httpModule',
        // the common surface of @chamvi/core and @chamvi/http
        'defineAgent',
        'approve',
        'defineTool',
        'defineEffectTool',
        'effectMarker',
        'requireToolPermission',
        'consoleChannel',
        'defineContextKey',
        'inject',
        'tryInject',
        'agentPermission',
        'resolveModel',
        'checkAgentModel',
    ])('exports %s', (name) => {
        expect(app).toHaveProperty(name);
        expect(app[name as keyof typeof app]).toBeTypeOf('function');
    });

    it.each(['createModelRegistry', 'installDefaultProvider', 'resolveModels'])('does not export %s', (name) => {
        expect(app).not.toHaveProperty(name);
    });

    it.each(['cron', 'http', 'webhook'])('exports the %s subscription builder', (name) => {
        const builder = app[name as 'cron' | 'http' | 'webhook'];
        expect(builder.on).toBeTypeOf('function');
    });

    it('drops what channels replaced', () => {
        for (const name of ['consoleNotifierModule', 'consoleNotifier']) {
            expect(app).not.toHaveProperty(name);
        }
    });

    it('exports the timer limit of the ms variables', () => {
        expect(app.TIMER_MAX_MS).toBe(2_147_483_647);
    });

    it('exports the default poll interval of the agents dir', () => {
        expect(app.DEFAULT_AGENTS_POLL_MS).toBe(5_000);
    });

    it('exports the tokens', () => {
        expect(Object.keys(app.AppToken).sort()).toEqual([
            'AGENT_CHECKS',
            'AGENT_ISSUES',
            'AUTHENTICATORS',
            'CHANNELS',
            'CLOCK',
            'CONFIG',
            'CONTEXT',
            'DATA_SOURCE',
            'ENGINE',
            'GIT_CREDENTIALS',
            'HTTP_ROUTES',
            'LIFECYCLE_HOOKS',
            'LOGGER',
            'SERVER',
            'SHUTDOWN',
            'STORE',
        ]);
    });

    it('exports the module names and codes', () => {
        expect(app.ModuleName).toEqual({
            CONFIG: 'chamvi:config',
            STORE: 'chamvi:store',
            STATIC_TOKENS: 'chamvi:static-tokens',
            ENGINE: 'chamvi:engine',
            AGENTS: 'chamvi:agents',
            SCHEDULER: 'chamvi:scheduler',
            HTTP: 'chamvi:http',
            CONSOLE: 'chamvi:console',
        });
        expect(app.APP_ERROR_CODE).toEqual({
            STOPPED: 'app_stopped',
            IN_USE: 'app_in_use',
            STOP_FAILED: 'app_stop_failed',
            STORE_NOT_MIGRATED: 'store_not_migrated',
        });
        expect(app.AUTHENTICATOR_ORDER).toEqual({
            STATIC_TOKENS: 0,
            AUTHUP: 10,
            OIDC: 20,
        });
    });

    it('exports the built-in providers', () => {
        expect(app.BUILTIN_PROVIDERS.map((provider) => provider.id).sort()).toEqual([
            'anthropic',
            'google',
            'mistral',
            'openai',
            'xai',
        ]);
    });

    it('exports the inspect report types', () => {
        expectTypeOf<IApp['inspect']>().returns.resolves.toEqualTypeOf<AppReport>();
        expectTypeOf<AppReport['agents']>().toEqualTypeOf<AgentReport[]>();
        expectTypeOf<AppReport['providers']>().toEqualTypeOf<ProviderReport[]>();
        expect(app.createApp({}).inspect).toBeTypeOf('function');
    });

    it('exports the app brand', () => {
        expect(app.APP_BRAND).toBe(Symbol.for('chamvi.app'));
    });

    it('exports the http permissions', () => {
        expect(app.Permission).toBeTypeOf('object');
    });

    it.each([
        ['authup', authup, ['authupModule', 'oidcModule']],
    ] as const)('@chamvi/app/%s exports its modules', (_, entry, names) => {
        for (const name of names) {
            expect(entry).toHaveProperty(name);
            expect((entry as Record<string, unknown>)[name]).toBeTypeOf('function');
        }
    });

    it.each([
        'reportingModule',
        'createPurgeTimer',
        'createAgentsWatcher',
        'createLazyProvider',
        'githubModule',
        'githubChannel',
        'openclawModule',
        'openclawChannel',
        'sandboxModule',
        'uiModule',
        'buildModuleHarness',
        'createModuleHarness',
    ])('keeps %s out of the main entry', (name) => {
        expect(app).not.toHaveProperty(name);
    });

    it.each([
        'buildModuleHarness',
        'createModuleHarness',
    ])('@chamvi/app/testing exports %s', (name) => {
        expect(testing).toHaveProperty(name);
        expect(testing[name as keyof typeof testing]).toBeTypeOf('function');
    });
});

describe('package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
        exports: Record<string, unknown>,
        dependencies?: Record<string, string>,
        devDependencies?: Record<string, string>,
        peerDependencies?: Record<string, string>,
        peerDependenciesMeta?: Record<string, { optional?: boolean }>,
    };

    it('exports only the main, authup and testing entries', () => {
        expect(Object.keys(pkg.exports).sort()).toEqual(['.', './authup', './package.json', './testing']);
    });

    it('names no feature package in the dependency fields', () => {
        const feature = /^@chamvi\/(github|channel-openclaw|sandbox(-.+)?|ui)$/;
        const names = [
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.devDependencies ?? {}),
            ...Object.keys(pkg.peerDependencies ?? {}),
        ];
        expect(names.filter((name) => feature.test(name))).toEqual([]);
    });

    it('declares only the model providers and authup as optional peers', () => {
        const optional = Object.entries(pkg.peerDependenciesMeta ?? {})
            .filter(([, meta]) => meta.optional)
            .map(([name]) => name)
            .sort();
        expect(optional).toEqual([
            '@ai-sdk/anthropic',
            '@ai-sdk/google',
            '@ai-sdk/mistral',
            '@ai-sdk/openai',
            '@ai-sdk/openai-compatible',
            '@ai-sdk/xai',
            '@authup/core-http-kit',
            '@authup/server-adapter-kit',
        ]);
    });
});
