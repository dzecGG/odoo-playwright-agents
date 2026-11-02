import { OdooPage } from './odoo-page';

const QUOTATIONS = '/odoo/action-sale.action_quotations_with_onboarding';

/** Sales > Orders > Quotations: the quotation / sales order form. */
export class SaleOrderPage extends OdooPage {
  async gotoNewQuotation() {
    await this.goto(`${QUOTATIONS}/new`);
  }

  async gotoOrder(id: number) {
    await this.goto(`${QUOTATIONS}/${id}`);
  }

  async setCustomer(name: string) {
    await this.page.getByRole('combobox', { name: 'Customer' }).fill(name);
    await this.page.getByRole('option', { name }).first().click();
  }

  /** Adds an order line; the price is left at the product's price when omitted. */
  async addProduct(name: string, quantity: number, unitPrice?: string) {
    await this.button('Add a product').click();
    await this.page.getByRole('combobox', { name: 'Search a product' }).fill(name);
    await this.page.getByRole('option', { name }).first().click();
    await this.lineCell('product_uom_qty').fill(String(quantity));
    if (unitPrice !== undefined) await this.lineCell('price_unit').fill(unitPrice);
  }

  async save() {
    await this.button('Save manually').click();
  }

  async confirm() {
    await this.button('Confirm', { exact: true }).click();
  }

  /** Create Invoice > Create Draft. Odoo then opens the new draft invoice. */
  async createDraftInvoice() {
    await this.button('Create Invoice').click();
    await this.button('Create Draft', { exact: true }).click();
  }

  /** The Invoices smart button, showing one invoice. */
  get invoiceSmartButton() {
    return this.page.getByRole('button', { name: /Invoice/ }).filter({ hasText: '1' });
  }
}
