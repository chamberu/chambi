/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
    basename,
    dirname,
    join,
    relative,
    sep,
} from 'node:path';
import type { Agent, AgentDefinition } from '@chamvi/core';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import { locateMany } from 'locter';
import { isObject } from 'smob';
import {
    AGENT_FILE,
    AGENT_NAME_MAX_LENGTH,
    AGENT_NAME_PATTERN,
    NODE_MODULES_DIR,
    SCRIPT_EXTENSIONS,
} from './constants.ts';
import {
    compareCodePoints,
    defaultExportOf,
    isDirectory,
    isFile,
    isHashIgnored,
    messageOf,
    readFreshModule,
    relativize,
} from './helpers.ts';
import type {
    AgentLoadIssue,
    LoadAgentOptions,
    LoadAgentsResult,
    LoadedAgent,
} from './types.ts';

const requireCache = createRequire(import.meta.url).cache;

/**
 * Loads one agent folder (`dir`, whose name is the agent's): its `agent.ts`,
 * default-exporting `defineAgent()`'s result named like the folder. The rest
 * of the folder is the agent's own: `agent.ts` imports or reads it. Every failure is an InvalidAgentDefinitionError naming the
 * file relative to the agents dir (the folder's parent), also a folder whose
 * content changed while it was read.
 */
export async function loadAgent(dir: string, options: LoadAgentOptions = {}): Promise<LoadedAgent> {
    const base = dirname(dir);
    try {
        await assertNoNodeModules(dir);
        await assertNoScripts(dir);
        // Hashed before and after the read: a read that straddles an edit is
        // refused, so the returned hash always names the content that was read.
        const hash = await hashAgentFolder(dir);
        const load = options.load ?? readFreshModule;
        const agent = await buildAgent(dir, async (path) => {
            try {
                return await load(path);
            } finally {
                forgetRequired(dir);
            }
        });
        if (await hashAgentFolder(dir) !== hash) {
            throw new InvalidAgentDefinitionError(`${basename(dir)}: changed while loading; load it again.`);
        }
        return {
            agent,
            hash,
            dir,
        };
    } catch (error) {
        if (error instanceof InvalidAgentDefinitionError) {
            const message = relativize(error.message, base);
            throw message === error.message ? error : new InvalidAgentDefinitionError(message);
        }
        throw new InvalidAgentDefinitionError(relativize(`${basename(dir)}: ${messageOf(error)}`, base));
    }
}

/**
 * Loads every agent folder of `root` (`listAgentFolders`), by name; a
 * folder that does not load is an issue, never a throw.
 */
export async function loadAgents(root: string, options: LoadAgentOptions = {}): Promise<LoadAgentsResult> {
    const agents: LoadedAgent[] = [];
    const issues: AgentLoadIssue[] = [];
    for (const name of await listAgentFolders(root)) {
        try {
            agents.push(await loadAgent(join(root, name), options));
        } catch (error) {
            issues.push({ agent: name, message: relativize(messageOf(error), root) });
        }
    }
    return { agents, issues };
}

/** The names of the direct subfolders of `root` not starting with `.` or `_` (and not `node_modules`), in code-point order. */
export async function listAgentFolders(root: string): Promise<string[]> {
    const found = await locateMany('*', { cwd: root, onlyDirectories: true });
    return found
        .map((info) => basename(info.path))
        .filter((name) => !name.startsWith('.') && !name.startsWith('_') && name !== NODE_MODULES_DIR)
        .sort(compareCodePoints);
}

/**
 * Refuses a `node_modules` folder in the agent folder or the agents dir: a
 * package installed there would load as a second copy next to the app's
 * (a second `@chamvi/core` breaks tools, `inject()` and `instanceof`).
 */
async function assertNoNodeModules(dir: string): Promise<void> {
    for (const [where, path] of [[basename(dir), dir], ['the agents dir', dirname(dir)]] as const) {
        if (await isDirectory(join(path, NODE_MODULES_DIR))) {
            throw new InvalidAgentDefinitionError(
                `${basename(dir)}: ${where} holds a node_modules folder; packages resolve from the app, install them there.`,
            );
        }
    }
}

/**
 * Refuses a JavaScript file (`.js`, `.mjs`, `.cjs`) anywhere in the folder:
 * Node caches a natively imported JavaScript file for the life of the
 * process, so a reload would not see an edit of it. Helpers are `.ts` or
 * `.mts`, which the loader transpiles fresh on every load.
 */
async function assertNoScripts(dir: string): Promise<void> {
    const found = await locateMany(`**/*{${SCRIPT_EXTENSIONS.join(',')}}`, {
        cwd: dir,
        onlyFiles: true,
        dot: false,
    });
    const scripts = found
        .map((info) => relative(dir, info.path).split(sep).join('/'))
        .sort(compareCodePoints);
    if (scripts.length > 0) {
        throw new InvalidAgentDefinitionError(
            `${basename(dir)}/${scripts[0]}: a JavaScript file is not reloaded fresh; write helpers as .ts or .mts.`,
        );
    }
}

/** Drops the CommonJS cache entries below `dir` (a required `.json` file), so the next load reads them again. */
function forgetRequired(dir: string): void {
    const prefixes = [`${dir}${sep}`];
    try {
        prefixes.push(`${realpathSync(dir)}${sep}`);
    } catch {
        // gone meanwhile
    }
    for (const key of Object.keys(requireCache)) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) delete requireCache[key];
    }
}

/**
 * The folder's content hash: sha256 (hex) over every file below `dir`
 * (dot-entries and the docs and editor leftovers of HASH_IGNORE_PATTERNS
 * skipped, never a file the loader can import) by relative POSIX path, each
 * as `path + '\0' + bytes + '\0'`.
 */
export async function hashAgentFolder(dir: string): Promise<string> {
    const found = await locateMany('**/*', {
        cwd: dir, 
        onlyFiles: true, 
        dot: false, 
    });
    const files = found
        .map((info) => ({ path: info.path, key: relative(dir, info.path).split(sep).join('/') }))
        .filter((file) => !isHashIgnored(file.key))
        .sort((a, b) => compareCodePoints(a.key, b.key));
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(`${file.key}\0`);
        hash.update(await readFile(file.path));
        hash.update('\0');
    }
    return hash.digest('hex');
}

async function buildAgent(dir: string, load: (path: string) => Promise<unknown>): Promise<Agent> {
    const name = basename(dir);
    if (name.length > AGENT_NAME_MAX_LENGTH || !AGENT_NAME_PATTERN.test(name)) {
        throw new InvalidAgentDefinitionError(
            `${name}: the folder name is no agent name (must match ${AGENT_NAME_PATTERN} and be at most ${AGENT_NAME_MAX_LENGTH} characters).`,
        );
    }
    const agentFile = join(dir, AGENT_FILE);
    const rel = `${name}/${AGENT_FILE}`;
    if (!await isFile(agentFile)) {
        throw new InvalidAgentDefinitionError(`${name}: has no ${AGENT_FILE}.`);
    }
    let mod: unknown;
    try {
        mod = await load(agentFile);
    } catch (error) {
        throw new InvalidAgentDefinitionError(`${rel}: ${messageOf(error)}`);
    }
    const declared = defaultExportOf(mod, rel);
    // structural, so an agent built by another @chamvi/core copy passes too
    if (!isObject(declared) || typeof declared.name !== 'string' || !isObject(declared.definition)) {
        throw new InvalidAgentDefinitionError(`${rel}: the default export must be defineAgent(...)'s result.`);
    }
    if (declared.name !== name) {
        throw new InvalidAgentDefinitionError(
            `${rel}: defineAgent names "${declared.name}", but the folder is "${name}"; the names must match.`,
        );
    }
    // through this copy of defineAgent, so its checks and budget defaults apply
    return defineAgent({ ...declared.definition, name } as AgentDefinition);
}
