import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

export type NewPlayerPage = () => Promise<Page>;

// Explicit contexts give each player a distinct token; own their lifetime per test.
export const test = base.extend<{ newPlayerPage: NewPlayerPage }>({
  newPlayerPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const context = await browser.newContext();
        contexts.push(context);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map(context => context.close()));
    }
  },
});
export { expect };
