/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    AppToken,
    envJson,
    envOneOf,
    envString,
} from '@chamvi/app';
import type {
    AppContext,
    Env,
    GitCredentialSource,
    IContainer,
    IModule,
} from '@chamvi/app';
import { InvalidAgentDefinitionError, MemoryRunRepository } from '@chamvi/core';
import type { IClock, IEngine } from '@chamvi/core';
import { isObject } from 'smob';
import { provideSandboxContext } from '../context/module.ts';
import { staticGitCredentials } from '../credentials/module.ts';
import type { IGitCredentials, StaticGitCredential } from '../credentials/types.ts';
import { isTerminal } from '../manager/helpers.ts';
import { GC_INTERVAL_MS } from '../manager/constants.ts';
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
import { isPackageNotFound, loadPackage, readImageAllowList } from './helpers.ts';
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
 * lifecycle hook that attaches the manager to the engine (in start mode also
 * starting the garbage collector on the engine's clock, every
 * `gcIntervalMs`) and closes it after the engine drained (the collector
 * stopped first; disposing the held workspaces too when the engine uses
 * a memory store, whose runs no restart resumes); migrate mode does nothing.
 */
export class SandboxModule implements IModule {
    readonly name: string = SANDBOX_MODULE_NAME;

    readonly manager: IWorkspaceManager;

    protected lazy: LazyProvider | undefined;

    protected report: AppContext['report'] | undefined;

    /** Set in `engineCreated`: answers `isSettled` for the garbage collection. */
    protected engine: IEngine | undefined;

    /**
     * True when the deployment was named (`CHAMVI_DEPLOYMENT` or the option):
     * only then is a run this engine does not know settled, since several
     * apps share the default deployment on one host.
     */
    protected ownsDeployment = false;

    /** Interval of the start-mode collector (`gcIntervalMs` or `GC_INTERVAL_MS`); 0 runs none. */
    protected gcIntervalMs: number = GC_INTERVAL_MS;

    /** The armed collector timer, while one runs. */
    protected collector: { clear(): void } | undefined;

    /** Set by `stopCollector`: a collection in flight arms no further timer. */
    protected collectorStopped = false;

    /** The collection the timer started, while it runs; `drained` waits for it. */
    protected collecting: Promise<void> | undefined;

    /** The sources other modules contribute to `AppToken.GIT_CREDENTIALS`, readable once `setup` ran. */
    protected contributed: () => readonly GitCredentialSource[] = () => [];

    /**
     * The manager's sources: the `credentials` option, the tokens of
     * `CHAMVI_GIT_TOKENS`, then the contributed ones (asked on each lookup,
     * so modules set up after this one count too).
     */
    protected credentialSources(env: Env, credentials: SandboxModuleOptions['credentials']): IGitCredentials[] {
        const sources = credentials === undefined ? [] : [credentials].flat();
        const tokens = envJson(env, 'CHAMVI_GIT_TOKENS');

        if (tokens !== undefined) {
            try {
                sources.push(staticGitCredentials(tokens as StaticGitCredential[]));
            } catch (error) {
                // the message names an entry and a rule, never a token
                const message = Error.isError(error) ? error.message.replace(/^staticGitCredentials\(\) ?/, '') : 'is invalid';
                throw new InvalidAgentDefinitionError(`CHAMVI_GIT_TOKENS ${message}`);
            }
        }

        sources.push({
            get: async (input) => {
                for (const source of this.contributed()) {
                    const answer = await source.get(input);

                    if (answer) {
                        return answer;
                    }
                }

                return undefined;
            },
        });

        return sources;
    }

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

        this.gcIntervalMs = managerOptions.gcIntervalMs ?? GC_INTERVAL_MS;

        const env = input ?? process.env;

        if (envString(env, 'CHAMVI_GIT_CREDENTIAL_MODE') !== undefined) {
            // removed in 0.4: ignoring it would hand bash the write token a `tools` deployment kept out
            throw new InvalidAgentDefinitionError('CHAMVI_GIT_CREDENTIAL_MODE was removed in 0.4: workspace-installed credentials are the only mode; unset it (see the upgrade guide).');
        }

        if ('credentialMode' in options) {
            throw new InvalidAgentDefinitionError('credentialMode was removed in 0.4: workspace-installed credentials are the only mode; drop the option (see the upgrade guide).');
        }

        if (manager) {
            this.manager = manager;

            return;
        }

        const deployment = envString(env, 'CHAMVI_DEPLOYMENT') ?? managerOptions.deployment;

        this.ownsDeployment = deployment !== undefined;

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

        const credentials = this.credentialSources(env, managerOptions.credentials);
        const allowImage = readImageAllowList(env) ?? managerOptions.allowImage;

        try {
            this.manager = createWorkspaceManager({
                ...managerOptions,
                credentials,
                provider: target,
                ...(allowImage && { allowImage }),
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
        // after every module's setup: the sources other modules contributed (githubModule()'s App)
        this.contributed = () => container.resolveAll(AppToken.GIT_CREDENTIALS);

        let detach: (() => void) | undefined;

        container.registerMany(AppToken.LIFECYCLE_HOOKS, {
            useValue: {
                name: SANDBOX_MODULE_NAME,
                engineCreated: (engine: IEngine) => {
                    this.engine = engine;
                    detach = this.manager.attach(engine);
                    provideSandboxContext(engine, this.manager);

                    // a job is short: only a long-lived process collects on a timer
                    if (context.mode === 'start') {
                        this.startCollector(engine.clock);
                    }
                },
                drained: async () => {
                    this.stopCollector();
                    // a collection in flight still reads the store and removes
                    // workspaces: it must settle before the store closes
                    await this.collecting;
                    detach?.();
                    detach = undefined;
                    // no run of a memory store resumes after this process: its
                    // workspaces would only wait for maxLifetimeMs
                    await this.manager.close({ dispose: this.engine?.store.runs instanceof MemoryRunRepository });
                },
            },
        });
    }

    /**
     * Collects expired workspaces and those of settled runs every
     * `gcIntervalMs` on `clock` (not keeping the process alive), each timer
     * armed once the previous collection settled; a failed collection is
     * reported and the next one still runs. None for an interval of 0.
     */
    protected startCollector(clock: IClock): void {
        if (this.gcIntervalMs === 0) {
            return;
        }

        this.collectorStopped = false;

        const arm = (): void => {
            this.collector = clock.setTimeout(() => {
                this.collector = undefined;

                const collecting = this.manager.collectGarbage()
                    .then(() => undefined, (error: unknown) => this.reportError(error))
                    .finally(() => {
                        if (this.collecting === collecting) {
                            this.collecting = undefined;
                        }

                        if (!this.collectorStopped) {
                            arm();
                        }
                    });

                this.collecting = collecting;
            }, this.gcIntervalMs);
        };

        arm();
    }

    /** Clears the collector timer; a collection in flight arms no further one (`drained` awaits it). */
    protected stopCollector(): void {
        this.collectorStopped = true;
        this.collector?.clear();
        this.collector = undefined;
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

    /**
     * A settled run, or with a named deployment also one that no longer
     * exists: in the default deployment an unknown run may be another app's
     * on the same host, so its workspaces stay until `maxLifetimeMs`. False
     * before the engine exists.
     */
    protected async isSettled(runId: string): Promise<boolean> {
        if (!this.engine) {
            return false;
        }

        const run = await this.engine.getRun(runId);

        if (!run) {
            return this.ownsDeployment;
        }

        return isTerminal(run.status);
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
