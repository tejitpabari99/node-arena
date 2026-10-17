import { fileURLToPath } from 'node:url';
const publicSimPath = `/@fs${fileURLToPath(new URL('../../../packages/sim/src/index.ts', import.meta.url))}`;
import path from "node:path";
import { expect, test } from "@playwright/test";
test("future 20-level content runs through real results, retry, next and completed picker", async ({
  page,
}) => {
  test.skip(
    process.env.WEB_TEST_SERVER !== "dev",
    "Imports controller fixtures through Vite; production runtime is covered by boot.spec",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Primitive greybox manifest keeps level starts synchronous and independent of shipped art.
  await page.route("**/manifest.json", (route) =>
    route.fulfill({
      path: path.join(process.cwd(), "test/fixtures/greybox-manifest.json"),
      contentType: "application/json",
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (simPath) => {
    const paths = [
      "/src/app/boot.ts",
      "/src/app/state.ts",
      "/src/app/runtime.ts",
      "/src/ui/App.tsx",
      simPath,
    ];
    const [
      { contentFiles },
      { createAppController },
      { createBrowserRuntime },
      { mountApp },
      { create },
    ] = await Promise.all(paths.map((path) => import(path)));
    const files = contentFiles(),
      sample = JSON.parse(files["data/levels/sample.json"]);
    // Replace the whole shipped campaign with the 20 fixture levels.
    for (const p of Object.keys(files)) if (p.startsWith("data/levels/")) delete files[p];
    for (let i = 20; i >= 1; i--)
      files[`data/levels/fixture-${i}.json`] = JSON.stringify({
        ...sample,
        id: `fixture-${i}`,
        name: `Fixture ${i}`,
        order: i,
      });
    const parent = document.getElementById("arena")!;
    parent.hidden = false;
    const app = createAppController({
      files,
      autoStart: false,
      createSim: (level: any, seed: number) =>
        create(
          {
            ...level,
            towers: level.towers.map((tower: any) => ({
              ...tower,
              owner: level.players.findIndex(
                (player: any) => player.kind === "human",
              ),
            })),
          },
          seed,
        ),
      createRuntime: (context: any) =>
        createBrowserRuntime(context, parent, app.snapshot().save.settings),
    });
    app.subscribe(() => {
      if (app.snapshot().screen === "playing") queueMicrotask(() => app.step());
    });
    mountApp(app, document.getElementById("app")!);
    await app.boot();
  }, publicSimPath);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".level-grid button")).toHaveCount(20);
  await page.getByRole("button", { name: /^20 Fixture 20/ }).click();
  await expect(page.getByRole("heading", { name: "Victory" })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Victory" })).toBeVisible();
  await page.getByRole("button", { name: "Back to menu" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /20 Fixture 20.*Completed/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^1 Fixture 1 / }).click();
  await expect(page.getByRole("heading", { name: "Victory" })).toBeVisible();
  await page.getByRole("button", { name: "Next arena" }).click();
  await expect(page.locator(".overlay .eyebrow")).toHaveText("Fixture 2");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("nodearena:save")!).completed[
          "fixture-20"
        ],
    ),
  ).toHaveProperty("firstAt");
});
