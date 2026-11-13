import mysql, { type Pool } from "mysql2/promise";
import { config } from "../config.ts";

// Created on first use, not at import, so it picks up whichever .env is in
// effect by then (the OpenClaw plugin loads it during registration).
let pool: Pool | null = null;

function getPool(): Pool {
  pool ??= mysql.createPool({
    ...config.mysql,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  return pool;
}

export async function query<T>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T[];
}

export async function closeConnection() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
