/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { excerptOf, parseReport } from '../../../src/tools/output.ts';

const bytes = (text: string) => new Uint8Array(Buffer.from(text));
const LOG = '~/.chamvi/out/0123456789ab.stdout.log';

describe('excerptOf', () => {
    it('returns the whole text when nothing was cut', () => {
        expect(excerptOf({
            size: 5,
            log: LOG,
            head: bytes('ab\n'),
            tail: bytes('cd'),
        })).toEqual({ text: 'ab\ncd', truncated: false });
    });

    it('marks the cut with its size and the log, never splitting a character', () => {
        const head = bytes('one\ntwo é').subarray(0, 9); // ends inside 'é'
        const tail = bytes('ü end\n').subarray(1); // starts inside 'ü'
        const excerpt = excerptOf({
            size: head.length + tail.length + 100,
            log: LOG,
            head,
            tail,
        });
        expect(excerpt.truncated).toBe(true);
        expect(excerpt.text).toBe(`one\ntwo \n[... 102 bytes cut, full output in ${LOG}]\n end\n`);
    });
});

describe('parseReport', () => {
    it('reads a report', () => {
        const report = parseReport(
            `chamvi-report 2\n/workspace/src\n3 ${LOG}\n${Buffer.from('hi\n').toString('base64')}\n-\n-\n`,
            'noise\nchamvi-report-stderr\n0 ~/.chamvi/out/0123456789ab.stderr.log\n-\n-\n',
        );
        expect(report?.status).toBe(2);
        expect(report?.cwd).toBe('/workspace/src');
        expect(Buffer.from(report!.stdout.head).toString()).toBe('hi\n');
        expect(report?.stderr.size).toBe(0);
    });

    it('reads a report without a status (the call was killed)', () => {
        const report = parseReport(`chamvi-report -\n/workspace\n0 ${LOG}\n-\n-\n`, `chamvi-report-stderr\n0 ${LOG}\n-\n-\n`);
        expect(report?.status).toBeUndefined();
    });

    it('is undefined for missing or cut reports', () => {
        expect(parseReport('', '')).toBeUndefined();
        expect(parseReport('hello\n', '')).toBeUndefined();
        expect(parseReport(`chamvi-report 0\n/workspace\n3 ${LOG}\naGkK\n`, `chamvi-report-stderr\n0 ${LOG}\n-\n-\n`)).toBeUndefined();
        expect(parseReport(`chamvi-report 0\n/workspace\n0 ${LOG}\n-\n-\n`, '')).toBeUndefined();
    });
});
