#!/usr/bin/env bash
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# One store writer, and one preview/Chrome/credit consumer across linked worktrees.
# Hold the lock until the Node driver has cleaned up all owned children.
exec flock --no-fork -x /tmp/node-arena-kane-resources.lock node "$here/runner.mjs" "$@" </dev/null
