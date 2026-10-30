/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import UntrustedChip from '../../../../app/components/untrusted-chip/UntrustedChip.vue';
import { wireRun } from '../../../utils/runs.ts';

describe('UntrustedChip', () => {
    it('shows the first source and time without rendering source markup', async () => {
        const run = wireRun({ taint: { source: '<b>web.fetch</b>', at: '2026-10-30T10:00:00.000Z' } });
        const html = await renderToString(createSSRApp(UntrustedChip, { taint: run.taint }));

        expect(html).toContain('Untrusted content</span>');
        expect(html).toContain('First consumed from &lt;b&gt;web.fetch&lt;/b&gt; at 2026-10-30T10:00:00.000Z');
        expect(html).toContain('aria-label="Untrusted content: first consumed from');
        expect(html).not.toContain('<b>');
    });

    it('does not label a run without taint', async () => {
        const html = await renderToString(createSSRApp(UntrustedChip, { taint: wireRun().taint }));

        expect(html).not.toContain('Untrusted content');
    });
});
