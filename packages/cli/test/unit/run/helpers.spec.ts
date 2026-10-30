/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError, InvalidAgentDefinitionError } from '@chamvi/app';
import { describe, expect, it } from 'vitest';
import { CLI_USAGE_ERROR_CODE, EXIT_CODE } from '../../../src/run/constants.ts';
import { assertKnownArgs, exitCodeOf } from '../../../src/run/helpers.ts';

class CLIError extends Error {
    code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'CLIError';
        this.code = code;
    }
}

describe('exitCodeOf', () => {
    it.each([
        ['a citty CLIError', new CLIError('Unknown command x', 'E_UNKNOWN_COMMAND'), EXIT_CODE.USAGE],
        ['a cli_usage error', new ChamviError({ code: CLI_USAGE_ERROR_CODE, message: 'usage' }), EXIT_CODE.USAGE],
        ['an InvalidAgentDefinitionError', new InvalidAgentDefinitionError('DATABASE_URL is required.'), EXIT_CODE.USAGE],
        ['the app_stopped error', new ChamviError({ code: 'app_stopped', message: 'stopped' }), EXIT_CODE.OK],
        ['a plain Error', new Error('boom'), EXIT_CODE.FAILURE],
        ['a non-error value', 'boom', EXIT_CODE.FAILURE],
    ])('maps %s', (_, error, code) => {
        expect(exitCodeOf(error)).toBe(code);
    });
});

describe('assertKnownArgs', () => {
    const def = {
        entry: { type: 'string' },
        'out-dir': { type: 'string' },
        dev: { type: 'boolean' },
        agent: { type: 'positional', required: true },
    } as const;

    it('accepts the defined flags, their camel-case aliases and positionals', () => {
        expect(() => assertKnownArgs({
            _: ['echo'],
            agent: 'echo',
            entry: 'src/index.ts',
            'out-dir': 'out',
            outDir: 'out',
            dev: true,
        }, def)).not.toThrow();
    });

    it('rejects --colour on a command without it', () => {
        let error: unknown;

        try {
            assertKnownArgs({ _: [], colour: true }, def);
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(ChamviError);
        expect((error as ChamviError).code).toBe(CLI_USAGE_ERROR_CODE);
        expect((error as Error).message).toContain('--colour');
        expect(exitCodeOf(error)).toBe(EXIT_CODE.USAGE);
    });

    it('rejects an extra positional argument', () => {
        expect(() => assertKnownArgs({ _: ['echo', 'more'], agent: 'echo' }, def)).toThrow(/more/);
    });
});
