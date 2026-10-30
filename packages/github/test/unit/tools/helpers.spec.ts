/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@chamvi/core';
import { REPO_PATTERN } from '../../../src/tools/constants.ts';
import { parseRepo, stepOf, toolError } from '../../../src/tools/helpers.ts';
import { assistant } from '../../utils/tools.ts';

describe('stepOf', () => {
    it('counts the assistant messages', () => {
        expect(stepOf({ toolCallId: 'c', messages: [] })).toBe(0);
        expect(stepOf({ toolCallId: 'c', messages: [{ role: 'user', content: 'x' }, assistant()] })).toBe(1);
        expect(stepOf({ toolCallId: 'c', messages: [assistant(), { role: 'user', content: 'x' }, assistant()] })).toBe(2);
    });

    it('stops at the assistant message that requested the call (approval path)', () => {
        const before = [{ role: 'user' as const, content: 'x' }, assistant()];

        expect(stepOf({ toolCallId: 'c-7', messages: [...before, assistant('c-7')] })).toBe(1);
        expect(stepOf({ toolCallId: 'c-7', messages: [...before, assistant('c-7'), assistant()] })).toBe(1);
        // another call id: counted as an earlier step
        expect(stepOf({ toolCallId: 'c-8', messages: [...before, assistant('c-7')] })).toBe(2);
    });
});

describe('stepOf with reused tool call ids', () => {
    const result = (toolCallId: string): ModelMessage => ({
        role: 'tool',
        content: [{
            type: 'tool-result',
            toolCallId,
            toolName: 'github_create_comment',
            output: { type: 'text', value: 'ok' },
        }],
    });
    const approval: ModelMessage = {
        role: 'tool',
        content: [{
            type: 'tool-approval-response',
            approvalId: 'a-1',
            approved: true,
        }],
    };
    const user: ModelMessage = { role: 'user', content: 'x' };

    it('does not take an earlier step that ran a call with the same id for the approval path', () => {
        expect(stepOf({ toolCallId: 'call_0', messages: [user, assistant('call_0'), result('call_0')] })).toBe(1);
        expect(stepOf({ toolCallId: 'call_0', messages: [user, assistant('call_0'), result('call_0'), assistant('call_0'), result('call_0')] })).toBe(2);
    });

    it('finds the pending call on the approval path when earlier steps reused its id', () => {
        expect(stepOf({ toolCallId: 'call_0', messages: [user, assistant('call_0'), result('call_0'), assistant('call_0'), approval] })).toBe(1);
    });
});

describe('parseRepo', () => {
    it('splits owner and name', () => {
        expect(parseRepo('octo/demo')).toEqual({ owner: 'octo', repo: 'demo' });
        expect(parseRepo('my-org/my.repo_1')).toEqual({ owner: 'my-org', repo: 'my.repo_1' });
    });

    it('refuses anything else', () => {
        for (const repo of ['', 'octo', 'a/b/c', '/demo', 'octo/', 'a b/c', 42]) {
            expect(() => parseRepo(repo)).toThrow(ValidationError);
        }
    });

    it('refuses dot segments, which URL resolution folds into another API path', () => {
        for (const repo of ['../x', '../..', './x', 'octo/..', 'octo/.', '../demo', '%2e%2e/x', 'octo/%2e%2e']) {
            expect(() => parseRepo(repo)).toThrow(ValidationError);
        }

        expect(parseRepo('octo/.github')).toEqual({ owner: 'octo', repo: '.github' });
    });

    it('agrees with the REPO_PATTERN the input schemas carry', () => {
        const pattern = new RegExp(REPO_PATTERN);

        for (const repo of ['octo/demo', 'my-org/my.repo_1', 'octo/.github']) {
            expect(pattern.test(repo)).toBe(true);
        }

        for (const repo of ['octo', 'a/b/c', 'a b/c', '../x', 'octo/..', 'octo/.', '%2e%2e/x']) {
            expect(pattern.test(repo)).toBe(false);
        }
    });
});

describe('toolError', () => {
    it('keeps status and message of a GitHub error, never the request', () => {
        const requestError = Object.assign(new Error('Not Found - https://docs.github.com/rest'), {
            name: 'HttpError',
            status: 404,
            request: { headers: { authorization: 'token ghs_1' } },
        });
        const error = toolError(requestError);

        expect(error.message).toBe('GitHub 404: Not Found - https://docs.github.com/rest');
        expect(JSON.stringify(error)).not.toContain('ghs_');
        expect('request' in error).toBe(false);
    });

    it('passes chamvi errors through', () => {
        const validation = new ValidationError('bad');

        expect(toolError(validation)).toBe(validation);
    });
});
