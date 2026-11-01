/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { DisconnectReason } from 'baileys';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { InvalidRunStateError } from '@chamvi/core';
import type { IEngine } from '@chamvi/core';
import {
    WHATSAPP_AUTH_ERROR_CODE,
    WHATSAPP_CONNECTION_ERROR_CODE,
    WHATSAPP_LOGGED_OUT_ERROR_CODE,
    WHATSAPP_RECONNECT,
    WHATSAPP_SHUTDOWN_TIMEOUT_MS,
} from '@chamvi/chat/baileys';
import { createWhatsAppFixture, settle } from '../../utils/whatsapp.ts';
import type { WhatsAppFixture } from '../../utils/whatsapp.ts';

const engines: IEngine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((engine) => engine.stop()));
    engines.length = 0;
});

function fixture(input: Parameters<typeof createWhatsAppFixture>[0] = {}): WhatsAppFixture {
    const value = createWhatsAppFixture(input);

    engines.push(value.engine);

    return value;
}

function codesOf(errors: unknown[]): unknown[] {
    return errors.map((error) => (error as { code?: unknown }).code);
}

/** the longest a reconnect may wait before attempt `n` (0-based): the base with the jitter on top, capped */
function upperDelay(n: number): number {
    const base = Math.min(WHATSAPP_RECONNECT.maxMs, WHATSAPP_RECONNECT.initialMs * WHATSAPP_RECONNECT.factor ** n);

    return Math.ceil(Math.min(WHATSAPP_RECONNECT.maxMs, base * (1 + WHATSAPP_RECONNECT.jitter)));
}

function lowerDelay(n: number): number {
    const base = Math.min(WHATSAPP_RECONNECT.maxMs, WHATSAPP_RECONNECT.initialMs * WHATSAPP_RECONNECT.factor ** n);

    return Math.floor(base * (1 - WHATSAPP_RECONNECT.jitter));
}

describe('WhatsApp connection lifecycle', () => {
    it('pins the reconnect and shutdown values', () => {
        expect(WHATSAPP_RECONNECT).toEqual({
            initialMs: 2000,
            factor: 1.8,
            maxMs: 30_000,
            jitter: 0.25,
            maxAttempts: 12,
        });
        expect(WHATSAPP_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    });

    it('factory_check_do_not_acquire', () => {
        const {
            engine,
            auth,
            sockets,
            setup,
        } = fixture();

        engine.checkAgent(engine.getAgent('assistant')!);

        expect(auth.signals).toEqual([]);
        expect(sockets.sockets).toEqual([]);
        expect(setup.status()).toBe('stopped');
    });

    it('acquire_before_socket', async () => {
        const {
            engine,
            auth,
            sockets,
            trace,
            setup,
        } = fixture();

        await engine.start();

        expect(trace).toEqual(['acquire', 'load', 'connect']);
        expect(sockets.sockets).toHaveLength(1);

        const { config } = sockets.last();
        const lease = auth.leases[0]!;

        // the lease's creds as they are, its keys behind the generation guard
        expect(config.auth.creds).toBe(lease.auth.creds);
        expect(config.auth.keys).not.toBe(lease.auth.keys);
        // a socket made is no connection
        expect(setup.status()).toBe('connecting');
    });

    it('conflicting_session_never_connects', async () => {
        const {
            engine,
            auth,
            sockets,
            setup,
        } = fixture();
        const conflict = new Error('the auth location is locked by another connector');

        auth.failAcquire(conflict);

        await expect(engine.start()).rejects.toBe(conflict);

        expect(sockets.sockets).toEqual([]);
        expect(auth.trace).not.toContain('release');
        expect(setup.status()).toBe('stopped');
    });

    it('a session replaced by another client is not fought over', async () => {
        const {
            engine,
            sockets,
            setup,
            clock,
            errors,
        } = fixture();

        await engine.start();
        sockets.last().open();
        sockets.last().close(DisconnectReason.connectionReplaced);

        expect(setup.status()).toBe('disconnected');

        clock.advance(10 * WHATSAPP_RECONNECT.maxMs);
        await settle();

        expect(sockets.sockets).toHaveLength(1);
        expect(codesOf(errors)).toEqual([WHATSAPP_CONNECTION_ERROR_CODE]);
    });

    it('write_after_generation_end_denied', async () => {
        const {
            engine,
            auth,
            sockets,
        } = fixture();

        await engine.start();

        const socket = sockets.last();
        const { auth: state } = socket.config;

        socket.open();
        await engine.stop();

        const saves = auth.trace.filter((entry) => entry === 'saveCreds').length;

        // the ended socket's late callbacks reach nothing
        socket.emit('creds.update', { registered: true });
        await settle();

        expect(auth.trace.filter((entry) => entry === 'saveCreds')).toHaveLength(saves);
        await expect(Promise.resolve(state.keys.set({ session: { a: new Uint8Array([1]) } }))).rejects.toBeInstanceOf(InvalidRunStateError);
        await expect(Promise.resolve(state.keys.get('session', ['a']))).rejects.toBeInstanceOf(InvalidRunStateError);
        expect(auth.keys.size).toBe(0);
        expect(socket.listenerCount()).toBe(0);
    });

    it('signal_key_writes_guarded', async () => {
        const {
            engine,
            auth,
            sockets,
            trace,
        } = fixture();

        await engine.start();

        const { keys } = sockets.last().config.auth;

        sockets.last().open();
        await keys.set({ session: { 'a.0': new Uint8Array([1, 2]) } });

        expect(auth.keys.get('session/a.0')).toEqual(new Uint8Array([1, 2]));
        await expect(Promise.resolve(keys.get('session', ['a.0']))).resolves.toEqual({ 'a.0': new Uint8Array([1, 2]) });

        // a write still in flight at stop is awaited before flush and release
        const hold = auth.holdKeys();
        const pending = Promise.resolve(keys.set({ session: { 'b.0': new Uint8Array([3]) } }));
        const stopping = engine.stop();

        await settle();
        expect(trace).not.toContain('flush');

        hold.resolve();
        await pending;
        await stopping;

        expect(trace.slice(trace.indexOf('disconnect'))).toEqual(['disconnect', 'keys.set:done', 'flush', 'release']);
        expect(auth.keys.get('session/b.0')).toEqual(new Uint8Array([3]));
    });

    it('disconnect_flush_release_order', async () => {
        const {
            engine,
            auth,
            sockets,
            trace,
            setup,
        } = fixture();

        await engine.start();
        sockets.last().open();

        const hold = auth.holdCreds();

        sockets.last().emit('creds.update', { registered: true });

        const stopping = engine.stop();

        await settle();
        expect(trace).not.toContain('flush');

        hold.resolve();
        await stopping;

        expect(trace).toEqual(['acquire', 'load', 'connect', 'saveCreds', 'disconnect', 'saveCreds:done', 'flush', 'release']);
        expect(setup.status()).toBe('stopped');
    });

    it('keeps the lease fenced when persistence outlives the shutdown bound', async () => {
        const {
            engine,
            auth,
            sockets,
            trace,
            clock,
            errors,
        } = fixture();

        await engine.start();
        sockets.last().open();
        auth.holdCreds();
        sockets.last().emit('creds.update', { registered: true });

        const stopping = engine.stop();

        await settle();
        clock.advance(WHATSAPP_SHUTDOWN_TIMEOUT_MS);
        await stopping;

        expect(trace).not.toContain('release');
        expect(trace).not.toContain('flush');
        expect(codesOf(errors)).toContain(WHATSAPP_AUTH_ERROR_CODE);
    });

    it('startup_failure_releases', async () => {
        const {
            engine,
            sockets,
            trace,
            setup,
        } = fixture();
        const failure = new Error('socket construction failed');

        sockets.failNext(failure);

        await expect(engine.start()).rejects.toBe(failure);

        expect(trace).toEqual(['acquire', 'load', 'connect', 'flush', 'release']);
        expect(setup.status()).toBe('stopped');
    });

    it('stop_during_acquire_releases_late_lease', async () => {
        const {
            engine,
            auth,
            sockets,
            trace,
            channel,
        } = fixture();
        const hold = auth.holdAcquire();
        const starting = channel.start!(engine.channelContext(channel));
        const outcome = starting.catch((error: unknown) => error);

        await settle();

        const stopping = channel.stop!();

        await settle();
        // the provider ignores the aborted signal; the stop waits for its lease to give it back
        expect(auth.signals[0]?.aborted).toBe(true);
        expect(trace).toEqual(['acquire']);

        hold.resolve();
        await stopping;
        await expect(outcome).resolves.toBeInstanceOf(InvalidRunStateError);

        expect(trace).toEqual(['acquire', 'load', 'release']);
        expect(sockets.sockets).toEqual([]);
    });

    it('a lease that never arrives holds the stop for the shutdown bound only', async () => {
        const {
            engine,
            auth,
            sockets,
            trace,
            channel,
            clock,
            errors,
        } = fixture();

        auth.holdAcquire();

        const outcome = channel.start!(engine.channelContext(channel)).catch((error: unknown) => error);

        await settle();

        const stopping = channel.stop!();

        await settle();
        clock.advance(WHATSAPP_SHUTDOWN_TIMEOUT_MS);
        await stopping;

        expect(await outcome).toBeInstanceOf(InvalidRunStateError);
        expect(trace).toEqual(['acquire']);
        expect(sockets.sockets).toEqual([]);
        expect(codesOf(errors)).toEqual([WHATSAPP_AUTH_ERROR_CODE]);
    });

    it('offline_not_connected', async () => {
        const {
            engine,
            sockets,
            setup,
            channel,
        } = fixture();

        await engine.start();

        const address = channel.to({ adapter: 'whatsapp', threadId: 'whatsapp:491701111111@s.whatsapp.net' });
        const send = () => channel.out!({
            kind: 'message',
            key: 'k1',
            runId: 'r1',
            agent: 'assistant',
            body: 'hi',
        }, address, { signal: new AbortController().signal, trigger: {} as never });

        await expect(send()).rejects.toThrow(/not connected/);
        expect(setup.status()).toBe('connecting');

        sockets.last().open();
        expect(setup.status()).toBe('connected');
        await send();

        sockets.last().close(DisconnectReason.connectionLost);
        expect(setup.status()).toBe('disconnected');
        await expect(send()).rejects.toThrow(/not connected/);
        expect(sockets.last().sent).toHaveLength(1);
    });

    it('reconnect_has_backoff_and_cancels', async () => {
        const {
            engine,
            sockets,
            clock,
            setup,
        } = fixture();

        await engine.start();
        sockets.last().open();
        sockets.last().close(DisconnectReason.connectionClosed);

        clock.advance(lowerDelay(0) - 1);
        await settle();
        expect(sockets.sockets).toHaveLength(1);

        clock.advance(upperDelay(0));
        await settle();
        expect(sockets.sockets).toHaveLength(2);
        expect(setup.status()).toBe('connecting');

        // the second failure in a row waits longer
        sockets.last().close(DisconnectReason.connectionClosed);
        clock.advance(lowerDelay(1) - 1);
        await settle();
        expect(sockets.sockets).toHaveLength(2);

        // a stop cancels the pending reconnect: no socket afterwards
        await engine.stop();
        clock.advance(10 * WHATSAPP_RECONNECT.maxMs);
        await settle();

        expect(sockets.sockets).toHaveLength(2);
        expect(setup.status()).toBe('stopped');
    });

    it('gives up after the last reconnect attempt and resets the count once open', async () => {
        const {
            engine,
            sockets,
            clock,
            setup,
            errors,
        } = fixture();

        await engine.start();
        sockets.last().open();
        sockets.last().close(DisconnectReason.connectionClosed);

        clock.advance(upperDelay(0));
        await settle();
        // open again: the next failure starts the backoff over
        sockets.last().open();
        sockets.last().close(DisconnectReason.connectionClosed);
        clock.advance(upperDelay(0));
        await settle();
        expect(sockets.sockets).toHaveLength(3);

        for (let attempt = 1; attempt < WHATSAPP_RECONNECT.maxAttempts; attempt++) {
            sockets.last().close(DisconnectReason.connectionLost);
            clock.advance(upperDelay(attempt));
            await settle();
        }

        expect(sockets.sockets).toHaveLength(2 + WHATSAPP_RECONNECT.maxAttempts);

        sockets.last().close(DisconnectReason.connectionLost);
        clock.advance(10 * WHATSAPP_RECONNECT.maxMs);
        await settle();

        expect(sockets.sockets).toHaveLength(2 + WHATSAPP_RECONNECT.maxAttempts);
        expect(setup.status()).toBe('disconnected');
        expect(codesOf(errors)).toEqual([WHATSAPP_CONNECTION_ERROR_CODE]);
    });

    it('logout_requires_pairing_not_retry_loop', async () => {
        const {
            engine,
            sockets,
            clock,
            setup,
            errors,
            trace,
        } = fixture();

        await engine.start();
        sockets.last().open();
        sockets.last().close(DisconnectReason.loggedOut);

        expect(setup.status()).toBe('logged-out');

        clock.advance(10 * WHATSAPP_RECONNECT.maxMs);
        await settle();

        expect(sockets.sockets).toHaveLength(1);
        expect(codesOf(errors)).toEqual([WHATSAPP_LOGGED_OUT_ERROR_CODE]);

        await engine.stop();

        expect(trace.slice(-2)).toEqual(['flush', 'release']);
        expect(setup.status()).toBe('stopped');
    });

    it('a restart takes a new lease and a new socket; the old one stays silent', async () => {
        const {
            engine,
            auth,
            sockets,
            channel,
            setup,
        } = fixture();

        await engine.start();

        const first = sockets.last();

        first.open();
        await engine.stop();
        await channel.start!(engine.channelContext(channel));

        expect(auth.leases).toHaveLength(2);
        expect(sockets.sockets).toHaveLength(2);

        // the first socket's late events change nothing
        first.open();
        expect(setup.status()).toBe('connecting');
        sockets.last().open();
        expect(setup.status()).toBe('connected');

        await channel.stop!();
    });
});
