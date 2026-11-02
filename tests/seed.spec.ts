import { test, expect } from '../src/fixtures';
import { roles } from '../src/roles';

/*
 * Starting point for the Playwright planner and generator agents: the built-in
 * `page` is logged in as the sales user and left on Odoo's home screen.
 *
 * Odoo Community has no app-grid home page; /odoo opens the user's first app
 * (Discuss), and the apps are listed under the "Home Menu" button in the navbar.
 */
test.use({ role: 'sales' });

test.describe('Test group', () => {
  test('seed', async ({ page, api }) => {
    const salesUser = roles.sales;
    const [user] = await api.searchRead<{ name: string }>('res.users', [['login', '=', salesUser.login]], ['name']);
    expect(user?.name).toBe(salesUser.name);

    await page.goto('/odoo');
    await expect(page).toHaveURL(/\/odoo(\/|$)/);
    await expect(page.getByRole('banner').getByRole('navigation')).toBeVisible();

    // The browser session belongs to the sales user, not the administrator.
    const session = await page.request.post('/web/session/get_session_info', {
      data: { jsonrpc: '2.0', method: 'call', params: {} },
    });
    const info = (await session.json()).result;
    expect(info.username).toBe(salesUser.login);
    expect(info.is_admin).toBe(false);

    // The Home Menu lists the Sales app, and not the apps of other jobs.
    await page.getByTitle('Home Menu').click();
    await expect(page.getByRole('menuitem', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Purchase', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Inventory', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Sales', exact: true })).toBeHidden();
  });
});
