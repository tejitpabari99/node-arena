import { useId, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { createLiveField, type LiveFieldOptions } from './live-field.js';

type FieldEvent = { currentTarget: { value: string } };
type KeyEvent = { key: string; isComposing?: boolean; preventDefault(): void };

/** Local text stays editable while only validated values enter the document. */
export function useLiveField(options: LiveFieldOptions) {
  const [, redraw] = useState(0);
  const errorId = useId();
  const field = useMemo(() => createLiveField(options, () => redraw(n => n + 1)), [options.mergeKey]);
  field.update(options);
  // Cleanup captures the old item session, including its commit callback.
  useLayoutEffect(() => () => field.finish(), [field]);
  useLayoutEffect(() => { field.sync(options.value); }, [field, options.value]);
  const onInput = (event: FieldEvent) => field.input(event.currentTarget.value);
  const onBlur = () => field.finish();
  const onKeyDown = (event: KeyEvent) => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); field.finish(); }
  };
  return {
    value: field.value, error: field.error, errorId, flush: field.flush, onInput, onBlur, onKeyDown,
    inputProps: { value: field.value, 'aria-invalid': field.error ? true as const : undefined, 'aria-describedby': field.error ? errorId : undefined, onInput, onBlur, onKeyDown },
  };
}

export function LiveFieldError({ field }: { field: Pick<ReturnType<typeof useLiveField>, 'error' | 'errorId'> }) {
  return field.error ? <span id={field.errorId} class="ed-error" role="alert">{field.error}</span> : null;
}
