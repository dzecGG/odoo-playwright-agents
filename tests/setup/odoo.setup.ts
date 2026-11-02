import fs from 'node:fs';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { OdooClient, OdooDatabaseManager } from '../../src/api';
import { config, requiredModules } from '../../src/config';
import { allRoles, authFile, roles } from '../../src/roles';

/*
 * Prepares Odoo for the suite. Safe to run on a brand-new Odoo and on one it
 * has already set up: every step checks what exists and only adds what is missing.
 */

setup.describe.configure({ mode: 'serial' });
setup.setTimeout(10 * 60_000);

function connectAdmin(): Promise<OdooClient> {
  return OdooClient.connect({
    baseUrl: config.url,
    db: config.db,
    login: config.adminLogin,
    password: config.adminPassword,
  });
}

setup('database exists with the required apps', async () => {
  const manager = new OdooDatabaseManager(config.url, config.masterPassword);

  if (!(await manager.exists(config.db))) {
    await manager.create({
      name: config.db,
      adminLogin: config.adminLogin,
      adminPassword: config.adminPassword,
      demo: false,
      lang: config.lang,
      countryCode: config.country,
    });
  }

  const admin = await connectAdmin();

  const missing = await admin.searchRead<{ name: string }>(
    'ir.module.module',
    [['name', 'in', [...requiredModules]], ['state', '!=', 'installed']],
    ['name'],
  );
  if (missing.length > 0) {
    await admin.execute('ir.module.module', 'button_immediate_install', [missing.map((m) => m.id)], {}, 600_000);
  }

  const installed = await admin.searchRead<{ name: string }>(
    'ir.module.module',
    [['name', 'in', [...requiredModules]], ['state', '=', 'installed']],
    ['name'],
  );
  expect(installed.map((m) => m.name).sort()).toEqual([...requiredModules].sort());

  // The company needs a chart of accounts before anything can be invoiced.
  const companyId = await admin.ref('base.main_company');
  const [company] = await admin.read<{ chart_template: string | false }>('res.company', [companyId], ['chart_template']);
  expect(company.chart_template, 'main company has a chart of accounts').toBeTruthy();
});

setup('one user per role with its standard access rights', async () => {
  const admin = await connectAdmin();
  const companyId = await admin.ref('base.main_company');
  const internalUser = await admin.ref('base.group_user');

  for (const role of allRoles) {
    const { login, name, groups } = roles[role];
    const groupIds = [internalUser, ...(await Promise.all(groups.map((g) => admin.ref(g))))];
    const values = {
      name,
      login,
      password: config.userPassword,
      tz: config.timezone,
      lang: config.lang,
      company_id: companyId,
      company_ids: [[6, 0, [companyId]]],
      // Replace, not add, so a second run resets any rights changed since.
      group_ids: [[6, 0, groupIds]],
    };

    const [existingId] = await admin.search('res.users', [['login', '=', login]], {
      context: { active_test: false },
    });
    if (existingId) {
      await admin.write('res.users', [existingId], { ...values, active: true });
    } else {
      await admin.create('res.users', values);
    }

    // Check the result as the user: the job groups, and no administrator rights.
    const user = await OdooClient.connect({ baseUrl: config.url, db: config.db, login, password: config.userPassword });
    for (const group of groups) {
      expect(await user.execute<boolean>('res.users', 'has_group', [[user.uid], group]), `${login} is in ${group}`).toBe(true);
    }
    expect(
      await user.execute<boolean>('res.users', 'has_group', [[user.uid], 'base.group_system']),
      `${login} is not a Settings administrator`,
    ).toBe(false);
  }
});

setup('save the login of each role user', async ({ playwright }) => {
  for (const role of allRoles) {
    const context = await playwright.request.newContext({ baseURL: config.url });
    const response = await context.post('/web/session/authenticate', {
      data: {
        jsonrpc: '2.0',
        method: 'call',
        params: { db: config.db, login: roles[role].login, password: config.userPassword },
      },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.error, `login error for ${role}`).toBeUndefined();
    expect(body.result?.username).toBe(roles[role].login);

    const file = authFile(role);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await context.storageState({ path: file });
    await context.dispose();
  }
});
