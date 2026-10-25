/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { BLOCK_END, REPORT_HEADER, REPORT_STDERR_HEADER } from './constants.ts';

/** One stream of a `bash` report. */
type ReportStream = {
    /** Bytes the command wrote. */
    size: number;
    /** `~/.chamvi/out/<id>.<stream>.log`. */
    log: string;
    head: Uint8Array;
    /** The rest after `head`, or its last bytes when the middle was cut. */
    tail: Uint8Array;
};

type Report = {
    /** The exit status, `undefined` when the call was killed (the report was read afterwards). */
    status: number | undefined;
    /** The working directory the next call starts in. */
    cwd: string;
    stdout: ReportStream;
    stderr: ReportStream;
};

/** Length of `bytes` without a trailing UTF-8 sequence that a cut left short. */
export function completeLength(bytes: Uint8Array): number {
    return bytes.length - cutTailLength(bytes);
}

/** Bytes of a trailing UTF-8 sequence `bytes` cut short (0 when it ends on a whole character). */
function cutTailLength(bytes: Uint8Array): number {
    for (let back = 1; back <= Math.min(4, bytes.length); back++) {
        const byte = bytes[bytes.length - back] as number;
        if ((byte & 0xC0) === 0x80) continue;
        let expected = 1;
        if ((byte & 0xE0) === 0xC0) expected = 2;
        else if ((byte & 0xF0) === 0xE0) expected = 3;
        else if ((byte & 0xF8) === 0xF0) expected = 4;
        return expected > back ? back : 0;
    }
    return 0;
}

/** Leading UTF-8 continuation bytes of `bytes` (a character the cut split), at most 3. */
function cutHeadLength(bytes: Uint8Array): number {
    let length = 0;
    while (length < Math.min(3, bytes.length) && ((bytes[length] as number) & 0xC0) === 0x80) length++;
    return length;
}

const decoder = new TextDecoder();

/**
 * The text a result shows of one stream: all of it when nothing was cut,
 * else the head, a `[... <n> bytes cut, full output in <log>]` line and the
 * tail, without a character the cut split.
 */
export function excerptOf(stream: ReportStream): { text: string; truncated: boolean } {
    const {
        head, 
        tail, 
        size, 
    } = stream;
    const cut = size - head.length - tail.length;
    if (cut <= 0) {
        return { text: decoder.decode(Buffer.concat([head, tail])), truncated: false };
    }
    const kept = head.subarray(0, head.length - cutTailLength(head));
    const rest = tail.subarray(cutHeadLength(tail));
    const dropped = cut + (head.length - kept.length) + (tail.length - rest.length);
    const before = decoder.decode(kept);
    const separator = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    return {
        text: `${before}${separator}[... ${dropped} bytes cut, full output in ${stream.log}]\n${decoder.decode(rest)}`,
        truncated: true,
    };
}

/** The stream section starting at `lines[start]` (`<size> <log>`, two base64 blocks); undefined when incomplete. */
function readStream(lines: string[], start: number): { stream: ReportStream; next: number } | undefined {
    const match = /^(\d+) (\S+)$/.exec(lines[start] ?? '');
    if (!match) return undefined;
    const blocks: Uint8Array[] = [];
    let index = start + 1;
    for (let block = 0; block < 2; block++) {
        const parts: string[] = [];
        while (index < lines.length && lines[index] !== BLOCK_END) {
            parts.push(lines[index] as string);
            index++;
        }
        if (index >= lines.length) return undefined;
        index++;
        blocks.push(new Uint8Array(Buffer.from(parts.join(''), 'base64')));
    }
    return {
        stream: {
            size: Number(match[1]),
            log: match[2] as string,
            head: blocks[0] as Uint8Array,
            tail: blocks[1] as Uint8Array,
        },
        next: index,
    };
}

/** The report a `bash` script printed (stdout and stderr part), undefined when it is missing or cut. */
export function parseReport(stdout: string, stderr: string): Report | undefined {
    const out = stdout.split('\n');
    const header = new RegExp(`^${REPORT_HEADER} (-|\\d+)$`).exec(out[0] ?? '');
    if (!header || out.length < 2) return undefined;
    const stdoutStream = readStream(out, 2);

    const err = stderr.split('\n');
    const start = err.lastIndexOf(REPORT_STDERR_HEADER);
    const stderrStream = start === -1 ? undefined : readStream(err, start + 1);
    if (!stdoutStream || !stderrStream) return undefined;

    return {
        status: header[1] === '-' ? undefined : Number(header[1]),
        cwd: out[1] as string,
        stdout: stdoutStream.stream,
        stderr: stderrStream.stream,
    };
}
