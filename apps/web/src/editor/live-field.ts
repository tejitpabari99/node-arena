/** UI-only field session; document edits and history boundaries belong to its consumer. */
export interface LiveFieldOptions {
  value: string;
  mergeKey: string;
  validate(text: string): string | undefined;
  normalize?(text: string): string;
  commit(text: string, merge: string): void;
  endBurst(): void;
}

export function createLiveField(initial: LiveFieldOptions, changed: () => void) {
  let options = initial, value = initial.value, external = initial.value, committed = initial.value;
  let error: string | undefined;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() { clearTimeout(timer); timer = undefined; }
  /** Normalizing fields skip the debounce commit so snapping never rewrites text mid-typing; they commit at blur/Enter. */
  function flush(settle = true) {
    cancel();
    if (!pending) return;
    error = options.validate(value);
    if (!error && (settle || !options.normalize)) {
      pending = false;
      value = options.normalize?.(value) ?? value;
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
      cancel(); timer = setTimeout(() => flush(false), 400); changed();
    },
    flush: () => flush(),
    finish() { flush(); options.endBurst(); },
  };
}
