/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Engine, InvalidAgentDefinitionError } from '@chamvi/core';
import type { IModelResolver, ModelRef } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { createModelResolver } from '../../models/resolver.ts';
import { readModelSettings } from '../../models/settings.ts';
import { AppToken, ModuleName } from '../../module/constants.ts';
import { runHooks } from '../../module/helpers.ts';
import { registerStartStep } from '../../module/start.ts';
import type { EngineModuleOptions } from './types.ts';

/**
 * Builds the `Engine` (start and job mode; nothing in migrate mode). `setup`
 * reads the model settings (env over the config file over createApp's
 * `model`/`providers`; every issue in one InvalidAgentDefinitionError) and
 * builds the model resolver; `onReady` builds the engine with the default
 * model, the resolver (which refuses an agent whose model cannot resolve) and
 * every `CHANNELS` contribution (two of one name, or a subscription of a
 * channel nobody contributed, is InvalidAgentDefinitionError),
 * registers `ENGINE`, runs the `engineCreated` hooks and, in start mode,
 * registers its start step (run once every module's `onReady` checked its
 * configuration): `engine.start()`, which starts the channels; a job starts
 * the engine without them. `teardown` drains it (which stops the channels
 * first) and runs the `drained` hooks.
 */
export class EngineModule implements IModule {
    readonly name: string = ModuleName.ENGINE;

    readonly dependencies = [ModuleName.CONFIG, ModuleName.STORE];

    protected options: EngineModuleOptions;

    protected engine: Engine | undefined;

    protected model: ModelRef | undefined;

    protected models: IModelResolver | undefined;

    constructor(options: EngineModuleOptions = {}) {
        this.options = options;
    }

    async setup(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);
        if (context.mode === 'migrate') {
            return;
        }

        const { settings, issues } = await readModelSettings({
            env: context.env,
            cwd: process.cwd(),
            ...(context.model !== undefined && { model: context.model }),
            ...(context.providers !== undefined && { providers: context.providers }),
        });
        if (issues.length > 0) {
            const lines = issues.map((issue) => `- ${issue.message}`);
            throw new InvalidAgentDefinitionError(`The model settings have ${issues.length} issue(s):\n${lines.join('\n')}`);
        }

        this.model = settings.model?.ref;
        this.models = await createModelResolver(settings, { ...(context.models !== undefined && { models: context.models }) });
    }

    async onReady(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);
        if (context.mode === 'migrate') {
            return;
        }

        const config = container.resolve(AppToken.CONFIG);
        const logger = container.resolve(AppToken.LOGGER);

        const engine = new Engine({
            store: container.resolve(AppToken.STORE),
            agents: [...context.agents],
            ...(this.model !== undefined && { model: this.model }),
            ...(this.models !== undefined && { models: this.models }),
            channels: container.resolveAll(AppToken.CHANNELS),
            maxConcurrentRuns: config.engine.maxConcurrentRuns,
            clock: container.resolve(AppToken.CLOCK),
            ...(this.options.owner !== undefined && { owner: this.options.owner }),
            ...(this.options.claimTtlMs !== undefined && { claimTtlMs: this.options.claimTtlMs }),
            onError: (error, run) => logger.error('engine error', error, { run: run?.id, agent: run?.agent }),
        });
        this.engine = engine;
        container.register(AppToken.ENGINE, { useValue: engine });

        await runHooks(container, 'engineCreated', engine);

        if (context.mode === 'start') {
            // started once every onReady checked its configuration (authenticators, routes); starts the channels
            registerStartStep(container, ModuleName.ENGINE, () => engine.start());
        }
    }

    async teardown(container: IContainer): Promise<void> {
        const { engine } = this;
        this.engine = undefined;

        if (engine) {
            // a no-op once createShutdown or runJob drained it
            await engine.drain({ timeoutMs: container.resolve(AppToken.CONFIG).http.drainTimeoutMs });
            await runHooks(container, 'drained');
        }
    }
}

export function engineModule(options?: EngineModuleOptions): IModule {
    return new EngineModule(options);
}
