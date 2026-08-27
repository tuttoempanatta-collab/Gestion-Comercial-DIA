const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { pool } = require('./pool');

const catalogPath = path.join(__dirname, 'catalog.db');

let catalogDb = null;

function getLocalCatalogDb() {
  if (catalogDb) return catalogDb;
  if (fs.existsSync(catalogPath)) {
    try {
      catalogDb = new Database(catalogPath, { readonly: true });
      console.log('Connected to local catalog.db (fallback)');
      return catalogDb;
    } catch (e) {
      console.error('Error connecting to catalog.db:', e.message);
      return null;
    }
  }
  return null;
}

const { getDescription } = require('./description_db');

module.exports = {
  enrichWithCatalog: async (item) => {
    // 1. Enrich description from IET data
    const enrichedDescription = await getDescription(item.codigo);
    if (enrichedDescription) {
      item.articulo = enrichedDescription;
    }

    // 2. Try Supabase/DB catalog_items first
    try {
      const res = await pool.query(
        'SELECT loyalty_description, price_amount, current_quantity FROM catalog_items WHERE item_id = $1',
        [String(item.codigo)]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        const hasPortalPrice = item.precio_fidelizado && item.precio_fidelizado !== '0,00' && item.precio_fidelizado !== '0';
        if (!hasPortalPrice && row.price_amount !== null && row.price_amount !== undefined) {
          const numPrice = parseFloat(row.price_amount);
          if (!isNaN(numPrice) && numPrice > 0) {
            item.precio_fidelizado = String(numPrice.toFixed(2)).replace('.', ',');
          }
        }
        item.stock = row.current_quantity || 0;
        return item;
      }
    } catch (e) {
      console.warn('[Catalog] Supabase lookup failed, trying local:', e.message);
    }

    // 3. Fallback: local catalog.db
    const db = getLocalCatalogDb();
    if (!db) {
      item.stock = 0;
      return item;
    }

    try {
      const stmt = db.prepare('SELECT LoyaltyDescription, PriceAmount, CurrentQuantityInUnits FROM Item WHERE ItemID = ?');
      const result = stmt.get(String(item.codigo));
      if (result) {
        const hasPortalPrice = item.precio_fidelizado && item.precio_fidelizado !== '0,00' && item.precio_fidelizado !== '0';
        if (!hasPortalPrice && result.PriceAmount !== null && result.PriceAmount !== undefined) {
          const numPrice = parseFloat(result.PriceAmount);
          if (!isNaN(numPrice) && numPrice > 0) {
            item.precio_fidelizado = String(numPrice.toFixed(2)).replace('.', ',');
          }
        }
        item.stock = result.CurrentQuantityInUnits || 0;
      } else {
        item.stock = 0;
      }
    } catch (e) {
      console.error(`Error querying local catalog for item ${item.codigo}:`, e.message);
      item.stock = 0;
    }


    return item;
  }
};
