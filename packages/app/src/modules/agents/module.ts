/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { resolve } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { AppToken, ModuleName } from '../../module/constants.ts';
import {
    AGENTS_WATCHER_HOOK_NAME,
    DEFAULT_AGENTS_DIR,
    NO_AGENTS_MESSAGE,
    NO_DIRECTORY_MESSAGE,
} from './constants.ts';
import { isDirectory } from './helpers.ts';
import type { AgentCheck } from '../../module/types.ts';
import type { IAgentsWatcher } from './types.ts';
import { createAgentsWatcher } from './watcher.ts';

/**
 * The agents dir (`CHAMVI_AGENTS_DIR`, else `./agents` when that is a
 * directory; start and job mode, nothing in migrate mode). Without a dir an
 * app without code agents starts empty (a warning). With one, `setup` registers `AGENT_ISSUES` and (start mode) the watcher's
 * lifecycle hook; `onReady` loads every folder into the engine before any
 * start step runs (a folder changed while the app was down cancels its old
 * runs once; in start mode a marker without a folder removes that agent, a
 * job never removes one), and the watcher
 * polls every `CHAMVI_AGENTS_POLL_MS` from `started` until `stopping` or
 * `teardown`, awaiting a reload in flight.
 */
export class AgentsModule implements IModule {
    readonly name: string = ModuleName.AGENTS;

    readonly dependencies = [ModuleName.CONFIG, ModuleName.ENGINE];

    protected watcher: IAgentsWatcher | undefined;

    /** The agents dir this lifecycle loads, absolute; set by `setup`. */
    protected root: string | undefined;

    async setup(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);
        if (context.mode === 'migrate') {
            return;
        }

        const { dir } = container.resolve(AppToken.CONFIG).agents;
        if (dir !== undefined) {
            // checked in onReady: a dir named explicitly must exist
            this.root = resolve(process.cwd(), dir);
        } else {
            const fallback = resolve(process.cwd(), DEFAULT_AGENTS_DIR);
            this.root = await isDirectory(fallback) ? fallback : undefined;
        }
        if (this.root === undefined) {
            if (context.agents.length === 0) {
                container.resolve(AppToken.LOGGER).warn(NO_AGENTS_MESSAGE);
            }
            return;
        }

        container.register(AppToken.AGENT_ISSUES, { useValue: () => this.watcher?.issues() ?? [] });
        if (context.mode === 'start') {
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

        const watcher = createAgentsWatcher({
            root,
            engine: container.resolve(AppToken.ENGINE),
            codeNames: new Set(context.agents.map((agent) => agent.name)),
            check: createAgentCheck(container),
            clock: container.resolve(AppToken.CLOCK),
            logger: container.resolve(AppToken.LOGGER),
            pollMs: config.agents.pollMs,
            signal: context.signal,
            removeOrphans: context.mode === 'start',
        });
        this.watcher = watcher;
        await watcher.boot();
    }

    /** Resolves once the watcher's poll in flight, if any, settled. */
    async idle(): Promise<void> {
        await this.watcher?.idle();
    }

    async teardown(): Promise<void> {
        // idempotent; the issues stay readable
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
