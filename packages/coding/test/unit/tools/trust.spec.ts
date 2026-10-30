/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { codingTools } from '@chamvi/coding';
import type { Tool } from 'ai';
import type { ToolTrust } from '@chamvi/core';
import type { IWorkspace } from '@chamvi/sandbox';
import { toolContext } from '../../utils/context.ts';

const READERS = ['read_file', 'grep', 'list_files', 'glob', 'git_diff', 'bash', 'bash_output'];

describe('coding tool trust classification', () => {
    it('classifies the selected workspace, never shell execution as outbound', async () => {
        const requested: Array<{ runId: string; workspace?: string }> = [];
        const tools = codingTools({
            get: async (runId, workspace) => {
                requested.push({ runId, workspace });

                return { info: { repo: workspace === 'repo' ? 'https://github.com/octo/demo.git' : undefined } } as IWorkspace;
            },
        });
        const ctx = toolContext('r1');

        for (const name of READERS) {
            const { trust } = (tools[name] as Tool & { trust: ToolTrust });

            expect(trust.outbound).toBeUndefined();

            const classify = trust.untrustedResult;

            if (typeof classify !== 'function') {
                throw new TypeError(`${name} needs a workspace trust classifier`);
            }

            expect(await classify({ workspace: 'repo' }, ctx)).toBe(true);
            expect(await classify({ workspace: 'empty' }, ctx)).toBe(false);
            expect(await classify({}, ctx)).toBe(false);
        }

        expect(requested).toContainEqual({ runId: 'r1', workspace: 'repo' });
        expect(requested).toContainEqual({ runId: 'r1', workspace: 'empty' });

        for (const name of ['write_file', 'edit_file', 'multi_edit', 'bash_kill']) {
            expect((tools[name] as { trust?: ToolTrust }).trust).toBeUndefined();
        }
    });
});
