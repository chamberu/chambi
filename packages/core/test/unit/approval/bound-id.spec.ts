/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SuspendSignal, requestApproval } from '../../../src/approval/request.ts';
import { runToolCall } from '../../../src/effect/frame.ts';
import type { ToolCallFrame } from '../../../src/effect/types.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';

function frame(overrides: Partial<ToolCallFrame> = {}): ToolCallFrame {
    return {
        runId: 'r1',
        toolCallId: `call_${'x'.repeat(195)}`,
        toolName: 'send',
        stepIndex: 2,
        approvals: 0,
        effects: createMemoryStore().effects,
        ...overrides,
    };
}

async function pendingId(call: ToolCallFrame, binding?: string): Promise<string> {
    try {
        await runToolCall(call, () => requestApproval({ title: 'Review', binding }));
    } catch (error) {
        if (error instanceof SuspendSignal) {
            return error.request.approvalId;
        }

        throw error;
    }

    throw new Error('Expected an approval suspension.');
}

describe('bound approval ids', () => {
    it('keeps ordinary approval ordinals independent of automatic approvals', async () => {
        const call = frame({ toolCallId: 'send' });
        const automatic = await pendingId(call, 'binding');

        expect(call.approvals).toBe(0);
        expect(await pendingId(call)).toBe('2:send:0');
        expect(await pendingId(frame({ toolCallId: 'send', approvals: 10 }), 'binding')).toBe(automatic);
        expect(await pendingId(call, 'binding')).not.toBe(automatic);
    });

    it('bounds automatic ids independently of provider tool-call id length', async () => {
        const id = await pendingId(frame(), 'a'.repeat(64));
        const longer = await pendingId(frame({ toolCallId: 'x'.repeat(2_000) }), 'a'.repeat(64));

        expect(id.length).toBeLessThanOrEqual(255);
        expect(longer.length).toBe(id.length);
        expect(longer).not.toBe(id);
    });

    it.each([
        { stepIndex: 3 },
        { toolCallId: 'different-call' },
        { boundApprovals: 1 },
    ])('includes the entire call identity: %j', async (changed) => {
        const original = await pendingId(frame(), 'a'.repeat(64));

        expect(await pendingId(frame(changed), 'a'.repeat(64))).not.toBe(original);
        expect(await pendingId(frame(), 'b'.repeat(64))).not.toBe(original);
    });

    it('reuses a recorded decision only for the same identity and binding', async () => {
        const call = frame();
        const binding = 'a'.repeat(64);
        const approvalId = await pendingId({ ...call }, binding);

        await call.effects.save(`approval:${call.runId}:${approvalId}`, { approved: true });
        await expect(runToolCall({ ...call }, () => requestApproval({ title: 'Review', binding })))
            .resolves.toMatchObject({ approved: true });
        expect(await pendingId({ ...call }, 'b'.repeat(64))).not.toBe(approvalId);
    });

    it('preserves ordinary ordinal ids unchanged', async () => {
        const call = frame();

        expect(await pendingId(call)).toBe(`2:${call.toolCallId}:0`);
        expect(await pendingId(call)).toBe(`2:${call.toolCallId}:1`);
    });
});
