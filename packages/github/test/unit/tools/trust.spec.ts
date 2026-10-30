/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { Tool } from 'ai';
import type { ToolTrust } from '@chamvi/core';
import { githubChannel } from '@chamvi/github';
import { createGithubFixture } from '../../utils/app.ts';
import { toolContext } from '../../utils/tools.ts';

function setup() {
    const { gh } = createGithubFixture();
    const channel = githubChannel({ app: gh, name: 'project-github' });
    const tools = gh.writeTools();
    const trust = (name: string) => (tools[name] as Tool & { trust: ToolTrust }).trust;

    return {
        gh,
        channel,
        trust,
    };
}

describe('GitHub trust classification', () => {
    it('classifies deliveries and every read tool as untrusted', () => {
        const { gh, channel } = setup();

        expect(channel.untrusted).toBe(true);

        for (const tool of Object.values(gh.readTools())) {
            expect((tool as Tool & { trust: ToolTrust }).trust).toEqual({ taint: true });
        }
    });

    it('gates writes conservatively, but not closing an issue', () => {
        const { trust } = setup();

        for (const name of ['github_create_issue', 'github_create_pull_request', 'github_merge_pull_request']) {
            expect(trust(name)).toEqual({ guardWhenTainted: true });
        }

        expect(trust('github_add_labels')).toEqual({ taint: true, guardWhenTainted: expect.any(Function) });
        expect(trust('github_close_issue')).toEqual({ guardWhenTainted: false });
    });

    it('exempts only a comment on the same canonical issue of this app’s channel', async () => {
        const { trust } = setup();
        const { guardWhenTainted } = trust('github_create_comment');

        expect(guardWhenTainted).toBeTypeOf('function');

        if (typeof guardWhenTainted !== 'function') {
            throw new TypeError('expected a comment trust classifier');
        }

        const ctx = toolContext({ channel: 'project-github' });

        ctx.run.trigger.address = 'Octo/Demo#5';

        expect(await guardWhenTainted({
            repo: 'octo/demo',
            number: 5,
            body: 'reply',
        }, ctx)).toBe(false);
        expect(await guardWhenTainted({
            repo: 'octo/demo',
            number: 6,
            body: 'elsewhere',
        }, ctx)).toBe(true);
        expect(await guardWhenTainted({
            repo: 'other/demo',
            number: 5,
            body: 'elsewhere',
        }, ctx)).toBe(true);

        ctx.run.trigger.channel = 'webhook';
        expect(await guardWhenTainted({
            repo: 'octo/demo',
            number: 5,
            body: 'spoofed address',
        }, ctx)).toBe(true);
        ctx.run.trigger.channel = 'project-github';
        delete ctx.run.trigger.address;
        expect(await guardWhenTainted({
            repo: 'octo/demo',
            number: 5,
            body: 'no source',
        }, ctx)).toBe(true);
        ctx.run.trigger.address = 'https://github.com/octo/demo/issues/5';
        expect(await guardWhenTainted({
            repo: 'octo/demo',
            number: 5,
            body: 'not canonical',
        }, ctx)).toBe(true);
    });
});
