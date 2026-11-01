/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    chmod,
    mkdir,
    mkdtemp,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import type { IKnowledgeSource, KnowledgeDocumentInput } from '@chamvi/knowledge';
import { FOLDER_EXTENSIONS, FOLDER_FILE_MAX_BYTES, folder } from '@chamvi/knowledge';

type Collected = { documents: KnowledgeDocumentInput[]; errors: unknown[] };

async function collect(source: IKnowledgeSource, signal = new AbortController().signal): Promise<Collected> {
    const documents: KnowledgeDocumentInput[] = [];
    const errors: unknown[] = [];

    for await (const document of source.documents({
        signal,
        onError: (error) => {
            errors.push(error);
        }, 
    })) {
        documents.push(document);
    }

    return { documents, errors };
}

describe('folder', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'chamvi-knowledge-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('has the documented defaults', () => {
        expect(FOLDER_EXTENSIONS).toEqual(['.md', '.markdown', '.mdx', '.txt']);
        expect(FOLDER_FILE_MAX_BYTES).toBe(1_048_576);

        const source = folder(root);

        expect(source.kind).toBe('folder');
        expect(source.trusted).toBe(true);
        expect(folder(root, { trusted: false }).trusted).toBe(false);
    });

    it('refuses bad options when called', () => {
        expect(() => folder('')).toThrow(InvalidAgentDefinitionError);
        expect(() => folder(42 as never)).toThrow(InvalidAgentDefinitionError);
        expect(() => folder(root, { extensions: ['md'] })).toThrow(InvalidAgentDefinitionError);
        expect(() => folder(root, { extensions: [] })).toThrow(InvalidAgentDefinitionError);
        expect(() => folder(root, { trusted: 'no' } as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('yields matching files sorted by path, skipping dot entries and other types', async () => {
        await mkdir(join(root, 'sub'));
        await mkdir(join(root, '.hidden'));
        await writeFile(join(root, 'sub', 'b.txt'), 'plain text');
        await writeFile(join(root, 'a.md'), 'intro\n\n# The Title  \n\nbody');
        await writeFile(join(root, '.hidden', 'x.md'), '# hidden');
        await writeFile(join(root, '.dot.md'), '# dot');
        await writeFile(join(root, 'img.png'), 'not text');

        const { documents, errors } = await collect(folder(root));

        expect(errors).toEqual([]);
        expect(documents).toEqual([
            {
                id: 'a.md', 
                source: 'a.md', 
                title: 'The Title', 
                content: 'intro\n\n# The Title  \n\nbody', 
            },
            {
                id: 'sub/b.txt', 
                source: 'sub/b.txt', 
                title: 'b', 
                content: 'plain text', 
            },
        ]);
    });

    it('takes extensions case-insensitively', async () => {
        await writeFile(join(root, 'notes.RST'), 'restructured');
        await writeFile(join(root, 'a.md'), 'markdown');

        const { documents } = await collect(folder(root, { extensions: ['.rst'] }));

        expect(documents.map((document) => document.id)).toEqual(['notes.RST']);
    });

    it('resolves a relative path against the cwd when called', async () => {
        await writeFile(join(root, 'a.md'), 'alpha');

        const { documents } = await collect(folder(relative(process.cwd(), root)));

        expect(documents.map((document) => document.id)).toEqual(['a.md']);
    });

    it('reports and skips oversized, non-UTF-8 and symlinked files once each', async () => {
        await writeFile(join(root, 'big.md'), 'a'.repeat(FOLDER_FILE_MAX_BYTES + 1));
        await writeFile(join(root, 'edge.md'), 'b'.repeat(FOLDER_FILE_MAX_BYTES));
        await writeFile(join(root, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xE9]));
        await writeFile(join(root, 'ok.md'), '# Fine');
        await symlink(join(root, 'ok.md'), join(root, 'link.md'));

        const { documents, errors } = await collect(folder(root));

        expect(documents.map((document) => document.id)).toEqual(['edge.md', 'ok.md']);
        expect(errors).toHaveLength(3);

        for (const error of errors) {
            expect(error).toBeInstanceOf(ValidationError);
        }

        const messages = errors.map((error) => (error as Error).message).join('\n');

        expect(messages).toContain('big.md');
        expect(messages).toContain('latin.txt');
        expect(messages).toContain('link.md');
    });

    it('never follows a symbolic link to a directory, and reports each link once', async () => {
        const outside = await mkdtemp(join(tmpdir(), 'chamvi-knowledge-outside-'));

        try {
            await writeFile(join(outside, 'secret.md'), '# Secret\n\nnot part of the folder');
            await mkdir(join(root, 'sub'));
            await writeFile(join(root, 'sub', 'inner.md'), '# Inner');
            await writeFile(join(root, 'ok.md'), '# Fine');
            await symlink(outside, join(root, 'linkdir'));
            // a loop back to the root
            await symlink(root, join(root, 'sub', 'up'));

            const { documents, errors } = await collect(folder(root));

            expect(documents.map((document) => document.id)).toEqual(['ok.md', 'sub/inner.md']);
            expect(errors.map((error) => (error as Error).message)).toEqual([
                'folder(): "linkdir" is a symbolic link; skipped.',
                'folder(): "sub/up" is a symbolic link; skipped.',
            ]);
        } finally {
            await rm(outside, { recursive: true, force: true });
        }
    });

    it.skipIf(process.getuid?.() === 0)('reports a directory it cannot read and indexes the rest', async () => {
        await mkdir(join(root, 'locked'));
        await writeFile(join(root, 'locked', 'hidden.md'), '# Hidden');
        await writeFile(join(root, 'ok.md'), '# Fine');
        await chmod(join(root, 'locked'), 0o000);

        try {
            const { documents, errors } = await collect(folder(root));

            expect(documents.map((document) => document.id)).toEqual(['ok.md']);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toBeInstanceOf(ValidationError);
            expect((errors[0] as Error).message).toMatch(/^folder\(\): "locked" could not be read \(.*\); skipped\.$/);
        } finally {
            await chmod(join(root, 'locked'), 0o755);
        }
    });

    it('checks its directory without reading it', async () => {
        await expect(folder(root).check!()).resolves.toBeUndefined();
        await expect(folder(join(root, 'missing')).check!()).rejects.toThrow(InvalidAgentDefinitionError);

        await writeFile(join(root, 'file.md'), 'x');
        await expect(folder(join(root, 'file.md')).check!()).rejects.toThrow(/no directory/);
    });

    it('throws for a missing directory on the first read', async () => {
        const source = folder(join(root, 'missing'));

        await expect(collect(source)).rejects.toThrow(InvalidAgentDefinitionError);
        await expect(collect(source)).rejects.toThrow(/missing/);
    });

    it('throws for a path that is no directory', async () => {
        await writeFile(join(root, 'file.md'), 'x');

        await expect(collect(folder(join(root, 'file.md')))).rejects.toThrow(InvalidAgentDefinitionError);
    });

    it('stops when the signal aborts', async () => {
        await writeFile(join(root, 'a.md'), 'alpha');

        const controller = new AbortController();

        controller.abort(new Error('stopped'));

        await expect(collect(folder(root), controller.signal)).rejects.toThrow('stopped');
    });
});
