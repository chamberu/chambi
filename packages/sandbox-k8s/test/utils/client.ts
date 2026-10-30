/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { V1Pod, V1PodStatus } from '@kubernetes/client-node';
import { expect } from 'vitest';
import { SandboxError } from '@chamvi/core';
import type { IPodClient, PodExecInput } from '@chamvi/sandbox-k8s';

export type FakeExecAnswer = {
    exitCode?: number;
    stdout?: string;
    stderr?: string
};

export type FakeExecHandler = (
    argv: readonly string[],
    input: PodExecInput,
) => FakeExecAnswer | Promise<FakeExecAnswer>;

export type FakePodClient = IPodClient & {
    /** Pods as the fake cluster holds them, by name. */
    pods: Map<string, V1Pod>;
    created: V1Pod[];
    deleted: string[];
    /** Label selectors of every list call. */
    selectors: string[];
    execs: Array<{
        name: string;
        argv: string[];
        stdin?: string
    }>;
    reads: number;
    /** Statuses the next reads return in order; the last one sticks. */
    statuses: Array<Partial<V1PodStatus>>;
    /** Answers exec calls (default: exit 0, no output); never asked for `git config`. */
    onExec: FakeExecHandler;
    /** Each pod's git config, kept by the fake: `git config <key> <value>`, `--get`, `--unset`. */
    gitConfig: Map<string, Map<string, string>>;
};

const running: Partial<V1PodStatus> = {
    phase: 'Running',
    containerStatuses: [{
        name: 'sandbox',
        image: 'img',
        imageID: '',
        ready: true,
        restartCount: 0,
        state: { running: {} },
    }],
};

/** Matches `key=value,key=value` selectors, the only form the provider sends. */
function matches(pod: V1Pod, selector: string): boolean {
    const labels = pod.metadata?.labels ?? {};

    return selector.split(',').every((term) => {
        const [key, value] = term.split('=');

        return labels[key!] === value;
    });
}

/**
 * An in-memory `IPodClient`: `create` stores the pod, `read` returns it with
 * the next scripted status (default Running), `delete` removes it (a missing
 * one is fine), `list` filters by labels, `exec` asks `onExec` and writes its
 * answer to the given streams; `git config` runs against the pod's
 * `gitConfig`, so a checkout record written on create is read back on find.
 */
export function createFakePodClient(onExec: FakeExecHandler = () => ({})): FakePodClient {
    const client: FakePodClient = {
        pods: new Map(),
        created: [],
        deleted: [],
        selectors: [],
        execs: [],
        reads: 0,
        statuses: [],
        onExec,
        gitConfig: new Map(),

        async create(pod) {
            const name = pod.metadata!.name!;
            const stored = structuredClone(pod);

            client.created.push(stored);
            client.pods.set(name, stored);

            return structuredClone(stored);
        },

        async read(name) {
            client.reads++;

            const pod = client.pods.get(name);

            // like the real client: the ApiException as the cause
            if (!pod) {
                throw new SandboxError(`cannot read pod ${name}: not found`, { cause: { code: 404 } });
            }

            const status = client.statuses.length > 1 ? client.statuses.shift() : client.statuses[0];

            pod.status = structuredClone(status ?? running) as V1PodStatus;

            return structuredClone(pod);
        },

        async delete(name) {
            client.deleted.push(name);
            client.pods.delete(name);
        },

        async list(labelSelector) {
            client.selectors.push(labelSelector);

            return client.pods.values().toArray()
                .filter((pod) => matches(pod, labelSelector))
                .map((pod) => structuredClone(pod));
        },

        async exec(name, input) {
            client.execs.push({
                name,
                argv: [...input.argv],
                ...(input.stdin ? { stdin: new TextDecoder().decode(input.stdin) } : {}),
            });

            const answer = gitConfig(name, unwrap(input.argv)) ?? await client.onExec(input.argv, input);

            if (answer.stdout) {
                input.stdout.write(new TextEncoder().encode(answer.stdout));
            }

            if (answer.stderr) {
                input.stderr.write(new TextEncoder().encode(answer.stderr));
            }

            return { exitCode: answer.exitCode ?? 0 };
        },
    };
    /** Runs `git config` against the pod's config; undefined for any other command. */
    const gitConfig = (name: string, command: string[]): FakeExecAnswer | undefined => {
        if (command[0] !== 'git' || command[1] !== 'config') {
            return undefined;
        }

        let config = client.gitConfig.get(name);

        if (!config) {
            config = new Map();
            client.gitConfig.set(name, config);
        }

        const [, , first, second, third] = command;

        if (first === '--get') {
            const value = config.get(second!);

            return value === undefined ? { exitCode: 1 } : { stdout: `${value}\n` };
        }

        if (first === '--get-regexp') {
            // git prints the variable names lower-cased
            const pattern = new RegExp(second!, 'i');
            const lines = [...config].filter(([key]) => pattern.test(key)).map(([key, value]) => `${key.toLowerCase()} ${value}\n`);

            return lines.length === 0 ? { exitCode: 1 } : { stdout: lines.join('') };
        }

        if (first === '--unset') {
            return config.delete(second!) ? {} : { exitCode: 5 };
        }

        if (third !== undefined || second === undefined) {
            return { exitCode: 2 };
        }

        config.set(first!, second);

        return {};
    };

    return client;
}

/**
 * The argv a fake exec sees for `argv`: the workspace's exec script (any
 * script text, any marker) around the timeout wrapper.
 */
export function wrapped(argv: readonly string[], timeoutSeconds = '300', cwd = '/workspace'): unknown[] {
    return [
        'sh',
        '-c',
        expect.any(String),
        'sh',
        expect.stringMatching(/^chamvi-exit-[0-9a-f]{32}:$/),
        cwd,
        'timeout',
        '-k',
        '5',
        timeoutSeconds,
        ...argv,
    ];
}

/** The command a fake exec runs, without the exec script and timeout wrappers. */
export function unwrap(argv: readonly string[]): string[] {
    return argv.slice(10);
}
