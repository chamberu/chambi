/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import * as web from '@chamvi/tool-web';

describe('public api', () => {
    it('exports the tools factory and the limits', () => {
        expect(web.webTools).toBeTypeOf('function');
        expect(web.WEB_FETCH_MAX_BYTES).toBe(5_242_880);
        expect(web.WEB_FETCH_MAX_CHARS).toBe(65_536);
        expect(web.WEB_TIMEOUT_MS).toBe(30_000);
        expect(web.WEB_MAX_REDIRECTS).toBe(5);
        expect(web.WEB_REQUEST_ERROR_CODE).toBe('web_request');
    });

    it('keeps the internals internal', () => {
        expect(Object.keys(web).sort()).toEqual([
            'WEB_FETCH_MAX_BYTES',
            'WEB_FETCH_MAX_CHARS',
            'WEB_MAX_REDIRECTS',
            'WEB_REQUEST_ERROR_CODE',
            'WEB_TIMEOUT_MS',
            'webTools',
        ]);
    });
});
