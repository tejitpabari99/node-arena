/** Single wire-format int; bump on any wire break. Exact match required at handshake. */
export const PROTOCOL_VERSION = 2;
/** Hash checkpoint cadence in ticks (client->server `hash`, `start.hashInterval`). */
export const HASH_INTERVAL = 20;
