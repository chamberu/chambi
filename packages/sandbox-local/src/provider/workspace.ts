/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import {
    chmod,
    lstat,
    mkdir,
    open,
    realpath,
    rename,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import {
    basename,
    dirname,
    join,
    sep,
} from 'node:path';
import type { IClock } from '@chamvi/core';
import { SandboxError, ValidationError } from '@chamvi/core';
import {
    EXEC_TIMEOUT_MAX_MS,
    EXEC_TIMEOUT_MS,
    FILE_MAX_BYTES,
    OUTPUT_MAX_BYTES,
    absoluteWorkspacePath,
    assertArgv,
    createOutputCollector,
    decodeUtf8File,
    resolveWorkspacePath,
} from '@chamvi/sandbox';
import type {
    ExecOptions,
    ExecResult,
    IWorkspace,
    WorkspaceInfo,
} from '@chamvi/sandbox';
import { KILL_GRACE_MS, LINGER_CHECK_MS, REPO_DIR } from './constants.ts';
import { trackLingering, untrackLingering } from './exit.ts';
import {
    errnoCode,
    exitCodeOf,
    groupAlive,
    killGroup,
} from './helpers.ts';
import type { LocalWorkspaceInput } from './types.ts';

type LiveExec = { fail(error: SandboxError): void };

/**
 * A workspace in a host directory. Each exec is its own process group
 * (`detached`), so a timeout, an abort or a dispose kills every process the
 * command started. A command that exits while a background job of it holds
 * its output settles `KILL_GRACE_MS` later with its own exit code; the job
 * runs on until the dispose, as on Docker and Kubernetes. The workspace
 * remembers the group of every command that exited while a job of it still
 * ran and forgets it once the group ended (checked every `LINGER_CHECK_MS`),
 * so the dispose kills the jobs but never a group that reused the id. Only
 * this instance knows the groups, so they die with the process too (its
 * `exit`); a workspace found again after a restart has no jobs. No
 * isolation: the command runs as the host user.
 */
export class LocalWorkspace implements IWorkspace {
    readonly id: string;

    readonly info: WorkspaceInfo;

    protected readonly dir: string;

    protected readonly root: string;

    protected readonly env: Record<string, string>;

    protected readonly clock: IClock;

    protected readonly onDispose: () => void;

    protected readonly live = new Set<LiveExec>();

    /** Process groups of finished execs whose background jobs still ran; the dispose kills them. */
    protected readonly lingering = new Set<number>();

    /** Forgets the lingering groups that ended, while there are any. */
    protected lingerTimer: { clear(): void } | undefined;

    protected disposing: Promise<void> | undefined;

    /** Set once the workspace directory was found missing (removed outside chamvi). */
    protected gone = false;

    constructor(input: LocalWorkspaceInput) {
        this.id = input.id;
        this.info = input.info;
        this.dir = input.dir;
        this.root = join(input.dir, REPO_DIR);
        this.env = input.env;
        this.clock = input.clock;
        this.onDispose = input.onDispose;
    }

    get disposed(): boolean {
        return this.disposing !== undefined || this.gone;
    }

    async exec(argv: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
        this.assertUsable();
        assertArgv(argv);

        const cwd = options.cwd === undefined ? '.' : resolveWorkspacePath(options.cwd);

        if (options.stdin !== undefined && typeof options.stdin !== 'string') {
            throw new ValidationError('stdin must be a string.');
        }

        const timeoutMs = this.timeoutOf(options.timeoutMs);

        if (options.signal?.aborted) {
            throw new SandboxError('exec aborted');
        }

        const directory = await this.realPath(cwd);
        const stats = await stat(directory).catch(() => undefined);

        if (!stats?.isDirectory()) {
            await this.assertRoot();

            throw new SandboxError(`cwd ${absoluteWorkspacePath(cwd)} is no directory in the workspace.`);
        }

        this.assertUsable();

        // the abort listener only sees aborts after the spawn: check the ones during the awaits
        if (options.signal?.aborted) {
            throw new SandboxError('exec aborted');
        }

        return this.run(argv, directory, timeoutMs, options);
    }

    async readFile(path: string): Promise<string> {
        const { shown, bytes } = await this.readRaw(path);

        return decodeUtf8File(bytes, shown);
    }

    async readBytes(path: string): Promise<Uint8Array> {
        return (await this.readRaw(path)).bytes;
    }

    /** The bytes of the workspace file `path` (at most FILE_MAX_BYTES) and its path as the model sees it. */
    protected async readRaw(path: string): Promise<{ shown: string; bytes: Uint8Array }> {
        this.assertUsable();

        const relative = resolveWorkspacePath(path);
        const shown = absoluteWorkspacePath(relative);
        const file = await this.realPath(relative);

        let size: number;

        try {
            const stats = await stat(file);

            if (!stats.isFile()) {
                throw new SandboxError(`${shown} is no file.`);
            }

            ({ size } = stats);
        } catch (error) {
            if (error instanceof SandboxError) {
                throw error;
            }

            const code = errnoCode(error);

            if (code === 'ENOENT' || code === 'ENOTDIR') {
                await this.assertRoot();

                throw new SandboxError(`file not found: ${shown}`);
            }

            throw new SandboxError(`cannot read ${shown} (${code ?? 'unknown error'}).`, { cause: error });
        }

        if (size > FILE_MAX_BYTES) {
            throw new SandboxError(`${shown} has ${size} bytes, more than the ${FILE_MAX_BYTES} a file may have.`);
        }

        // read at most one byte past the limit: the file may grow after the stat
        const buffer = Buffer.alloc(FILE_MAX_BYTES + 1);
        let length = 0;

        try {
            const handle = await open(file, 'r');

            try {
                while (length < buffer.length) {
                    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);

                    if (bytesRead === 0) {
                        break;
                    }

                    length += bytesRead;
                }
            } finally {
                await handle.close();
            }
        } catch (error) {
            throw new SandboxError(`cannot read ${shown} (${errnoCode(error) ?? 'unknown error'}).`, { cause: error });
        }

        if (length > FILE_MAX_BYTES) {
            throw new SandboxError(`${shown} has more than the ${FILE_MAX_BYTES} bytes a file may have.`);
        }

        return { shown, bytes: new Uint8Array(buffer.subarray(0, length)) };
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        this.assertUsable();

        const relative = resolveWorkspacePath(path);

        if (relative === '.') {
            throw new ValidationError('path must name a file, not the workspace root.');
        }

        if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
            throw new ValidationError('content must be a string or bytes.');
        }

        const size = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.length;

        if (size > FILE_MAX_BYTES) {
            throw new ValidationError(`content has ${size} bytes, more than the ${FILE_MAX_BYTES} a file may have.`);
        }

        // mkdir would bring a removed workspace directory back
        await this.assertRoot();

        const file = await this.realPath(relative);
        // into a temporary file next to it with the old file's mode, then
        // renamed over it: a reader or a second writer never sees a cut file
        const temporary = join(dirname(file), `.chamvi-write-${randomBytes(8).toString('hex')}`);

        try {
            await mkdir(dirname(file), { recursive: true });

            const mode = await stat(file).then((stats) => stats.mode & 0o7777, () => undefined);

            await writeFile(temporary, content);

            if (mode !== undefined) {
                await chmod(temporary, mode);
            }

            await rename(temporary, file);
        } catch (error) {
            await rm(temporary, { force: true }).catch(() => undefined);

            throw new SandboxError(`cannot write ${absoluteWorkspacePath(relative)} (${errnoCode(error) ?? 'unknown error'}).`, { cause: error });
        }
    }

    dispose(): Promise<void> {
        this.disposing ??= this.remove();

        return this.disposing;
    }

    protected async remove(): Promise<void> {
        for (const entry of [...this.live]) {
            entry.fail(new SandboxError('workspace disposed'));
        }

        this.killLingering();
        this.onDispose();

        try {
            await rm(this.dir, {
                recursive: true,
                force: true,
                maxRetries: 3,
            });
        } catch (error) {
            throw new SandboxError(`cannot remove workspace ${this.id} (${errnoCode(error) ?? 'unknown error'}).`, { cause: error });
        }
    }

    protected assertUsable(): void {
        if (this.disposing) {
            throw new SandboxError('workspace disposed');
        }

        if (this.gone) {
            throw new SandboxError(this.goneMessage());
        }

        if (this.clock.now().getTime() >= this.info.expiresAt.getTime()) {
            throw new SandboxError('workspace expired');
        }
    }

    /**
     * The real path of the workspace path `relative`, symbolic links
     * resolved (for a missing path: its deepest existing ancestor's, plus
     * the rest); ValidationError when it leads out of the workspace root or
     * through a link whose target is missing. Checked before every call; a
     * command running at the same time can still swap a link in (local has
     * no isolation).
     */
    protected async realPath(relative: string): Promise<string> {
        const shown = absoluteWorkspacePath(relative);
        let root: string;

        try {
            root = await realpath(this.root);
        } catch (error) {
            await this.assertRoot();

            throw new SandboxError(`cannot resolve ${shown} (${errnoCode(error) ?? 'unknown error'}).`, { cause: error });
        }

        let current = join(this.root, relative);
        const rest: string[] = [];
        let real: string | undefined;

        while (real === undefined) {
            try {
                real = await realpath(current);
            } catch (error) {
                const code = errnoCode(error);

                if ((code !== 'ENOENT' && code !== 'ENOTDIR') || current === this.root) {
                    throw new SandboxError(`cannot resolve ${shown} (${code ?? 'unknown error'}).`, { cause: error });
                }

                if (await lstat(current).then((stats) => stats.isSymbolicLink(), () => false)) {
                    throw new ValidationError(`${shown} goes through a symbolic link whose target is missing.`);
                }

                rest.unshift(basename(current));
                current = dirname(current);
            }
        }

        if (real !== root && !real.startsWith(`${root}${sep}`)) {
            throw new ValidationError(`${shown} leads out of the workspace through a symbolic link.`);
        }

        return join(real, ...rest);
    }

    /**
     * Marks the workspace gone and throws when its directory no longer
     * exists. Its background jobs are killed then: the manager forgets a gone
     * workspace without disposing it.
     */
    protected async assertRoot(): Promise<void> {
        const stats = await stat(this.root).catch(() => undefined);

        if (stats?.isDirectory() || this.disposing) {
            return;
        }

        this.gone = true;
        this.killLingering();

        throw new SandboxError(this.goneMessage());
    }

    protected goneMessage(): string {
        return `workspace ${this.id} is gone (its directory was removed); call create_workspace for a new one.`;
    }

    /** Kills the background jobs of finished execs (dispose, process exit); synchronous. */
    killLingering(): void {
        this.lingerTimer?.clear();
        this.lingerTimer = undefined;

        for (const pid of this.lingering) {
            if (groupAlive(pid)) {
                killGroup(pid);
            }
        }

        this.lingering.clear();
        untrackLingering(this);
    }

    /** Remembers the group of an exec whose command exited while a job of it runs on. */
    protected linger(pid: number): void {
        // the leader was reaped: a live member is a job, and the id cannot be reused while it lives
        if (this.disposing || !groupAlive(pid)) {
            return;
        }

        this.lingering.add(pid);
        trackLingering(this);
        this.lingerTimer ??= this.clock.setTimeout(() => this.checkLingering(), LINGER_CHECK_MS, { keepAlive: false });
    }

    protected checkLingering(): void {
        this.lingerTimer = undefined;

        for (const pid of this.lingering) {
            if (!groupAlive(pid)) {
                this.lingering.delete(pid);
            }
        }

        if (this.lingering.size === 0) {
            untrackLingering(this);
        }

        if (this.lingering.size > 0 && !this.disposing) {
            this.lingerTimer = this.clock.setTimeout(() => this.checkLingering(), LINGER_CHECK_MS, { keepAlive: false });
        }
    }

    /** The requested timeout (default `EXEC_TIMEOUT_MS`), at most `EXEC_TIMEOUT_MAX_MS` and never past the expiry. */
    protected timeoutOf(requested: number | undefined): number {
        if (requested !== undefined && (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0)) {
            throw new ValidationError('timeoutMs must be a positive number.');
        }

        const remaining = this.info.expiresAt.getTime() - this.clock.now().getTime();

        return Math.max(1, Math.min(requested ?? EXEC_TIMEOUT_MS, EXEC_TIMEOUT_MAX_MS, remaining));
    }

    protected run(
        argv: readonly string[],
        cwd: string,
        timeoutMs: number,
        options: ExecOptions,
    ): Promise<ExecResult> {
        return new Promise<ExecResult>((resolve, reject) => {
            const started = this.clock.now().getTime();
            const stdout = createOutputCollector(OUTPUT_MAX_BYTES);
            const stderr = createOutputCollector(OUTPUT_MAX_BYTES);
            const { signal } = options;

            let child: ChildProcess;

            try {
                child = spawn(argv[0] as string, argv.slice(1), {
                    cwd,
                    env: this.env,
                    detached: true,
                    stdio: 'pipe',
                });
            } catch (error) {
                reject(new SandboxError(`cannot start ${argv[0]}.`, { cause: error }));

                return;
            }

            let settled = false;
            let timedOut = false;
            let killTimer: { clear(): void } | undefined;
            let graceTimer: { clear(): void } | undefined;
            let pipeTimer: { clear(): void } | undefined;

            const kill = () => {
                if (child.pid !== undefined) {
                    killGroup(child.pid);
                }
            };
            const closePipes = () => {
                child.stdin?.destroy();
                child.stdout?.destroy();
                child.stderr?.destroy();
            };
            const finish = (): boolean => {
                if (settled) {
                    return false;
                }

                settled = true;
                killTimer?.clear();
                graceTimer?.clear();
                pipeTimer?.clear();
                signal?.removeEventListener('abort', onAbort);
                this.live.delete(entry);

                return true;
            };
            const entry: LiveExec = {
                fail: (error) => {
                    if (!finish()) {
                        return;
                    }

                    kill();
                    closePipes();
                    reject(error);
                },
            };
            function onAbort() {
                entry.fail(new SandboxError('exec aborted'));
            }
            const result = (exitCode: number, stderrText: string): ExecResult => ({
                exitCode,
                stdout: stdout.text(),
                stderr: stderrText,
                stdoutTruncated: stdout.truncated,
                stderrTruncated: stderr.truncated,
                timedOut,
                durationMs: this.clock.now().getTime() - started,
            });

            this.live.add(entry);
            signal?.addEventListener('abort', onAbort, { once: true });

            child.stdout?.on('data', (chunk: Uint8Array) => stdout.write(chunk));
            child.stderr?.on('data', (chunk: Uint8Array) => stderr.write(chunk));
            // a child that never reads its stdin closes the pipe (EPIPE)
            child.stdin?.on('error', () => undefined);
            child.stdin?.end(options.stdin ?? '');

            child.on('error', (error) => {
                // Handle only a command that could not start and has not settled.
                if (child.pid !== undefined || !finish()) {
                    return;
                }

                closePipes();

                const code = errnoCode(error);

                if (code === 'ENOENT') {
                    resolve(result(127, `${argv[0]}: command not found\n`));
                } else if (code === 'EACCES') {
                    resolve(result(126, `${argv[0]}: permission denied\n`));
                } else {
                    reject(new SandboxError(`cannot start ${argv[0]} (${code ?? 'unknown error'}).`, { cause: error }));
                }
            });

            child.on('exit', () => {
                if (settled || timedOut) {
                    return;
                }

                // the command finished on its own: no timeout any more, but a
                // background job it started may run on and hold the pipes open
                killTimer?.clear();

                if (child.pid !== undefined) {
                    this.linger(child.pid);
                }

                pipeTimer = this.clock.setTimeout(closePipes, KILL_GRACE_MS);
            });

            child.on('close', (code, closeSignal) => {
                if (!finish()) {
                    return;
                }

                resolve(result(exitCodeOf(code, closeSignal), stderr.text()));
            });

            killTimer = this.clock.setTimeout(() => {
                timedOut = true;
                kill();
                // a process that left the group may hold the pipes open
                graceTimer = this.clock.setTimeout(closePipes, KILL_GRACE_MS);
            }, timeoutMs);
        });
    }
}
