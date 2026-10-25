/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent, ModelRef } from '@chamvi/core';
import type { Env } from '../env/types.ts';
import type {
    ModelProviders,
    ProviderConfig,
    ProviderSettings,
    ProviderType,
    SettingSource,
} from '../models/types.ts';

/** A provider as the report shows it: no secret, only where each field came from. */
export type ProviderReport = {
    name: string;
    type: ProviderType;
    sources: ProviderSettings['sources'];
    /** Origin and path of the base URL, when one is set. */
    baseURL?: string;
    /** Whether an API key is set. */
    apiKey: boolean;
    /** Header names, never values. */
    headers: string[];
    /** Why the provider could not be built (a package that is not installed). */
    error?: string;
};

/** An agent as the report shows it. */
export type AgentReport = {
    name: string;
    kind: 'code' | 'folder';
    /** The agent's model, else the default; an object as `<provider>:<modelId> (object)`. */
    model?: string;
    /** Why a start would refuse or skip the agent. */
    errors: string[];
};

/** What `IApp.inspect()` returns. */
export type AppReport = {
    /** Whether a start would resolve every setting and register every agent. */
    ok: boolean;
    /** The config file read (absolute), when one was. */
    configFile?: string;
    model?: { ref: string; source: SettingSource };
    /** The ids of createApp's `models`. */
    models: string[];
    providers: ProviderReport[];
    agents: AgentReport[];
    /** Settings and config problems, and warnings (an app without agents). */
    issues: string[];
};

/** inspectApp's input: what the App holds and the lifecycle env. */
export type InspectInput = {
    env: Env;
    cwd: string;
    agents: readonly Agent[];
    model?: ModelRef;
    providers?: Record<string, ProviderConfig>;
    models?: ModelProviders;
};
