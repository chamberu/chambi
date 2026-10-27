/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { RunWire } from '../../../../app/api/types.ts';
import ApprovalCallout from '../../../../app/components/approval-callout/ApprovalCallout.vue';
import { RouteName } from '../../../../app/router/constants.ts';
import { wireRun } from '../../../utils/runs.ts';

async function render(run: RunWire): Promise<string> {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { render: () => null } },
            {
                path: '/agents/:name',
                name: RouteName.AGENT,
                component: { render: () => null },
            },
            {
                path: '/runs/:id',
                name: RouteName.RUN,
                component: { render: () => null },
            },
        ],
    });
    await router.push('/');
    await router.isReady();
    const app = createSSRApp(ApprovalCallout, { run, canAnswer: false });
    app.use(router);
    // the vuecs components are global in the app; here they render as nothing
    for (const name of ['VCCountdown', 'VCTimeago', 'VCButton', 'VCFormTextarea']) {
        app.component(name, { render: () => null });
    }
    return renderToString(app);
}

const waiting = {
    kind: 'approval' as const,
    approvalId: 'call-1:0',
    toolName: 'deploy',
    toolCallId: 'call-1',
    title: 'Deploy <prod>?',
    expiresAt: '2026-10-22T10:00:00.000Z',
};

describe('ApprovalCallout', () => {
    it('the approval callout shows title and body', async () => {
        const html = await render(wireRun({
            status: 'waiting',
            waiting: { ...waiting, body: 'Rolls out v2.3.1 to every region.\nTakes ten minutes.' },
        }));
        expect(html).toContain('data-testid="approval-title"');
        expect(html).toContain('Deploy &lt;prod&gt;?');
        expect(html).toContain('data-testid="approval-body"');
        expect(html).toContain('Rolls out v2.3.1 to every region.\nTakes ten minutes.');
        expect(html).toContain('data-testid="approval-tool"');
        expect(html).not.toContain('Tool input');
    });

    it('leaves the body out when the request has none', async () => {
        const html = await render(wireRun({ status: 'waiting', waiting }));
        expect(html).toContain('Deploy &lt;prod&gt;?');
        expect(html).not.toContain('data-testid="approval-body"');
    });

    const options = [
        {
            id: 'a', 
            label: 'Alpha', 
            detail: '@@ -1 +1 @@\n-old\n+new <script>x</script>', 
        },
        { id: 'b', label: 'Beta' },
    ];

    it('renders radios for a single choice', async () => {
        const html = await render(wireRun({ status: 'waiting', waiting: { ...waiting, options } }));
        expect(html).toContain('data-testid="approval-options"');
        expect(html).toContain('Choose one');
        const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
        expect(radios).toHaveLength(2);
        for (const radio of radios) expect(radio).toContain('name="option-r1"');
        expect(html.match(/<details/g)).toHaveLength(1);
        expect(html).toContain('<pre class="option-detail"');
        expect(html).toContain('<span class="diff-add">+new &lt;script&gt;x&lt;/script&gt;</span>');
        // one line per span, the SSR fragment markers aside
        expect(html.replace(/<!--[[\]]-->/g, '')).toContain('<span class="diff-del">-old</span>\n<span class="diff-add">');
        expect(html).not.toContain('<script>x');
        expect(html).toContain('Alpha');
        expect(html).toContain('Beta');
    });

    it('renders checkboxes for a multiple choice', async () => {
        const html = await render(wireRun({
            status: 'waiting',
            waiting: {
                ...waiting, 
                options, 
                multiple: true, 
            }, 
        }));
        expect(html.match(/<input[^>]*type="checkbox"[^>]*>/g)).toHaveLength(2);
        expect(html).not.toContain('type="radio"');
        expect(html).toContain('Choose one or more');
    });

    it('renders a plain approval without options', async () => {
        const html = await render(wireRun({ status: 'waiting', waiting }));
        expect(html).not.toContain('type="radio"');
        expect(html).not.toContain('type="checkbox"');
        expect(html).not.toContain('data-testid="approval-options"');
    });
});
