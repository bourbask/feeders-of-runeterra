/**
 * The three version numbers that travel outside this repository.
 *
 * They are separate on purpose. A wire-format change is not a payload change,
 * and neither is a content-schema change: coupling them would force a client
 * upgrade for a new oracle table.
 */

/**
 * WebSocket envelope `v` field. A mismatch closes the socket with 4001
 * (01-architecture.md section 5.1).
 */
export const PROTOCOL_VERSION = 1;

/**
 * Current `payloadVersion` written on new events. Older values stay readable
 * through the upcasters of `upcast.ts` (03-donnees.md section 3.8).
 */
export const EVENT_SCHEMA_VERSION = 1;

/** Shape version of the versioned content bundle (03-donnees.md section 4). */
export const CONTENT_SCHEMA_VERSION = 1;
