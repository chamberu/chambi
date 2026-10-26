/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { AppReport, Env, ProviderReport } from '@chamvi/app';
import { isRecord } from '../run/helpers.ts';
import { CLI_PACKAGE_NAME } from './constants.ts';

/**
 * The CLI's version: the nearest package.json named @chamvi/cli above this
 * file (src/commands in the sources, dist in the build).
 */
export function readVersion(from: string = fileURLToPath(import.meta.url)): string | undefined {
    let dir = path.dirname(from);
    for (;;) {
        try {
            const manifest: unknown = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
            if (isRecord(manifest) && manifest.name === CLI_PACKAGE_NAME && typeof manifest.version === 'string') {
                return manifest.version;
            }
        } catch {
            // no (readable) package.json here
        }

        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/**
 * Copies the keys of `<cwd>/.env` that `env` lacks (unset or empty) into
 * `env`, in place, so module factories reading `process.env` at the entry
 * import see them; never overrides a set variable. A missing file is fine.
 */
export async function loadDotEnv(env: Env, file: string): Promise<void> {
    let text: string;
    try {
        text = await readFile(file, 'utf8');
    } catch {
        return;
    }

    for (const [key, value] of Object.entries(parseEnv(text))) {
        const current = env[key];
        if (typeof current !== 'string' || current.length === 0) {
            env[key] = value;
        }
    }
}

function renderProvider(provider: ProviderReport): string {
    const { sources } = provider;
    const parts = [`type ${provider.type} (${sources.type})`];
    parts.push(provider.apiKey ? `api key set (${sources.apiKey ?? 'unknown'})` : 'no api key');
    if (provider.baseURL !== undefined) {
        parts.push(`base URL ${provider.baseURL}`);
    }
    if (provider.headers.length > 0) {
        const headers = provider.headers.map((name) => {
            const source = sources.headers[name];
            return source === undefined ? name : `${name} (${source})`;
        });
        parts.push(`headers ${headers.join(', ')}`);
    }
    const line = `  ${provider.name}: ${parts.join(', ')}`;
    return provider.error === undefined ? line : `${line}\n    error: ${provider.error}`;
}

/**
 * The `chamvi doctor` text of an inspect report: the default model, a line
 * per provider and per agent (its errors below it), then the issues. The
 * report holds no secret, so neither does the text.
 */
export function renderReport(report: AppReport): string {
    const lines: string[] = [];
    if (report.configFile !== undefined) {
        lines.push(`config file: ${report.configFile}`);
    }
    lines.push(report.model === undefined ?
        'default model: none' :
        `default model: ${report.model.ref} (${report.model.source})`);
    if (report.models.length > 0) {
        lines.push(`models: ${report.models.join(', ')}`);
    }

    lines.push('', 'providers:');
    if (report.providers.length === 0) {
        lines.push('  none');
    }
    for (const provider of report.providers) {
        lines.push(renderProvider(provider));
    }

    lines.push('', 'agents:');
    if (report.agents.length === 0) {
        lines.push('  none');
    }
    for (const agent of report.agents) {
        const status = agent.errors.length === 0 ? 'ok' : 'error';
        lines.push(`  ${agent.name} (${agent.kind}): ${agent.model ?? 'no model'}, ${status}`);
        for (const error of agent.errors) {
            lines.push(`    - ${error}`);
        }
    }

    if (report.issues.length > 0) {
        lines.push('', 'issues:');
        for (const issue of report.issues) {
            lines.push(`  - ${issue}`);
        }
    }

    lines.push('', report.ok ? 'ok: a start would succeed' : 'not ok: a start would refuse or skip what is listed above');
    return `${lines.join('\n')}\n`;
}
