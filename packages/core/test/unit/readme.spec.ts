/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { triageIssue } from '../fixtures/readme-example.ts';
import { mockModel } from '../utils/mock-model.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('runs the triage agent to completion', async () => {
        const model = mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'addLabel',
                    input: { label: 'bug' },
                }],
            },
            { parts: [{ type: 'text', text: 'Labelled as bug.' }] },
        ]);

        const {
            run,
            labels,
            lines,
        } = await triageIssue(model);

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('Labelled as bug.');
        expect(labels).toEqual(['bug']);
        expect(lines[0]).toMatch(/^\[chamvi\] message: Labelled as bug\. \(agent triage, run /);
        expect(lines.slice(1)).toEqual(['Labelled as bug.']);
    });
});
