/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { IOutputSink } from '../output/types.ts';
import type { WorkspaceInfo } from '../workspace/types.ts';

export type TransportExecOptions = {
    stdin?: Uint8Array;
    /** Gets every stdout chunk as it arrives; the workspace caps and keeps it. */
    stdout: IOutputSink;
    /** Gets every stderr chunk as it arrives; the workspace caps and keeps it. */
    stderr: IOutputSink;
    /**
     * Aborted on a caller abort, a dispose, the client-side guard, or once the
     * workspace settled the exec itself (the command exited, a background job
     * still holds its output): stop waiting and detach.
     */
    signal: AbortSignal;
};

export type TransportExecResult = {
    exitCode: number;
    /**
     * The connection closed before the stream ended (e.g. the daemon reset it
     * after the command exited with stdin still queued): the output may be
     * cut, so the workspace accepts the result only after the exit marker.
     */
    closed?: boolean;
};

/**
 * Runs argv in one container or pod. The remote workspace wraps argv itself
 * (the working directory, GNU `timeout`, the exit status reported on
 * stderr); a transport only executes and streams the output.
 */
export interface IExecTransport {
    /** A command that cannot start reports exit 127. */
    exec(argv: readonly string[], options: TransportExecOptions): Promise<TransportExecResult>;
    /**
     * Whether the container or pod still runs; asked after a failed exec. False
     * marks the workspace gone. A rejection, or no answer within
     * `ALIVE_PROBE_TIMEOUT_MS` (the signal then aborts), reads as alive.
     */
    alive?(signal: AbortSignal): Promise<boolean>;
    /** Deletes the container or pod; idempotent, a missing one is fine. */
    remove(): Promise<void>;
}

export type RemoteWorkspaceInput = {
    /** `randomUUID()`. */
    id: string;
    /** A mutable object the provider owns (it sets `commit` after the checkout). */
    info: WorkspaceInfo;
    transport: IExecTransport;
    /** Default `systemClock`. */
    clock?: IClock;
};
