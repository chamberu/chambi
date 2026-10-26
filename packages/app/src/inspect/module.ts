/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { checkAgentModel } from '@chamvi/core';
import type { Agent, ModelRef } from '@chamvi/core';
import { isObject } from 'smob';
import { readConfig } from '../config/module.ts';
import { messageOf } from '../loader/helpers.ts';
import { loadAgents } from '../loader/module.ts';
import { createModelResolver } from '../models/resolver.ts';
import { readModelSettings } from '../models/settings.ts';
import type { ModelResolver, ProviderSettings } from '../models/types.ts';
import type { AgentCheck } from '../module/types.ts';
import { NO_AGENTS_MESSAGE, NO_DIRECTORY_MESSAGE } from '../modules/agents/constants.ts';
import { isDirectory, resolveAgentsRoot } from '../modules/agents/helpers.ts';
import type {
    AgentReport,
    AppReport,
    InspectInput,
    ProviderReport,
} from './types.ts';

/** Code-point order. */
function compareNames(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

/** A model as the report shows it: the string, or `<provider>:<modelId> (object)`. */
function renderModel(model: ModelRef): string {
    if (typeof model === 'string') return model;
    const provider = isObject(model) && typeof model.provider === 'string' ? model.provider : 'unknown';
    const modelId = isObject(model) && typeof model.modelId === 'string' ? model.modelId : 'unknown';
    return `${provider}:${modelId} (object)`;
}

/** The base URL's origin and path only (never credentials, query or fragment). */
function renderBaseURL(value: string): string | undefined {
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    } catch {
        return undefined;
    }
}

function toProviderReport(provider: ProviderSettings, resolver: ModelResolver | undefined): ProviderReport {
    const baseURL = provider.baseURL === undefined ? undefined : renderBaseURL(provider.baseURL);
    const error = resolver?.errors.get(provider.name);
    return {
        name: provider.name,
        type: provider.type,
        sources: provider.sources,
        ...(baseURL !== undefined && { baseURL }),
        apiKey: provider.apiKey !== undefined,
        headers: Object.keys(provider.headers),
        ...(error !== undefined && { error }),
    };
}

/** What a start would refuse about an agent: the model (`putAgent`) and the `AGENT_CHECKS` the app's modules declare (`agentChecks()`). */
function checkAgent(
    agent: Agent,
    model: ModelRef | undefined,
    resolver: ModelResolver | undefined,
    agentChecks: readonly AgentCheck[],
): string[] {
    const checks = [
        () => checkAgentModel(agent, {
            ...(model !== undefined && { model }),
            ...(resolver !== undefined && { models: resolver }),
        }),
        ...agentChecks.map((check) => () => check(agent)),
    ];
    const errors: string[] = [];
    for (const check of checks) {
        try {
            check();
        } catch (error) {
            errors.push(messageOf(error));
        }
    }
    return errors;
}

function toAgentReport(
    agent: Agent,
    kind: AgentReport['kind'],
    model: ModelRef | undefined,
    errors: string[],
): AgentReport {
    const ref = agent.definition.model ?? model;
    return {
        name: agent.name,
        kind,
        ...(ref !== undefined && { model: renderModel(ref) }),
        errors,
    };
}

/**
 * The read-only report behind `IApp.inspect()` and `chamvi doctor`: the
 * config, the model settings and the providers resolved like the engine
 * module, the agents dir resolved like the agents module and its folders
 * loaded through `loadAgents()`, each agent checked like a start would. No
 * store, no Engine, no `putAgent`, no revision marker, no user module; every
 * problem is reported, never thrown.
 */
export async function inspectApp(input: InspectInput): Promise<AppReport> {
    const { env, cwd } = input;
    const issues: string[] = [];
    let blocked = false;
    const fail = (message: string) => {
        issues.push(message);
        blocked = true;
    };

    let dir: string | undefined;
    let configRead = false;
    try {
        dir = readConfig(env, { mode: 'start' }).agents.dir;
        configRead = true;
    } catch (error) {
        fail(messageOf(error));
    }

    const read = await readModelSettings({
        env,
        cwd,
        ...(input.model !== undefined && { model: input.model }),
        ...(input.providers !== undefined && { providers: input.providers }),
    });
    for (const issue of read.issues) {
        fail(issue.message);
    }
    const { settings } = read;
    const model = settings.model?.ref;

    let resolver: ModelResolver | undefined;
    try {
        resolver = await createModelResolver(settings, { ...(input.models !== undefined && { models: input.models }) });
    } catch (error) {
        fail(messageOf(error));
    }
    if (typeof model === 'string' && resolver) {
        try {
            resolver.check(model);
        } catch (error) {
            fail(messageOf(error));
        }
    }

    const agents: AgentReport[] = input.agents.map((agent) => toAgentReport(agent, 'code', model, checkAgent(agent, model, resolver, input.checks)));

    if (configRead) {
        const root = await resolveAgentsRoot(dir, cwd);
        if (root === undefined) {
            if (input.agents.length === 0) issues.push(NO_AGENTS_MESSAGE);
        } else if (!await isDirectory(root)) {
            fail(NO_DIRECTORY_MESSAGE);
        } else {
            const codeNames = new Set(input.agents.map((agent) => agent.name));
            const loaded = await loadAgents(root);
            const folders: AgentReport[] = [
                ...loaded.agents.map(({ agent }) => toAgentReport(
                    agent,
                    'folder',
                    model,
                    codeNames.has(agent.name) ?
                        [`${agent.name}: a code agent has this name; the folder is not loaded.`] :
                        checkAgent(agent, model, resolver, input.checks),
                )),
                ...loaded.issues.map((issue): AgentReport => ({
                    name: issue.agent,
                    kind: 'folder',
                    errors: [issue.message],
                })),
            ];
            folders.sort((a, b) => compareNames(a.name, b.name));
            agents.push(...folders);
        }
    }

    const report: AppReport = {
        ok: !blocked && agents.every((agent) => agent.errors.length === 0),
        ...(settings.configFile !== undefined && { configFile: settings.configFile }),
        ...(settings.model !== undefined && { model: { ref: renderModel(settings.model.ref), source: settings.model.source } }),
        models: Object.keys(input.models ?? {}),
        providers: settings.providers.values().toArray().map((provider) => toProviderReport(provider, resolver)),
        agents,
        issues,
    };
    return report;
}
