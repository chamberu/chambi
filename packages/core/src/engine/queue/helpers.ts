/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Run } from '../../run/types.ts';

export const groupKey = (run: Pick<Run, 'agent' | 'concurrencyKey'>) => `${run.agent}\0${run.concurrencyKey}`;
