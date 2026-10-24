import type { ComponentChildren } from 'preact';
import type { AttachInput, RuntimeInput } from '../app/runtime';
import type { AppController } from '../app/state';
import type { TestApi } from '../test-harness';
import { Overlay } from './Overlay';
import { createKaneController, type KaneSnapshot } from './controller';
import { createBuildingTags } from './tags';
import './kane.css';

export interface KaneControls {
  overlay: ComponentChildren;
  snapshot(): KaneSnapshot;
  /** Optional tag integration; the runtime owns refresh and disposal of the wrapper. */
  wrapInput?(input: RuntimeInput, ...context: Parameters<AttachInput>): RuntimeInput;
}

/** Loaded only in a test build when the request selects the Kane campaign. */
export function createKaneOverlay(app: AppController, api: TestApi): KaneControls {
  const controller = createKaneController(app);
  return {
    overlay: <Overlay controller={controller} api={api}/>,
    snapshot: controller.snapshot,
    wrapInput(input, context, scene) {
      controller.bindLevel(context.level, context.driver);
      const tags = createBuildingTags(context, scene);
      return {
        refresh() { input.refresh(); tags.refresh(); },
        cancel() { return input.cancel(); },
        dispose() { tags.dispose(); input.dispose(); },
      };
    },
  };
}
