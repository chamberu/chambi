/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from 'ai';
import type { ToolContext, ToolTrust } from '@chamvi/core';
import { createGithubFixture } from '../../utils/app.ts';
import { toolContext } from '../../utils/tools.ts';

function setup() {
    const { gh, fake } = createGithubFixture();
    const { guardWhenTainted } = (gh.writeTools().github_add_labels as Tool & { trust: ToolTrust }).trust;

    if (typeof guardWhenTainted !== 'function') {
        throw new TypeError('expected a label trust classifier');
    }

    const classify = (labels: string[], ctx: ToolContext, repo = 'octo/demo') => guardWhenTainted({
        repo,
        number: 5,
        labels,
    }, ctx);
    const lookups = () => fake.requests.filter((request) => request.path.endsWith('/labels'));

    return {
        fake,
        classify,
        lookups,
    };
}

describe('existing-label trust exemption', () => {
    it('exempts only exact names in the repository vocabulary', async () => {
        const { fake, classify } = setup();
        const ctx = toolContext();

        fake.labels.set('octo/demo', [{ name: 'bug' }, { name: 'triage' }]);

        expect(await classify(['bug', 'triage'], ctx)).toBe(false);
        expect(await classify(['bug', 'new-model-chosen-label'], ctx)).toBe(true);
        expect(await classify(['BUG'], ctx)).toBe(true);
    });

    it('shares one lookup across concurrent calls and canonical repository spellings', async () => {
        const {
            fake,
            classify,
            lookups,
        } = setup();
        const ctx = toolContext();

        fake.labels.set('octo/demo', [{ name: 'bug' }]);

        expect(await Promise.all([
            classify(['bug'], ctx, 'Octo/Demo'),
            classify(['bug'], ctx, 'octo/demo'),
            classify(['unknown'], ctx, 'OCTO/DEMO'),
        ])).toEqual([false, false, true]);
        expect(lookups()).toHaveLength(1);

        fake.labels.set('octo/demo', [{ name: 'new' }]);

        expect(await classify(['new'], ctx)).toBe(true);
        expect(await classify(['bug'], ctx)).toBe(false);
        expect(lookups()).toHaveLength(1);
    });

    it('loads every page before testing membership', async () => {
        const {
            fake,
            classify,
            lookups,
        } = setup();

        fake.labels.set('octo/demo', Array.from({ length: 150 }, (_, index) => ({ name: `label-${index}` })));

        expect(await classify(['label-149'], toolContext())).toBe(false);
        expect(lookups()).toHaveLength(2);
        expect(lookups().map((request) => request.query.per_page)).toEqual(['100', '100']);
    });

    it('keeps repositories and executions separate, including resumed executions of the same run', async () => {
        const {
            fake,
            classify,
            lookups,
        } = setup();
        const ctx = toolContext({ runId: 'run-1' });

        fake.labels.set('octo/demo', [{ name: 'bug' }]);
        fake.labels.set('octo/other', [{ name: 'feature' }]);

        expect(await classify(['bug'], ctx)).toBe(false);
        expect(await classify(['bug'], ctx, 'octo/other')).toBe(true);
        expect(await classify(['feature'], ctx, 'octo/other')).toBe(false);

        fake.labels.set('octo/demo', [{ name: 'new' }]);

        expect(await classify(['new'], toolContext({ runId: 'run-2' }))).toBe(false);
        expect(await classify(['new'], toolContext({ runId: 'run-1' }))).toBe(false);
        expect(await classify(['new'], ctx)).toBe(true);
        expect(lookups()).toHaveLength(4);
    });

    it('fails closed and caches a failed lookup until the next execution', async () => {
        const {
            fake,
            classify,
            lookups,
        } = setup();
        const ctx = toolContext();

        fake.labels.set('octo/demo', [{ name: 'bug' }]);
        fake.failNext('GET', '/repos/octo/demo/labels', 403);

        expect(await classify(['bug'], ctx)).toBe(true);
        expect(await classify(['bug'], ctx)).toBe(true);
        expect(lookups()).toHaveLength(1);
        expect(await classify(['bug'], toolContext())).toBe(false);
        expect(lookups()).toHaveLength(2);
    });
});
