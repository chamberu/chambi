/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { App } from 'routup';

export type ConnectMcpOptions = {
    /** Applied to `tools/call` requests only, so the handshake is never aborted. */
    signal?: AbortSignal;
};

/** An MCP client talking to `app.fetch` in-process, as the bearer `token`. */
export async function connectMcp(app: App, token: string | undefined, options: ConnectMcpOptions = {}): Promise<Client> {
    const client = new Client({ name: 'test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://test/mcp'), {
        fetch: (url, init) => {
            const isCall = typeof init?.body === 'string' && init.body.includes('"tools/call"');

            return app.fetch(new Request(url, {
                ...init,
                ...(isCall && options.signal ? { signal: options.signal } : {}),
            }));
        },
        ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {}),
    });

    await client.connect(transport);

    return client;
}

export type ToolResult = {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
};

/** Calls a tool and returns its result in a typed shape. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    return await client.callTool({ name, arguments: args }) as ToolResult;
}

/** The text of a tool result's first content block. */
export function textOf(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}
