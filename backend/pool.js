const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

let activePool = null;
let useSqlite = false;

// Helper to translate Postgres syntax into SQLite syntax
function translatePgToSqlite(sql, params) {
  let sqliteSql = sql;
  let newParams = [];
  let returning = false;
  
  // Replace ILIKE with LIKE (SQLite LIKE is case-insensitive for ASCII)
  sqliteSql = sqliteSql.replace(/\bILIKE\b/g, 'LIKE');
  
  // Replace NOW() with datetime('now')
  sqliteSql = sqliteSql.replace(/\bNOW\(\)/g, "datetime('now')");
  
  // Check for RETURNING
  if (/\bRETURNING\b/i.test(sqliteSql)) {
    returning = true;
    sqliteSql = sqliteSql.replace(/\bRETURNING\s+\w+/i, '');
  }
  
  // Parse placeholders
  const regex = /\$(\d+)/g;
  let lastIndex = 0;
  let resultSql = '';
  let match;
  
  while ((match = regex.exec(sqliteSql)) !== null) {
    const matchIndex = match.index;
    const num = parseInt(match[1]);
    const valIndex = num - 1;
    const val = params ? params[valIndex] : undefined;
    
    // Check if the preceding text ends with "= ANY(" (ignoring whitespace)
    const prefix = sqliteSql.substring(lastIndex, matchIndex);
    const isAny = /=\s*ANY\s*\(\s*$/i.test(prefix);
    
    if (isAny) {
      // Remove "= ANY(" from the prefix
      const cleanPrefix = prefix.replace(/=\s*ANY\s*\(\s*$/i, '');
      resultSql += cleanPrefix;
      
      // Expand the array into IN (?, ?, ...)
      if (Array.isArray(val)) {
        if (val.length === 0) {
          resultSql += 'IN (NULL)';
        } else {
          resultSql += `IN (${val.map(() => '?').join(', ')})`;
          newParams.push(...val);
        }
      } else {
        resultSql += '= ?';
        newParams.push(val);
      }
      
      // Skip the closing parenthesis of ANY($N)
      const suffix = sqliteSql.substring(regex.lastIndex);
      const closeParenMatch = /^\s*\)/.exec(suffix);
      if (closeParenMatch) {
        regex.lastIndex += closeParenMatch[0].length;
      }
    } else {
      resultSql += prefix;
      resultSql += '?';
      newParams.push(val);
    }
    
    lastIndex = regex.lastIndex;
  }
  
  resultSql += sqliteSql.substring(lastIndex);
  
  return { sql: resultSql, params: newParams, returning };
}

async function getActivePool() {
  if (activePool) return activePool;

  if (process.env.DATABASE_URL && !useSqlite) {
    try {
      console.log('[Database] Connecting to PostgreSQL using DATABASE_URL...');
      const pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        },
        connectionTimeoutMillis: 5000 // 5 seconds timeout
      });

      // Quick test query to verify if the DB is reachable
      await pgPool.query('SELECT 1');
      console.log('[Database] PostgreSQL connection test successful.');

      // Safely ensure table column exists in PostgreSQL
      await pgPool.query('ALTER TABLE commercial_actions ADD COLUMN IF NOT EXISTS precio_final TEXT;');
      console.log('[Database] PostgreSQL: Verified column precio_final exists in commercial_actions');

      activePool = pgPool;
      return activePool;
    } catch (err) {
      console.error('[Database Error] Failed to connect to PostgreSQL:', err.message);
      console.log('[Database] Falling back to SQLite because PostgreSQL is unreachable.');
      useSqlite = true;
    }
  }

  // Initialize SQLite
  console.log('[Database] Initializing local SQLite (database.sqlite)...');
  const dbPath = path.join(__dirname, 'database.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Initialize tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT,
      start_date TEXT,
      end_date TEXT,
      items_count INTEGER DEFAULT 0,
      error_message TEXT
    );
    
    CREATE TABLE IF NOT EXISTS commercial_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      extraction_id INTEGER REFERENCES extractions(id) ON DELETE CASCADE,
      codigo TEXT,
      articulo TEXT,
      combo TEXT,
      precio_fidelizado TEXT,
      fecha_desde TEXT,
      fecha_hasta TEXT,
      cantidades TEXT,
      stock INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    
    CREATE TABLE IF NOT EXISTS product_descriptions (
      codigo TEXT PRIMARY KEY,
      description TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS catalog_items (
      item_id TEXT PRIMARY KEY,
      loyalty_description TEXT,
      price_amount REAL,
      current_quantity REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Configuración por defecto
    INSERT INTO settings (key, value) VALUES ('username', 'T00624AR') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('password', 'T00624AR') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('portal_url', 'https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.login') ON CONFLICT (key) DO NOTHING;
  `);

  // Ensure column exists
  const columns = db.pragma('table_info(commercial_actions)');
  const hasPrecioFinal = columns.some(col => col.name === 'precio_final');
  if (!hasPrecioFinal) {
    db.exec('ALTER TABLE commercial_actions ADD COLUMN precio_final TEXT');
    console.log('[Database] SQLite: Added column precio_final to commercial_actions');
  }

  activePool = {
    isSqlite: true,
    query: async (text, params) => {
      if (typeof text !== 'string') {
        throw new Error('Query must be a string');
      }
      
      const { sql, params: sqliteParams, returning } = translatePgToSqlite(text, params);
      
      // Handle transaction statements
      const trimmed = sql.trim().toUpperCase();
      if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
        db.prepare(trimmed).run();
        return { rows: [], rowCount: 0 };
      }
      
      try {
        const stmt = db.prepare(sql);
        const isSelect = trimmed.startsWith('SELECT');
        
        if (isSelect) {
          const rows = stmt.all(sqliteParams || []);
          return { rows, rowCount: rows.length };
        } else {
          const info = stmt.run(sqliteParams || []);
          const rows = returning ? [{ id: info.lastInsertRowid }] : [];
          return { 
            rows, 
            rowCount: info.changes,
            lastInsertRowid: info.lastInsertRowid 
          };
        }
      } catch (err) {
        console.error(`[SQLite Error] Query: "${sql}"`, err.message);
        throw err;
      }
    },
    end: async () => {
      db.close();
      console.log('[Database] Closed SQLite connection');
    }
  };

  return activePool;
}

// Proxy pool object that delegates requests asynchronously
const pool = {
  query: async (text, params) => {
    const active = await getActivePool();
    return active.query(text, params);
  },
  end: async () => {
    if (activePool) {
      await activePool.end();
      activePool = null;
    }
  }
};

module.exports = { pool };
