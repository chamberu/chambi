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

const READERS = ['read_file', 'grep', 'list_files', 'glob', 'git_diff', 'bash', 'bash_output'];

describe('coding tool trust classification', () => {
    it('taints every read and shell result, repo-backed or repo-less, never as outbound', () => {
        const tools = codingTools({ get: async () => ({ info: {} }) as IWorkspace });

        for (const name of READERS) {
            const { trust } = (tools[name] as Tool & { trust: ToolTrust });

            expect(trust.guardWhenTainted).toBeUndefined();
            // a repo-less workspace can fetch anything (curl, git clone), so its output is untrusted too
            expect(trust.taint).toBe(true);
        }

        for (const name of ['write_file', 'edit_file', 'multi_edit', 'bash_kill']) {
            expect((tools[name] as { trust?: ToolTrust }).trust).toBeUndefined();
        }
    });
});
