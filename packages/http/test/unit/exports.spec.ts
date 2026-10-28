/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import * as http from '@chamvi/http';

describe('public api', () => {
    it('exports the channel HTTP rate-limit policy type', () => {
        expectTypeOf<http.ChannelRateLimitOptions>().toEqualTypeOf<{ max: number; windowMs?: number }>();
        expectTypeOf<http.HttpAppOptions['channelRateLimits']>()
            .toEqualTypeOf<Record<string, false | http.ChannelRateLimitOptions> | undefined>();
    });

    it.each([
        'agentPermission',
        'assertMcpRunTool',
        'authup',
        'createHttpApp',
        'createShutdown',
        'httpChannel',
        'mcpChannel',
        'oidc',
        'staticTokens',
        'webhookChannel',
    ])('exports %s', (name) => {
        expect(http).toHaveProperty(name);
        expect(http[name as keyof typeof http]).toBeTypeOf('function');
    });

    it('exports the subscription builders and channel names', () => {
        expect(http.http.on).toBeTypeOf('function');
        expect(http.webhook.on).toBeTypeOf('function');
        expect(http.HTTP_CHANNEL_NAME).toBe('http');
        expect(http.MCP_CHANNEL_NAME).toBe('mcp');
        expect(http.WEBHOOK_CHANNEL_NAME).toBe('webhook');
    });

    it('leaves permission matching to core', () => {
        // core's hasPermission(principal.permissions, wanted) is the one matcher
        expect(http).not.toHaveProperty('hasPermission');
    });

    it('exports the shutdown defaults', () => {
        expect(http.DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS).toBe(30_000);
        expect(http.DEFAULT_SHUTDOWN_CLOSE_TIMEOUT_MS).toBe(5_000);
    });

    it('exports Permission', () => {
        expect(http.Permission).toEqual({
            ALL: '*',
            RUN_READ: 'run:read',
            RUN_CANCEL: 'run:cancel',
            STATE_READ: 'state:read',
            STATE_WRITE: 'state:write',
        });
    });

    it('exports the MeView and ApproveBody types', () => {
        expectTypeOf<http.MeView>().toEqualTypeOf<{
            id: string;
            kind: string;
            name?: string;
            permissions: string[];
        }>();
        expectTypeOf<http.ApproveBody>().toEqualTypeOf<{
            approvalId: string;
            approved: boolean;
            reason?: string;
            selected?: string[];
        }>();
    });
});
