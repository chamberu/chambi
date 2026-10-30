/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { loadAgent } from '@chamvi/app';
import { createModuleJiti, createPackageAliases, readModule } from '../../../src/loader/helpers.ts';
import { createTempDir, writeTree } from '../../utils/folder.ts';

describe('the default module reader', () => {
    let root: { path: string; remove: () => Promise<void> };

    beforeEach(async () => {
        root = await createTempDir();
    });

    afterEach(async () => {
        await root.remove();
    });

    it('re-reading a changed folder returns the new code, including an imported file', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, {
            'agent.ts': 'import { defineAgent } from \'@chamvi/core\';\nimport { text } from \'./_text.ts\';\nexport default defineAgent({ name: \'triage\', model: \'test/model\', instructions: text });\n',
            '_text.ts': 'export const text: string = \'one\';\n',
        });

        expect((await loadAgent(dir)).agent.definition.instructions).toBe('one');

        await writeFile(join(dir, '_text.ts'), 'export const text: string = \'two\';\n');

        expect((await loadAgent(dir)).agent.definition.instructions).toBe('two');
    });

    it('re-reading returns the new code of a .mts helper imported from agent.ts and from a tool file it imports', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, {
            'agent.ts': 'import { defineAgent } from \'@chamvi/core\';\nimport echo from \'./tools/echo.ts\';\nimport { text } from \'./_text.mts\';\nexport default defineAgent({ name: \'triage\', model: \'test/model\', instructions: text, tools: { echo } });\n',
            'tools/echo.ts': 'import { text } from \'../_text.mts\';\nexport default { description: text, inputSchema: { type: \'object\' } };\n',
            '_text.mts': 'export const text: string = \'one\';\n',
        });

        const read = async () => {
            const { agent } = await loadAgent(dir);

            return [agent.definition.instructions, (agent.definition.tools as Record<string, { description: string }>).echo?.description];
        };

        expect(await read()).toEqual(['one', 'one']);

        await writeFile(join(dir, '_text.mts'), 'export const text: string = \'two\';\n');

        expect(await read()).toEqual(['two', 'two']);
    });

    it('a required JSON file is read again', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, {
            'agent.ts': 'import { defineAgent } from \'@chamvi/core\';\nimport data from \'./_data.json\';\nexport default defineAgent({ name: \'triage\', model: \'test/model\', instructions: data.text });\n',
            '_data.json': JSON.stringify({ text: 'one' }),
        });

        expect((await loadAgent(dir)).agent.definition.instructions).toBe('one');

        await writeFile(join(dir, '_data.json'), JSON.stringify({ text: 'two' }));

        expect((await loadAgent(dir)).agent.definition.instructions).toBe('two');
    });

    it('a pinned package resolves to the app\'s copy, also for an agents dir outside the app tree', async () => {
        const fake = (label: string) => ({
            'package.json': JSON.stringify({
                name: '@chamvi/fake',
                type: 'module',
                exports: { '.': { import: './index.mjs' }, './sub': { import: './sub.mjs' } },
            }),
            'index.mjs': `export const label = '${label}';\nexport const registry = new WeakSet();\nexport function mark(value) { registry.add(value); return value; }\n`,
            'sub.mjs': `export const sub = '${label} sub';\n`,
        });
        const tree: Record<string, string> = { 'app/src/main.ts': '' };

        for (const [file, content] of Object.entries(fake('app'))) {
            tree[`app/node_modules/@chamvi/fake/${file}`] = content;
        }

        // a second copy where a resolution from the agent file upwards would find it
        for (const [file, content] of Object.entries(fake('elsewhere'))) {
            tree[`data/node_modules/@chamvi/fake/${file}`] = content;
        }

        tree['data/volume/agents/triage/agent.ts'] = [
            'import { label, mark } from \'@chamvi/fake\';',
            'import { sub } from \'@chamvi/fake/sub\';',
            'export default { name: \'triage\', definition: { model: \'test/model\', instructions: `${label} ${sub}`, output: mark({}) } };',
            '',
        ].join('\n');
        await writeTree(root.path, tree);

        const jiti = createModuleJiti(join(root.path, 'app/src/main.ts'));

        const loaded = await loadAgent(join(root.path, 'data/volume/agents/triage'), { load: (path) => readModule(jiti, path) });
        const app = await import(pathToFileURL(join(root.path, 'app/node_modules/@chamvi/fake/index.mjs')).href) as { registry: WeakSet<object> };

        expect(loaded.agent.definition.instructions).toBe('app app sub');
        expect(app.registry.has(loaded.agent.definition.output as object)).toBe(true);
    });

    it('pins @chamvi/*, ai and @ai-sdk/* to the copies the app resolves', () => {
        const aliases = createPackageAliases(import.meta.url);

        expect(Object.keys(aliases)).toEqual(expect.arrayContaining(['@chamvi/core', 'ai', 'ai/test', '@ai-sdk/provider']));
        expect(aliases['@chamvi/core']).toMatch(/core[\\/]dist[\\/]index\.mjs$/);
        expect(Object.keys(aliases).some((key) => key.includes('*') || key.endsWith('/package.json'))).toBe(false);
    });

    it('a package from node_modules is the same instance as a native import', async () => {
        const pkg = join(root.path, 'node_modules', 'fake-registry');

        await writeTree(root.path, {
            'node_modules/fake-registry/package.json': JSON.stringify({
                name: 'fake-registry',
                type: 'module',
                exports: { '.': { import: './index.mjs', require: './index.cjs' } },
            }),
            'node_modules/fake-registry/index.mjs': 'export const registry = new WeakSet();\nexport function mark(value) { registry.add(value); return value; }\n',
            'node_modules/fake-registry/index.cjs': 'exports.registry = new WeakSet();\nexports.mark = (value) => { exports.registry.add(value); return value; };\n',
            'agents/triage/agent.ts': [
                'import { mark } from \'fake-registry\';',
                'export default { name: \'triage\', definition: { model: \'test/model\', instructions: \'x\', output: mark({ marked: true }) } };',
                '',
            ].join('\n'),
        });

        const loaded = await loadAgent(join(root.path, 'agents', 'triage'));
        const native = await import(pathToFileURL(join(pkg, 'index.mjs')).href) as { registry: WeakSet<object> };

        expect(native.registry.has(loaded.agent.definition.output as object)).toBe(true);
    });

    it('a TypeScript enum loads', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, { 'agent.ts': 'import { defineAgent } from \'@chamvi/core\';\nenum Kind { Sort = \'sort the inbox\' }\nexport default defineAgent({ name: \'triage\', model: \'test/model\', instructions: Kind.Sort });\n' });

        expect((await loadAgent(dir)).agent.definition.instructions).toBe('sort the inbox');
    });
});
