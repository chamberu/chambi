/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { BadRequestError } from '@ebec/http';
import { defineSchema } from '@rapiq/core';
import { describe, expect, it } from 'vitest';
import { decodeQuery } from '../../../src/request/helpers.ts';

const schema = defineSchema({
    filters: { allowed: ['agent', 'status'] },
    sorts: { allowed: ['createdAt'] },
    throwOnFailure: true,
});

const decode = (query: string) => decodeQuery(new URLSearchParams(query), schema);

describe('decodeQuery', () => {
    it('decodes filters, pagination and sorts from the bracket dialect', () => {
        expect(decode('filter[agent]=a&page[limit]=5&sort=createdAt')).toEqual({
            filters: [{
                field: 'agent',
                operator: 'eq',
                value: 'a',
            }],
            limit: 5,
            offset: 0,
            sorts: [{ name: 'createdAt', operator: 'ASC' }],
        });
    });

    it('decodes nothing to an empty query without a default limit', () => {
        expect(decode('')).toEqual({ filters: [], sorts: [] });
    });

    it('decodes the expression dialect to the same leaf', () => {
        expect(decode('filter=eq(agent,\'a\')').filters).toEqual([{
            field: 'agent',
            operator: 'eq',
            value: 'a',
        }]);
    });

    it.each([
        'filter[nope]=1',
        'sort=id',
        'page[limit]=abc',
        'page[limit]=0',
        'page[offset]=-1',
        'filter[status]=',
    ])('rejects %s with issues', (query) => {
        let error: unknown;

        try {
            decode(query);
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(BadRequestError);
        expect((error as BadRequestError).issues.length).toBeGreaterThan(0);
    });

    it('bounds the limit at 100', () => {
        expect(() => decode('page[limit]=101')).toThrow('The pagination limit must not exceed the value of 100.');
        expect(decode('page[limit]=100').limit).toBe(100);
    });

    it('rejects an unknown codec', () => {
        expect(() => decode('codec=zzz&filter[agent]=a')).toThrow(BadRequestError);
    });

    it('rejects compound filters', () => {
        expect(() => decode('filter=or(eq(agent,\'a\'),eq(status,\'queued\'))'))
            .toThrow('Only top-level filters joined with "and" are supported.');
    });

    it('ignores fields, include and unknown keys', () => {
        expect(decode('fields=id&include=x&foo=bar')).toEqual({ filters: [], sorts: [] });
    });
});
