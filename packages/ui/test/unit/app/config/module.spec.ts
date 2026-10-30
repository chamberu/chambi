/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { DEV_CONFIG } from '../../../../app/config/constants.ts';
import { readConfig } from '../../../../app/config/module.ts';

function doc(text: string | undefined): Pick<Document, 'getElementById'> {
    return { getElementById: (id: string) => (text === undefined || id !== 'chamvi-config' ? null : { textContent: text } as HTMLElement) };
}

describe('readConfig', () => {
    it('reads the injected config', () => {
        const config = {
            apiBase: '/api',
            uiBase: '/api/ui',
            auth: { tokens: false, authup: { url: 'https://auth.example.com', clientId: 'chamvi' } },
        };

        expect(readConfig(doc(JSON.stringify(config)))).toEqual(config);
    });

    it('falls back to DEV_CONFIG without the element or with invalid JSON', () => {
        expect(readConfig(doc(undefined))).toEqual(DEV_CONFIG);
        expect(readConfig(doc('{nope'))).toEqual(DEV_CONFIG);
        expect(readConfig(doc('[]'))).toEqual(DEV_CONFIG);
        expect(readConfig(doc('{"apiBase":1}'))).toEqual(DEV_CONFIG);
    });

    it('is the dev server default', () => {
        expect(DEV_CONFIG).toEqual({
            apiBase: '',
            uiBase: '/ui',
            auth: { tokens: true },
        });
    });
});
