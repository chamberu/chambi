/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { codingTools } from '@chamvi/coding';
import type { BashJobResult, BashOutputResult, BashResult } from '@chamvi/coding';
import type { IWorkspace, RepositoryInstructions } from '@chamvi/sandbox';
import type { GitFixture } from '@chamvi/test-kit';
import { callTool, toolContext } from '../../utils/context.ts';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

const SECRET = 'ghs_s3cretTokenValue';

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => { fixture = await createFixture(); });
afterAll(async () => { await fixture.cleanup(); });
beforeEach(async () => { s = await setupCoding(fixture); });
afterEach(async () => { await s.cleanup(); });

/** The tools over the setup's workspace seen through a redaction of SECRET, as a manager with credentials hands it out. */
function redactingTools() {
    const redacting: IWorkspace = Object.create(s.workspace, { redact: { value: (text: string) => text.replaceAll(SECRET, '[redacted]') } });
    const tools = codingTools({ get: async () => redacting });
    return (name: string, input: unknown) => callTool(tools, name, input, toolContext('r1'));
}

describe('redaction of decoded output', () => {
    it('redacts delivered instruction text and diagnostics while hashing disk bytes', async () => {
        const content = `Private ${SECRET}\n@missing-${SECRET}.md\n`;
        await s.workspace.writeFile('AGENTS.md', content);

        const result = await redactingTools()('read_file', { path: 'src/a.ts' }) as { instructions: RepositoryInstructions };

        expect(result.instructions.sources[0]).toMatchObject({
            path: 'AGENTS.md',
            content: 'Private [redacted]\n@missing-[redacted].md\n',
            sha256: createHash('sha256').update(content).digest('hex'),
        });
        expect(result.instructions.diagnostics).toEqual([
            expect.objectContaining({ path: 'missing-[redacted].md', code: 'missing-include' }),
        ]);
        expect(JSON.stringify(result)).not.toContain(SECRET);
    });

    it('passes the excerpts of bash through the workspace redaction', async () => {
        const call = redactingTools();
        const result = await call('bash', { command: `echo "token ${SECRET}"; echo "${SECRET}" >&2` }) as BashResult;
        expect(result.stdout).toBe('token [redacted]\n');
        expect(result.stderr).toBe('[redacted]\n');
    });

    it('passes the output of a background job through it', async () => {
        const call = redactingTools();
        const job = await call('bash', { command: `echo "${SECRET}"`, background: true }) as BashJobResult;
        await vi.waitFor(async () => {
            const output = await call('bash_output', { job: job.job }) as BashOutputResult;
            expect(output.status).toBe('exited');
            expect(output.output).toBe('[redacted]\n');
        }, { timeout: 10_000, interval: 100 });
    });
});
