/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import {
    SandboxError,
    ValidationError,
    systemClock,
} from '@chamvi/core';
import { resolveWorkspacePath } from '../path/module.ts';
import type { ExecResult, IWorkspace } from '../workspace/types.ts';
import {
    DISCOVERY_SCRIPT,
    INSPECT_BATCH_MAX_BYTES,
    INSPECT_BATCH_MAX_PATHS,
    INSTRUCTION_DIRECTORIES_MAX,
    INSTRUCTION_EXEC_TIMEOUT_MS,
    INSTRUCTION_FILES,
    INSTRUCTION_INCLUDE_DEPTH_MAX,
    INSTRUCTION_PATHS_MAX,
    INSTRUCTION_PATH_MAX_BYTES,
    INSTRUCTION_REFERENCES_MAX,
    INSTRUCTION_REQUEST_TIMEOUT_MS,
    INSTRUCTION_SOURCES_MAX,
    INSTRUCTION_SOURCE_MAX_BYTES,
    INSTRUCTION_TOTAL_MAX_BYTES,
} from './constants.ts';
import {
    byteLength,
    createDiagnosticList,
    directoryChain,
    isGitPath,
    parseIncludes,
    parseInspectOutput,
    parseReadOutput,
    pathPrefix,
    resolveInclude,
} from './helpers.ts';
import type {
    IncludeTarget,
    InspectionStatus,
    ReadRepositoryInstructionsOptions,
    RepositoryInstructionSource,
    RepositoryInstructions,
} from './types.ts';

/** Thrown inside the collection once the request's time is used up; becomes a `limit` diagnostic. */
class DeadlineSignal {}

const LINK_MESSAGE = 'A symbolic link; links are never followed.';
const SPECIAL_MESSAGE = 'Not a regular file.';
const DENIED_MESSAGE = 'The directory cannot be searched.';
const UNREADABLE_MESSAGE = 'The file cannot be read.';

type Node = {
    source: RepositoryInstructionSource;
    includes: string[];
} | undefined;

/**
 * Reads the development instructions of a repository workspace for
 * `paths` (default the root): per directory from the root down to each
 * path, `AGENTS.md` then `CLAUDE.md`, each followed depth first by the
 * files its standalone `@path` lines include. Everything goes through
 * `workspace.exec` with a fixed script (no host path, no repository
 * program); symbolic links, special files and `.git` are refused whenever
 * observed, which is a best-effort check, not a guarantee against a
 * concurrent change. A source is returned whole or omitted with a
 * diagnostic; a transport failure, a malformed answer or an abort rejects
 * with a SandboxError instead of reading as no instructions.
 */
export async function readRepositoryInstructions(
    workspace: IWorkspace,
    paths?: readonly string[],
    options: ReadRepositoryInstructionsOptions = {},
): Promise<RepositoryInstructions> {
    const { signal } = options;
    const clock = options.clock ?? systemClock;
    const deadline = clock.now().getTime() + INSTRUCTION_REQUEST_TIMEOUT_MS;
    const redact = (text: string) => (workspace.redact ? workspace.redact(text) : text);
    const diagnostics = createDiagnosticList(redact);
    const requested = paths ?? ['.'];
    if (!Array.isArray(requested)) {
        throw new ValidationError('paths must be a list of workspace paths.');
    }

    let references = 0;
    let totalBytes = 0;
    let stopped = false;
    const stop = (message: string) => {
        if (stopped) return;
        stopped = true;
        diagnostics.add('.', 'limit', message);
    };
    /** Counts one inspection or reference; false (and stopped) past the bound. */
    const count = () => {
        if (stopped) return false;
        if (references >= INSTRUCTION_REFERENCES_MAX) {
            stop(`More than ${INSTRUCTION_REFERENCES_MAX} paths and references were looked at; the rest were skipped.`);
            return false;
        }
        references++;
        return true;
    };

    const expiry = new AbortController();
    const execScript = async (args: string[]) => {
        if (signal?.aborted) throw new SandboxError('Repository instruction discovery aborted.');
        const left = deadline - clock.now().getTime();
        if (left <= 0) throw new DeadlineSignal();
        const timeoutMs = Math.min(INSTRUCTION_EXEC_TIMEOUT_MS, left);
        const execDeadline = clock.now().getTime() + timeoutMs;
        const operation = new AbortController();
        const execSignal = AbortSignal.any(signal ?
            [signal, expiry.signal, operation.signal] : [expiry.signal, operation.signal]);
        // Bound the whole call, including credential refresh and a provider's transport grace.
        return new Promise<ExecResult>((resolve, reject) => {
            let settled = false;
            const timer = clock.setTimeout(() => operation.abort(), timeoutMs);
            const finish = () => {
                if (settled) return false;
                settled = true;
                timer.clear();
                execSignal.removeEventListener('abort', onAbort);
                return true;
            };
            function onAbort() {
                if (!finish()) return;
                if (signal?.aborted) reject(new SandboxError('Repository instruction discovery aborted.'));
                else if (expiry.signal.aborted || clock.now().getTime() >= deadline) reject(new DeadlineSignal());
                else reject(new SandboxError('Repository instruction discovery timed out.'));
                operation.abort();
            }
            execSignal.addEventListener('abort', onAbort, { once: true });
            let pending: Promise<ExecResult>;
            try {
                pending = workspace.exec(['/bin/sh', '-c', DISCOVERY_SCRIPT, 'sh', ...args], {
                    cwd: '.',
                    timeoutMs,
                    signal: execSignal,
                });
            } catch (error) {
                pending = Promise.reject(error);
            }
            pending.then((response) => {
                if (settled) return;
                if (execSignal.aborted || clock.now().getTime() >= execDeadline) {
                    onAbort();
                    return;
                }
                if (finish()) resolve(response);
            }, (error: unknown) => {
                if (finish()) reject(error);
            });
        });
    };

    const statuses = new Map<string, InspectionStatus>();
    /** Inspects the paths not inspected yet, in batches. */
    const inspect = async (list: string[]) => {
        const pending = [...new Set(list.filter((path) => !statuses.has(path)))];
        while (pending.length > 0) {
            const batch: string[] = [];
            let bytes = 0;
            for (let next = pending[0]; next !== undefined; next = pending[0]) {
                if (batch.length >= INSPECT_BATCH_MAX_PATHS || (batch.length > 0 && bytes + byteLength(next) > INSPECT_BATCH_MAX_BYTES)) break;
                bytes += byteLength(next);
                batch.push(next);
                pending.shift();
            }
            const result = await execScript(['inspect', ...batch]);
            const found = parseInspectOutput(result, batch.length);
            batch.forEach((path, index) => statuses.set(path, found[index]!));
        }
    };

    /** Reports a status that is no regular file; `missing` names the code of an absent path. */
    const report = (path: string, status: InspectionStatus | { kind: 'unreadable' }, missing?: 'missing-include') => {
        switch (status.kind) {
            case 'absent':
                if (missing) diagnostics.add(path, missing, 'The included file does not exist.');
                return;
            case 'link':
                diagnostics.add(pathPrefix(path, status.at), 'unsupported-file', LINK_MESSAGE);
                return;
            case 'denied':
                diagnostics.add(pathPrefix(path, status.at - 1), 'unreadable', DENIED_MESSAGE);
                return;
            case 'unreadable':
                diagnostics.add(path, 'unreadable', UNREADABLE_MESSAGE);
                return;
            case 'file':
                // a regular file is no failure
                return;
            default:
                diagnostics.add(path, 'unsupported-file', SPECIAL_MESSAGE);
        }
    };

    const sources: RepositoryInstructionSource[] = [];
    const nodes = new Map<string, Node>();

    /** Reads and records a file once per request; undefined when it failed (reported once). */
    const load = async (path: string, include: boolean): Promise<Node> => {
        if (nodes.has(path)) return nodes.get(path);
        if (sources.length >= INSTRUCTION_SOURCES_MAX) {
            stop(`More than ${INSTRUCTION_SOURCES_MAX} instruction files; the rest were skipped.`);
            return undefined;
        }
        const outcome = parseReadOutput(await execScript(['read', path]));
        let node: Node;
        if (outcome.kind !== 'bytes') {
            report(path, outcome, include ? 'missing-include' : undefined);
        } else if (outcome.bytes.byteLength > INSTRUCTION_SOURCE_MAX_BYTES) {
            diagnostics.add(path, 'limit', `The file is larger than ${INSTRUCTION_SOURCE_MAX_BYTES} bytes and was omitted.`);
        } else if (totalBytes + outcome.bytes.byteLength > INSTRUCTION_TOTAL_MAX_BYTES) {
            stop(`The instruction files exceed ${INSTRUCTION_TOTAL_MAX_BYTES} bytes together; the rest were skipped.`);
        } else {
            let text: string | undefined;
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(outcome.bytes);
            } catch {
                diagnostics.add(path, 'invalid-utf8', 'The file is not valid UTF-8.');
            }
            if (text !== undefined) {
                totalBytes += outcome.bytes.byteLength;
                // redacted before anything reads it, the digest is of the bytes on disk
                const content = redact(text);
                const source: RepositoryInstructionSource = {
                    path,
                    sha256: createHash('sha256').update(outcome.bytes).digest('hex'),
                    content,
                    scopes: [],
                    includedBy: [],
                };
                sources.push(source);
                node = { source, includes: parseIncludes(content) };
            }
        }
        nodes.set(path, node);
        return node;
    };

    const visited = new Map<string, number>();
    const visit = async (path: string, scope: string, parent: string | undefined, ancestry: string[]): Promise<void> => {
        if (stopped) return;
        const node = await load(path, parent !== undefined);
        if (!node) return;
        if (!node.source.scopes.includes(scope)) node.source.scopes.push(scope);
        if (parent !== undefined && !node.source.includedBy.includes(parent)) node.source.includedBy.push(parent);
        if (ancestry.includes(path)) {
            diagnostics.add(path, 'cycle', 'The file includes itself through the files it includes.');
            return;
        }
        const key = `${path}\0${scope}`;
        // A shorter route can reach descendants that exceeded the depth limit before.
        const previousDepth = visited.get(key);
        if (previousDepth !== undefined && previousDepth <= ancestry.length) return;
        visited.set(key, ancestry.length);

        const depth = ancestry.length + 1;
        const targets: Array<{ reference: string; target: IncludeTarget }> = [];
        for (const reference of node.includes) {
            if (!count()) break;
            targets.push({ reference, target: resolveInclude(path, reference) });
        }
        await inspect(targets.flatMap(({ target }) => (target.kind === 'path' && depth <= INSTRUCTION_INCLUDE_DEPTH_MAX ? [target.path] : [])));
        for (const { reference, target } of targets) {
            if (stopped) return;
            if (target.kind === 'diagnostic') {
                diagnostics.add(reference, target.code, target.message);
                continue;
            }
            if (depth > INSTRUCTION_INCLUDE_DEPTH_MAX) {
                diagnostics.add(target.path, 'limit', `Includes nest deeper than ${INSTRUCTION_INCLUDE_DEPTH_MAX} levels.`);
                continue;
            }
            const status = statuses.get(target.path)!;
            if (status.kind === 'file') {
                await visit(target.path, scope, path, [...ancestry, path]);
            } else {
                report(target.path, status, 'missing-include');
            }
        }
    };

    const collect = async () => {
        // the requested paths
        const accepted: string[] = [];
        for (const raw of requested.slice(0, INSTRUCTION_PATHS_MAX)) {
            if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\0')) {
                throw new ValidationError('paths must be non-empty strings without NUL.');
            }
            if (byteLength(raw) > INSTRUCTION_PATH_MAX_BYTES) {
                diagnostics.add(raw, 'limit', `The path is longer than ${INSTRUCTION_PATH_MAX_BYTES} bytes.`);
                continue;
            }
            let path: string;
            try {
                path = resolveWorkspacePath(raw);
            } catch {
                diagnostics.add(raw, 'outside-workspace', 'The path is not inside the workspace.');
                continue;
            }
            accepted.push(path);
        }
        if (requested.length > INSTRUCTION_PATHS_MAX) {
            diagnostics.add('.', 'limit', `Only the first ${INSTRUCTION_PATHS_MAX} paths were looked at.`);
        }
        result.paths = accepted;

        const inspectable = accepted.filter((path) => path !== '.' && !isGitPath(path));
        await inspect(inspectable.filter(() => count()));

        // the directories each path reaches, in request order
        const directories: string[] = [];
        for (const path of accepted) {
            if (stopped) break;
            let chain: string[];
            if (path === '.') {
                chain = ['.'];
            } else if (isGitPath(path)) {
                diagnostics.add(path, 'unsupported-file', 'Paths in .git are never read.');
                continue;
            } else {
                const status = statuses.get(path);
                if (!status) break;
                const components = path.split('/').length;
                if (status.kind === 'link') {
                    report(path, status);
                    chain = directoryChain(pathPrefix(path, status.at - 1));
                } else if (status.kind === 'denied') {
                    report(path, status);
                    if (status.at < 2) continue;
                    chain = directoryChain(pathPrefix(path, status.at - 2));
                } else {
                    chain = directoryChain(pathPrefix(path, status.kind === 'dir' ? components : components - 1));
                }
            }
            for (const dir of chain) {
                if (directories.includes(dir)) continue;
                if (directories.length >= INSTRUCTION_DIRECTORIES_MAX) {
                    diagnostics.add('.', 'limit', `More than ${INSTRUCTION_DIRECTORIES_MAX} directories; the deeper ones were skipped.`);
                    break;
                }
                directories.push(dir);
            }
        }

        // root first, then each level, each level in code-point order
        const depthOf = (dir: string) => (dir === '.' ? 0 : dir.split('/').length);
        const order = (a: string, b: string) => {
            if (a === b) return 0;
            return a < b ? -1 : 1;
        };
        directories.sort((a, b) => depthOf(a) - depthOf(b) || order(a, b));

        const candidates: Array<{ dir: string; path: string }> = [];
        for (const dir of directories) {
            for (const name of INSTRUCTION_FILES) {
                if (!count()) break;
                candidates.push({ dir, path: dir === '.' ? name : `${dir}/${name}` });
            }
        }
        await inspect(candidates.map(({ path }) => path));
        for (const { dir, path } of candidates) {
            if (stopped) break;
            const status = statuses.get(path)!;
            if (status.kind === 'file') {
                await visit(path, dir, undefined, []);
            } else {
                report(path, status);
            }
        }
    };

    const result: RepositoryInstructions = {
        commit: workspace.info.commit ?? null,
        paths: [],
        sources,
        diagnostics: diagnostics.entries,
        complete: true,
    };
    const timer = clock.setTimeout(() => expiry.abort(), INSTRUCTION_REQUEST_TIMEOUT_MS);
    try {
        await collect();
    } catch (error) {
        if (!(error instanceof DeadlineSignal)) throw error;
        stop(`The request took longer than ${INSTRUCTION_REQUEST_TIMEOUT_MS / 1000} s; the rest was skipped.`);
    } finally {
        timer.clear();
    }
    if (signal?.aborted) throw new SandboxError('Repository instruction discovery aborted.');

    const redactedPaths = result.paths.map(redact);
    const redactedSources = sources.map((source) => ({
        ...source,
        path: redact(source.path),
        scopes: source.scopes.map(redact),
        includedBy: source.includedBy.map(redact),
    }));
    if (expiry.signal.aborted || clock.now().getTime() >= deadline) {
        stop(`The request took longer than ${INSTRUCTION_REQUEST_TIMEOUT_MS / 1000} s; the rest was skipped.`);
    }
    return {
        commit: result.commit,
        paths: redactedPaths,
        sources: redactedSources,
        diagnostics: diagnostics.entries,
        complete: diagnostics.entries.length === 0,
    };
}
