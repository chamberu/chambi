/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type PackageJson = {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

const ROOT = new URL('../../../../', import.meta.url);

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(new URL(path, ROOT), 'utf8')) as T;
}

/**
 * The graph release-please's node-workspace plugin builds (release-please
 * 17, `combineDeps`): every released package with its dependencies,
 * devDependencies, optionalDependencies and, with `updatePeerDependencies`,
 * peerDependencies. A cycle makes `buildGraphOrder` throw, which aborts the
 * whole release run; nx exclusions do not reach it.
 */
function releaseGraph(): Map<string, string[]> {
    const config = readJson<{
        packages: Record<string, unknown>;
        plugins?: Array<{ type: string; updatePeerDependencies?: boolean }>;
    }>('release-please-config.json');
    const workspace = config.plugins?.find((plugin) => plugin.type === 'node-workspace');
    const packages = Object.keys(config.packages).map((path) => readJson<PackageJson>(`${path}/package.json`));
    const names = new Set(packages.map((pkg) => pkg.name));

    const graph = new Map<string, string[]>();
    for (const pkg of packages) {
        const edges = Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.optionalDependencies,
            ...(workspace?.updatePeerDependencies ? pkg.peerDependencies : {}),
        });
        graph.set(pkg.name, edges.filter((name) => names.has(name)));
    }
    return graph;
}

function findCycles(graph: Map<string, string[]>): string[] {
    const cycles = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, path: string[]) => {
        const index = path.indexOf(name);
        if (index !== -1) {
            cycles.add([...path.slice(index), name].join(' -> '));
            return;
        }
        if (done.has(name)) {
            return;
        }
        for (const next of graph.get(name) ?? []) {
            visit(next, [...path, name]);
        }
        done.add(name);
    };
    for (const name of graph.keys()) {
        visit(name, []);
    }
    return [...cycles];
}

describe('workspace dependency graph', () => {
    it('has no cycle in the graph release-please builds', () => {
        const graph = releaseGraph();
        expect(graph.size).toBeGreaterThan(10);
        expect(findCycles(graph)).toEqual([]);
    });

    it('keeps core and app independent of the optional skill runtime', () => {
        const graph = releaseGraph();
        expect(graph.get('@chamvi/core')).not.toContain('@chamvi/skills');
        expect(graph.get('@chamvi/app')).not.toContain('@chamvi/skills');
        expect(graph.get('@chamvi/skills')).toContain('@chamvi/core');
    });

    it('holds the channel packages and not the ones they replaced', () => {
        const graph = releaseGraph();
        expect(graph.keys().toArray()).toEqual(expect.arrayContaining([
            '@chamvi/channel-cron',
            '@chamvi/channel-openclaw',
            '@chamvi/github',
        ]));
        for (const name of ['@chamvi/scheduler', '@chamvi/notify-github', '@chamvi/notify-openclaw']) {
            expect(graph.has(name)).toBe(false);
            for (const edges of graph.values()) expect(edges).not.toContain(name);
        }
        expect(graph.get('@chamvi/app')).toContain('@chamvi/channel-cron');
    });
});
