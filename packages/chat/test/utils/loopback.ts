/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { initAuthCreds } from 'baileys';
import type { AuthenticationState, SocketConfig } from 'baileys';

type BaileysLogger = SocketConfig['logger'];

export type LoopbackTransport = {
    /** the ws URL a Baileys socket connects to (socketOptions.waWebSocketUrl) */
    readonly url: string;
    /** every connection attempt that reached the server */
    readonly attempts: number;
    close(): Promise<void>;
};

/**
 * A loopback TCP server that accepts and drops every connection, so a Baileys
 * socket sees a transport close without any WhatsApp server or network.
 * Only the connection attempts are observable: no WhatsApp handshake ever runs.
 */
export async function startLoopbackTransport(): Promise<LoopbackTransport> {
    let attempts = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
        attempts += 1;
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.destroy();
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
        throw new Error('loopback server has no port');
    }

    return {
        url: `ws://127.0.0.1:${address.port}/ws/chat`,
        get attempts() {
            return attempts;
        },
        async close() {
            for (const socket of sockets) {
                socket.destroy();
            }

            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        },
    };
}

/** A fresh, unregistered in-memory Baileys auth state (never paired, nothing persisted). */
export function createMemoryAuthState(): AuthenticationState {
    return {
        creds: initAuthCreds(),
        keys: {
            get: async () => ({}),
            set: async () => {},
        },
    };
}

/** A Baileys (pino-shaped) logger that prints nothing. */
export function createSilentBaileysLogger(): BaileysLogger {
    const logger: BaileysLogger = {
        level: 'silent',
        child: () => logger,
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
    };

    return logger;
}
