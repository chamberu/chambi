/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { runCli } from '../../../src/run/module.ts';
import { FIXTURE_APP, copyFixtureApp } from '../../utils/app.ts';
import { createFakeProcess } from '../../utils/process.ts';
import type { FakeProcess } from '../../utils/process.ts';

type SpawnCall = {
    command: string;
    args: readonly string[];
    options: Record<string, unknown>
};

class FakeChild extends EventEmitter {
    exitCode: number | null = null;

    signalCode: NodeJS.Signals | null = null;

    readonly kills: string[] = [];

    kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
        this.kills.push(signal);

        return true;
    }

    /** The child ends (by a code or a signal). */
    end(code: number | null, signal: NodeJS.Signals | null = null): void {
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('exit', code, signal);
        this.emit('close', code, signal);
    }
}

describe('dev', () => {
    let fake: FakeProcess;
    let child: FakeChild;
    let calls: SpawnCall[];

    beforeEach(() => {
        fake = createFakeProcess();
        child = new FakeChild();
        calls = [];
    });

    function dev(args: string[] = [], cwd = FIXTURE_APP): Promise<void> {
        const fakeSpawn = ((command: string, spawnArgs: readonly string[], options: Record<string, unknown>) => {
            calls.push({
                command,
                args: spawnArgs,
                options,
            });

            return child;
        }) as unknown as typeof spawn;

        return runCli(['dev', ...args], {
            ...fake.context({ cwd }),
            spawn: fakeSpawn,
            execPath: '/usr/bin/node',
            cliPath: '/opt/cli/dist/cli.mjs',
        });
    }

    /** The spawn call; rejects when the command ended without spawning. */
    async function spawned(running: Promise<void>): Promise<SpawnCall> {
        let ended = false;

        running.then(() => {
            ended = true;
        }, () => {
            ended = true;
        });
        await new Promise<void>((resolve, reject) => {
            const poll = () => {
                if (calls.length > 0) {
                    resolve();
                } else if (ended) {
                    reject(new Error(`dev ended without spawning: ${fake.stderr.join('')}`));
                } else {
                    setImmediate(poll);
                }
            };

            poll();
        });

        return calls[0]!;
    }

    it('spawns node --watch with the start args', async () => {
        const running = dev();
        const call = await spawned(running);

        expect(call.command).toBe('/usr/bin/node');
        expect(call.args).toEqual([
            '--watch',
            '/opt/cli/dist/cli.mjs',
            'start',
            '--dev',
            '--entry',
            path.join(FIXTURE_APP, 'src/index.ts'),
        ]);
        // stdin is a pipe only this process writes: it closes when this process dies, which ends the group
        expect(call.options).toMatchObject({ cwd: FIXTURE_APP, stdio: ['pipe', 'inherit', 'inherit'] });
        expect((call.options.env as Record<string, string>).CHAMVI_DEV_LINK).toBe('1');

        child.end(0);
        await running;
        expect(fake.exitCodes).toEqual([0]);
    });

    it('loads .env only when it exists', async () => {
        const app = await copyFixtureApp();

        try {
            await writeFile(path.join(app.cwd, '.env'), 'CHAMVI_LOG_LEVEL=info\n');

            const running = dev([], app.cwd);
            const call = await spawned(running);

            expect(call.args.slice(0, 3)).toEqual(['--watch', '--env-file-if-exists=.env', '/opt/cli/dist/cli.mjs']);
            child.end(0);
            await running;
        } finally {
            await app.remove();
        }
    });

    it('detached is set', async () => {
        const running = dev();
        const call = await spawned(running);

        expect(call.options.detached).toBe(true);
        child.end(0);
        await running;
    });

    it('without an entry file spawns start without --entry (the default app)', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'chamvi-cli-dev-'));

        try {
            const running = dev([], cwd);
            const call = await spawned(running);

            expect(call.args).toEqual(['--watch', '/opt/cli/dist/cli.mjs', 'start', '--dev']);
            child.end(0);
            await running;
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    it('--entry', async () => {
        const running = dev(['--entry', 'src/agents.ts']);
        const call = await spawned(running);

        expect(call.args.at(-1)).toBe(path.join(FIXTURE_APP, 'src/agents.ts'));
        child.end(0);
        await running;
    });

    it('dev forwards one signal', async () => {
        const running = dev();

        await spawned(running);

        fake.signals.emit('SIGINT');
        expect(child.kills).toEqual(['SIGINT']);

        child.end(null, 'SIGINT');
        await running;
        expect(fake.exitCodes).toEqual([0]);
        expect(fake.exits).toEqual([]);
    });

    it('a second signal is forwarded too', async () => {
        const running = dev();

        await spawned(running);

        fake.signals.emit('SIGTERM');
        fake.signals.emit('SIGTERM');
        expect(child.kills).toEqual(['SIGTERM', 'SIGTERM']);

        child.end(1);
        await running;
        expect(fake.exitCodes).toEqual([1]);
    });

    it('child exit code is passed through', async () => {
        const running = dev();

        await spawned(running);
        child.end(2);
        await running;
        expect(fake.exitCodes).toEqual([2]);
    });

    it('a child killed by a signal the CLI did not forward exits 1', async () => {
        const running = dev();

        await spawned(running);
        child.end(null, 'SIGKILL');
        await running;
        expect(fake.exitCodes).toEqual([1]);
    });

    it('SIGHUP forwards SIGTERM', async () => {
        const running = dev();

        await spawned(running);

        fake.signals.emit('SIGHUP');
        expect(child.kills).toEqual(['SIGTERM']);

        child.end(null, 'SIGTERM');
        await running;
        expect(fake.exitCodes).toEqual([0]);
    });

    it('the child is killed when the CLI exits first', async () => {
        const running = dev();

        await spawned(running);

        fake.signals.emit('exit');
        expect(child.kills).toEqual(['SIGTERM']);

        child.end(null, 'SIGTERM');
        await running;
    });

    it('removes its listeners once the child ended', async () => {
        const running = dev();

        await spawned(running);
        child.end(0);
        await running;

        ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'].forEach((event) => {
            expect(fake.signals.listenerCount(event)).toBe(0);
        });
        fake.signals.emit('exit');
        expect(child.kills).toEqual([]);
    });

    it('a spawn error exits 1', async () => {
        const running = dev();

        await spawned(running);
        child.emit('error', new Error('spawn /usr/bin/node ENOENT'));
        await running;
        expect(fake.exitCodes).toEqual([1]);
        expect(fake.stderr.join('')).toContain('ENOENT');
    });

    it('a missing entry exits 2 without spawning', async () => {
        await dev(['--entry', 'src/nope.ts']);
        expect(fake.exitCodes).toEqual([2]);
        expect(calls).toEqual([]);
    });
});
