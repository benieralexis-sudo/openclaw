import pg from 'pg';
import { ENV } from './env.mjs';

const { Pool } = pg;

let _pool = null;

export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: ENV.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return _pool;
}

export async function runQuery(sql, params = []) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return { rows: res.rows, rowCount: res.rowCount };
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
