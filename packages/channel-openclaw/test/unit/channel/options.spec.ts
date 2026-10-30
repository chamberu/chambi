/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { openclawChannel } from '@chamvi/channel-openclaw';
import type { OpenclawChannelOptions } from '@chamvi/channel-openclaw';
import { hookUrl } from '../../../src/channel/helpers.ts';

const valid: OpenclawChannelOptions = {
    baseUrl: 'http://openclaw:18789',
    hooksToken: 'hooks-token-0123456789',
    deliver: { channel: 'telegram', to: '12345' },
};

describe('openclawChannel options', () => {
    it('defaults its name to openclaw', () => {
        expect(openclawChannel(valid).name).toBe('openclaw');
        expect(openclawChannel({ ...valid, name: 'chat' }).name).toBe('chat');
    });

    it.each<[string, Partial<OpenclawChannelOptions>]>([
        ['an empty hooksToken', { hooksToken: '' }],
        ['a relative baseUrl', { baseUrl: 'openclaw:18789/x' }],
        ['a non-URL baseUrl', { baseUrl: 'not a url' }],
        ['a ftp baseUrl', { baseUrl: 'ftp://openclaw' }],
        ['a baseUrl with credentials', { baseUrl: 'http://user:pass@openclaw:18789' }],
        ['a baseUrl with a query', { baseUrl: 'http://openclaw:18789/?a=1' }],
        ['a baseUrl with a hash', { baseUrl: 'http://openclaw:18789/#x' }],
        ['a hooksPath without a leading slash', { hooksPath: 'hooks' }],
        ['a hooksPath of /', { hooksPath: '/' }],
        ['a hooksPath of //', { hooksPath: '//' }],
        ['a hooksToken with a line break', { hooksToken: 'hooks-token\n0123456789' }],
        ['a hooksToken with a NUL', { hooksToken: 'hooks-token\u00000123456789' }],
        ['a hooksToken with a character above U+00FF', { hooksToken: 'hooks-token-\u20AC0123456789' }],
        ['a hooksToken with surrounding whitespace', { hooksToken: ' hooks-token-0123456789 ' }],
        ['an empty channel', { deliver: { channel: '', to: '12345' } }],
        ['the channel last', { deliver: { channel: 'last', to: '12345' } }],
        ['an empty to', { deliver: { channel: 'telegram', to: '' } }],
        ['an empty accountId', {
            deliver: {
                channel: 'telegram',
                to: '12345',
                accountId: '',
            },
        }],
        ['no deliver', { deliver: undefined as unknown as OpenclawChannelOptions['deliver'] }],
        ['an empty agentId', { agentId: '' }],
        ['an empty name', { name: '' }],
        ['a zero timeoutMs', { timeoutMs: 0 }],
        ['a fractional timeoutMs', { timeoutMs: 1.5 }],
        ['a non-function approvalUrl', { approvalUrl: 'https://app.example/ui/approvals' as unknown as OpenclawChannelOptions['approvalUrl'] }],
    ])('rejects %s', (_label, patch) => {
        expect(() => openclawChannel({ ...valid, ...patch })).toThrow(InvalidAgentDefinitionError);
    });

    it('is out only', () => {
        const channel = openclawChannel(valid);

        expect(channel.out).toBeTypeOf('function');
        expect(channel.in).toBeUndefined();
        expect(channel.start).toBeUndefined();
        expect(channel.stop).toBeUndefined();
    });

    it('names the factory in its errors', () => {
        expect(() => openclawChannel({ ...valid, hooksToken: '' })).toThrow(/^openclawChannel: hooksToken /);
    });

    it('builds the hook url', () => {
        expect(hookUrl('http://openclaw:18789/', '/hooks')).toBe('http://openclaw:18789/hooks/agent');
        expect(hookUrl('http://openclaw:18789', '/hooks')).toBe('http://openclaw:18789/hooks/agent');
        expect(hookUrl('https://x.dev/oc', '/hooks')).toBe('https://x.dev/oc/hooks/agent');
        expect(hookUrl('https://x.dev/oc/', '/custom/hooks')).toBe('https://x.dev/oc/custom/hooks/agent');
    });
});
