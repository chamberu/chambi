/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** A workspace with background jobs (lingering process groups) of finished execs. */
type JobHolder = { killLingering(): void };

const holders = new Set<JobHolder>();

let installed = false;

/**
 * Kills the background jobs of every open workspace of this process. Run on
 * the process `exit` (synchronous kills only): the groups are known only to
 * the instance that spawned them, so a workspace `find` rebuilds after a
 * restart could never kill them. The folders stay for their runs.
 */
export function killLingeringJobs(): void {
    for (const holder of [...holders]) {
        holder.killLingering();
    }
}

/** Tracks a workspace while it has background jobs; installs the one `exit` listener on first use. */
export function trackLingering(holder: JobHolder): void {
    holders.add(holder);

    if (installed) {
        return;
    }

    installed = true;
    process.on('exit', killLingeringJobs);
}

export function untrackLingering(holder: JobHolder): void {
    holders.delete(holder);
}
