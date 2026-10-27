/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import type { StepWire } from '../../api/types.ts';
import { formatTokens } from '../../runs/helpers.ts';

export type LlmOutput = {
    text?: string;
    finishReason?: string;
    toolCalls?: Array<{ toolName: string; input: unknown }>;
    usage?: { inputTokens?: number; outputTokens?: number };
};

export type WaitOutput = {
    approved?: boolean;
    reason?: string;
    approver?: {
        id: string;
        kind: string;
        name?: string
    };
    selected?: string[];
};

export function llmOutput(step: StepWire): LlmOutput {
    return isObject(step.output) ? step.output as LlmOutput : {};
}

export function waitOutput(step: StepWire): WaitOutput {
    return isObject(step.output) ? step.output as WaitOutput : {};
}

/** `code · message` of a step or run error. */
export function errorText(error: unknown): string {
    if (isObject(error)) {
        const code = typeof error.code === 'string' ? error.code : undefined;
        const message = typeof error.message === 'string' ? error.message : JSON.stringify(error);
        return code ? `${code} · ${message}` : message;
    }
    return String(error);
}

export function stepTitle(step: StepWire): string {
    if (step.kind === 'wait') return `approval · ${step.name ?? 'tool'}`;
    if (step.kind === 'tool') return step.name ?? 'tool';
    const output = llmOutput(step);
    const calls = output.toolCalls?.map((call) => call.toolName) ?? [];
    if (calls.length > 0) return `calls ${calls.join(', ')}`;
    return output.text ? output.text.slice(0, 80) : (step.name ?? 'model step');
}

export function stepMeta(step: StepWire): string {
    const ms = Date.parse(step.finishedAt) - Date.parse(step.startedAt);
    const parts = [ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.max(0, ms)} ms`];
    const usage = step.kind === 'llm' ? llmOutput(step).usage : undefined;
    if (usage) parts.push(`${formatTokens((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))} tok`);
    if (step.error !== undefined) parts.push('error');
    return parts.join(' · ');
}

export function approverName(output: WaitOutput): string | undefined {
    return output.approver ? (output.approver.name ?? output.approver.id) : undefined;
}

/** The labels of a wait step's selected options (from the step input's options), the ids when unknown. */
export function selectedLabels(step: StepWire): string[] {
    const { selected } = waitOutput(step);
    if (!Array.isArray(selected)) return [];
    const options = isObject(step.input) && Array.isArray(step.input.options) ? step.input.options : [];
    const labels = new Map<string, string>();
    for (const option of options) {
        if (isObject(option) && typeof option.id === 'string' && typeof option.label === 'string') {
            labels.set(option.id, option.label);
        }
    }
    return selected.map((id) => labels.get(id) ?? id);
}
