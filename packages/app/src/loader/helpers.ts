/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { createHash } from 'node:crypto';
import {
    readFileSync,
    readdirSync,
    realpathSync,
    statSync,
} from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import {
    basename,
    dirname,
    extname,
    join,
    relative,
    sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { createJiti } from 'jiti';
import type { Jiti } from 'jiti';
import { locateMany } from 'locter';
import { isObject } from 'smob';
import { HASH_IGNORE_PATTERNS, HASH_IMPORTABLE_EXTENSIONS, PINNED_PACKAGE_SCOPES } from './constants.ts';

let moduleJiti: Jiti | undefined;

/**
 * The default reader of `agent.ts`: `readModule` on one jiti that pins the
 * app's packages (`createPackageAliases`), created on first use.
 */
export function readFreshModule(path: string): Promise<unknown> {
    moduleJiti ??= createModuleJiti(import.meta.url);
    return readModule(moduleJiti, path);
}

/**
 * A jiti without module or fs cache (writes nothing into `node_modules`)
 * whose bare `@chamvi/*`, `ai` and `@ai-sdk/*` specifiers resolve to the
 * copies `from` resolves, wherever the importing file lives.
 */
export function createModuleJiti(from: string): Jiti {
    return createJiti(from, {
        moduleCache: false,
        fsCache: false,
        interopDefault: true,
        alias: createPackageAliases(from),
    });
}

/**
 * Evaluates a module file fresh on every call (transpiled, never from Node's
 * module cache). Its relative `.ts`/`.mts` imports are transpiled fresh too;
 * packages load natively (one instance).
 */
export async function readModule(jiti: Jiti, path: string): Promise<unknown> {
    const source = await readFile(path, 'utf8');
    return jiti.evalModule(source, {
        filename: path,
        async: true,
        forceTranspile: true,
    });
}

/**
 * Alias entries (`specifier -> absolute file`) for every package named
 * `@chamvi/*`, `ai` or `@ai-sdk/*` that `from` can resolve (the closest
 * `node_modules` first), one per exported subpath without a wildcard,
 * resolved with the ESM conditions from `from`.
 */
export function createPackageAliases(from: string): Record<string, string> {
    const fromPath = from.startsWith('file:') ? fileURLToPath(from) : from;
    const resolver = createJiti(fromPath, { moduleCache: false, fsCache: false });
    const packages = new Map<string, string>();
    for (const modules of nodeModulesPaths(dirname(fromPath))) {
        for (const name of listPinnedPackages(modules)) {
            if (!packages.has(name)) packages.set(name, join(modules, name));
        }
    }

    const aliases: Record<string, string> = {};
    for (const [name, dir] of packages) {
        for (const subpath of exportedSubpaths(dir)) {
            const specifier = subpath === '.' ? name : `${name}${subpath.slice(1)}`;
            try {
                const resolved = resolver.esmResolve(specifier, { parentURL: pathToFileURL(fromPath).href });
                aliases[specifier] = realpathSync(resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved);
            } catch {
                // not resolvable with the import conditions (e.g. a require-only subpath): left to jiti
            }
        }
    }
    return aliases;
}

function nodeModulesPaths(start: string): string[] {
    const paths: string[] = [];
    let dir = start;
    for (;;) {
        if (basename(dir) !== 'node_modules') paths.push(join(dir, 'node_modules'));
        const parent = dirname(dir);
        if (parent === dir) return paths;
        dir = parent;
    }
}

function listPinnedPackages(modules: string): string[] {
    const names: string[] = [];
    if (isDirectorySync(join(modules, 'ai'))) names.push('ai');
    for (const scope of PINNED_PACKAGE_SCOPES) {
        let entries: string[];
        try {
            entries = readdirSync(join(modules, scope));
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.startsWith('.')) names.push(`${scope}/${entry}`);
        }
    }
    return names;
}

/** The subpaths a package exports (`.` and `./x`), wildcards and `./package.json` left out. */
function exportedSubpaths(dir: string): string[] {
    let manifest: unknown;
    try {
        manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
        return [];
    }
    if (!isObject(manifest)) return [];
    const { exports } = manifest;
    if (!isObject(exports)) return ['.'];
    const keys = Object.keys(exports);
    if (keys.every((key) => !key.startsWith('.'))) return ['.'];
    return keys.filter((key) => key.startsWith('.') && !key.includes('*') && key !== './package.json');
}

function isDirectorySync(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

export async function isDirectory(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}

export async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

export function compareCodePoints(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

/** The message of a thrown value, with its cause's message when that adds to it. */
export function messageOf(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof Error && cause.message && !message.includes(cause.message)) {
        return `${message} (${cause.message})`;
    }
    return message;
}

/** `message` with every spelling of `base` (path, real path, file URL) cut, so it names paths relative to it. */
export function relativize(message: string, base: string): string {
    const prefixes = new Set<string>([base]);
    try {
        prefixes.add(realpathSync(base));
    } catch {
        // a missing base has no real path
    }
    for (const prefix of [...prefixes]) {
        prefixes.add(pathToFileURL(prefix).href);
    }
    let out = message;
    // the longest first, so a URL is not cut down to its path part
    for (const prefix of [...prefixes].sort((a, b) => b.length - a.length)) {
        out = out.split(`${prefix}${prefix.startsWith('file:') ? '/' : sep}`).join('');
        out = out.split(prefix).join('.');
    }
    return out;
}

/** The default export of a module namespace, or an error naming the file. */
export function defaultExportOf(mod: unknown, file: string): unknown {
    if ((isObject(mod) || typeof mod === 'function') && 'default' in mod) {
        return (mod as { default: unknown }).default;
    }
    throw new InvalidAgentDefinitionError(`${file}: has no default export.`);
}

/**
 * Whether the folder hash leaves out `file` (a relative POSIX path): its
 * basename matches HASH_IGNORE_PATTERNS and the loader cannot import it.
 */
export function isHashIgnored(file: string): boolean {
    const name = file.slice(file.lastIndexOf('/') + 1);
    const extension = extname(name).toLowerCase();
    if ((HASH_IMPORTABLE_EXTENSIONS as readonly string[]).includes(extension)) return false;
    return HASH_IGNORE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * sha256 (hex) over the files below `dir` that `include` keeps (dot-entries
 * skipped) by relative POSIX path, each as `path + '\0' + bytes + '\0'`.
 */
export async function hashFolder(dir: string, include: (key: string) => boolean): Promise<string> {
    const found = await locateMany('**/*', {
        cwd: dir,
        onlyFiles: true,
        dot: false,
    });
    const files = found
        .map((info) => ({ path: info.path, key: relative(dir, info.path).split(sep).join('/') }))
        .filter((file) => include(file.key))
        .sort((a, b) => compareCodePoints(a.key, b.key));
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(`${file.key}\0`);
        hash.update(await readFile(file.path));
        hash.update('\0');
    }
    return hash.digest('hex');
}

/**
 * The hash of an agent folder before HASH_IGNORE_PATTERNS existed (every
 * file but dot-entries), or undefined when it equals `hash` (no ignored file):
 * a revision marker at it holds the same content, so a reload moves it
 * without cancelling runs.
 */
export async function formerAgentFolderHash(dir: string, hash: string): Promise<string | undefined> {
    const former = await hashFolder(dir, () => true);
    return former === hash ? undefined : former;
}
