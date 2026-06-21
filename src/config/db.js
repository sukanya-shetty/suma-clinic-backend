const mysql = require('mysql2/promise');
require('dotenv').config();

// Create MySQL connection pool for local Express development
let pool = null;
if (process.env.DB_HOST) {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
}

let currentDB = null;

// Hono middleware will set the active D1 database binding per request
const setDB = (db) => {
  currentDB = db;
};

const query = async (sql, params = []) => {
  // 1. Cloudflare D1/SQLite Mode
  if (currentDB) {
    const stmt = currentDB.prepare(sql);
    const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;

    const trimmedSql = sql.trim().toLowerCase();
    if (trimmedSql.startsWith('select') || trimmedSql.startsWith('with')) {
      const { results } = await bound.all();
      return [results, null];
    } else {
      const result = await bound.run();
      return [{
        insertId: result.meta.last_row_id !== undefined ? result.meta.last_row_id : null,
        affectedRows: result.meta.changes !== undefined ? result.meta.changes : 0
      }, null];
    }
  }

  // 2. Local MySQL Development Fallback Mode
  if (!pool) {
    throw new Error('Database not initialized. Please configure D1 binding or local MySQL environment variables.');
  }
  return pool.query(sql, params);
};

const getConnection = async () => {
  // 1. Cloudflare D1/SQLite Mode
  if (currentDB) {
    return {
      query: async (sql, params = []) => query(sql, params),
      beginTransaction: async () => {
        await query('BEGIN TRANSACTION;');
      },
      commit: async () => {
        await query('COMMIT;');
      },
      rollback: async () => {
        await query('ROLLBACK;');
      },
      release: () => {}
    };
  }

  // 2. Local MySQL Development Fallback Mode
  if (!pool) {
    throw new Error('Database not initialized. Please configure D1 binding or local MySQL.');
  }
  return pool.getConnection();
};

module.exports = {
  setDB,
  query,
  getConnection
};