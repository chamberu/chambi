/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    expectTypeOf,
    it,
} from 'vitest';
import { EFFECT, InvalidAgentDefinitionError, toolContextSchema } from '@chamvi/core';
import * as coding from '@chamvi/coding';
import type { CodingResult, ICodingBackend } from '@chamvi/coding';
import type { IWorkspaceManager } from '@chamvi/sandbox';

const manager: Pick<IWorkspaceManager, 'get'> = { get: () => { throw new TypeError('not used'); } };

describe('public api', () => {
    it('exports codingTools', () => {
        expect(coding.codingTools).toBeTypeOf('function');
    });

    it('exports the limits', () => {
        expect(coding.READ_MAX_LINES).toBe(2_000);
        expect(coding.READ_MAX_CHARS).toBe(65_536);
        expect(coding.SEARCH_MAX_RESULTS).toBe(500);
        expect(coding.LIST_MAX_RESULTS).toBe(5_000);
        expect(coding.LINE_MAX_CHARS).toBe(500);
    });

    it('builds the coding tools', () => {
        expect(Object.keys(coding.codingTools(manager)).sort()).toEqual([
            'bash',
            'bash_kill',
            'bash_output',
            'edit_file',
            'git_diff',
            'grep',
            'list_files',
            'multi_edit',
            'read_file',
            'write_file',
        ]);
    });

    it('refuses a missing workspace manager', () => {
        expect(() => coding.codingTools(undefined as never)).toThrow(InvalidAgentDefinitionError);
        expect(() => coding.codingTools({} as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('are chamvi tools and not effect tools', () => {
        for (const tool of Object.values(coding.codingTools(manager))) {
            expect(tool.contextSchema).toBe(toolContextSchema);
            expect(EFFECT in tool).toBe(false);
        }
    });

    it('keeps the tool builders internal', () => {
        expect(Object.keys(coding).sort()).toEqual([
            'LINE_MAX_CHARS',
            'LIST_MAX_RESULTS',
            'READ_MAX_CHARS',
            'READ_MAX_LINES',
            'SEARCH_MAX_RESULTS',
            'codingTools',
        ]);
    });

    it('types the coding backend contract', () => {
        expectTypeOf<CodingResult['status']>().toEqualTypeOf<'done' | 'stuck'>();
        expectTypeOf<CodingResult>().toEqualTypeOf<{
            status: 'done' | 'stuck'; 
            summary: string; 
            diff: string 
        }>();
        expectTypeOf<ICodingBackend['code']>().returns.resolves.toEqualTypeOf<CodingResult>();
    });
});
