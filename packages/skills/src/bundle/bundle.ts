/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { BigIntStats } from 'node:fs';
import {
    join,
    resolve,
} from 'node:path';
import {
    SKILL_CONTROL_PATTERN,
    SKILL_HASH_HEADER,
    SKILL_MAX_BODY_BYTES,
    SKILL_MAX_DIRECTORY_DEPTH,
    SKILL_MAX_FILES,
    SKILL_MAX_FRONTMATTER_BYTES,
    SKILL_MAX_INVENTORY_ENTRIES,
    SKILL_MAX_REFERENCE_BYTES,
    SKILL_MAX_TOTAL_BYTES,
} from './constants.ts';
import {
    compareSkillPaths,
    invalidSkill,
    parseSkillDocument,
    validateApprovedSkill,
    validateSkillDirectory,
} from './helpers.ts';
import type { ApprovedSkill, SkillBundle, SkillBundleInventory } from './types.ts';

function sameIdentity(one: BigIntStats, two: BigIntStats): boolean {
    return one.dev === two.dev && one.ino === two.ino && one.mode === two.mode &&
        one.size === two.size && one.mtimeNs === two.mtimeNs && one.ctimeNs === two.ctimeNs;
}

function inspectInventory(directory: string): SkillBundleInventory {
    const entries: SkillBundleInventory = new Map();
    const pending = [{ path: '', depth: 0 }];
    let files = 0;
    while (pending.length) {
        const current = pending.pop()!;
        const absolute = join(directory, current.path);
        const identity = fs.lstatSync(absolute, { bigint: true });
        if (!identity.isDirectory()) {
            invalidSkill(current.path || '.', 'expected a regular directory without symlinks');
        }

        entries.set(current.path, identity);
        const handle = fs.opendirSync(absolute);
        try {
            let child = handle.readSync();
            while (child) {
                const path = current.path ? `${current.path}/${child.name}` : child.name;
                if (child.name.startsWith('.') || child.name.includes('\\') || SKILL_CONTROL_PATTERN.test(child.name)) {
                    invalidSkill(current.path || '.', 'hidden or invalid paths are unsupported');
                }

                if (entries.has(path) || pending.some((entry) => entry.path === path)) {
                    invalidSkill(path, 'duplicate decoded inventory path');
                }

                if (entries.size + pending.length >= SKILL_MAX_INVENTORY_ENTRIES) {
                    invalidSkill('.', 'inventory exceeds 1024 entries');
                }

                const stat = fs.lstatSync(join(directory, path), { bigint: true });
                if (stat.isDirectory()) {
                    if (current.depth >= SKILL_MAX_DIRECTORY_DEPTH) {
                        invalidSkill(path, 'directory nesting exceeds 64 levels');
                    }

                    pending.push({ path, depth: current.depth + 1 });
                } else if (stat.isFile()) {
                    if (++files > SKILL_MAX_FILES) {
                        invalidSkill('.', 'bundle exceeds 64 regular files');
                    }

                    entries.set(path, stat);
                } else {
                    invalidSkill(path, 'symlinks and special files are unsupported');
                }

                child = handle.readSync();
            }
        } finally {
            handle.closeSync();
        }
        if (!sameIdentity(identity, fs.lstatSync(absolute, { bigint: true }))) {
            invalidSkill(current.path || '.', 'directory changed during inspection');
        }
    }
    if (!entries.get('SKILL.md')?.isFile()) {
        invalidSkill('SKILL.md', 'root file is required');
    }

    return entries;
}

function readBoundedFile(directory: string, path: string, expected: BigIntStats): Buffer {
    const limit = path === 'SKILL.md' ?
        SKILL_MAX_FRONTMATTER_BYTES + SKILL_MAX_BODY_BYTES + 10 :
        SKILL_MAX_REFERENCE_BYTES;
    if (expected.size > BigInt(limit)) {
        invalidSkill(path, 'file exceeds its byte limit');
    }

    const descriptor = fs.openSync(join(directory, path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const before = fs.fstatSync(descriptor, { bigint: true });
        if (!before.isFile() || !sameIdentity(expected, before)) {
            invalidSkill(path, 'file changed before reading');
        }

        const buffer = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        let count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
        while (count > 0) {
            length += count;
            if (length === buffer.length) {
                invalidSkill(path, 'file grew during reading');
            }

            count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
        }
        if (BigInt(length) !== before.size || !sameIdentity(before, fs.fstatSync(descriptor, { bigint: true }))) {
            invalidSkill(path, 'file changed during reading');
        }

        return buffer.subarray(0, length);
    } finally {
        fs.closeSync(descriptor);
    }
}

function readSnapshot(directory: string) {
    validateSkillDirectory(directory);
    const root = resolve(directory);
    try {
        const before = inspectInventory(root);
        const files = [...before].filter(([, stat]) => stat.isFile()).sort(([a], [b]) => compareSkillPaths(a, b));
        const hash = createHash('sha256').update(SKILL_HASH_HEADER);
        const contents = new Map<string, string>();
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        let total = 0;
        for (const [path, identity] of files) {
            if (BigInt(total) + identity.size > BigInt(SKILL_MAX_TOTAL_BYTES)) {
                invalidSkill('.', 'bundle exceeds 1 MiB');
            }

            const buffer = readBoundedFile(root, path, identity);
            total += buffer.length;
            let content: string;
            try {
                content = decoder.decode(buffer);
            } catch {
                invalidSkill(path, 'file must be valid UTF-8 text');
            }
            if (content.includes('\0')) {
                invalidSkill(path, 'binary content is unsupported');
            }

            contents.set(path, content);
            const pathBytes = Buffer.from(path);
            hash.update(`${pathBytes.length}:`).update(pathBytes).update(`${buffer.length}:`).update(buffer);
        }
        const after = inspectInventory(root);
        if (before.size !== after.size || [...before].some(([path, identity]) => !after.has(path) || !sameIdentity(identity, after.get(path)!))) {
            invalidSkill('.', 'bundle changed during loading');
        }

        const document = parseSkillDocument(contents.get('SKILL.md')!);
        contents.delete('SKILL.md');
        return {
            document,
            hash: hash.digest('hex'),
            contents,
        };
    } catch (error) {
        if (error instanceof InvalidAgentDefinitionError) {
            throw error;
        }

        return invalidSkill('.', 'cannot read a stable passive bundle');
    }
}

/** Review aid: validates all passive bundle files and hashes their exact bytes; it grants no approval. */
export function hashSkillBundle(directory: string): string {
    return readSnapshot(directory).hash;
}

export function readSkillBundle(descriptor: ApprovedSkill): SkillBundle {
    validateApprovedSkill(descriptor);
    const {
        document,
        hash,
        contents,
    } = readSnapshot(descriptor.directory);
    if (document.name !== descriptor.name) {
        invalidSkill('SKILL.md', 'name does not match the approved descriptor');
    }

    if (hash !== descriptor.hash) {
        invalidSkill('.', 'hash does not match the approved pin');
    }

    return Object.freeze({
        metadata: Object.freeze({
            name: document.name,
            description: document.description,
            version: descriptor.version,
            hash,
            ignoredFields: document.ignoredFields,
        }),
        body: document.body,
        references: Object.freeze(contents.keys().toArray()),
        readReference: (path: string) => contents.get(path),
    });
}
