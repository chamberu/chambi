/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { hashSkillBundle, readSkillBundle } from '../../../src/skills/bundle.ts';

const directories: string[] = [];
const frontmatter = 'name: audit\ndescription: Review code\n';
const skill = (metadata = frontmatter, body = 'Audit the code.\n') => `---\n${metadata}---\n${body}`;

function bundle(files: Record<string, string | Buffer> = {}): string {
    const directory = fs.mkdtempSync(join(tmpdir(), 'chamvi-skill-'));
    directories.push(directory);
    for (const [path, content] of Object.entries({ 'SKILL.md': skill(), ...files })) {
        fs.mkdirSync(dirname(join(directory, path)), { recursive: true });
        fs.writeFileSync(join(directory, path), content);
    }
    return directory;
}

function descriptor(directory: string) {
    return {
        name: 'audit',
        version: '1.0.0',
        directory,
        sha256: hashSkillBundle(directory),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
    directories.length = 0;
});

describe('passive skill bundles', () => {
    it('hash_is_deterministic_and_covers_all_files', () => {
        const files = {
            'references/README.md': 'read me',
            'data.json': '{}',
            LICENSE: 'license',
        };
        const one = bundle(files);
        const two = bundle({
            LICENSE: 'license',
            'data.json': '{}',
            'references/README.md': 'read me',
        });
        const original = hashSkillBundle(one);
        expect(hashSkillBundle(two)).toBe(original);
        for (const [path, content] of Object.entries({ 'SKILL.md': skill(), ...files })) {
            fs.writeFileSync(join(two, path), `${content}changed`);
            expect(hashSkillBundle(two)).not.toBe(original);
            fs.writeFileSync(join(two, path), content);
        }
        fs.writeFileSync(join(two, 'SKILL.md'), skill('name: audit\ndescription: Different\n'));
        expect(hashSkillBundle(two)).not.toBe(original);
        fs.writeFileSync(join(two, 'SKILL.md'), skill());
        fs.renameSync(join(two, 'data.json'), join(two, 'other.json'));
        expect(hashSkillBundle(two)).not.toBe(original);
    });

    it('uses_exact_length_framing_and_code_point_order', () => {
        const directory = bundle({
            'a.txt': 'BC',
            '😀.txt': 'astral',
            '\uE000.txt': 'bmp',
        });
        const root = skill();
        const expected = createHash('sha256')
            .update('chamvi-skill-bundle-v1\n')
            .update(`8:SKILL.md${Buffer.byteLength(root)}:${root}`)
            .update('5:a.txt2:BC')
            .update('7:\uE000.txt3:bmp')
            .update('8:😀.txt6:astral')
            .digest('hex');
        expect(hashSkillBundle(directory)).toBe(expected);
    });

    it('framing_distinguishes_path_content_boundaries', () => {
        expect(hashSkillBundle(bundle({ 'a.txt': 'b.txtC' })))
            .not.toBe(hashSkillBundle(bundle({ 'a.txtb.txt': 'C' })));
    });

    it('requires_matching_name_and_pin', () => {
        const approved = descriptor(bundle());
        expect(readSkillBundle(approved).metadata.name).toBe('audit');
        for (const sha256 of ['', 'a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64), '0'.repeat(64)]) {
            expect(() => readSkillBundle({ ...approved, sha256 })).toThrow(InvalidAgentDefinitionError);
        }
        expect(() => readSkillBundle({ ...approved, name: 'other' })).toThrow(InvalidAgentDefinitionError);
        expect(() => readSkillBundle({ ...approved, name: 'Audit' })).toThrow(InvalidAgentDefinitionError);
    });

    it.each(['', 'latest', 'LATEST', 'main', 'master', 'HEAD', '^1.0', '~1', '1.*', 'x', '1.x', '1.2.X', '>=1', '1 || 2', '1\n2', 'a'.repeat(129)])('rejects inexact descriptor version %j', (version) => {
        const approved = descriptor(bundle());
        expect(() => readSkillBundle({ ...approved, version })).toThrow(InvalidAgentDefinitionError);
    });

    it('accepts exact opaque versions and frozen metadata snapshots', () => {
        const loaded = readSkillBundle({ ...descriptor(bundle()), version: 'release-2026.10+reviewed' });
        expect(loaded.metadata.version).toBe('release-2026.10+reviewed');
        expect(Object.isFrozen(loaded)).toBe(true);
        expect(Object.isFrozen(loaded.metadata)).toBe(true);
        expect(Object.isFrozen(loaded.metadata.ignoredFields)).toBe(true);
        expect(Object.isFrozen(loaded.references)).toBe(true);
    });

    it.each([
        'name: &name audit\ndescription: *name\n',
        `${frontmatter}ignored: &x [*x]\n`,
        'name: !!str audit\ndescription: !evil Review\n',
        `${frontmatter}ignored: !!js/function something\n`,
        `${frontmatter}ignored: !<tag:example.com,2026:thing> text\n`,
        `${frontmatter}description: Duplicate\n`,
        'name: 1\ndescription: Review\n',
        'name: audit\ndescription: [Review]\n',
        'name: audit\ndescription: null\n',
        'name: audit\ndescription: " "\n',
        'name: audit\ndescription: "bad\\u0000text"\n',
        'name: "audit\\nother"\ndescription: Review\n',
        `${frontmatter}1: ignored\n`,
        '[name, description]\n',
        `${frontmatter}ignored: [unterminated\n`,
    ])('rejects_aliases_custom_tags_duplicate_keys_and_nonstring_metadata %j', (metadata) => {
        expect(() => hashSkillBundle(bundle({ 'SKILL.md': skill(metadata) }))).toThrow(InvalidAgentDefinitionError);
    });

    it('reports_ignored_fields_without_applying_them', () => {
        const directory = bundle({ 'SKILL.md': skill(`${frontmatter}model: provider/model\nallowed-tools: [shell]\nextra: {nested: value}\n`) });
        const loaded = readSkillBundle(descriptor(directory));
        expect(loaded.metadata.ignoredFields).toEqual(['allowed-tools', 'extra', 'model']);
        expect(Object.keys(loaded.metadata).sort()).toEqual(['description', 'ignoredFields', 'name', 'sha256', 'version']);
        expect(loaded.body).toBe('Audit the code.\n');
    });

    it.each(['.hidden.txt', '.hidden/a.md', 'references/.hidden', 'script.js', 'script.ts', 'image.png', 'x\\y.txt'])('rejects hidden or unsupported path %j', (path) => {
        expect(() => hashSkillBundle(bundle({ [path]: 'text' }))).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects_symlinks_and_special_files_without_executing_content', () => {
        const directory = bundle();
        const outside = bundle({ 'safe.txt': 'outside' });
        const marker = join(directory, 'marker.txt');
        fs.writeFileSync(join(directory, 'instructions.txt'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`);
        expect(hashSkillBundle(directory)).toMatch(/^[a-f0-9]{64}$/);
        expect(fs.existsSync(marker)).toBe(false);
        fs.symlinkSync(join(outside, 'safe.txt'), join(directory, 'link.txt'));
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
        fs.unlinkSync(join(directory, 'link.txt'));
        fs.symlinkSync(outside, join(directory, 'linked'));
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
        expect(() => hashSkillBundle(join(directory, 'linked'))).toThrow(InvalidAgentDefinitionError);
        fs.unlinkSync(join(directory, 'linked'));
        execFileSync('mkfifo', [join(directory, 'pipe.txt')]);
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
        expect(() => hashSkillBundle('relative')).toThrow(InvalidAgentDefinitionError);
    });

    it('bounds_metadata_body_references_total_and_count', () => {
        const directory = bundle();
        const metadata = `${frontmatter}#${'x'.repeat(4096 - Buffer.byteLength(frontmatter) - 2)}\n`;
        fs.writeFileSync(join(directory, 'SKILL.md'), skill(metadata, 'x'.repeat(65536)));
        expect(hashSkillBundle(directory)).toMatch(/^[a-f0-9]{64}$/);
        fs.writeFileSync(join(directory, 'SKILL.md'), skill(metadata.replace('#', '#x')));
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
        fs.writeFileSync(join(directory, 'SKILL.md'), skill(frontmatter, 'x'.repeat(65537)));
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
        fs.writeFileSync(join(directory, 'SKILL.md'), skill());
        fs.writeFileSync(join(directory, 'ref.txt'), 'x'.repeat(131072));
        expect(hashSkillBundle(directory)).toMatch(/^[a-f0-9]{64}$/);
        fs.appendFileSync(join(directory, 'ref.txt'), 'x');
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
        fs.unlinkSync(join(directory, 'ref.txt'));
        for (let index = 0; index < 63; index++) fs.writeFileSync(join(directory, `${index}.txt`), '');
        expect(hashSkillBundle(directory)).toMatch(/^[a-f0-9]{64}$/);
        fs.writeFileSync(join(directory, 'overflow.txt'), '');
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);

        const total = bundle();
        for (let index = 0; index < 7; index++) fs.writeFileSync(join(total, `${index}.txt`), 'x'.repeat(131072));
        fs.writeFileSync(join(total, 'last.txt'), 'x'.repeat(131072 - Buffer.byteLength(skill())));
        expect(hashSkillBundle(total)).toMatch(/^[a-f0-9]{64}$/);
        fs.appendFileSync(join(total, 'last.txt'), 'x');
        expect(() => hashSkillBundle(total)).toThrow(InvalidAgentDefinitionError);
    });

    it('bounds_description_length_and_requires_root_frontmatter', () => {
        expect(hashSkillBundle(bundle({ 'SKILL.md': skill(`name: audit\ndescription: ${'x'.repeat(1024)}\n`) }))).toMatch(/^[a-f0-9]{64}$/);
        for (const content of [skill(`name: audit\ndescription: ${'x'.repeat(1025)}\n`), 'no frontmatter', '---\nname: audit\n']) {
            expect(() => hashSkillBundle(bundle({ 'SKILL.md': content }))).toThrow(InvalidAgentDefinitionError);
        }
        const directory = bundle();
        fs.unlinkSync(join(directory, 'SKILL.md'));
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects_invalid_utf8_without_leaking_body_or_absolute_path', () => {
        const directory = bundle({ 'secret.txt': Buffer.from([0xc3, 0x28]) });
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
        fs.writeFileSync(join(directory, 'SKILL.md'), skill('name: audit\ndescription: [PRIVATE-SECRET\n'));
        fs.unlinkSync(join(directory, 'secret.txt'));
        try {
            hashSkillBundle(directory);
            expect.unreachable('invalid YAML was accepted');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
            expect((error as Error).message).not.toContain(directory);
            expect((error as Error).message).not.toContain('PRIVATE-SECRET');
            expect((error as Error).message).toContain('SKILL.md');
        }
    });

    it('rejects_binary_text_and_final_symlink_swaps', () => {
        expect(() => hashSkillBundle(bundle({ 'binary.txt': 'text\0binary' }))).toThrow(InvalidAgentDefinitionError);
        const directory = bundle({ 'ref.txt': 'approved reference' });
        const outside = bundle({ 'secret.txt': 'private outside content' });
        const open = fs.openSync;
        vi.spyOn(fs, 'openSync').mockImplementation((...args: Parameters<typeof fs.openSync>) => {
            if (String(args[0]) === join(directory, 'ref.txt')) {
                fs.unlinkSync(join(directory, 'ref.txt'));
                fs.symlinkSync(join(outside, 'secret.txt'), join(directory, 'ref.txt'));
            }
            return open(...args);
        });
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects_unstable_inventory_including_empty_directories', () => {
        const directory = bundle();
        const read = fs.readSync;
        let changed = false;
        vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
            const result = read(...args);
            if (!changed) {
                changed = true;
                fs.mkdirSync(join(directory, 'new-empty-directory'));
            }
            return result;
        });
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
    });

    it('rejects_file_changes_during_reads', () => {
        const directory = bundle({ 'ref.txt': 'original' });
        const read = fs.readSync;
        let changed = false;
        vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
            const result = read(...args);
            if (!changed) {
                changed = true;
                fs.appendFileSync(join(directory, 'SKILL.md'), 'changed');
            }
            return result;
        });
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
    });

    it('bounds_empty_directory_traversal', () => {
        const directory = bundle();
        for (let index = 0; index < 1025; index++) fs.mkdirSync(join(directory, `empty-${index}`));
        expect(() => hashSkillBundle(directory)).toThrow(InvalidAgentDefinitionError);
    });

    it('snapshot_survives_source_change_but_restart_rejects_old_pin', () => {
        const directory = bundle({ 'references/README.md': 'original reference', 'data.json': '{invalid opaque JSON' });
        const approved = descriptor(directory);
        const loaded = readSkillBundle(approved);
        expect(loaded.references).toEqual(['data.json', 'references/README.md']);
        expect(loaded.readReference('data.json')).toBe('{invalid opaque JSON');
        expect(loaded.readReference('SKILL.md')).toBeUndefined();
        fs.writeFileSync(join(directory, 'references/README.md'), 'new reference');
        fs.writeFileSync(join(directory, 'SKILL.md'), skill(frontmatter, 'new body'));
        expect(loaded.body).toBe('Audit the code.\n');
        expect(loaded.readReference('references/README.md')).toBe('original reference');
        expect(() => readSkillBundle(approved)).toThrow(InvalidAgentDefinitionError);
    });
});
