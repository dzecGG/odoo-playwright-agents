import path from 'node:path';

/** The jobs that carry out the business steps. Never the administrator. */
export type Role = 'sales' | 'purchase' | 'warehouse' | 'accounting';

export interface RoleDefinition {
  login: string;
  name: string;
  /**
   * XML ids of the groups the user gets, besides "Internal User". These are
   * Odoo Community 19's standard job rights (Settings > Users > Access Rights).
   */
  groups: string[];
}

export const roles: Record<Role, RoleDefinition> = {
  sales: {
    login: 'pw.sales',
    name: 'Sam Sales',
    // Sales: User: Own Documents Only
    groups: ['sales_team.group_sale_salesman'],
  },
  purchase: {
    login: 'pw.purchase',
    name: 'Pat Purchase',
    // Purchase: User
    groups: ['purchase.group_purchase_user'],
  },
  warehouse: {
    login: 'pw.warehouse',
    name: 'Wes Warehouse',
    // Inventory: User
    groups: ['stock.group_stock_user'],
  },
  accounting: {
    login: 'pw.accounting',
    name: 'Ada Accounting',
    // Accounting: Invoicing. Community 19 offers only "Invoicing" and
    // "Administrator" here; Administrator adds configuration rights the job does not need.
    groups: ['account.group_account_invoice'],
  },
};

export const allRoles = Object.keys(roles) as Role[];

/** Where the setup project saves each role's logged-in browser state. */
export function authFile(role: Role): string {
  return path.resolve(__dirname, '..', 'playwright', '.auth', `${role}.json`);
}
