/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ValidationError } from '@chamvi/core';
import { requestError } from '../request/asserts.ts';
import {
    assertName,
    compareSemver,
    obj,
    str,
    versionDetail,
} from './asserts.ts';
import type { PackageDependency, PackageVersion, RegistryAdapter } from './types.ts';

const MODULE = /^[A-Za-z0-9.~_-]+(?:\/[A-Za-z0-9.~_+-]+)*$/;

/** The proxy's case encoding: an upper-case letter becomes `!` and its lower case. */
function escapePath(path: string): string {
    return path.replace(/[A-Z]/g, (letter) => `!${letter.toLowerCase()}`);
}

type GoMod = {
    dependencies: PackageDependency[];
    engines: Record<string, string>;
    deprecated: string | null;
};

/** The requires, `go`/`toolchain` lines and the `// Deprecated:` comment of a go.mod. */
export function parseGoMod(text: string): GoMod {
    const dependencies: PackageDependency[] = [];
    const engines: Record<string, string> = {};
    let deprecated: string | null = null;
    let comment: string[] = [];
    let inRequire = false;
    const addRequire = (line: string) => {
        const match = /^(\S+)\s+(\S+)(.*)$/.exec(line);
        if (!match?.[1] || !match[2]) return;
        const indirect = /\/\/\s*indirect/.test(match[3] ?? '');
        dependencies.push({
            name: match[1], 
            requirement: indirect ? `${match[2]} (indirect)` : match[2], 
            kind: 'runtime', 
        });
    };
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (inRequire) {
            if (line === ')') inRequire = false;
            else if (line && !line.startsWith('//')) addRequire(line);
            continue;
        }
        if (line.startsWith('//')) {
            comment.push(line.slice(2).trim());
            continue;
        }
        if (line.startsWith('module ')) {
            const notes = [...comment, line.split('//')[1]?.trim() ?? ''];
            const note = notes.find((item) => item.startsWith('Deprecated:'));
            if (note) deprecated = note.slice('Deprecated:'.length).trim();
        } else if (line.startsWith('go ')) {
            engines.go = line.slice(3).trim();
        } else if (line.startsWith('toolchain ')) {
            engines.toolchain = line.slice(10).trim();
        } else if (line === 'require (') {
            inRequire = true;
        } else if (line.startsWith('require ')) {
            addRequire(line.slice(8).trim());
        }
        comment = [];
    }
    return {
        dependencies, 
        engines, 
        deprecated, 
    };
}

/** A browsable repository for the common hosts, by module path. */
function repositoryOf(module: string): string | null {
    const match = /^((?:github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+)/.exec(module);
    return match?.[1] ? `https://${match[1]}` : null;
}

/** The Go module proxy: the version list, `@latest`, and the version's `.info` and `.mod`. */
export const goRegistry: RegistryAdapter = async (ctx, name, version) => {
    assertName(name, MODULE, 'Go module path', 500);
    if (!name.split('/')[0]!.includes('.')) {
        throw new ValidationError(`${JSON.stringify(name)} is no module path the proxy serves: it starts with a domain, e.g. github.com/owner/repo.`);
    }
    const base = `/${escapePath(name)}`;
    const list = await ctx.getText(`${base}/@v/list`);
    if (list === undefined) throw requestError(`go has no package ${name}.`);
    const latestInfo = obj(await ctx.getJson(`${base}/@latest`));
    const latest = str(latestInfo.Version);

    const numbers = list.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    if (latest !== null && !numbers.includes(latest)) numbers.push(latest);
    const times = new Map<string, string>();
    if (latest !== null && str(latestInfo.Time)) times.set(latest, latestInfo.Time as string);

    const target = version ?? latest;
    let detail = null;
    if (target !== null) {
        const info = obj(await ctx.getJson(`${base}/@v/${escapePath(target)}.info`));
        const mod = await ctx.getText(`${base}/@v/${escapePath(target)}.mod`);
        if (Object.keys(info).length === 0 || mod === undefined) throw requestError(`go has no version ${target} of ${name}.`);
        if (str(info.Time)) times.set(target, info.Time as string);
        const parsed = parseGoMod(mod);
        detail = versionDetail({
            version: target,
            publishedAt: times.get(target) ?? null,
            dependencies: parsed.dependencies,
            engines: parsed.engines,
            deprecated: parsed.deprecated,
            license: null,
        });
    }

    const versions: PackageVersion[] = numbers
        .sort((a, b) => compareSemver(b, a))
        .map((number) => ({ version: number, publishedAt: times.get(number) ?? null }));

    return {
        name,
        description: null,
        latest,
        tags: {},
        versions,
        version: detail,
        homepage: `https://pkg.go.dev/${name}`,
        repository: repositoryOf(name),
        changelog: null,
        source: `${ctx.base}${base}/@v/list`,
    };
};
