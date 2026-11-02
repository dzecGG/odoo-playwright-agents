import { OdooPage, PaymentDialog } from './odoo-page';

/** Invoicing: customer invoices and vendor bills. */
export class InvoicePage extends OdooPage {
  async gotoCustomerInvoices() {
    await this.goto('/odoo/action-account.action_move_out_invoice_type');
  }

  async gotoCustomerInvoice(id: number) {
    await this.goto(`/odoo/action-account.action_move_out_invoice_type/${id}`);
  }

  async gotoVendorBill(id: number) {
    await this.goto(`/odoo/action-account.action_move_in_invoice_type/${id}`);
  }

  async confirm() {
    await this.button('Confirm', { exact: true }).click();
  }

  async fillBillDetails(reference: string, billDate: string) {
    await this.page.getByRole('textbox', { name: 'Bill Reference' }).fill(reference);
    await this.page.locator('div[name="invoice_date"] input').fill(billDate);
  }

  get payButton() {
    return this.button('Pay', { exact: true });
  }

  get registerPaymentButton() {
    return this.button('Register Payment');
  }

  /** Clicks Pay and returns the payment dialog it opens. */
  async pay() {
    await this.payButton.click();
    return new PaymentDialog(this.page);
  }
}
