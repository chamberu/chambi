/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { ValidationError } from '@chamvi/core';
import { codingTools } from '@chamvi/coding';
import type { IWorkspace } from '@chamvi/sandbox';
import type { GitFixture } from '@chamvi/test-kit';
import { callTool, toolContext } from '../../utils/context.ts';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => {
    fixture = await createFixture();
});
afterAll(async () => {
    await fixture.cleanup();
});
beforeEach(async () => {
    s = await setupCoding(fixture);
});
afterEach(async () => {
    await s.cleanup();
});

describe('edit_file', () => {
    it('replaces one match', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 3',
        })).resolves.toEqual({ path: 'src/a.ts', replacements: 1 });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = 3;\nexport const b = 2;\n');
    });

    it('applies every edit of one file the model sends in one step', async () => {
        await s.call('write_file', { path: 'src/c.ts', content: 'a = 1;\nb = 2;\nc = 3;\n' });

        const results = await Promise.all([
            ['a = 1', 'a = 10'],
            ['b = 2', 'b = 20'],
            ['c = 3', 'c = 30'],
        ].map(([oldString, newString]) => s.call('edit_file', {
            path: 'src/c.ts',
            oldString,
            newString,
        })));

        expect(results).toEqual(Array.from({ length: 3 }, () => ({ path: 'src/c.ts', replacements: 1 })));
        await expect(s.workspace.readFile('src/c.ts')).resolves.toBe('a = 10;\nb = 20;\nc = 30;\n');

        // a write and an edit of one file run one after the other too
        await Promise.all([
            s.call('write_file', { path: '/workspace/src/c.ts', content: 'x = 1;\n' }),
            s.call('edit_file', {
                path: 'src/c.ts',
                oldString: 'x = 1',
                newString: 'x = 2',
            }),
        ]);
        await expect(s.workspace.readFile('src/c.ts')).resolves.toBe('x = 2;\n');
    });

    it('inserts replacement patterns literally', async () => {
        await s.call('edit_file', {
            path: 'src/a.ts',
            oldString: '1',
            newString: '$&$1$$',
        });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = $&$1$$;\nexport const b = 2;\n');
    });

    it('refuses a missing oldString', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'nope',
            newString: 'x',
        })).rejects.toThrow(/not found/);
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'nope',
            newString: 'x',
        })).rejects.toThrow(ValidationError);
    });

    it('refuses several matches without replaceAll', async () => {
        const edit = s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'export',
            newString: 'export declare',
        });

        await expect(edit).rejects.toThrow(ValidationError);
        await expect(edit).rejects.toThrow(/2 matches/);
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = 1;\nexport const b = 2;\n');
    });

    it('replaces every match with replaceAll', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'export ',
            newString: '',
            replaceAll: true,
        })).resolves.toEqual({ path: 'src/a.ts', replacements: 2 });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('const a = 1;\nconst b = 2;\n');
    });

    it('refuses an empty or unchanged oldString', async () => {
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: '',
            newString: 'x',
        })).rejects.toThrow(ValidationError);
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 1',
        })).rejects.toThrow(ValidationError);
        await expect(s.call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 2',
            replaceAll: 'yes',
        })).rejects.toThrow(ValidationError);
    });
});

describe('multi_edit', () => {
    it('applies the edits in order and writes once', async () => {
        await expect(s.call('multi_edit', {
            path: 'src/a.ts',
            edits: [
                { oldString: 'a = 1', newString: 'a = 10' },
                { oldString: 'a = 10', newString: 'a = 100' },
                {
                    oldString: 'export',
                    newString: 'export /* x */',
                    replaceAll: true,
                },
            ],
        })).resolves.toEqual({
            path: 'src/a.ts',
            edits: 3,
            replacements: 4,
        });
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export /* x */ const a = 100;\nexport /* x */ const b = 2;\n');
    });

    it('writes nothing when one edit does not match', async () => {
        const error = await s.call('multi_edit', {
            path: 'src/a.ts',
            edits: [
                { oldString: 'a = 1', newString: 'a = 10' },
                { oldString: 'missing', newString: 'x' },
            ],
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).toContain('edit 2');
        await expect(s.workspace.readFile('src/a.ts')).resolves.toBe('export const a = 1;\nexport const b = 2;\n');
    });

    it('refuses ambiguous edits and bad input', async () => {
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: [{ oldString: 'export', newString: 'x' }] }))
            .rejects.toThrow(/edit 1.*2 matches/);
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: [] })).rejects.toThrow(ValidationError);
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: [{ oldString: 'a', newString: 'a' }] })).rejects.toThrow(ValidationError);
        await expect(s.call('multi_edit', { path: 'src/a.ts', edits: 'x' })).rejects.toThrow(ValidationError);
        await expect(s.call('multi_edit', { path: '../a.ts', edits: [{ oldString: 'a', newString: 'b' }] })).rejects.toThrow(ValidationError);
    });
});

describe('edits of a file holding an issued token', () => {
    const SECRET = 'ghs_s3cretTokenValue';
    const FILE = `export const a = 1;\nconst t = '${SECRET}';\n`;

    /** The tools over the setup's workspace as a manager with credentials hands it out: reads redacted, a raw read beside them. */
    function redactingTools() {
        const redact = (text: string) => text.replaceAll(SECRET, '[redacted]');
        const redactedSpans = (text: string) => {
            const spans: Array<{ start: number; end: number }> = [];

            for (let at = text.indexOf(SECRET); at !== -1; at = text.indexOf(SECRET, at + SECRET.length)) {
                spans.push({ start: at, end: at + SECRET.length });
            }

            return spans;
        };
        const redacting: IWorkspace = Object.create(s.workspace, {
            redact: { value: redact },
            redactedSpans: { value: redactedSpans },
            readFile: { value: async (path: string) => redact(await s.workspace.readFile(path)) },
            readFileRaw: { value: (path: string) => s.workspace.readFile(path) },
        });
        const tools = codingTools({ get: async () => redacting });

        return (name: string, input: unknown) => callTool(tools, name, input, toolContext('r1'));
    }

    async function bytesOf(path: string): Promise<string> {
        return new TextDecoder().decode(await s.workspace.readBytes(path));
    }

    beforeEach(async () => {
        await s.workspace.writeFile('src/a.ts', FILE);
    });

    it('keeps the token byte for byte when editing another line', async () => {
        const call = redactingTools();

        await call('edit_file', {
            path: 'src/a.ts',
            oldString: 'a = 1',
            newString: 'a = 2',
        });
        expect(await bytesOf('src/a.ts')).toBe(`export const a = 2;\nconst t = '${SECRET}';\n`);
    });

    it('keeps the token byte for byte through multi_edit', async () => {
        const call = redactingTools();

        await call('multi_edit', {
            path: 'src/a.ts',
            edits: [
                { oldString: 'a = 1', newString: 'a = 2' },
                { oldString: 'const t', newString: 'const token' },
            ],
        });
        expect(await bytesOf('src/a.ts')).toBe(`export const a = 2;\nconst token = '${SECRET}';\n`);
    });

    it('gives no signal for a guess at the token: a right and a wrong guess fail alike', async () => {
        const call = redactingTools();
        const guess = (oldString: string) => call('edit_file', {
            path: 'src/a.ts',
            oldString,
            newString: 'x',
        }).catch((e: unknown) => e);
        const right = await guess(SECRET.slice(0, 8));
        const wrong = await guess('ghs_zzzz');

        expect(right).toBeInstanceOf(ValidationError);
        expect((right as Error).message).toBe((wrong as Error).message.replace('ghs_zzzz', SECRET.slice(0, 8)));

        // multi_edit: a probe edit then a restoring edit would tell by the count
        const probe = await call('multi_edit', {
            path: 'src/a.ts',
            edits: [
                { oldString: SECRET, newString: 'probe' },
                { oldString: 'probe', newString: SECRET },
            ],
        }).catch((e: unknown) => e);

        expect(probe).toBeInstanceOf(ValidationError);
        expect(await bytesOf('src/a.ts')).toBe(FILE);
    });

    it('matches the text the model read and refuses an edit of the redacted span', async () => {
        const call = redactingTools();
        const error = await call('edit_file', {
            path: 'src/a.ts',
            oldString: "t = '[redacted]'",
            newString: "t = 'other'",
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).toMatch(/redacted credential/);
        expect(await bytesOf('src/a.ts')).toBe(FILE);

        // right up to the span is fine, and the token stays
        await call('edit_file', {
            path: 'src/a.ts',
            oldString: "const t = '",
            newString: "const token = '",
        });
        expect(await bytesOf('src/a.ts')).toBe(`export const a = 1;\nconst token = '${SECRET}';\n`);
    });

    it('keeps every token with replaceAll and a literal [redacted] in newString', async () => {
        await s.workspace.writeFile('src/a.ts', `x ${SECRET} x ${SECRET} x\n`);

        const call = redactingTools();
        const result = await call('edit_file', {
            path: 'src/a.ts',
            oldString: 'x',
            newString: '[redacted]',
            replaceAll: true,
        });

        expect(result).toMatchObject({ replacements: 3 });
        expect(await bytesOf('src/a.ts')).toBe(`[redacted] ${SECRET} [redacted] ${SECRET} [redacted]\n`);
    });

    it('puts the token back when write_file round-trips the text read_file showed', async () => {
        const call = redactingTools();
        // the text read_file shows through the redacting view
        const shown = FILE.replace(SECRET, '[redacted]');

        await call('write_file', { path: 'src/a.ts', content: `// header\n${shown}` });
        expect(await bytesOf('src/a.ts')).toBe(`// header\n${FILE}`);
    });

    it('keeps a literal [redacted] of the file and restores tokens in order', async () => {
        await s.workspace.writeFile('src/a.ts', `[redacted] ${SECRET} [redacted] ${SECRET}\n`);

        const call = redactingTools();

        await call('write_file', { path: 'src/a.ts', content: 'A [redacted] B [redacted] C [redacted] D [redacted]\n' });
        expect(await bytesOf('src/a.ts')).toBe(`A [redacted] B ${SECRET} C [redacted] D ${SECRET}\n`);
    });

    it('refuses write_file content whose [redacted] markers do not line up with the file, writing nothing', async () => {
        const call = redactingTools();
        const error = await call('write_file', { path: 'src/a.ts', content: 'const t = \'[redacted]\';\nconst u = \'[redacted]\';\n' })
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).toMatch(/redacted credential/);
        expect((error as Error).message).not.toContain(SECRET);
        expect(await bytesOf('src/a.ts')).toBe(FILE);
    });

    it('refuses write_file content with [redacted] over a token file it cannot read as text, writing nothing', async () => {
        const bytes = new Uint8Array([...new TextEncoder().encode(`t = '${SECRET}';\n`), 0xFF]);

        await s.workspace.writeFile('src/a.ts', bytes);

        const call = redactingTools();
        const error = await call('write_file', { path: 'src/a.ts', content: "t = '[redacted]';\n" }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).not.toContain(SECRET);
        expect(await s.workspace.readBytes('src/a.ts')).toEqual(bytes);
    });

    it('writes a literal [redacted] where the file holds no token', async () => {
        const call = redactingTools();

        await call('write_file', { path: 'src/new.ts', content: 'x [redacted]\n' });
        expect(await bytesOf('src/new.ts')).toBe('x [redacted]\n');
    });

    it('leaves the file untouched and echoes no text when oldString is missing', async () => {
        const call = redactingTools();
        const error = await call('edit_file', {
            path: 'src/a.ts',
            oldString: 'missing',
            newString: 'x',
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).not.toContain(SECRET);
        expect(await bytesOf('src/a.ts')).toBe(FILE);
    });
});
