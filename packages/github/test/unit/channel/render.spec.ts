/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { ChannelMessage } from '@chamvi/core';
import { COMMENT_BODY_MAX_LENGTH } from '@chamvi/github';
import {
    fenceFor,
    markerKey,
    parseAddress,
    renderComment,
} from '../../../src/channel/helpers.ts';

const approval: ChannelMessage = {
    kind: 'approval',
    key: 'r1:a1',
    agent: 'release',
    runId: 'r1',
    title: 'Approval required: deploy',
    body: 'Agent "release" wants to call "deploy" with:\n{\n  "env": "prod"\n}',
    approvalId: 'a1',
    expiresAt: new Date('2026-10-21T10:00:00Z'),
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('renderComment', () => {
    it('renders an approval', () => {
        const comment = renderComment(approval, {
            mentions: ['owner'],
            approvalUrl: (ref) => `https://app.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}&agent=${ref.agent}`,
            marker: '<!-- chamvi:effect=r1:a1 -->',
        });
        expect(comment).toBe([
            '@owner',
            '',
            '### Approval required: deploy',
            '',
            '```',
            approval.body,
            '```',
            '',
            'Waiting for approval until 2026-10-21T10:00:00.000Z. Approve or deny: https://app.example/ui/approvals?run=r1&approval=a1&agent=release',
            'Run `r1` of agent `release`.',
            '',
            '<!-- chamvi:effect=r1:a1 -->',
        ].join('\n'));
    });

    it('renders a choice approval', () => {
        const choice: ChannelMessage = {
            ...approval,
            options: [{
                id: 'a', 
                label: '@owner see #1', 
                detail: 'never shown', 
            }, { id: 'b', label: 'B' }],
        };
        const input = {
            mentions: ['owner'],
            approvalUrl: (ref: { runId: string; approvalId: string }) => `https://app.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}`,
            marker: '<!-- chamvi:effect=r1:a1 -->',
        };
        const comment = renderComment(choice, input);
        expect(comment).toBe([
            '@owner',
            '',
            '### Approval required: deploy',
            '',
            '```',
            approval.body,
            '```',
            '',
            'Options (choose one):',
            '```',
            '- a: @owner see #1',
            '- b: B',
            '```',
            '',
            'Waiting for approval until 2026-10-21T10:00:00.000Z. Choose and approve or deny: https://app.example/ui/approvals?run=r1&approval=a1',
            'Run `r1` of agent `release`.',
            '',
            '<!-- chamvi:effect=r1:a1 -->',
        ].join('\n'));
        expect(comment).not.toContain('never shown');
        expect(renderComment({ ...choice, multiple: true }, input)).toContain('Options (choose one or more):');
        expect(renderComment(choice, { mentions: [], marker: '<!-- m -->' }))
            .toContain('Waiting for approval until 2026-10-21T10:00:00.000Z. Choose in the chamvi UI or through POST /runs/:id/approve with selected.');
    });

    it('stays under GitHub\'s limit for maximal options', () => {
        const options = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`.padEnd(128, 'x'), label: 'l'.repeat(200) }));
        const comment = renderComment({
            ...approval, 
            body: 'b'.repeat(100_000), 
            options, 
        }, {
            mentions: ['owner'],
            approvalUrl: () => 'https://app.example/ui/approvals',
            marker: '<!-- chamvi:effect=r1:a1 -->',
        });
        expect(comment.length).toBeLessThanOrEqual(65_536);
        expect(comment).toContain(`- ${options[19]!.id}: ${options[19]!.label}`);
    });

    it('puts a title with line breaks on one heading line', () => {
        const comment = renderComment({ ...approval, title: '  Approval\nrequired:\t\tdeploy ' }, { mentions: [], marker: '<!-- m -->' });
        expect(comment.split('\n')[0]).toBe('### Approval required: deploy');
    });

    it('keeps mentions and references in the title from notifying or linking', () => {
        const comment = renderComment({ ...approval, title: 'Reply to @org/security-team about #1, octo/demo#2 and GH-3' }, { mentions: [], marker: '<!-- m -->' });
        const heading = comment.split('\n')[0]!;
        expect(heading).toBe('### Reply to @\u200Dorg/security-team about #\u200D1, octo/demo#\u200D2 and GH\u200D-3');
        expect(heading).not.toMatch(/@[A-Za-z0-9]/);
        expect(heading).not.toMatch(/#\d/);
        expect(heading).not.toMatch(/GH-\d/);
    });

    it('without a link, names the UI and the approve route', () => {
        const comment = renderComment(approval, { mentions: [], marker: '<!-- chamvi:effect=r1:a1 -->' });
        expect(comment).toContain('Answer it in the chamvi UI or through POST /runs/:id/approve.');
        expect(comment.startsWith('### ')).toBe(true);
        // the comment holds no token, so it names no path that needs one
        expect(comment).not.toMatch(/MCP|resume_run|REST API/);
    });

    it('renders the hint instead of a link for an approval without an approvalId', () => {
        const withoutId: ChannelMessage = { ...approval };
        delete withoutId.approvalId;
        const urls: unknown[] = [];
        const comment = renderComment(withoutId, {
            mentions: [],
            approvalUrl: (ref) => {
                urls.push(ref);
                return 'https://app.example/ui/approvals';
            },
            marker: '<!-- m -->',
        });
        expect(urls).toEqual([]);
        expect(comment).not.toContain('Approve or deny');
        expect(comment).toContain('Answer it in the chamvi UI or through POST /runs/:id/approve.');
    });

    it('renders a message without the approval line', () => {
        const comment = renderComment({
            kind: 'message',
            key: 'k',
            agent: 'release',
            runId: 'r1',
            title: 'Stuck',
            body: 'No progress.',
        }, { mentions: ['a', 'b'], marker: '<!-- m -->' });
        expect(comment.split('\n')[0]).toBe('@a @b');
        expect(comment).not.toContain('Waiting for approval');
        expect(comment).toContain('Run `r1` of agent `release`.\n\n<!-- m -->');
    });

    it('fences the body', () => {
        const body = 'see\n```\n@mallory\n```\ncloses #12 for @octo/core';
        const comment = renderComment({ ...approval, body }, { mentions: ['owner'], marker: '<!-- chamvi:effect=r1:a1 -->' });
        const lines = comment.split('\n');
        const fences = lines.map((line, i) => [line, i] as const).filter(([line]) => line === '````');
        expect(fences).toHaveLength(2);
        const [[, open], [, close]] = fences as [[string, number], [string, number]];
        expect(lines.slice(open + 1, close).join('\n')).toBe(body);
        // outside the fence only the configured mention notifies
        const outside = [...lines.slice(0, open), ...lines.slice(close + 1)];
        expect(outside.filter((line) => line.includes('@'))).toEqual(['@owner']);
        expect(outside.join('\n')).not.toContain('#12');
        expect(lines.indexOf('<!-- chamvi:effect=r1:a1 -->')).toBeGreaterThan(close);
    });

    it('cuts a huge body', () => {
        const comment = renderComment({ ...approval, body: 'x'.repeat(1024 * 1024) }, { mentions: ['owner'], marker: '<!-- m -->' });
        expect(comment.length).toBeLessThan(65_536);
        expect(comment).toContain(`(cut, ${1024 * 1024 - COMMENT_BODY_MAX_LENGTH} more characters)`);

        const pair = renderComment({ ...approval, body: `${'x'.repeat(COMMENT_BODY_MAX_LENGTH - 1)}😀yyy` }, { mentions: [], marker: '<!-- m -->' });
        expect(pair).not.toMatch(LONE_SURROGATE);
    });

    it('stays bounded for a body of backticks', () => {
        const comment = renderComment({ ...approval, body: '`'.repeat(1024 * 1024) }, { mentions: [], marker: '<!-- m -->' });
        expect(comment.length).toBeLessThan(65_536);
    });
    it('renders a message without a title and without a body', () => {
        const comment = renderComment({
            kind: 'message',
            key: 'k',
            agent: 'release',
            runId: 'r1',
            body: 'Done.',
        }, { mentions: [], marker: '<!-- m -->' });
        expect(comment).toBe(['```', 'Done.', '```', '', 'Run `r1` of agent `release`.', '', '<!-- m -->'].join('\n'));
        const empty = renderComment({ ...approval, body: '' }, { mentions: [], marker: '<!-- m -->' });
        expect(empty).not.toContain('```');
        expect(empty.split('\n')[0]).toBe('### Approval required: deploy');
    });
});

describe('parseAddress', () => {
    it('reads owner, repo and number', () => {
        expect(parseAddress('octo/demo#7')).toEqual({
            owner: 'octo', 
            repo: 'demo', 
            number: 7, 
        });
        expect(parseAddress('my.org/re-po_1#123')).toEqual({
            owner: 'my.org', 
            repo: 're-po_1', 
            number: 123, 
        });
    });

    it.each(['octo/demo', 'octo/demo#', 'octo/demo#0', 'octo/demo#07', 'octo/demo#x', '../x#1', 'octo#1', 42, undefined])('refuses %j', (address) => {
        expect(parseAddress(address)).toBeUndefined();
    });
});

describe('fenceFor', () => {
    it('is one backtick longer than the longest run, at least three', () => {
        expect(fenceFor('plain')).toBe('```');
        expect(fenceFor('a `b` c')).toBe('```');
        expect(fenceFor('```')).toBe('````');
        expect(fenceFor('x `````` y ``')).toBe('```````');
    });
});

describe('markerKey', () => {
    it('keeps a safe key', () => {
        expect(markerKey('r1:a1')).toBe('r1:a1');
        expect(markerKey('6f0c-1:b2.c_3')).toBe('6f0c-1:b2.c_3');
    });

    it('hashes an unsafe key into the marker', () => {
        const key = markerKey('a-->b');
        expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(markerKey('a-->b')).toBe(key);
        expect(markerKey('a--b')).toMatch(/^sha256:/);
        expect(markerKey('a b')).toMatch(/^sha256:/);
        expect(markerKey('k'.repeat(256))).toMatch(/^sha256:/);
        expect(markerKey('k'.repeat(255))).toBe('k'.repeat(255));
    });
});
