/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IModule } from 'orkos';
import { describe, expect, it } from 'vitest';
import {
    AUTHENTICATOR_ORDER,
    AppToken,
    ModuleName,
    configModule,
    staticTokensModule,
} from '@chamvi/app';
import type { AuthenticatorEntry } from '@chamvi/app';
import { createHarness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';

const ENV_TOKEN = 'env-token-0123456789';
const OPTION_TOKEN = 'option-token-0123456789';

function bearer(token: string): Request {
    return new Request('http://localhost/me', { headers: { authorization: `Bearer ${token}` } });
}

async function entriesOf(options: {
    env?: Record<string, string>;
    dev?: boolean;
    module?: ReturnType<typeof staticTokensModule>;
    extra?: IModule[];
}) {
    const logger = createRecordingLogger();
    const harness = await createHarness({
        dev: options.dev,
        env: { ...options.env },
        // the static-tokens module first, so a contribution registered after its setup still counts
        modules: [configModule({ logger }), options.module ?? staticTokensModule(), ...(options.extra ?? [])],
    });
    const entries: AuthenticatorEntry[] = harness.container.resolveAll(AppToken.AUTHENTICATORS);

    await harness.stop();

    return { entries, logger };
}

describe('staticTokensModule', () => {
    it('is named and depends on the config module', () => {
        const module = staticTokensModule();

        expect(module.name).toBe(ModuleName.STATIC_TOKENS);
        expect(module.dependencies).toEqual([ModuleName.CONFIG]);
    });

    it('contributes CHAMVI_TOKENS', async () => {
        const { entries } = await entriesOf({
            env: {
                CHAMVI_TOKENS: JSON.stringify([{
                    value: ENV_TOKEN,
                    id: 'ci',
                    permissions: ['run:read'],
                }]),
            },
        });

        expect(entries).toHaveLength(1);
        expect(entries[0]!.name).toBe('static-tokens');
        expect(entries[0]!.order).toBe(AUTHENTICATOR_ORDER.STATIC_TOKENS);
        await expect(entries[0]!.authenticator(bearer(ENV_TOKEN))).resolves.toEqual({
            id: 'ci',
            kind: 'token',
            permissions: ['run:read'],
        });
    });

    it('options win over env', async () => {
        const { entries } = await entriesOf({
            env: {
                CHAMVI_TOKENS: JSON.stringify([{
                    value: ENV_TOKEN,
                    id: 'ci',
                    permissions: ['*'],
                }]),
            },
            module: staticTokensModule({
                tokens: [{
                    value: OPTION_TOKEN,
                    id: 'opt',
                    permissions: ['*'],
                }],
            }),
        });

        expect(entries).toHaveLength(1);
        await expect(entries[0]!.authenticator(bearer(ENV_TOKEN))).resolves.toBeUndefined();
        await expect(entries[0]!.authenticator(bearer(OPTION_TOKEN))).resolves.toMatchObject({ id: 'opt' });
    });

    it('nothing without tokens outside dev', async () => {
        const { entries, logger } = await entriesOf({});

        expect(entries).toEqual([]);
        expect(logger.entries).toEqual([]);
    });

    it('dev generates a \'*\' token and logs it once', async () => {
        const { entries, logger } = await entriesOf({ dev: true });

        expect(entries).toHaveLength(1);

        const warnings = logger.entries.filter((entry) => entry.msg.includes('CHAMVI_TOKENS'));

        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.level).toBe('warn');

        const token = warnings[0]!.token as string;

        expect(token.length).toBeGreaterThanOrEqual(32);
        await expect(entries[0]!.authenticator(bearer(token))).resolves.toEqual({
            id: 'dev',
            kind: 'token',
            permissions: ['*'],
        });
    });

    it('dev with tokens generates none', async () => {
        const { entries, logger } = await entriesOf({
            dev: true,
            env: {
                CHAMVI_TOKENS: JSON.stringify([{
                    value: ENV_TOKEN,
                    id: 'ci',
                    permissions: ['*'],
                }]),
            },
        });

        expect(entries).toHaveLength(1);
        expect(logger.entries.filter((entry) => entry.msg.includes('CHAMVI_TOKENS'))).toEqual([]);
    });

    it('dev with another authenticator generates none', async () => {
        const other: AuthenticatorEntry = {
            name: 'other',
            order: AUTHENTICATOR_ORDER.AUTHUP,
            authenticator: async () => undefined,
        };
        const { entries, logger } = await entriesOf({
            dev: true,
            extra: [{
                name: 'other-auth',
                async setup(container) {
                    container.registerMany(AppToken.AUTHENTICATORS, { useValue: other });
                },
            }],
        });

        expect(entries).toEqual([other]);
        expect(logger.entries.filter((entry) => entry.msg.includes('CHAMVI_TOKENS'))).toEqual([]);
    });
});
