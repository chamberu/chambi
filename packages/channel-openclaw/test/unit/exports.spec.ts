/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as pkg from '@chamvi/channel-openclaw';

describe('public api', () => {
    it('exports openclawChannel', () => {
        expect(pkg.openclawChannel).toBeTypeOf('function');
    });

    it('exports the constants', () => {
        expect(pkg.DEFAULT_HOOKS_PATH).toBe('/hooks');
        expect(pkg.OPENCLAW_CHANNEL_NAME).toBe('openclaw');
        expect(pkg.OPENCLAW_TIMEOUT_MS).toBe(30_000);
        expect(pkg.OPENCLAW_REQUEST_ERROR_CODE).toBe('openclaw_request');
        expect(pkg.MESSAGE_BODY_MAX_LENGTH).toBe(8_000);
    });

    it.each([
        'openclaw',
        'injectOpenclawContext',
        'provideOpenclawContext',
        'HOOK_NAME',
        'IDEMPOTENCY_KEY_MAX_LENGTH',
        'DEFAULT_NOTIFIER_NAME',
        'ERROR_TEXT_MAX_LENGTH',
        'APPROVAL_HINT',
        'CHOICE_HINT',
        'resolveOptions',
        'openclawContextKey',
        'renderMessage',
    ])('has no %s', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });

    it.each([
        'openclawModule',
        'OpenclawModule',
    ])('the main entry keeps %s out', (name) => {
        expect(pkg).not.toHaveProperty(name);
    });
});
