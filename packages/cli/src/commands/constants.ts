/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** CHAMVI_FORCE_EXIT_MS default (C4). */
export const FORCE_EXIT_MS = 90_000;

/** CHAMVI_FORCE_EXIT_MS default under `start --dev` (C3). */
export const DEV_FORCE_EXIT_MS = 15_000;

export const FORCE_EXIT_VARIABLE = 'CHAMVI_FORCE_EXIT_MS';

/** Set by `chamvi dev` on its child: `start --dev` then links to it through stdin (`CliContext.linkToParent`). */
export const DEV_LINK_VARIABLE = 'CHAMVI_DEV_LINK';

/** The dotenv file `start --dev` reads from the working directory. */
export const DOTENV_FILE = '.env';

/** What `start --check` prints on stdout when the check found nothing. */
export const CHECK_PASSED_MESSAGE = 'chamvi: start check passed';

export const CLI_PACKAGE_NAME = '@chamvi/cli';

export const ENTRY_ARG = {
    type: 'string',
    description: 'The app entry (default: dist/index.mjs, src/index.ts for the source commands)',
    valueHint: 'path',
} as const;

/** The output folder of `chamvi build` (C2). */
export const BUILD_OUT_DIR = 'dist';

/** The files `chamvi build` writes (the bundle, chunks and their source maps); an out dir holding others is refused. */
export const BUILD_OUTPUT_PATTERN = /\.mjs(?:\.map)?$/;

/** The optional peer `chamvi build` drives. */
export const TSDOWN_PACKAGE = 'tsdown';

export const MODULE_NOT_FOUND_CODE = 'ERR_MODULE_NOT_FOUND';
