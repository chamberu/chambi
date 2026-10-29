/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { join } from 'node:path';
import { InvalidAgentDefinitionError, InvalidRunStateError } from '@chamvi/core';
import type { AgentIssue } from '@chamvi/http';
import { formerAgentFolderHash, messageOf, relativize } from '../../loader/helpers.ts';
import { hashAgentFolder, listAgentFolders, loadAgent } from '../../loader/module.ts';
import type { LoadedAgent } from '../../loader/types.ts';
import { BOOT_LOAD_ATTEMPTS, EMPTY_ROOT_MESSAGE, JOB_CONFLICT_HINT } from './constants.ts';
import { isDirectory, isEmptyDirectory } from './helpers.ts';
import type { AgentsWatcherOptions, IAgentsWatcher } from './types.ts';

/**
 * The agents dir's loader and polling watcher. Per folder it keeps the hash
 * its agent is registered at (`applied`), the hash it last tried to load
 * (`attempted`, so a broken folder is tried once per content) and the hash
 * the previous poll saw (`seen`): a folder whose hash differs from the
 * attempted one is loaded once a poll sees the same hash as the poll before
 * (stable for one interval), and registered only when the load read exactly
 * that content. A folder absent on two consecutive polls is removed from the
 * engine. A failed load or check keeps the registered agent and writes no
 * revision marker. Every poll compares the stored markers with the applied
 * hashes and records an agent whose marker another process moved as an issue.
 * The role decides what reaches the store (see `AgentsWatcherOptions.role`).
 */
export function createAgentsWatcher(options: AgentsWatcherOptions): IAgentsWatcher {
    const {
        root,
        engine,
        codeNames,
        check,
        clock,
        logger,
        pollMs,
        signal,
        role,
    } = options;

    const issues = new Map<string, AgentIssue>();
    const applied = new Map<string, string>();
    const attempted = new Map<string, string>();
    const seen = new Map<string, string>();
    const missing = new Set<string>();
    // agents whose marker another process moved (an issue until it matches again)
    const drifted = new Set<string>();
    // job role: agents whose stored marker differs while they have unsettled runs, by issue message
    const conflicts = new Map<string, string>();

    let timer: { clear(): void } | undefined;
    let started = false;
    let stopped = false;
    let inFlight: Promise<void> | undefined;
    let rootGone = false;

    const record = (agent: string, message: string) => {
        issues.set(agent, {
            agent,
            message,
            at: clock.now(),
        });
        logger.warn('agent load failed', { agent, message });
    };

    const recordDrift = (agent: string, marker: string | undefined) => {
        const message = marker === undefined ?
            `${agent}: another process sharing the store removed this agent's revision marker; this replica does not run it until its folder changes. Every process sharing the store must see the same folders.` :
            `${agent}: another process sharing the store registered other content for this agent; this replica does not run it until its folder matches. Every process sharing the store must see the same folders.`;
        issues.set(agent, {
            agent,
            message,
            at: clock.now(),
        });
        logger.warn('agent revision moved', { agent, message });
    };

    /** Whether the folder no longer hashes to `hash` (or is gone). */
    const changedSince = async (name: string, hash: string): Promise<boolean> => {
        try {
            return await hashAgentFolder(join(root, name)) !== hash;
        } catch {
            return true;
        }
    };

    /**
     * Loads the folder (hashed to `hash` just before) and registers its agent,
     * unless that is refused (an issue). `unstable` when the folder moved past
     * `hash` while loading: nothing is registered or recorded, and the next
     * stable poll decides.
     */
    const apply = async (name: string, hash: string): Promise<'done' | 'unstable'> => {
        attempted.set(name, hash);
        if (codeNames.has(name)) {
            record(name, `${name}: a code agent has this name; the folder is not loaded.`);
            return 'done';
        }

        let loaded: LoadedAgent;
        try {
            loaded = await loadAgent(join(root, name));
        } catch (error) {
            if (await changedSince(name, hash)) {
                attempted.delete(name);
                return 'unstable';
            }
            record(name, relativize(messageOf(error), root));
            return 'done';
        }
        if (loaded.hash !== hash) {
            attempted.delete(name);
            return 'unstable';
        }

        try {
            check(loaded.agent);
            engine.checkAgent(loaded.agent);
        } catch (error) {
            record(name, relativize(messageOf(error), root));
            return 'done';
        }

        if (role === 'check') {
            return 'done';
        }

        // Verification is fatal during boot; polling reports failures and retains the old agent.
        await engine.prepare({ agents: [loaded.agent], signal });

        try {
            // a marker from before HASH_IGNORE_PATTERNS holds the same content: moved, never a cancel
            const formerRevision = await formerAgentFolderHash(join(root, name), hash);
            await engine.putAgent(loaded.agent, {
                revision: hash,
                reload: role === 'start',
                ...(formerRevision !== undefined && { formerRevision }),
            });
        } catch (error) {
            // refused before any store write (a model that cannot resolve, a subscription to an unknown channel): an issue until the content changes
            if (error instanceof InvalidAgentDefinitionError) {
                record(name, relativize(messageOf(error), root));
                return 'done';
            }
            // a job never reloads: the marker differs while the agent has unsettled runs
            if (role === 'job' && error instanceof InvalidRunStateError) {
                const message = `${name}: ${messageOf(error)} ${JOB_CONFLICT_HINT}`;
                conflicts.set(name, message);
                record(name, message);
                return 'done';
            }
            throw error;
        }
        applied.set(name, hash);
        issues.delete(name);
        drifted.delete(name);
        return 'done';
    };

    /**
     * Compares the stored markers with the applied hashes: an agent whose
     * marker another process moved or removed while its folder here is
     * unchanged cannot run on this replica (the start guard), so it becomes
     * an issue; it is not re-synced, since two populations with different
     * folders would cancel each other's runs.
     */
    const checkMarkers = async (): Promise<void> => {
        if (applied.size === 0) return;
        const markers = new Map((await engine.store.listAgentRevisions()).map((marker) => [marker.agent, marker.hash]));
        for (const [name, hash] of applied) {
            if (seen.get(name) !== hash) continue;
            const marker = markers.get(name);
            if (marker === hash) {
                if (drifted.delete(name)) issues.delete(name);
                continue;
            }
            if (drifted.has(name)) continue;
            drifted.add(name);
            recordDrift(name, marker);
        }
    };

    const poll = async (): Promise<void> => {
        if (!await isDirectory(root)) {
            // an unmounted volume must not remove every agent
            if (!rootGone) logger.warn('the agents dir is gone; its agents stay loaded until it is back');
            rootGone = true;
            return;
        }
        if (await isEmptyDirectory(root)) {
            // an empty mount point (a volume not mounted yet) removes nothing either
            if (!rootGone) logger.warn(EMPTY_ROOT_MESSAGE);
            rootGone = true;
            return;
        }
        rootGone = false;

        const names = await listAgentFolders(root);
        const present = new Set(names);
        for (const name of names) {
            missing.delete(name);
            let hash: string;
            try {
                hash = await hashAgentFolder(join(root, name));
            } catch {
                // removed while polling: the next poll sees it gone
                continue;
            }
            const previous = seen.get(name);
            seen.set(name, hash);
            if (hash === attempted.get(name) || hash !== previous) continue;
            if (hash === applied.get(name)) {
                // back to the registered content: nothing to reload (the marker check re-reads a moved marker)
                attempted.set(name, hash);
                issues.delete(name);
                drifted.delete(name);
                continue;
            }

            try {
                await apply(name, hash);
            } catch (error) {
                // the store failed: try again on a later poll
                attempted.delete(name);
                logger.error('agent reload failed', error, { agent: name });
            }
        }

        const tracked = new Set([...seen.keys(), ...applied.keys(), ...issues.keys()]);
        for (const name of tracked) {
            if (present.has(name)) continue;
            if (!missing.has(name)) {
                missing.add(name);
                continue;
            }

            if (!codeNames.has(name)) {
                try {
                    await engine.removeAgent(name);
                } catch (error) {
                    // still missing on the next poll: removed then
                    logger.error('agent removal failed', error, { agent: name });
                    continue;
                }
            }
            missing.delete(name);
            drifted.delete(name);
            seen.delete(name);
            attempted.delete(name);
            applied.delete(name);
            issues.delete(name);
        }

        await checkMarkers();
    };

    const arm = () => {
        if (stopped) return;
        timer = clock.setTimeout(() => {
            timer = undefined;
            inFlight = poll()
                .catch((error: unknown) => {
                    logger.error('agents dir poll failed', error);
                })
                .finally(() => {
                    inFlight = undefined;
                    arm();
                });
        }, pollMs, { keepAlive: false });
    };

    return {
        async boot() {
            const names = await listAgentFolders(root);
            for (const name of names) {
                for (let attempt = 1; ; attempt++) {
                    if (signal?.aborted) throw signal.reason;
                    let hash: string;
                    try {
                        hash = await hashAgentFolder(join(root, name));
                    } catch (error) {
                        record(name, relativize(messageOf(error), root));
                        break;
                    }
                    seen.set(name, hash);
                    if (await apply(name, hash) === 'done') break;
                    if (attempt >= BOOT_LOAD_ATTEMPTS) {
                        // the watcher loads it once it is stable
                        record(name, `${name}: changed while loading; it is loaded once it stays unchanged for one poll.`);
                        break;
                    }
                }
            }

            if (role !== 'start') return;
            if (await isEmptyDirectory(root)) {
                // an empty mount point must not remove every agent with a marker
                logger.warn(EMPTY_ROOT_MESSAGE);
                rootGone = true;
                return;
            }
            const folders = new Set(names);
            for (const marker of await engine.store.listAgentRevisions()) {
                if (folders.has(marker.agent) || codeNames.has(marker.agent)) continue;
                await engine.removeAgent(marker.agent);
            }
        },
        start() {
            if (started || stopped) return;
            started = true;
            arm();
        },
        async stop() {
            stopped = true;
            timer?.clear();
            timer = undefined;
            await inFlight;
        },
        async idle() {
            await inFlight;
        },
        conflict(name) {
            return conflicts.get(name);
        },
        issues() {
            return issues.values().toArray().map((issue) => ({ ...issue }));
        },
    };
}
