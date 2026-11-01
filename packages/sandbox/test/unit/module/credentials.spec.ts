/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import {
    AppToken,
    configModule,
    engineModule,
    storeModule,
} from '@chamvi/app';
import type { GitCredentialSource, IContainer, IModule } from '@chamvi/app';
import { createModuleHarness } from '@chamvi/app/testing';
import type { ModuleHarness } from '@chamvi/app/testing';
import { sandboxModule } from '@chamvi/sandbox/module';
import type { IGitCredentials } from '@chamvi/sandbox';
import { createFakeProvider } from '../../utils/provider.ts';
import { textModel } from '../../utils/model.ts';
import { createRecordingLogger } from '../../utils/module.ts';

let harnesses: ModuleHarness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((harness) => harness.stop()));
    harnesses = [];
});

/** A module contributing `source` to AppToken.GIT_CREDENTIALS, as githubModule() does. */
function contributing(source: GitCredentialSource): IModule {
    return {
        name: 'test:credentials',
        async setup(container: IContainer) {
            container.registerMany(AppToken.GIT_CREDENTIALS, { useValue: source });
        },
    };
}

async function harnessWith(modules: IModule[]): Promise<ModuleHarness> {
    const harness = await createModuleHarness({
        mode: 'start',
        env: {},
        agents: [defineAgent({
            name: 'coder',
            model: textModel('done'),
            instructions: 'x',
        })],
        modules: [
            configModule({ logger: createRecordingLogger() }),
            storeModule(),
            engineModule(),
            ...modules,
        ],
    });

    harnesses.push(harness);

    return harness;
}

describe('sandboxModule git credentials', () => {
    it('reads static tokens from CHAMVI_GIT_TOKENS', async () => {
        const provider = createFakeProvider();
        const module = sandboxModule({
            provider,
            gcIntervalMs: 0,
            env: {
                CHAMVI_GIT_TOKENS: JSON.stringify([{
                    host: 'github.com',
                    path: 'octo',
                    token: 'ghp_envtoken',
                }]),
            },
        });

        await module.manager.acquire('r1', { repo: 'octo/demo' });
        expect(provider.created[0]!.checkout?.credential).toEqual({ username: 'x-access-token', password: 'ghp_envtoken' });
        await module.manager.close();
    });

    it('names CHAMVI_GIT_TOKENS for a bad value without echoing it', () => {
        for (const value of ['{nope', JSON.stringify({ host: 'github.com' }), JSON.stringify([{ host: 'github.com', token: 'a\nsecret-value' }])]) {
            let error: unknown;

            try {
                sandboxModule({ provider: createFakeProvider(), env: { CHAMVI_GIT_TOKENS: value } });
            } catch (e) {
                error = e;
            }

            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect((error as Error).message).toContain('CHAMVI_GIT_TOKENS');
            expect((error as Error).message).not.toContain('secret-value');
        }
    });

    it('refuses CHAMVI_GIT_CREDENTIAL_MODE, removed in 0.4, naming the variable', () => {
        for (const value of ['tools', 'env', 'workspace']) {
            let error: unknown;

            try {
                sandboxModule({ provider: createFakeProvider(), env: { CHAMVI_GIT_CREDENTIAL_MODE: value } });
            } catch (e) {
                error = e;
            }

            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect((error as Error).message).toContain('CHAMVI_GIT_CREDENTIAL_MODE');
            expect((error as Error).message).not.toContain(`"${value}"`);
        }

        // empty is unset
        expect(() => sandboxModule({
            provider: createFakeProvider(),
            gcIntervalMs: 0,
            env: { CHAMVI_GIT_CREDENTIAL_MODE: '' },
        })).not.toThrow();
    });

    it('refuses a credentialMode option, removed in 0.4', () => {
        const options = {
            provider: createFakeProvider(),
            env: {},
            credentialMode: 'tools',
        } as Parameters<typeof sandboxModule>[0];

        expect(() => sandboxModule(options)).toThrow(InvalidAgentDefinitionError);
        expect(() => sandboxModule(options)).toThrow(/credentialMode/);
    });

    it('asks the sources other modules contribute after its own', async () => {
        const provider = createFakeProvider();
        const asked: string[] = [];
        const own: IGitCredentials = {
            async get(input) {
                asked.push(`own:${input.path}`);

                return input.path === 'octo/own' ? { username: 'u', password: 'own-token' } : undefined;
            },
        };
        const module = sandboxModule({
            provider,
            gcIntervalMs: 0,
            credentials: own,
            env: {},
        });

        await harnessWith([
            contributing({
                async get(input) {
                    asked.push(`contributed:${input.path}`);

                    return { username: 'x-access-token', password: 'app-token' };
                },
            }),
            module,
        ]);
        await module.manager.acquire('r1', { repo: 'octo/demo' });
        expect(provider.created[0]!.checkout?.credential).toEqual({ username: 'x-access-token', password: 'app-token' });
        expect(asked.slice(0, 2)).toEqual(['own:octo/demo', 'contributed:octo/demo']);
    });
});
