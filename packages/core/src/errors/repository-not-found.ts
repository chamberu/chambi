/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError } from './base.ts';
import { ErrorCode } from './constants.ts';

export class RepositoryNotFoundError extends ChamviError {
    constructor(resource: string) {
        super({ message: `No matching ${resource} were found.`, code: ErrorCode.REPOSITORY_NOT_FOUND });
    }
}
