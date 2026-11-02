import path from 'node:path';
import dotenv from 'dotenv';

// Values already in the environment (for example in CI) win over .env.
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing setting ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** Settings from .env (see .env.example). */
export const config = {
  url: env('ODOO_URL', 'http://localhost:8069'),
  masterPassword: env('ODOO_MASTER_PASSWORD', 'admin'),
  db: env('ODOO_DB', 'playwright'),
  adminLogin: env('ODOO_ADMIN_LOGIN', 'admin'),
  adminPassword: env('ODOO_ADMIN_PASSWORD', 'admin'),
  country: env('ODOO_COUNTRY', 'US'),
  lang: env('ODOO_LANG', 'en_US'),
  userPassword: env('ODOO_USER_PASSWORD'),
  /** Timezone for both the browser and the Odoo users, so dates agree. */
  timezone: 'UTC',
} as const;

/** Odoo modules the suite needs: Sales, Purchase, Inventory, Invoicing. */
export const requiredModules = ['sale_management', 'purchase', 'stock', 'account'] as const;
