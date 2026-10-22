/**
 * CLI commands whose implementation moved to tools/src/_parked, mapped to the owning SP that restores them.
 * `check:parked --strict` fails while this is non-empty. Owners of commands that are also ci.sh steps must
 * match the ci.sh PARKED entry (checked in tools/test/parked.test.ts).
 */
export const PARKED_COMMANDS: Readonly<Record<string, string>> = {};
