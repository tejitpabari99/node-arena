import { expect, test } from "@playwright/test";
test("menu loads authored content; real runtime renders and pauses without simulation restart", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Node Arena" })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose an arena" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /First Steps/ }).click();
  await expect(page.locator("main")).toHaveAttribute("data-screen", "playing");
  await expect(page.locator("#arena canvas").first()).toBeVisible();
  const canvasSize = await page.locator("#arena canvas").first().boundingBox();
  expect(canvasSize!.width).toBeGreaterThan(600);
  expect(canvasSize!.height).toBeGreaterThan(400);
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.locator("#arena [data-tower-summary]")).toHaveCount(1);
  await expect(page.locator("#arena [data-tower-summary]")).toHaveText(/(Tower t\d[^]*){5}/);
  expect(((await page.locator("#arena [data-tower-summary]").textContent()) ?? "").match(/Tower t\d/g)).toHaveLength(5);
  await expect(page.locator("#arena [data-tower-index]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Paused", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Quality", { exact: true }).selectOption("low");
  await page.getByLabel("Colourblind palette").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-screen", "playing");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Quit to menu" }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#arena canvas")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Quality", { exact: true })).toHaveValue("low");
  await expect(page.getByLabel("Colourblind palette")).toBeChecked();
  expect(
    await page.evaluate(() => {
      const g = globalThis as Record<string, unknown>;
      return [typeof g.process, typeof g.Buffer, typeof g.require];
    }),
  ).toEqual(["undefined", "undefined", "undefined"]);
  expect(errors).toEqual([]);
});
