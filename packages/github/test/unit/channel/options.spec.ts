/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, MemoryLockRepository } from '@chamvi/core';
import { githubChannel } from '@chamvi/github';
import type { GithubChannelOptions } from '@chamvi/github';
import { resolveOptions } from '../../../src/channel/helpers.ts';
import { createCommentFixture } from '../../utils/github.ts';

const { gh } = createCommentFixture();

describe('githubChannel options', () => {
    it('defaults its name to github', () => {
        expect(resolveOptions({ app: gh }).name).toBe('github');
        expect(resolveOptions({ app: gh, name: 'issues' }).name).toBe('issues');
        expect(githubChannel({ app: gh }).name).toBe('github');
        expect(githubChannel({ app: gh, name: 'github-ent' }).name).toBe('github-ent');
    });

    it('has in and out, and no start', () => {
        const channel = githubChannel({ app: gh });

        expect(channel.in).toBeTypeOf('function');
        expect(channel.out).toBeTypeOf('function');
        expect(channel).not.toHaveProperty('start');
    });

    it('takes one mention or several', () => {
        expect(resolveOptions({ app: gh, mention: 'octocat' }).mentions).toEqual(['octocat']);
        expect(resolveOptions({ app: gh, mention: ['octocat', 'Mona-Lisa'] }).mentions).toEqual(['octocat', 'Mona-Lisa']);
        expect(resolveOptions({ app: gh }).mentions).toEqual([]);
    });

    it('defaults to independent local memory locks', () => {
        const defaults = resolveOptions({ app: gh });

        expect(defaults.locks).toBeInstanceOf(MemoryLockRepository);
        expect(resolveOptions({ app: gh }).locks).not.toBe(defaults.locks);
    });

    it('uses the supplied lock repository for persistent comments', () => {
        const locks = new MemoryLockRepository();

        expect(resolveOptions({
            app: gh,
            locks,
        }).locks).toBe(locks);
    });

    it.each<[string, Partial<GithubChannelOptions>]>([
        ['no app', { app: undefined as unknown as GithubChannelOptions['app'] }],
        ['an app without octokit', { app: {} as GithubChannelOptions['app'] }],
        ['an empty name', { name: '' }],
        ['an upper-case name', { name: 'GitHub' }],
        ['a mention starting with a dash', { mention: '-bad' }],
        ['a mention with a space', { mention: 'a b' }],
        ['a mention of 40 characters', { mention: 'a'.repeat(40) }],
        ['a mention with a double dash', { mention: ['ok', 'a--b'] }],
        ['a mention with an @', { mention: '@octocat' }],
        ['a zero timeoutMs', { timeoutMs: 0 }],
        ['a fractional timeoutMs', { timeoutMs: 2.5 }],
        ['a zero bodyLimit', { bodyLimit: 0 }],
        ['a missing lock acquire', { locks: { release: async () => {} } as unknown as GithubChannelOptions['locks'] }],
        ['a missing lock release', { locks: { acquire: async () => true } as unknown as GithubChannelOptions['locks'] }],
        ['a non-function onError', { onError: 'log' as unknown as GithubChannelOptions['onError'] }],
        ['a non-function approvalUrl', { approvalUrl: 'https://app.example/ui/approvals' as unknown as GithubChannelOptions['approvalUrl'] }],
    ])('rejects %s', (_label, patch) => {
        expect(() => githubChannel({ app: gh, ...patch })).toThrow(InvalidAgentDefinitionError);
    });
});
