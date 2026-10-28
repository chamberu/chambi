/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryConversationStore } from '@chamvi/core';
import { describeConversationStoreContract } from '@chamvi/test-kit';

describeConversationStoreContract((clock) => new MemoryConversationStore({ clock }));
