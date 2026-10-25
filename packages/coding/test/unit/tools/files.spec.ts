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
import { Buffer } from 'node:buffer';
import type { ToolSet } from 'ai';
import { SandboxError, ValidationError } from '@chamvi/core';
import type { GitFixture } from '@chamvi/test-kit';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => { fixture = await createFixture(); });
afterAll(async () => { await fixture.cleanup(); });
beforeEach(async () => { s = await setupCoding(fixture); });
afterEach(async () => { await s.cleanup(); });

describe('read_file', () => {
    it('reads a whole file', async () => {
        await expect(s.call('read_file', { path: 'src/a.ts' })).resolves.toEqual({
            path: 'src/a.ts',
            content: 'export const a = 1;\nexport const b = 2;',
            startLine: 1,
            endLine: 2,
            totalLines: 2,
            truncated: false,
        });
    });

    it('reads a range', async () => {
        await expect(s.call('read_file', {
            path: '/workspace/src/a.ts',
            offset: 2,
            limit: 1,
        })).resolves.toEqual({
            path: 'src/a.ts',
            content: 'export const b = 2;',
            startLine: 2,
            endLine: 2,
            totalLines: 2,
            truncated: false,
        });
    });

    it('cuts at READ_MAX_CHARS', async () => {
        await s.workspace.writeFile('long.txt', `${'x'.repeat(70_000)}\nnext\n`);
        const result = await s.call<{
            content: string; 
            truncated: boolean; 
            endLine: number; 
            totalLines: number 
        }>('read_file', { path: 'long.txt' });
        expect(result.content).toHaveLength(65_536);
        expect(result.truncated).toBe(true);
        expect(result.endLine).toBe(1);
        expect(result.totalLines).toBe(2);
    });

    it('refuses an offset past the end and a limit out of range', async () => {
        await expect(s.call('read_file', { path: 'src/a.ts', offset: 3 })).rejects.toThrow(ValidationError);
        await expect(s.call('read_file', { path: 'src/a.ts', offset: 0 })).rejects.toThrow(ValidationError);
        await expect(s.call('read_file', { path: 'src/a.ts', limit: 2_001 })).rejects.toThrow(ValidationError);
        await expect(s.call('read_file', { path: 'src/a.ts', limit: 1.5 })).rejects.toThrow(ValidationError);
    });

    it('reads an empty file', async () => {
        await s.workspace.writeFile('empty.txt', '');
        await expect(s.call('read_file', { path: 'empty.txt' })).resolves.toMatchObject({
            content: '',
            totalLines: 0,
            truncated: false,
        });
    });
});

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** What the model gets for a tool result, through the tool's toModelOutput. */
function modelOutput(tools: ToolSet, name: string, output: unknown): unknown {
    const toModelOutput = tools[name]?.toModelOutput as ((options: unknown) => unknown) | undefined;
    return toModelOutput?.({
        toolCallId: 'call-1', 
        input: {}, 
        output, 
    });
}

describe('read_file: binary files and images', () => {
    it('reads a binary file as base64', async () => {
        const bytes = new Uint8Array([0, 1, 2, 255, 254]);
        await s.workspace.writeFile('bin/data.bin', bytes);
        await expect(s.call('read_file', { path: 'bin/data.bin', encoding: 'base64' })).resolves.toEqual({
            path: 'bin/data.bin',
            encoding: 'base64',
            content: Buffer.from(bytes).toString('base64'),
            bytes: 5,
        });
    });

    it('refuses base64 reads above 1 MiB', async () => {
        await s.workspace.writeFile('big.bin', new Uint8Array(1_048_577));
        await expect(s.call('read_file', { path: 'big.bin', encoding: 'base64' })).rejects.toThrow(ValidationError);
    });

    it('tells the model to use base64 for a file that is not UTF-8', async () => {
        await s.workspace.writeFile('latin1.txt', new Uint8Array([0x61, 0xFF, 0x62]));
        const error = await s.call('read_file', { path: 'latin1.txt' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain("encoding: 'base64'");
    });

    it('returns an image as an image part for the model', async () => {
        await s.workspace.writeFile('logo.png', PNG);
        const result = await s.call('read_file', { path: 'logo.png' });
        expect(result).toEqual({
            path: 'logo.png',
            type: 'image',
            mediaType: 'image/png',
            bytes: PNG.length,
            data: PNG.toString('base64'),
        });
        expect(modelOutput(s.tools, 'read_file', result)).toEqual({
            type: 'content',
            value: [
                { type: 'text', text: `Image logo.png (image/png, ${PNG.length} bytes).` },
                {
                    type: 'file', 
                    mediaType: 'image/png', 
                    data: { type: 'data', data: PNG.toString('base64') }, 
                },
            ],
        });
        const text = await s.call('read_file', { path: 'src/a.ts' });
        expect(modelOutput(s.tools, 'read_file', text)).toEqual({ type: 'json', value: text });
    });

    it('refuses an image above 5 MiB', async () => {
        const big = new Uint8Array(5 * 1_048_576 + 1);
        big.set(PNG.subarray(0, 8));
        await s.workspace.writeFile('huge.png', big);
        await expect(s.call('read_file', { path: 'huge.png' })).rejects.toThrow(SandboxError);
    });

    it('reads a text file past the former 1 MiB limit by range', async () => {
        const line = `${'x'.repeat(99)}\n`;
        await s.workspace.writeFile('large.txt', line.repeat(20_000));
        await expect(s.call('read_file', {
            path: 'large.txt', 
            offset: 19_999, 
            limit: 5, 
        })).resolves.toMatchObject({
            startLine: 19_999,
            endLine: 20_000,
            totalLines: 20_000,
        });
    });
});

describe('write_file', () => {
    it('writes base64 content as bytes', async () => {
        const bytes = new Uint8Array([0, 255, 10]);
        await expect(s.call('write_file', {
            path: 'out/b.bin',
            content: Buffer.from(bytes).toString('base64'),
            encoding: 'base64',
        })).resolves.toEqual({ path: 'out/b.bin', bytes: 3 });
        await expect(s.workspace.readBytes('out/b.bin')).resolves.toEqual(bytes);
    });

    it('refuses content that is not base64', async () => {
        await expect(s.call('write_file', {
            path: 'b.bin', 
            content: 'not base64!', 
            encoding: 'base64', 
        })).rejects.toThrow(ValidationError);
        await expect(s.call('write_file', {
            path: 'b.bin', 
            content: 'abc', 
            encoding: 'hex', 
        })).rejects.toThrow(ValidationError);
    });

    it('creates nested files', async () => {
        await expect(s.call('write_file', { path: 'x/y.txt', content: 'hi' })).resolves.toEqual({ path: 'x/y.txt', bytes: 2 });
        await expect(s.workspace.readFile('x/y.txt')).resolves.toBe('hi');
    });

    it('counts bytes, not characters', async () => {
        await expect(s.call('write_file', { path: 'u.txt', content: '€' })).resolves.toEqual({ path: 'u.txt', bytes: 3 });
    });

    it('refuses a non-string content', async () => {
        await expect(s.call('write_file', { path: 'u.txt', content: 42 })).rejects.toThrow(ValidationError);
    });
});

describe('list_files', () => {
    it('lists tracked and untracked but not ignored', async () => {
        await s.call('write_file', { path: 'new.ts', content: 'export {};\n' });
        await s.call('write_file', { path: 'dist/out.js', content: '1;\n' });
        const { files, truncated } = await s.call<{ files: string[]; truncated: boolean }>('list_files', {});
        expect(files).toContain('src/a.ts');
        expect(files).toContain('new.ts');
        expect(files).not.toContain('dist/out.js');
        expect(truncated).toBe(false);
    });

    it('lists below a path and up to a limit', async () => {
        await expect(s.call('list_files', { path: 'src' })).resolves.toEqual({ files: ['src/a.ts'], truncated: false });
        const { files, truncated } = await s.call<{ files: string[]; truncated: boolean }>('list_files', { limit: 1 });
        expect(files).toHaveLength(1);
        expect(truncated).toBe(true);
    });
});

describe('workspace resolution', () => {
    it('resolves the only workspace without an id', async () => {
        await expect(s.call('read_file', { path: 'src/a.ts', workspace: s.workspace.id })).resolves.toMatchObject({ totalLines: 2 });
        await expect(s.call('read_file', { path: 'src/a.ts' })).resolves.toMatchObject({ totalLines: 2 });
    });

    it('refuses another run\'s workspace', async () => {
        await expect(s.call('read_file', { path: 'src/a.ts', workspace: s.workspace.id }, 'r2')).rejects.toThrow(SandboxError);
        await expect(s.call('write_file', {
            path: 'x', 
            content: 'y', 
            workspace: s.workspace.id, 
        }, 'r2')).rejects.toThrow(SandboxError);
    });

    it('refuses escapes', async () => {
        await expect(s.call('read_file', { path: '../x' })).rejects.toThrow(ValidationError);
        await expect(s.call('write_file', { path: '/etc/x', content: 'y' })).rejects.toThrow(ValidationError);
        await expect(s.call('list_files', { path: '../' })).rejects.toThrow(ValidationError);
    });

    it('refuses a non-object input and a missing path', async () => {
        await expect(s.call('read_file', 'src/a.ts')).rejects.toThrow(ValidationError);
        await expect(s.call('read_file', {})).rejects.toThrow(ValidationError);
        await expect(s.call('read_file', { path: 'src/a.ts', workspace: 7 })).rejects.toThrow(ValidationError);
    });
});
