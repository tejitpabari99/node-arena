import { campaignFiles, contentFiles } from "./app/boot";
import { createAppController } from "./app/state";
import { createBrowserRuntime } from "./app/runtime";
import { connectAppAudio } from "./audio/app";
import { mountApp } from "./ui/App";
import { testHookRequest } from "./test-harness/gate";
import "./style.css";
const root = document.getElementById("app");
if (!root) throw new Error("Missing app root");
const arena = document.createElement("div");
arena.id = "arena";
arena.setAttribute("aria-label", "Arena");
document.body.prepend(arena);
// Literal env check (not the imported constant) so Rollup drops the guarded dynamic imports, and their chunks, before chunking.
const hooksBuild = import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === "1";
const request = testHookRequest(location.search, hooksBuild);
const testing = hooksBuild && request.testing;
const fixture = request.fixture;
const fixtures = hooksBuild && fixture !== null ? await import("./test-harness/fixtures") : undefined;
// Sample level stays available to the test API and ?dev=1 tuning; players only see the campaign.
const dev = new URLSearchParams(location.search).get("dev") === "1";
const files = fixtures
  ? fixtures.fixtureFiles(contentFiles(), fixture!)
  : testing || dev ? contentFiles() : campaignFiles(contentFiles());
const harness = testing ? (await import("./test-harness")).createTestHarness(files) : undefined;
const app = createAppController({
  files,
  ...(harness ? { autoStart: false, createSim: harness.createSim } : {}),
  createRuntime: (context) => {
    arena.hidden = false;
    return createBrowserRuntime(context, arena, app.snapshot().save.settings);
  },
});
app.subscribe(() => {
  arena.hidden = !app.driver;
});
if (harness) window.__na = harness.connect(app);
const sound = connectAppAudio(app);
mountApp(app, root);
void app.boot();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    sound.dispose();
    app.dispose();
    arena.remove();
  });
