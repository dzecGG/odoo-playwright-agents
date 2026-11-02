import type { Locator, Page } from '@playwright/test';

/** Pieces of the Odoo web client that every app shares. Page objects return locators; the tests make the assertions. */
export class OdooPage {
  constructor(readonly page: Page) {}

  async goto(path: string) {
    await this.page.goto(path);
  }

  /** A step of the status bar (Quotation, Sales Order, Ready, Done, Posted ...). */
  statusStep(name: string) {
    return this.page.getByRole('radio', { name, exact: true });
  }

  button(name: string, options: { exact?: boolean } = {}) {
    return this.page.getByRole('button', { name, exact: options.exact });
  }

  /** A row of the totals block under the order lines, such as "Untaxed Amount:" or "Total:". */
  totalsRow(name: RegExp) {
    return this.page.getByRole('row', { name });
  }

  /** A form field that Odoo has flagged as invalid, such as partner_id. */
  invalidField(fieldName: string) {
    return this.page.locator(`div[name="${fieldName}"].o_field_invalid`);
  }

  /** Either the access error dialog or the opened form: what Odoo shows after a direct URL to a record. */
  get dialogOrForm() {
    return this.page.getByRole('dialog').or(this.page.locator('.o_form_view, .o_action_manager')).first();
  }

  /** The green "Paid" badge in the status bar of an invoice or bill. */
  get paidBadge() {
    return this.page.locator('span.text-bg-success').getByText('Paid', { exact: true });
  }

  /** The "Paid" ribbon on a vendor bill. */
  get paidRibbon() {
    return this.page.locator('.o_widget_web_ribbon').getByText('Paid');
  }

  /** Types in the list view search box and presses Enter. */
  async search(text: string) {
    const searchBox = this.page.getByRole('searchbox');
    await searchBox.fill(text);
    await searchBox.press('Enter');
  }

  /** Opens the first list row whose text matches. */
  async openListRow(text: string | RegExp) {
    await this.page.getByRole('row', { name: text }).first().click();
  }

  /** The apps listed under the navbar "Home Menu" button. */
  async openHomeMenu() {
    await this.page.getByTitle('Home Menu').click();
  }

  homeMenuItem(name: string) {
    return this.page.getByRole('menuitem', { name, exact: true });
  }

  async closeHomeMenu() {
    await this.page.keyboard.press('Escape');
  }

  async openHomeMenuFromStart() {
    await this.goto('/odoo');
    await this.openHomeMenu();
  }

  /** Pages with a quantity/price grid: fills one cell of the first order line. */
  protected lineCell(column: string): Locator {
    return this.page.locator(`td[name="${column}"] input`).first();
  }
}

/** The "Pay" dialog (Register Payment) on an invoice or bill. */
export class PaymentDialog {
  readonly root: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('dialog');
  }

  get journal() {
    return this.root.getByRole('combobox', { name: 'Journal' });
  }

  get paymentMethod() {
    return this.root.getByRole('combobox', { name: 'Payment Method' });
  }

  get amount() {
    return this.root.getByRole('textbox', { name: 'Amount' });
  }

  async createPayment() {
    await this.root.getByRole('button', { name: 'Create Payment' }).click();
  }
}
