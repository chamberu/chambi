/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */


import { describe, expect, it } from 'vitest';
import {
    ErrorCode,
    InvalidAgentDefinitionError,
    ValidationError,
} from '@chamvi/core';
import type { ChannelMessage } from '@chamvi/core';
import { CHAT_TEXT_MAX_CHARS } from '@chamvi/chat';
import type { ChatApprovalRef } from '@chamvi/chat';
import { renderChatMessage } from '../../../src/outbound/helpers.ts';

const EXPIRES = new Date('2026-11-02T09:00:00.000Z');
const URL_OF = (ref: ChatApprovalRef) => `https://chamvi.example/ui/approvals?run=${ref.runId}&approval=${ref.approvalId}`;

function message(patch: Partial<ChannelMessage> = {}): ChannelMessage {
    return {
        kind: 'message',
        key: 'k-1',
        runId: 'run-1',
        agent: 'helper',
        body: 'Hello there.',
        ...patch,
    };
}

function approval(patch: Partial<ChannelMessage> = {}): ChannelMessage {
    return message({
        kind: 'approval',
        key: 'run-1:0:call-1:0',
        title: 'Deploy to prod?',
        body: 'Release v1.2.0.',
        approvalId: '0:call-1:0',
        expiresAt: EXPIRES,
        ...patch,
    });
}

describe('renderChatMessage', () => {
    it('renders a message as its title and body, nothing else', () => {
        expect(renderChatMessage(message(), {})).toBe('Hello there.');
        expect(renderChatMessage(message({ title: 'Release' }), {})).toBe('Release\n\nHello there.');
    });

    it('oversize_text_never_sends: refuses a message above the bound instead of splitting or cutting it', () => {
        const exact = 'a'.repeat(CHAT_TEXT_MAX_CHARS);

        expect(CHAT_TEXT_MAX_CHARS).toBe(4096);
        expect(renderChatMessage(message({ body: exact }), {})).toBe(exact);

        const render = () => renderChatMessage(message({ body: `${exact}b` }), {});

        expect(render).toThrow(ValidationError);
        expect(render).toThrow(/4096/);
        expect(() => renderChatMessage(message({ title: 'T', body: exact }), {})).toThrow(ValidationError);
    });

    it('approval_link_contains_ids_only: links run and approval id, no token, no run detail', () => {
        const refs: ChatApprovalRef[] = [];
        const text = renderChatMessage(approval(), {
            approvalUrl: (ref) => {
                refs.push(ref);

                return URL_OF(ref);
            },
        });

        expect(refs).toEqual([{
            runId: 'run-1',
            approvalId: '0:call-1:0',
            agent: 'helper',
        }]);
        expect(Object.keys(refs[0]!).sort()).toEqual(['agent', 'approvalId', 'runId']);
        expect(text).toBe([
            'Deploy to prod?',
            'Release v1.2.0.',
            `Expires: ${EXPIRES.toISOString()}\nApprove or deny: https://chamvi.example/ui/approvals?run=run-1&approval=0:call-1:0`,
        ].join('\n\n'));
        expect(text).not.toMatch(/token/i);
        expect(text).not.toContain('run-1:0:call-1:0');
    });

    it('renders an approval body exactly as given (core passes the generic notification for trust gates)', () => {
        const body = 'A tool call waits for approval. Answer it in the chamvi UI.';
        const text = renderChatMessage(approval({ title: 'Approval needed', body }), { approvalUrl: URL_OF });

        expect(text.split('\n\n')[1]).toBe(body);
    });

    it('requires approvalUrl for approvals and checks what it returns', () => {
        expect(() => renderChatMessage(approval(), {})).toThrow(InvalidAgentDefinitionError);
        expect(() => renderChatMessage(approval(), {})).toThrow(/approvalUrl/);

        for (const bad of [
            '/ui/approvals?run=1',
            'ftp://chamvi.example/a',
            'https://user:secret@chamvi.example/a',
            'https://chamvi.example/a b',
            'https://chamvi.example/a\nApprove: https://evil.example',
            '',
            42 as unknown as string,
        ]) {
            const render = () => renderChatMessage(approval(), { approvalUrl: () => bad });

            expect(render).toThrow(InvalidAgentDefinitionError);

            try {
                render();
            } catch (error) {
                // the refused value is never echoed (it may hold a credential)
                expect(String((error as Error).message)).not.toContain('secret');
            }
        }

        // a plain message needs no approvalUrl
        expect(renderChatMessage(message(), {})).toBe('Hello there.');
    });

    it('options_without_details: lists every id and label, never a detail', () => {
        const text = renderChatMessage(approval({
            options: [
                {
                    id: 'v1.2.0',
                    label: 'Release 1.2.0',
                    detail: 'PRIVATE DIFF 1',
                },
                {
                    id: 'v2.0.0',
                    label: 'Release 2.0.0',
                    detail: 'PRIVATE DIFF 2',
                },
            ],
        }), { approvalUrl: URL_OF });

        expect(text).toContain('Options (choose one):\n- v1.2.0: Release 1.2.0\n- v2.0.0: Release 2.0.0');
        expect(text).toContain('Choose and approve or deny: https://chamvi.example/');
        expect(text).not.toContain('PRIVATE DIFF');

        const multiple = renderChatMessage(approval({
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            multiple: true,
        }), { approvalUrl: URL_OF });

        expect(multiple).toContain('Options (choose one or more):\n- a: A\n- b: B');
    });

    it('approval_render_preserves_url_and_expiry: cuts only the prose, Unicode-safe, within the bound', () => {
        const url = 'https://chamvi.example/ui/approvals?run=run-1&approval=0%3Acall-1%3A0&x=%F0%9F%98%80';
        const options = Array.from({ length: 20 }, (_, index) => ({ id: `option-${index}`, label: `Label ${index}` }));
        // an emoji (a surrogate pair) on every boundary the cut may land on
        const body = '😀'.repeat(5000);
        const text = renderChatMessage(approval({ body, options }), { approvalUrl: () => url });

        expect(text.length).toBeLessThanOrEqual(CHAT_TEXT_MAX_CHARS);
        expect(text.endsWith(`Expires: ${EXPIRES.toISOString()}\nChoose and approve or deny: ${url}`)).toBe(true);

        for (const option of options) {
            expect(text).toContain(`- ${option.id}: ${option.label}\n`);
        }

        expect(text).toMatch(/… \(cut, \d+ more characters\)/);
        // no lone surrogate anywhere
        expect(text.isWellFormed()).toBe(true);
        expect(text.startsWith('Deploy to prod?\n\n😀')).toBe(true);
    });

    it('refuses an approval whose links and options cannot fit', () => {
        const options = Array.from({ length: 20 }, (_, index) => ({ id: `option-${index}`, label: 'L'.repeat(200) }));
        const render = () => renderChatMessage(approval({ options }), { approvalUrl: URL_OF });

        expect(render).toThrow(ValidationError);
        expect(render).toThrow(/options/);

        try {
            render();
        } catch (error) {
            expect((error as ValidationError).code).toBe(ErrorCode.VALIDATION);
        }
    });
});
