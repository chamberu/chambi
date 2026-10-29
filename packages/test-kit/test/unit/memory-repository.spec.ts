/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createMemoryRepositories } from '@chamvi/core';
import { describeRepositoryContract } from '@chamvi/test-kit';

describeRepositoryContract((clock) => createMemoryRepositories({ clock }));
