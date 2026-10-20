import { expect, test } from "@playwright/test";

async function startLevel(page: import("@playwright/test").Page, name: RegExp) {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: name }).click();
  await expect(page.locator("main")).toHaveAttribute("data-screen", "playing");
}

test("tip shows once on level 1, dismiss persists across reload, absent on later levels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await startLevel(page, /First Steps/);
  const tip = page.locator('[data-hud="tip"]');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute("role", "status");
  await tip.getByRole("button", { name: "Dismiss" }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await startLevel(page, /First Steps/);
  await expect(page.locator('[data-hud="root"]')).toBeVisible();
  await expect(page.locator('[data-hud="tip"]')).toHaveCount(0);
});

test("tip is not shown on levels other than level 1", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await startLevel(page, /Neutral Ground/);
  await expect(page.locator('[data-hud="root"]')).toBeVisible();
  await expect(page.locator('[data-hud="tip"]')).toHaveCount(0);
});

test("strength meter exposes role=meter with team percent valuetext summing to 100", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await startLevel(page, /First Steps/);
  const meter = page.locator('[data-hud="meter"]');
  await expect(meter).toHaveAttribute("role", "meter");
  await expect(meter).toHaveAttribute("aria-valuetext", /^([A-Za-z ]+ \d+%)(, [A-Za-z ]+ \d+%)+$/);
  const text = (await meter.getAttribute("aria-valuetext"))!;
  const sum = [...text.matchAll(/(\d+)%/g)].reduce((a, m) => a + Number(m[1]), 0);
  expect(sum).toBe(100);
  // aria-valuenow tracks the first segment (read both attrs in one tick-safe evaluate).
  const { now, vt } = await meter.evaluate((el) => ({ now: Number(el.getAttribute("aria-valuenow")), vt: el.getAttribute("aria-valuetext")! }));
  expect(now).toBe(Number(/(\d+)%/.exec(vt)![1]));
});

test("Esc pauses and the round Pause/speed buttons work", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await startLevel(page, /First Steps/);
  const speed = page.getByRole("button", { name: "Game speed" });
  await expect(speed).toHaveText("1×");
  await speed.click();
  await expect(speed).toHaveText("2×");
  await expect(speed).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-screen", "playing");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
});
