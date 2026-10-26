/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, InvalidRunStateError } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { AppToken, ModuleName } from '../../module/constants.ts';
import {
    AGENTS_WATCHER_HOOK_NAME,
    AGENT_RELOADED_MESSAGE,
    AGENT_REMOVED_MESSAGE,
    HASH_PREFIX_LENGTH,
    NO_AGENTS_MESSAGE,
    NO_DIRECTORY_MESSAGE,
} from './constants.ts';
import { isDirectory, resolveAgentsRoot } from './helpers.ts';
import type { AgentCheck } from '../../module/types.ts';
import type { AgentsWatcherRole, IAgentsWatcher } from './types.ts';
import { createAgentsWatcher } from './watcher.ts';

/**
 * The agents dir (`CHAMVI_AGENTS_DIR`, else `./agents` when that is a
 * directory; start and job mode, nothing in migrate mode). Without a dir an
 * app without code agents starts empty (a warning). With one, `setup` registers `AGENT_ISSUES` and (start mode) the watcher's
 * lifecycle hook; `onReady` loads every folder into the engine before any
 * start step runs (a folder changed while the app was down cancels its old
 * runs once, logged `agent reloaded`/`agent removed` with the cancelled run
 * ids; in start mode a marker without a folder removes that agent), and the
 * watcher polls every `CHAMVI_AGENTS_POLL_MS` from `started` until
 * `stopping` or `teardown`, awaiting a reload in flight. A job never cancels:
 * a revision conflict of the job's own agent fails the job
 * (InvalidRunStateError), another agent's is an issue. A check
 * (`context.check`) only loads and checks, writing nothing.
 */
export class AgentsModule implements IModule {
    readonly name: string = ModuleName.AGENTS;

    readonly dependencies = [ModuleName.CONFIG, ModuleName.ENGINE];

    protected watcher: IAgentsWatcher | undefined;

    /** Ends the `agents.cancelled` subscription (start and job mode). */
    protected unsubscribe: (() => void) | undefined;

    /** The agents dir this lifecycle loads, absolute; set by `setup`. */
    protected root: string | undefined;

    async setup(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);
        if (context.mode === 'migrate') {
            return;
        }

        const { dir } = container.resolve(AppToken.CONFIG).agents;
        // a dir named explicitly must exist, checked in onReady
        this.root = await resolveAgentsRoot(dir, process.cwd());
        if (this.root === undefined) {
            if (context.agents.length === 0) {
                container.resolve(AppToken.LOGGER).warn(NO_AGENTS_MESSAGE);
            }
            return;
        }

        container.register(AppToken.AGENT_ISSUES, { useValue: () => this.watcher?.issues() ?? [] });
        if (context.mode === 'start' && !context.check) {
            container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                useValue: {
                    name: AGENTS_WATCHER_HOOK_NAME,
                    started: () => this.watcher?.start(),
                    stopping: () => this.watcher?.stop(),
                },
            });
        }
    }

    async onReady(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);
        const config = container.resolve(AppToken.CONFIG);
        const { root } = this;
        if (context.mode === 'migrate' || root === undefined) {
            return;
        }

        if (!await isDirectory(root)) {
            throw new InvalidAgentDefinitionError(NO_DIRECTORY_MESSAGE);
        }

        const engine = container.resolve(AppToken.ENGINE);
        const logger = container.resolve(AppToken.LOGGER);
        if (!context.check) {
            // before the boot: a folder changed while the app was down is logged too
            this.unsubscribe = engine.on('agents.cancelled', (event) => {
                logger.info(event.reason === 'agent_removed' ? AGENT_REMOVED_MESSAGE : AGENT_RELOADED_MESSAGE, {
                    agent: event.name,
                    ...(event.revision !== undefined && { revision: event.revision.slice(0, HASH_PREFIX_LENGTH) }),
                    cancelled: event.runIds,
                });
            });
        }

        let role: AgentsWatcherRole = 'start';
        if (context.check) role = 'check';
        else if (context.mode === 'job') role = 'job';
        const watcher = createAgentsWatcher({
            root,
            engine,
            codeNames: new Set(context.agents.map((agent) => agent.name)),
            check: createAgentCheck(container),
            clock: container.resolve(AppToken.CLOCK),
            logger,
            pollMs: config.agents.pollMs,
            signal: context.signal,
            role,
        });
        this.watcher = watcher;
        await watcher.boot();
        const conflict = context.job ? watcher.conflict(context.job.agent) : undefined;
        if (conflict !== undefined) {
            throw new InvalidRunStateError(conflict);
        }
    }

    /** Resolves once the watcher's poll in flight, if any, settled. */
    async idle(): Promise<void> {
        await this.watcher?.idle();
    }

    async teardown(): Promise<void> {
        // idempotent; the issues stay readable
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        await this.watcher?.stop();
    }
}

/** Every module's `AGENT_CHECKS` contribution (the model is checked by `putAgent`, which refuses before any store write). */
function createAgentCheck(container: IContainer): AgentCheck {
    const checks = container.resolveAll(AppToken.AGENT_CHECKS);
    return (agent) => {
        for (const check of checks) check(agent);
    };
}

export function agentsModule(): IModule {
    return new AgentsModule();
}
