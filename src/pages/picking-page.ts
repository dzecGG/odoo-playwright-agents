import { OdooPage } from './odoo-page';

/** Inventory > Operations: deliveries and receipts. */
export class PickingPage extends OdooPage {
  async gotoDeliveries() {
    await this.goto('/odoo/action-stock.action_picking_tree_outgoing');
  }

  async gotoReceipts() {
    await this.goto('/odoo/action-stock.action_picking_tree_incoming');
  }

  async gotoReceipt(id: number) {
    await this.goto(`/odoo/action-stock.action_picking_tree_incoming/${id}`);
  }

  /** Any transfer, as reached by someone who may not have the Inventory app. */
  async gotoTransfer(id: number) {
    await this.goto(`/odoo/action-stock.action_picking_tree_all/${id}`);
  }

  /** Opens a transfer by clicking the list cell that holds its reference. */
  async openListCell(name: string) {
    await this.page.getByRole('cell', { name }).click();
  }

  async validate() {
    await this.button('Validate').click();
  }
}
