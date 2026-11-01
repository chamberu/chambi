/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

// The /baileys entry (WhatsApp Web on Baileys): the only entry that imports baileys.

export {
    WHATSAPP_ADAPTER_NAME,
    WHATSAPP_AUTH_ERROR_CODE,
    WHATSAPP_CONNECTION_ERROR_CODE,
    WHATSAPP_LOGGED_OUT_ERROR_CODE,
    WHATSAPP_RECONNECT,
    WHATSAPP_SHUTDOWN_TIMEOUT_MS,
} from './constants.ts';
export { createWhatsAppChat } from './module.ts';
export type {
    IWhatsAppAuthProvider,
    WhatsAppAuthLease,
    WhatsAppChatOptions,
    WhatsAppChatSetup,
    WhatsAppConnectionStatus,
    WhatsAppIdentity,
    WhatsAppPairing,
    WhatsAppPolicy,
    WhatsAppSocket,
    WhatsAppSocketFactory,
} from './types.ts';
