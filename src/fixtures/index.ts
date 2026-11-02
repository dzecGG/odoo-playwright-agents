import { test as base, expect, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { OdooClient } from '../api';
import { config } from '../config';
import { authFile, roles, type Role } from '../roles';

export { expect };
export type { Role };

type TestFixtures = {
  /**
   * Logs the built-in `page` in as this role: `test.use({ role: 'sales' })`.
   * Without it, `page` is not logged in.
   */
  role: Role | undefined;
  /** Opens a new browser context logged in as the role and returns its page. */
  pageAs: (role: Role) => Promise<Page>;
  salesPage: Page;
  purchasePage: Page;
  warehousePage: Page;
  accountingPage: Page;
  /** An API client that acts as the given role user, to check what that user can see or do. */
  apiAs: (role: Role) => Promise<OdooClient>;
};

type WorkerFixtures = {
  /** An API client logged in as the database administrator, for setup and checks. */
  api: OdooClient;
};

/** Context options from the project config, so role pages match the built-in `page`. */
function projectContextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { baseURL, viewport, locale, timezoneId, ignoreHTTPSErrors, userAgent, deviceScaleFactor, isMobile, hasTouch } =
    testInfo.project.use;
  return { baseURL, viewport, locale, timezoneId, ignoreHTTPSErrors, userAgent, deviceScaleFactor, isMobile, hasTouch };
}

async function openRolePage(browser: Browser, testInfo: TestInfo, role: Role) {
  const context = await browser.newContext({ ...projectContextOptions(testInfo), storageState: authFile(role) });
  return { context, page: await context.newPage() };
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  role: [undefined, { option: true }],

  storageState: async ({ role, storageState }, use) => {
    await use(role ? authFile(role) : storageState);
  },

  pageAs: async ({ browser }, use, testInfo) => {
    const contexts: Array<{ close(): Promise<void> }> = [];
    await use(async (role) => {
      const { context, page } = await openRolePage(browser, testInfo, role);
      contexts.push(context);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },

  salesPage: async ({ pageAs }, use) => use(await pageAs('sales')),
  purchasePage: async ({ pageAs }, use) => use(await pageAs('purchase')),
  warehousePage: async ({ pageAs }, use) => use(await pageAs('warehouse')),
  accountingPage: async ({ pageAs }, use) => use(await pageAs('accounting')),

  api: [
    async ({}, use) => {
      await use(
        await OdooClient.connect({
          baseUrl: config.url,
          db: config.db,
          login: config.adminLogin,
          password: config.adminPassword,
        }),
      );
    },
    { scope: 'worker' },
  ],

  apiAs: async ({}, use) => {
    await use((role) =>
      OdooClient.connect({ baseUrl: config.url, db: config.db, login: roles[role].login, password: config.userPassword }),
    );
  },
});
