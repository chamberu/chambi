/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createMemoryStores } from '@chamvi/core';
import { describeStoreContract } from '@chamvi/test-kit';

describeStoreContract((clock) => createMemoryStores({ clock }));
