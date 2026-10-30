/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { tokenizeJson } from '../../../../app/components/json-block/helpers.ts';
import {
    approverName,
    errorText,
    selectedLabels,
    stepMeta,
    stepTitle,
    waitOutput,
} from '../../../../app/components/step-item/helpers.ts';
import { wireStep } from '../../../utils/runs.ts';

describe('tokenizeJson', () => {
    it('marks keys, strings and literals and keeps every character', () => {
        const json = JSON.stringify({
            env: 'prod "x"',
            ok: true,
            n: 1,
            z: null,
        }, null, 2);
        const tokens = tokenizeJson(json);

        expect(tokens.map((t) => t.text).join('')).toBe(json);
        expect(tokens.filter((t) => t.kind === 'k').map((t) => t.text)).toEqual(['"env"', '"ok"', '"n"', '"z"']);
        expect(tokens.filter((t) => t.kind === 's').map((t) => t.text)).toEqual(['"prod \\"x\\""']);
        expect(tokens.filter((t) => t.kind === 'c').map((t) => t.text)).toEqual(['true', 'null']);
    });
});

describe('step labels', () => {
    it('titles each kind', () => {
        expect(stepTitle(wireStep(0, 'tool', { name: 'deploy' }))).toBe('deploy');
        expect(stepTitle(wireStep(1, 'wait', { name: 'deploy' }))).toBe('approval · deploy');
        expect(stepTitle(wireStep(2, 'llm', { output: { text: 'x', toolCalls: [{ toolName: 'deploy', input: {} }] } }))).toBe('calls deploy');
        expect(stepTitle(wireStep(3, 'llm', { output: { text: 'done' } }))).toBe('done');
    });

    it('shows duration, tokens and errors', () => {
        expect(stepMeta(wireStep(0, 'llm', { output: { usage: { inputTokens: 1200, outputTokens: 80 } } }))).toBe('1.0 s · 1.3k tok');
        expect(stepMeta(wireStep(0, 'tool', { finishedAt: '2026-10-21T10:00:00.340Z', error: { code: 'x', message: 'y' } }))).toBe('340 ms · error');
        expect(errorText({ code: 'github_request', message: 'GitHub 502' })).toBe('github_request · GitHub 502');
        expect(errorText('plain')).toBe('plain');
    });

    it('names the approver', () => {
        const output = waitOutput(wireStep(0, 'wait', { output: { approved: true, approver: { id: 'e2e', kind: 'token' } } }));

        expect(approverName(output)).toBe('e2e');
        expect(approverName(waitOutput(wireStep(0, 'wait')))).toBeUndefined();
    });
});

describe('wait step selection', () => {
    it('names the selected options by label, ids as fallback', () => {
        const step = wireStep(0, 'wait', {
            input: { options: [{ id: 'a', label: 'Alpha' }] },
            output: { approved: true, selected: ['a', 'z'] },
        });

        expect(selectedLabels(step)).toEqual(['Alpha', 'z']);
        expect(selectedLabels(wireStep(0, 'wait', { output: { approved: true } }))).toEqual([]);
    });
});
