/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError } from '@chamvi/core';
import type { ExecResult } from '@chamvi/sandbox';
import { grepResult, parseMatches } from '../../../src/tools/search.ts';

function exec(stdout: string, exitCode = 0): ExecResult {
    return {
        exitCode,
        stdout,
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 1,
    };
}

const WARNING = './big.txt: WARNING: stopped searching binary file after match (found "\\0" byte around offset 70894)';

describe('grep output', () => {
    it('skips a ripgrep warning line between records', () => {
        const output = `./big.txt\x001:needle a\n${WARNING}\n./b.txt\x002:needle b\n`;
        expect(parseMatches(output).matches).toEqual([
            {
                path: 'big.txt',
                line: 1,
                text: 'needle a',
            },
            {
                path: 'b.txt',
                line: 2,
                text: 'needle b',
            },
        ]);
    });

    it('skips a line that holds no record and goes on with the next one', () => {
        const output = 'a.txt\x00x:broken\nb.txt\x003\x00needle\n';
        expect(parseMatches(output).matches).toEqual([{
            path: 'b.txt',
            line: 3,
            text: 'needle',
        }]);
    });

    it('drops a record the output cap cut', () => {
        expect(parseMatches('a.txt\x001:one\nb.txt\x002:tw').matches).toHaveLength(1);
    });

    it('fails loudly when matches came back without their NUL separators', () => {
        // BusyBox cut turns every NUL into a newline
        expect(() => grepResult(exec('git-grep\na.txt\n1\nneedle one\na.txt\n2\nneedle two\n'), 100, undefined)).toThrow(SandboxError);
        expect(() => grepResult(exec('git-grep\na.txt\n1\nneedle one\n'), 100, undefined)).toThrow('grep output could not be parsed');
    });

    it('answers no matches for empty output and for ripgrep binary notices', () => {
        expect(grepResult(exec('git-grep\n', 1), 100, undefined)).toEqual({
            matches: [],
            truncated: false,
            engine: 'git-grep',
        });
        expect(grepResult(exec(`ripgrep\n./x.bin: binary file matches (found "\\0" byte around offset 3)\n${WARNING}\n`), 100, undefined))
            .toMatchObject({ matches: [] });
    });
});
