// Cloudflare D1 compatibility layer for SQLite (replaces mysql2/promise)

let currentDB = null;

// Hono middleware will set the active D1 database binding per request
const setDB = (db) => {
  currentDB = db;
};

const query = async (sql, params = []) => {
  if (!currentDB) {
    throw new Error('Database not initialized. Please configure D1 binding.');
  }

  // SQLite/D1 prepare statement
  const stmt = currentDB.prepare(sql);
  const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;

  const trimmedSql = sql.trim().toLowerCase();
  
  if (trimmedSql.startsWith('select') || trimmedSql.startsWith('with')) {
    const { results } = await bound.all();
    // Return format matching mysql2 query: [rows, fields]
    return [results, null];
  } else {
    // INSERT, UPDATE, DELETE, etc.
    const result = await bound.run();
    // Return format matching mysql2: [resultDetails]
    return [{
      insertId: result.meta.last_row_id !== undefined ? result.meta.last_row_id : null,
      affectedRows: result.meta.changes !== undefined ? result.meta.changes : 0
    }, null];
  }
};

const getConnection = async () => {
  // Return mock connection for transactions support
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
};

module.exports = {
  setDB,
  query,
  getConnection
};