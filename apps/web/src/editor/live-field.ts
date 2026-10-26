/** UI-only field session; document edits and history boundaries belong to its consumer. */
export interface LiveFieldOptions {
  value: string;
  mergeKey: string;
  validate(text: string): string | undefined;
  commit(text: string, merge: string): void;
  endBurst(): void;
}

export function createLiveField(initial: LiveFieldOptions, changed: () => void) {
  let options = initial, value = initial.value, external = initial.value, committed = initial.value;
  let error: string | undefined;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() { clearTimeout(timer); timer = undefined; }
  function flush() {
    cancel();
    if (!pending) return;
    error = options.validate(value);
    if (!error) {
      pending = false;
      if (value !== committed) { committed = value; options.commit(value, options.mergeKey); }
    }
    changed();
  }
  return {
    get value() { return value; },
    get error() { return error; },
    update(next: LiveFieldOptions) { options = next; },
    sync(next: string) {
      if (next === external) return;
      external = next;
      // Acknowledging our own edit must not erase subsequent keystrokes.
      if (next === committed) return;
      cancel(); pending = false; value = committed = next; error = undefined; changed();
    },
    input(text: string) {
      value = text; pending = true; error = options.validate(text);
      cancel(); timer = setTimeout(flush, 400); changed();
    },
    flush,
    finish() { flush(); options.endBurst(); },
  };
}
