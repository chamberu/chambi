/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { stableHash } from '../effect/helpers.ts';
import { EXTRACT_OUTPUT_MAX_LENGTH } from './constants.ts';
import { isSafeExtractionSchema } from './schema.ts';

function minimum(value: number, bound: unknown): boolean {
    return bound === undefined || (typeof bound === 'number' && Number.isFinite(bound) && value >= bound);
}

function maximum(value: number, bound: unknown): boolean {
    return bound === undefined || (typeof bound === 'number' && Number.isFinite(bound) && value <= bound);
}

function decimal(value: number): { coefficient: bigint; exponent: number } {
    const [mantissa, exponent = '0'] = value.toString().split('e');
    const fraction = mantissa!.split('.')[1] ?? '';

    return {
        coefficient: BigInt(mantissa!.replace('.', '')),
        exponent: Number(exponent) - fraction.length,
    };
}

/** Compare decimal values exactly, without rounding their floating-point quotient. */
function isMultipleOf(value: number, divisor: unknown): boolean {
    if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor <= 0) {
        return false;
    }

    const number = decimal(value);
    const multiple = decimal(divisor);
    const exponent = Math.min(number.exponent, multiple.exponent);

    return (number.coefficient * 10n ** BigInt(number.exponent - exponent)) %
        (multiple.coefficient * 10n ** BigInt(multiple.exponent - exponent)) === 0n;
}

function matches(schema: Record<string, unknown>, value: unknown): boolean {
    if (schema.type !== undefined) {
        switch (schema.type) {
            case 'null': {
                if (value !== null) {
                    return false;
                }

                break;
            }
            case 'integer': {
                if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
                    return false;
                }

                break;
            }
            case 'array': {
                if (!Array.isArray(value)) {
                    return false;
                }

                break;
            }
            case 'object': {
                if (!isObject(value)) {
                    return false;
                }

                break;
            }
            default: {
                if (typeof value !== schema.type) {
                    return false;
                }
            }
        }
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
        return false;
    }

    if (Object.hasOwn(schema, 'const')) {
        return value === schema.const;
    }

    if (Array.isArray(schema.enum)) {
        return schema.enum.includes(value);
    }

    switch (schema.type) {
        case 'number':
        case 'integer': {
            const number = value as number;

            return minimum(number, schema.minimum) && maximum(number, schema.maximum) &&
                (schema.exclusiveMinimum === undefined ||
                    (typeof schema.exclusiveMinimum === 'number' && number > schema.exclusiveMinimum)) &&
                (schema.exclusiveMaximum === undefined ||
                    (typeof schema.exclusiveMaximum === 'number' && number < schema.exclusiveMaximum)) &&
                (schema.multipleOf === undefined || isMultipleOf(number, schema.multipleOf));
        }
        case 'string': {
            const string = value as string;
            const { length } = Array.from(string);

            return minimum(length, schema.minLength) && maximum(length, schema.maxLength) &&
                new RegExp(`^(?:${schema.pattern as string})$`, 'u').test(string);
        }
        case 'array': {
            const array = value as unknown[];

            return Object.getPrototypeOf(array) === Array.prototype &&
                Reflect.ownKeys(array).length === array.length + 1 &&
                minimum(array.length, schema.minItems) && maximum(array.length, schema.maxItems) &&
                Array.from({ length: array.length }, (_, index) => Object.getOwnPropertyDescriptor(array, index))
                    .every((descriptor) => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') &&
                        matches(schema.items as Record<string, unknown>, descriptor.value)) &&
                (schema.uniqueItems === undefined || schema.uniqueItems === false ||
                    (schema.uniqueItems === true && new Set(array.map((item) => stableHash(item))).size === array.length));
        }
        case 'object': {
            const object = value as Record<string, unknown>;
            const prototype: unknown = Object.getPrototypeOf(object);
            const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
            const keys = Reflect.ownKeys(object);

            return (prototype === Object.prototype || prototype === null) &&
                minimum(keys.length, schema.minProperties) && maximum(keys.length, schema.maxProperties) &&
                (schema.required === undefined ||
                    (Array.isArray(schema.required) && schema.required.every((key) => typeof key === 'string' && Object.hasOwn(object, key)))) &&
                keys.every((key) => {
                    const descriptor = Object.getOwnPropertyDescriptor(object, key);

                    return typeof key === 'string' && Object.hasOwn(properties, key) &&
                        descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') &&
                        matches(properties[key]!, descriptor.value);
                });
        }
        default: {
            return true;
        }
    }
}

/** Checks the actual SDK output independently of any custom validator or transform. */
export function isSafeExtractionOutput(schema: unknown, value: unknown): boolean {
    try {
        return isSafeExtractionSchema(schema) && matches(schema as Record<string, unknown>, value) &&
            JSON.stringify(value).length <= EXTRACT_OUTPUT_MAX_LENGTH;
    } catch {
        return false;
    }
}
