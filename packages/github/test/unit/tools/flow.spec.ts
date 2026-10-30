/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ToolDeniedError, approve, defineAgent } from '@chamvi/core';
import type { AgentHooks } from '@chamvi/core';
import type { IGithubApp } from '@chamvi/github';
import { github } from '@chamvi/github';
import { createGithubTestApp, deliver } from '../../utils/app.ts';
import { mockModel } from '../../utils/model.ts';
import type { MockResponse } from '../../utils/model.ts';

const ISSUES_OPENED = readFileSync(new URL('../../fixtures/deliveries/issues-opened.json', import.meta.url), 'utf8');

/** Asks the owner (inbox and API) before `tool` runs with an input `gated` accepts. */
function gate(tool: string, gated: (input: unknown) => boolean = () => true): AgentHooks {
    return {
        async beforeToolExecution(call, ctx) {
            if (call.toolName !== tool || !gated(call.input)) return undefined;
            const decision = await approve(ctx, { title: `Run ${tool}?` });
            if (!decision.approved) throw new ToolDeniedError(`${tool} was denied.`);
            return undefined;
        },
    };
}

function triage(script: MockResponse[]) {
    return (gh: IGithubApp) => [defineAgent({
        name: 'triage',
        model: mockModel(script),
        instructions: 'Triage new issues.',
        channels: [github.on('issues.opened')],
        tools: () => ({ ...gh.readTools(), ...gh.writeTools() }),
        hooks: gate('github_close_issue'),
    })];
}

function setup(script: MockResponse[]) {
    const setup = createGithubTestApp({ agents: triage(script) });
    const { issue } = (JSON.parse(ISSUES_OPENED) as { issue: Record<string, unknown> });
    setup.fake.issues.set('octo/demo#5', { ...issue });
    return setup;
}

const ISSUE = { repo: 'octo/demo', number: 5 };

describe('webhook to comment', () => {
    it('labels and comments once, also after a redelivery', async () => {
        const {
            app,
            engine,
            store,
            fake,
        } = setup([
            {
                parts: [{
                    type: 'tool-call', 
                    toolName: 'github_get_issue', 
                    input: ISSUE, 
                }], 
            },
            {
                parts: [
                    {
                        type: 'tool-call', 
                        toolName: 'github_add_labels', 
                        input: { ...ISSUE, labels: ['bug'] }, 
                    },
                    {
                        type: 'tool-call', 
                        toolName: 'github_create_comment', 
                        input: { ...ISSUE, body: 'Thanks, labelled as a bug.' }, 
                    },
                ],
            },
            { parts: [{ type: 'text', text: 'Triaged.' }] },
        ]);

        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(response.status).toBe(202);
        const { runs } = await response.json() as { runs: Array<{ runId: string }> };
        await engine.start();
        await engine.idle();

        const run = await store.runs.findOne(runs[0]!.runId);
        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('Triaged.');
        const comments = fake.comments.get('octo/demo#5') ?? [];
        expect(comments).toHaveLength(1);
        expect(comments[0]?.body).toContain(`<!-- chamvi:effect=${run!.id}:github_create_comment:octo/demo#5:1 -->`);
        expect(fake.issues.get('octo/demo#5')?.labels).toEqual([{ name: 'bug' }]);

        const redelivered = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        expect(await redelivered.json()).toMatchObject({ runs: [{ deduplicated: true }] });
        await engine.idle();
        expect(fake.comments.get('octo/demo#5')).toHaveLength(1);
        await engine.drain();
    });

    it('pauses before closing an issue', async () => {
        const {
            app,
            engine,
            store,
            fake,
        } = setup([
            {
                parts: [{
                    type: 'tool-call', 
                    toolName: 'github_close_issue', 
                    input: { ...ISSUE, reason: 'not_planned' }, 
                }], 
            },
            { parts: [{ type: 'text', text: 'Closed.' }] },
        ]);
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        const { runs } = await response.json() as { runs: Array<{ runId: string }> };
        await engine.start();
        await engine.idle();

        const run = await store.runs.findOne(runs[0]!.runId);
        expect(run?.status).toBe('waiting');
        expect(run?.waiting?.toolName).toBe('github_close_issue');
        expect(fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
        await engine.drain();
    });

    it('keeps one comment per step across an approval resume', async () => {
        const comment = (body: string) => ({
            parts: [{
                type: 'tool-call' as const,
                toolName: 'github_create_comment',
                input: { ...ISSUE, body },
            }],
        });
        const setup = createGithubTestApp({
            agents: (gh) => [defineAgent({
                name: 'triage',
                model: mockModel([comment('zero'), comment('first'), comment('second'), { parts: [{ type: 'text', text: 'Done.' }] }]),
                instructions: 'Triage new issues.',
                channels: [github.on('issues.opened')],
                tools: () => gh.writeTools(),
                hooks: gate('github_create_comment', (input) => (input as { body?: string }).body === 'first'),
            })],
        });
        const {
            app,
            engine,
            store,
            fake,
            errors,
        } = setup;
        const { issue } = (JSON.parse(ISSUES_OPENED) as { issue: Record<string, unknown> });
        fake.issues.set('octo/demo#5', { ...issue });
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        const { runs } = await response.json() as { runs: Array<{ runId: string }> };
        const { runId } = runs[0]!;
        await engine.start();
        await engine.idle();

        const paused = await store.runs.findOne(runId);
        expect(paused?.status).toBe('waiting');
        expect(paused?.waiting?.toolName).toBe('github_create_comment');
        expect(fake.comments.get('octo/demo#5')).toHaveLength(1);

        await engine.approve(runId, { approvalId: paused!.waiting!.approvalId, approved: true });
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect(errors).toEqual([]);
        const bodies = (fake.comments.get('octo/demo#5') ?? []).map((c) => String(c.body));
        expect(bodies).toHaveLength(3);
        for (const [step, body] of bodies.entries()) {
            expect(body).toContain(`<!-- chamvi:effect=${runId}:github_create_comment:octo/demo#5:${step} -->`);
        }
        await engine.drain();
    });

    it('keeps one comment per step when the provider reuses tool call ids', async () => {
        const comment = (body: string) => ({
            parts: [{
                type: 'tool-call' as const,
                toolName: 'github_create_comment',
                toolCallId: 'call_0',
                input: { ...ISSUE, body },
            }],
        });
        const {
            app,
            engine,
            store,
            fake,
        } = setup([comment('zero'), comment('one'), { parts: [{ type: 'text', text: 'Done.' }] }]);
        const response = await deliver(app, {
            event: 'issues',
            delivery: 'd-1',
            body: ISSUES_OPENED,
        });
        const { runs } = await response.json() as { runs: Array<{ runId: string }> };
        const { runId } = runs[0]!;
        await engine.start();
        await engine.idle();

        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        const bodies = (fake.comments.get('octo/demo#5') ?? []).map((c) => String(c.body));
        expect(bodies).toHaveLength(2);
        expect(bodies[1]).toContain(`${runId}:github_create_comment:octo/demo#5:1 -->`);
        await engine.drain();
    });
});
