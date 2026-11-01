/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** Where a run came from, as bound at the start of its execution (`runSource()`). */
export type RunSource = {
    channel: string;
    address?: string;
};
