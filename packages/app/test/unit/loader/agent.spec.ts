/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { writeFile } from 'node:fs/promises';
import { InvalidAgentDefinitionError, loadAgent } from '@chamvi/app';
import { createTempDir, writeTree } from '../../utils/folder.ts';

const agentTs = (body = 'model: \'test/model\', instructions: \'x\'', name = 'triage') =>
    `import { defineAgent } from '@chamvi/core';\nexport default defineAgent({ name: '${name}', ${body} });\n`;

describe('loadAgent', () => {
    let root: { path: string; remove: () => Promise<void> };

    beforeEach(async () => {
        root = await createTempDir();
    });

    afterEach(async () => {
        await root.remove();
    });

    async function expectRefused(files: Record<string, string>, message: RegExp, name = 'triage') {
        await writeTree(join(root.path, name), files);

        const promise = loadAgent(join(root.path, name));

        await expect(promise).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
        await expect(promise).rejects.toThrow(message);
    }

    it('only agent.ts is required; other files are the agent\'s own', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, {
            'agent.ts': [
                'import { readFileSync } from \'node:fs\';',
                'import { cron } from \'@chamvi/channel-cron\';',
                'import { defineAgent } from \'@chamvi/core\';',
                'import { tools } from \'./lib/tools.ts\';',
                '',
                'export default defineAgent({',
                '    name: \'triage\',',
                '    model: \'test/model\',',
                '    instructions: readFileSync(new URL(\'./prompt.md\', import.meta.url), \'utf8\'),',
                '    tools,',
                '    channels: [cron.on(\'0 9 * * *\', { timezone: \'Europe/Berlin\' })],',
                '    budget: { maxSteps: 3 },',
                '});',
                '',
            ].join('\n'),
            'lib/tools.ts': 'export const tools = { say_hi: { description: \'Says hi.\', inputSchema: { type: \'object\' }, execute: async () => \'hi\' } };\n',
            'prompt.md': 'Sort the inbox.\n',
            'tools/README.md': '# the agent\'s own notes\n',
            'channels/daily.yaml': 'not read: the folder is the agent\'s own\n',
            'instructions.md': 'not read either\n',
        });

        const loaded = await loadAgent(dir);

        expect(loaded.dir).toBe(dir);
        expect(loaded.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(loaded.agent.name).toBe('triage');
        expect(loaded.agent.definition.instructions).toBe('Sort the inbox.\n');
        expect(loaded.agent.definition.model).toBe('test/model');
        expect(loaded.agent.definition.budget.maxSteps).toBe(3);
        expect(Object.keys(loaded.agent.definition.tools as object)).toEqual(['say_hi']);
        expect(loaded.agent.definition.channels?.map((s) => s.id)).toEqual(['cron:0 9 * * *']);
    });

    it('applies the budget defaults of defineAgent to a structural agent', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, { 'agent.ts': 'export default { name: \'triage\', definition: { model: \'test/model\', instructions: \'x\' } };\n' });

        const loaded = await loadAgent(dir);

        expect(loaded.agent.definition.budget.maxSteps).toBe(20);
    });

    it('a folder without agent.ts is an issue', async () => {
        await expectRefused({ 'prompt.md': 'x' }, /^triage: has no agent\.ts\.$/);
    });

    it('an agent.mts is no agent file', async () => {
        await expectRefused({ 'agent.mts': agentTs() }, /^triage: has no agent\.ts\.$/);
    });

    it('a defineAgent name that differs from the folder is refused', async () => {
        await expectRefused(
            { 'agent.ts': agentTs(undefined, 'other') },
            /^triage\/agent\.ts: defineAgent names "other", but the folder is "triage"; the names must match\.$/,
        );
    });

    it('a plain config object is refused', async () => {
        await expectRefused(
            { 'agent.ts': 'export default { model: \'test/model\', instructions: \'x\' };\n' },
            /^triage\/agent\.ts: the default export must be defineAgent\(\.\.\.\)'s result\.$/,
        );
    });

    it('a default export that is no object is refused', async () => {
        await expectRefused({ 'agent.ts': 'export default 42;\n' }, /agent\.ts/);
    });

    it('an agent file without a default export is refused', async () => {
        await expectRefused({ 'agent.ts': 'export const config = {};\n' }, /default export/);
    });

    it('an agent definition defineAgent refuses is refused', async () => {
        await expectRefused({ 'agent.ts': 'export default { name: \'triage\', definition: { model: \'test/model\', instructions: \'x\', channels: [{ channel: \'http\', id: \'http\', options: {} }, { channel: \'http\', id: \'http\', options: {} }] } };\n' }, /duplicate subscription id/);
    });

    it('a folder name that is no agent name is refused', async () => {
        await expectRefused({ 'agent.ts': agentTs(undefined, 'Bad_Name') }, /Bad_Name/, 'Bad_Name');
    });

    it('a syntax error names the file relative to the agents dir, without an absolute path', async () => {
        await writeTree(join(root.path, 'triage'), { 'agent.ts': 'export default {\n' });

        const error = await loadAgent(join(root.path, 'triage')).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message).toMatch(/^triage\/agent\.ts: /);
        expect((error as Error).message).not.toContain(root.path);
    });

    it('takes an injected module reader', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, { 'agent.ts': '' });

        const seen: string[] = [];

        const loaded = await loadAgent(dir, {
            load: async (path) => {
                seen.push(path);

                return { default: { name: 'triage', definition: { model: 'test/model', instructions: 'x' } } };
            },
        });

        expect(seen).toEqual([join(dir, 'agent.ts')]);
        expect(loaded.agent.definition.instructions).toBe('x');
    });

    it('refuses a load that a change of the folder straddles', async () => {
        const dir = join(root.path, 'triage');

        await writeTree(dir, { 'agent.ts': '' });

        const promise = loadAgent(dir, {
            load: async (path) => {
                await writeFile(path, 'export default { name: \'triage\', definition: { model: \'test:other\', instructions: \'x\' } };\n');

                return { default: { name: 'triage', definition: { model: 'test/model', instructions: 'x' } } };
            },
        });

        await expect(promise).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
        await expect(promise).rejects.toThrow('triage: changed while loading; load it again.');
    });

    it.each([
        ['a .mjs helper', '_text.mjs'],
        ['a .js helper', 'lib/text.js'],
        ['a .cjs helper', '_text.cjs'],
        ['a nested .mjs tool', 'tools/echo.mjs'],
    ])('refuses %s, which a reload would not see fresh', async (_label, file) => {
        await expectRefused({
            'agent.ts': agentTs(),
            [file]: 'export const text = 1;\n',
        }, new RegExp(`^triage/${file.replace('.', '\\.')}: a JavaScript file is not reloaded fresh; write helpers as \\.ts or \\.mts\\.$`));
    });

    it.each([
        ['the agent folder', 'triage/node_modules/x/index.js', 'triage holds a node_modules folder'],
        ['the agents dir', 'node_modules/x/index.js', 'the agents dir holds a node_modules folder'],
    ])('refuses a node_modules folder in %s', async (_label, file, message) => {
        await writeTree(root.path, {
            'triage/agent.ts': agentTs(),
            [file]: 'module.exports = 1;\n',
        });

        await expect(loadAgent(join(root.path, 'triage'))).rejects.toThrow(`triage: ${message}`);
    });
});
