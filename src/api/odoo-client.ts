/**
 * Client for Odoo's external API (JSON-RPC on /jsonrpc).
 *
 * Odoo 19 still serves /jsonrpc; it also adds the newer /json/2 API, but that
 * one needs API keys and has no database service, so the suite uses JSON-RPC
 * for both database management and model calls.
 */

export type Domain = Array<string | [string, string, unknown]>;
export type Values = Record<string, unknown>;
export type Kwargs = Record<string, unknown>;

/** An error returned by Odoo, with its server-side message and exception type. */
export class OdooRpcError extends Error {
  constructor(
    message: string,
    readonly exceptionName: string | undefined,
    readonly debug: string | undefined,
  ) {
    super(message);
    this.name = 'OdooRpcError';
  }
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    message: string;
    data?: { name?: string; message?: string; debug?: string };
  };
}

let requestId = 0;

/** Calls `service.method(...args)` on Odoo's /jsonrpc endpoint. */
export async function jsonRpc<T>(
  baseUrl: string,
  service: string,
  method: string,
  args: unknown[],
  timeoutMs = 300_000,
): Promise<T> {
  const response = await fetch(new URL('/jsonrpc', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: ++requestId,
      params: { service, method, args },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Odoo ${service}.${method}: HTTP ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) {
    const data = body.error.data ?? {};
    throw new OdooRpcError(
      `Odoo ${service}.${method}: ${data.message || body.error.message}`,
      data.name,
      data.debug,
    );
  }
  return body.result as T;
}

/** Database manager calls (the `db` service). They need the master password. */
export class OdooDatabaseManager {
  constructor(
    private readonly baseUrl: string,
    private readonly masterPassword: string,
  ) {}

  list(): Promise<string[]> {
    return jsonRpc<string[]>(this.baseUrl, 'db', 'list', []);
  }

  async exists(name: string): Promise<boolean> {
    return jsonRpc<boolean>(this.baseUrl, 'db', 'db_exist', [name]);
  }

  /** Creates a database with only the `base` module, and its administrator. */
  async create(options: {
    name: string;
    adminLogin: string;
    adminPassword: string;
    demo?: boolean;
    lang?: string;
    countryCode?: string;
  }): Promise<void> {
    await jsonRpc<boolean>(
      this.baseUrl,
      'db',
      'create_database',
      [
        this.masterPassword,
        options.name,
        options.demo ?? false,
        options.lang ?? 'en_US',
        options.adminPassword,
        options.adminLogin,
        options.countryCode ?? false,
      ],
      600_000,
    );
  }

  drop(name: string): Promise<boolean> {
    return jsonRpc<boolean>(this.baseUrl, 'db', 'drop', [this.masterPassword, name]);
  }
}

/** Calls model methods on one database as one user. */
export class OdooClient {
  private constructor(
    readonly baseUrl: string,
    readonly db: string,
    readonly uid: number,
    readonly login: string,
    private readonly password: string,
  ) {}

  /** Logs in and returns a client, or throws if the login or password is wrong. */
  static async connect(options: {
    baseUrl: string;
    db: string;
    login: string;
    password: string;
  }): Promise<OdooClient> {
    const uid = await jsonRpc<number | false>(options.baseUrl, 'common', 'authenticate', [
      options.db,
      options.login,
      options.password,
      {},
    ]);
    if (!uid) {
      throw new Error(`Odoo login failed for "${options.login}" on database "${options.db}"`);
    }
    return new OdooClient(options.baseUrl, options.db, uid, options.login, options.password);
  }

  /** Calls any public model method: `model.method(*args, **kwargs)`. */
  execute<T = unknown>(model: string, method: string, args: unknown[] = [], kwargs: Kwargs = {}, timeoutMs?: number): Promise<T> {
    return jsonRpc<T>(
      this.baseUrl,
      'object',
      'execute_kw',
      [this.db, this.uid, this.password, model, method, args, kwargs],
      timeoutMs,
    );
  }

  search(model: string, domain: Domain = [], kwargs: Kwargs = {}): Promise<number[]> {
    return this.execute<number[]>(model, 'search', [domain], kwargs);
  }

  searchCount(model: string, domain: Domain = []): Promise<number> {
    return this.execute<number>(model, 'search_count', [domain]);
  }

  searchRead<T extends Values = Values>(
    model: string,
    domain: Domain = [],
    fields: string[] = [],
    kwargs: Kwargs = {},
  ): Promise<Array<T & { id: number }>> {
    return this.execute(model, 'search_read', [domain], { fields, ...kwargs });
  }

  read<T extends Values = Values>(model: string, ids: number[], fields: string[] = []): Promise<Array<T & { id: number }>> {
    return this.execute(model, 'read', [ids], { fields });
  }

  async create(model: string, values: Values): Promise<number> {
    const result = await this.execute<number | number[]>(model, 'create', [values]);
    return Array.isArray(result) ? result[0] : result;
  }

  write(model: string, ids: number[], values: Values): Promise<boolean> {
    return this.execute<boolean>(model, 'write', [ids, values]);
  }

  unlink(model: string, ids: number[]): Promise<boolean> {
    return this.execute<boolean>(model, 'unlink', [ids]);
  }

  /** Returns the record id behind an XML id such as `base.main_company`, or undefined. */
  async refId(xmlId: string): Promise<number | undefined> {
    const [module, name] = xmlId.split('.');
    const [data] = await this.searchRead<{ res_id: number }>(
      'ir.model.data',
      [['module', '=', module], ['name', '=', name]],
      ['res_id'],
      { limit: 1 },
    );
    return data?.res_id;
  }

  /** Like refId, but throws when the XML id does not exist. */
  async ref(xmlId: string): Promise<number> {
    const id = await this.refId(xmlId);
    if (id === undefined) throw new Error(`Odoo XML id not found: ${xmlId}`);
    return id;
  }

  /** Field names of a model, for code that must cope with renamed fields. */
  async fieldNames(model: string): Promise<string[]> {
    const fields = await this.execute<Record<string, unknown>>(model, 'fields_get', [], { attributes: ['type'] });
    return Object.keys(fields);
  }
}
