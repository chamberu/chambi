/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { AppToken, envOneOf, envString } from '@chamvi/app';
import type { AppContext, IContainer, IModule } from '@chamvi/app';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { Engine } from '@chamvi/core';
import { isObject } from 'smob';
import { provideSandboxContext } from '../context/module.ts';
import { isTerminal } from '../manager/helpers.ts';
import { createWorkspaceManager } from '../manager/module.ts';
import type { IWorkspaceManager } from '../manager/types.ts';
import { DEFAULT_SANDBOX_IMAGE } from '../provider/constants.ts';
import type { ISandboxProvider } from '../provider/types.ts';
import {
    SANDBOX_MODULE_NAME,
    SANDBOX_PROVIDER_IDS,
    SANDBOX_PROVIDER_NAMES,
    SANDBOX_PROVIDER_PACKAGES,
} from './constants.ts';
import { isPackageNotFound, loadPackage } from './helpers.ts';
import { createLazyProvider } from './provider.ts';
import type {
    DockerProviderPackage,
    KubernetesProviderPackage,
    LazyProvider,
    LocalProviderPackage,
    SandboxModuleOptions,
    SandboxProviderName,
} from './types.ts';

/**
 * Run-scoped workspaces (`.manager`, built when the factory is called). In
 * start and job mode `setup` loads the provider package and contributes the
 * lifecycle hook that attaches the manager to the engine and closes it after
 * the engine drained; migrate mode does nothing.
 */
export class SandboxModule implements IModule {
    readonly name: string = SANDBOX_MODULE_NAME;

    readonly manager: IWorkspaceManager;

    protected lazy: LazyProvider | undefined;

    protected report: AppContext['report'] | undefined;

    /** Set in `engineCreated`: answers `isSettled` for the garbage collection. */
    protected engine: Engine | undefined;

    constructor(options: SandboxModuleOptions = {}) {
        const {
            provider,
            manager,
            namespace,
            image,
            workspaceEnv,
            env: input,
            ...managerOptions
        } = options;

        if (manager) {
            this.manager = manager;
            return;
        }

        const env = input ?? process.env;
        const deployment = envString(env, 'CHAMVI_DEPLOYMENT') ?? managerOptions.deployment;
        const name = envOneOf(env, 'CHAMVI_SANDBOX_PROVIDER', SANDBOX_PROVIDER_NAMES) ??
            (typeof provider === 'string' ? provider : undefined);

        let target: ISandboxProvider;
        if (typeof name === 'undefined' && isObject(provider)) {
            target = provider;
        } else {
            const selected = name ?? 'local';
            const resolved = {
                image: envString(env, 'CHAMVI_SANDBOX_IMAGE') ?? image ?? DEFAULT_SANDBOX_IMAGE,
                namespace: envString(env, 'CHAMVI_SANDBOX_NAMESPACE') ?? namespace,
            };
            if (selected === 'kubernetes' && !resolved.namespace) {
                throw new InvalidAgentDefinitionError('CHAMVI_SANDBOX_NAMESPACE is required for CHAMVI_SANDBOX_PROVIDER=kubernetes.');
            }
            this.lazy = createLazyProvider(
                SANDBOX_PROVIDER_IDS[selected],
                () => this.loadProvider(selected, resolved),
            );
            target = this.lazy;
        }

        try {
            this.manager = createWorkspaceManager({
                ...managerOptions,
                provider: target,
                ...(workspaceEnv && { env: workspaceEnv }),
                ...(deployment !== undefined && { deployment }),
                isSettled: managerOptions.isSettled ?? ((runId) => this.isSettled(runId)),
                onError: managerOptions.onError ?? ((error) => this.reportError(error)),
            });
        } catch (error) {
            // name the variable, never echo its value
            if (envString(env, 'CHAMVI_DEPLOYMENT') !== undefined && error instanceof InvalidAgentDefinitionError && /deployment/.test(error.message)) {
                throw new InvalidAgentDefinitionError(`CHAMVI_DEPLOYMENT ${error.message.replace(/^deployment /, '')}`);
            }
            throw error;
        }
    }

    async setup(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);
        if (context.mode === 'migrate') {
            return;
        }

        this.report = context.report;
        await this.lazy?.load();

        let detach: (() => void) | undefined;
        container.registerMany(AppToken.LIFECYCLE_HOOKS, {
            useValue: {
                name: SANDBOX_MODULE_NAME,
                engineCreated: (engine: Engine) => {
                    this.engine = engine;
                    detach = this.manager.attach(engine);
                    provideSandboxContext(engine, this.manager);
                },
                drained: async () => {
                    detach?.();
                    detach = undefined;
                    await this.manager.close();
                },
            },
        });
    }

    /** Imports the provider package and builds the provider; a test seam. */
    protected async importProvider(
        name: SandboxProviderName,
        options: { image: string; namespace?: string },
    ): Promise<ISandboxProvider> {
        const specifier = SANDBOX_PROVIDER_PACKAGES[name];
        switch (name) {
            case 'docker': {
                const { createDockerSandbox } = await loadPackage<DockerProviderPackage>(specifier);
                return createDockerSandbox({ image: options.image });
            }
            case 'kubernetes': {
                const { createKubernetesSandbox } = await loadPackage<KubernetesProviderPackage>(specifier);
                return createKubernetesSandbox({ namespace: options.namespace!, image: options.image });
            }
            default: {
                const { createLocalSandbox } = await loadPackage<LocalProviderPackage>(specifier);
                return createLocalSandbox();
            }
        }
    }

    protected async loadProvider(
        name: SandboxProviderName,
        options: { image: string; namespace?: string },
    ): Promise<ISandboxProvider> {
        try {
            return await this.importProvider(name, options);
        } catch (error) {
            // only the provider package itself, not a module it imports (dockerode, @kubernetes/client-node)
            if (isPackageNotFound(error, SANDBOX_PROVIDER_PACKAGES[name])) {
                throw new InvalidAgentDefinitionError(`CHAMVI_SANDBOX_PROVIDER=${name} needs ${SANDBOX_PROVIDER_PACKAGES[name]} installed.`);
            }
            throw error;
        }
    }

    /** A run that no longer exists or settled; false before the engine exists. */
    protected async isSettled(runId: string): Promise<boolean> {
        if (!this.engine) return false;
        const run = await this.engine.getRun(runId);
        return !run || isTerminal(run.status);
    }

    protected reportError(error: unknown): void {
        if (this.report) {
            this.report(error, { module: SANDBOX_MODULE_NAME });
            return;
        }
        // eslint-disable-next-line no-console
        console.error('[chamvi]', error);
    }
}

/**
 * The sandbox module. The provider is `CHAMVI_SANDBOX_PROVIDER` (`local`,
 * `docker`, `kubernetes`), else `options.provider`, else `local`, read from
 * `options.env ?? process.env` now; its package is imported in `setup`.
 */
export function sandboxModule(options?: SandboxModuleOptions): SandboxModule {
    return new SandboxModule(options);
}
