import type { ComponentChildren } from 'preact';
import type { AttachInput, RuntimeInput } from '../app/runtime';
import type { AppController } from '../app/state';
import type { TestApi } from '../test-harness';
import { Overlay } from './Overlay';
import './kane.css';

export interface KaneControls {
  overlay: ComponentChildren;
  /** Optional tag integration; the runtime owns refresh and disposal of the wrapper. */
  wrapInput?(input: RuntimeInput, ...context: Parameters<AttachInput>): RuntimeInput;
}

/** Loaded only in a test build when the request selects the Kane campaign. */
export function createKaneOverlay(app: AppController, api: TestApi): KaneControls {
  return { overlay: <Overlay app={app} api={api}/> };
}
