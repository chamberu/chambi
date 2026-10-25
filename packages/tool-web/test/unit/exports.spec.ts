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
        expect(web.MAX_REDIRECTS).toBe(5);
        expect(web.WEB_REQUEST_ERROR_CODE).toBe('web_request');
        expect(web.WEB_SEARCH_MAX_RESULTS).toBe(20);
        expect(web.PACKAGE_VERSIONS_MAX).toBe(100);
        expect(web.PACKAGE_DEPENDENCIES_MAX).toBe(200);
        expect(Object.keys(web.DEFAULT_REGISTRIES)).toEqual(['npm', 'pypi', 'crates', 'packagist', 'go', 'rubygems']);
        expect(Object.isFrozen(web.DEFAULT_REGISTRIES)).toBe(true);
    });

    it('keeps the internals internal', () => {
        expect(Object.keys(web).sort()).toEqual([
            'DEFAULT_REGISTRIES',
            'MAX_REDIRECTS',
            'PACKAGE_DEPENDENCIES_MAX',
            'PACKAGE_VERSIONS_MAX',
            'WEB_FETCH_MAX_BYTES',
            'WEB_FETCH_MAX_CHARS',
            'WEB_REQUEST_ERROR_CODE',
            'WEB_SEARCH_MAX_RESULTS',
            'WEB_TIMEOUT_MS',
            'webTools',
        ]);
    });
});
