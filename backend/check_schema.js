const Database = require('better-sqlite3');
const path = require('path');

try {
  const db = new Database(path.join(__dirname, 'catalog.db'), { readonly: true });
  const tableInfo = db.prepare("PRAGMA table_info(Item)").all();
  console.log('Columns in Item table:');
  console.log(JSON.stringify(tableInfo, null, 2));
  
  // Also check if there's a separate Stock table
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('\nAll tables:');
  console.log(JSON.stringify(tables, null, 2));
} catch (e) {
  console.error('Error:', e.message);
}
