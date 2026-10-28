/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildStrategy } from 'release-please/build/src/factory.js';
import { parseConventionalCommits } from 'release-please/build/src/commit.js';
import { LinkedVersions } from 'release-please/build/src/plugins/linked-versions.js';
import { NodeWorkspace } from 'release-please/build/src/plugins/node-workspace.js';
import { Version } from 'release-please/build/src/version.js';
import { ReleasePleaseManifest } from 'release-please/build/src/updaters/release-please-manifest.js';

const config = JSON.parse(await readFile(new URL('./release-please-config.json', import.meta.url), 'utf8'));

for (const versions of [['0.3.1', '0.3.1'], ['0.3.0', '0.2.2']]) {
    test(`dependency-only bump stays linked with releases ${versions.join(', ')}`, async () => {
        const repositoryConfig = {
            'packages/core': { releaseType: 'node', component: 'core' },
            'packages/dependent': { releaseType: 'node', component: 'dependent' },
        };
        const github = {
            repository: { owner: 'fixture', repo: 'linked' },
            async getFileContentsOnBranch(path) {
                const index = path.startsWith('packages/core/') ? 0 : 1;
                return {
                    parsedContent: JSON.stringify({
                        name: index === 0 ? '@fixture/core' : '@fixture/dependent', 
                        version: versions[index], 
                        ...(index === 1 ? { dependencies: { '@fixture/core': `^${versions[0]}` } } : {}), 
                    }), 
                };
            },
        };
        let strategies = {};
        const releases = {};
        const commits = {};
        for (const [index, path] of Object.keys(repositoryConfig).entries()) {
            strategies[path] = await buildStrategy({
                github,
                targetBranch: 'master',
                path,
                ...repositoryConfig[path],
                bumpMinorPreMajor: true,
                bumpPatchForMinorPreMajor: true,
            });
            releases[path] = { tag: { version: Version.parse(versions[index]) }, sha: 'previous' };
            commits[path] = index === 0 ? [{
                sha: 'change', 
                message: 'fix: repair core', 
                files: [`${path}/src/index.ts`], 
            }] : [];
        }
        const workspace = new NodeWorkspace(github, 'master', repositoryConfig, {
            updateAllPackages: true,
            updatePeerDependencies: true,
        });
        const linkedConfig = config.plugins.find((plugin) => plugin.type === 'linked-versions');
        const linked = new LinkedVersions(github, 'master', repositoryConfig, 'main', ['core', 'dependent'], { merge: linkedConfig.merge });
        const plugins = config.plugins.map((plugin) => plugin.type === 'linked-versions' ? linked : workspace);
        for (const plugin of plugins) {
            strategies = await plugin.preconfigure(strategies, commits, releases);
        }
        let candidates = [];
        for (const [path, packageConfig] of Object.entries(repositoryConfig)) {
            const pullRequest = await strategies[path].buildReleasePullRequest(parseConventionalCommits(commits[path]), releases[path]);
            if (pullRequest) {
                // Manifest.buildPullRequests adds this update before running plugins.
                pullRequest.updates.push({
                    path: '.release-please-manifest.json',
                    createIfMissing: false,
                    updater: new ReleasePleaseManifest({
                        version: pullRequest.version,
                        versionsMap: new Map([[path, pullRequest.version]]),
                    }),
                });
                candidates.push({
                    path, 
                    config: packageConfig,
                    pullRequest, 
                });
            }
        }
        for (const plugin of plugins) {
            candidates = await plugin.run(candidates);
        }
        assert.equal(candidates.length, 1, 'the workspace produces one linked release pull request');
        const updates = candidates.flatMap((candidate) => candidate.pullRequest.updates);
        const actualVersions = [];
        for (const path of Object.keys(repositoryConfig)) {
            const filename = `${path}/package.json`;
            const update = updates.find((item) => item.path === filename);
            assert.ok(update, `missing update for ${filename}`);
            const original = await github.getFileContentsOnBranch(filename);
            const updated = JSON.parse(update.updater.updateContent(original.parsedContent));
            actualVersions.push(updated.version);
            if (updated.dependencies) {
                assert.equal(updated.dependencies['@fixture/core'], `^${actualVersions[0]}`);
            }
        }
        assert.deepEqual(actualVersions, versions[0] === '0.3.1' ? ['0.3.2', '0.3.2'] : ['0.3.1', '0.3.1']);
        const manifestUpdate = updates.find((update) => update.path === '.release-please-manifest.json');
        assert.ok(manifestUpdate, 'the release updates its manifest');
        const manifest = JSON.parse(manifestUpdate.updater.updateContent(JSON.stringify({
            'packages/core': versions[0],
            'packages/dependent': versions[1],
        })));
        assert.equal(manifest['packages/core'], actualVersions[0]);
        assert.equal(manifest['packages/dependent'], actualVersions[1]);
    });
}
