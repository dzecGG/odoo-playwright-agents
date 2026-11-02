import { OdooPage } from './odoo-page';

/** Purchase > Orders: the RFQ / purchase order form and list. */
export class PurchaseOrderPage extends OdooPage {
  async gotoRfqList() {
    await this.goto('/odoo/action-purchase.purchase_rfq');
  }

  async gotoNewRfq() {
    await this.goto('/odoo/action-purchase.purchase_rfq/new');
  }

  async gotoRfq(id: number) {
    await this.goto(`/odoo/action-purchase.purchase_rfq/${id}`);
  }

  /** The list of all purchase orders (Invoicing users reach it to create bills). */
  async gotoPurchaseOrders() {
    await this.goto('/odoo/action-purchase.purchase_form_action');
  }

  async clickNew() {
    await this.button('New').click();
  }

  async setVendor(name: string) {
    await this.page.getByRole('combobox', { name: 'Vendor' }).fill(name);
    await this.page.getByRole('option', { name }).first().click();
  }

  /** Adds an order line; the price is left at the product's price when omitted. */
  async addProduct(name: string, quantity: number, unitPrice?: string) {
    await this.button('Add a product').click();
    await this.page.getByRole('combobox', { name: 'Search a product' }).fill(name);
    await this.page.getByRole('option', { name }).first().click();
    await this.lineCell('product_qty').fill(String(quantity));
    if (unitPrice !== undefined) await this.lineCell('price_unit').fill(unitPrice);
  }

  async save() {
    await this.button('Save manually').click();
  }

  async confirmOrder() {
    await this.button('Confirm Order').click();
  }

  /** Ticks the order in the list and clicks "Create Bills". */
  async createBillsFor(orderName: string) {
    await this.page.getByRole('row', { name: new RegExp(orderName) }).getByRole('checkbox').check();
    await this.button('Create Bills').click();
  }
}
