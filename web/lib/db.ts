import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { env } from "./env";

/**
 * MySQL access layer (docs/CONTRACTS.md section 4, "Connection rules").
 *  - one pool per server process (cached on globalThis so dev hot-reload
 *    does not open a new pool on every edit)
 *  - always parameterised queries (`?` placeholders), never string concat
 *  - multipleStatements disabled (blocks stacked-query SQL injection)
 *  - session-dependent work (transactions, OUT parameters) must use ONE
 *    acquired connection: withConnection / withTransaction
 */
const globalForDb = globalThis as unknown as { __skillmatchPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.__skillmatchPool) {
    const e = env();
    globalForDb.__skillmatchPool = mysql.createPool({
      host: e.MYSQL_HOST,
      port: e.MYSQL_PORT,
      user: e.MYSQL_USER,
      password: e.MYSQL_PASSWORD,
      database: e.MYSQL_DATABASE,
      connectionLimit: 10,
      waitForConnections: true,
      multipleStatements: false,
      decimalNumbers: true, // DECIMAL -> number (scores, salaries)
      timezone: "Z",
    });
  }
  return globalForDb.__skillmatchPool;
}

/** Run a single parameterised statement on any pooled connection. */
export async function query<T>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await getPool().query(sql, params);
  return rows as T;
}

/** Borrow one connection for several statements; always released. */
export async function withConnection<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

/** Run fn inside BEGIN ... COMMIT on one connection; ROLLBACK on any error. */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    }
  });
}

/** Close the pool (tests / scripts). */
export async function closePool(): Promise<void> {
  if (globalForDb.__skillmatchPool) {
    await globalForDb.__skillmatchPool.end();
    globalForDb.__skillmatchPool = undefined;
  }
}
