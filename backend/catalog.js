const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const catalogPath = path.join(__dirname, 'catalog.db');

let catalogDb = null;

function getCatalogDb() {
  if (catalogDb) return catalogDb;
  
  if (fs.existsSync(catalogPath)) {
    try {
      catalogDb = new Database(catalogPath, { readonly: true });
      console.log('Connected to catalog.db successfully');
      return catalogDb;
    } catch (e) {
      console.error('Error connecting to catalog.db:', e.message);
      return null;
    }
  } else {
    console.warn('catalog.db not found at', catalogPath);
    return null;
  }
}

const { getDescription } = require('./description_db');

module.exports = {
  enrichWithCatalog: (item) => {
    // 1. Check for enriched description first
    const enrichedDescription = getDescription(item.codigo);
    if (enrichedDescription) {
      item.articulo = enrichedDescription;
    }

    const db = getCatalogDb();
    if (!db) return { ...item, stock: 0 };

    try {
      // Query ItemID, LoyaltyDescription, PriceAmount, and CurrentQuantityInUnits
      const stmt = db.prepare('SELECT LoyaltyDescription, PriceAmount, CurrentQuantityInUnits FROM Item WHERE ItemID = ?');
      const result = stmt.get(item.codigo);

      if (result) {
        const webPrice = parseFloat(item.precio_fidelizado.replace(',', '.'));
        
        if (isNaN(webPrice) || webPrice === 0) {
          console.log(`Enriching item ${item.codigo} with catalog price: ${result.PriceAmount}`);
          item.precio_fidelizado = result.PriceAmount.toString().replace('.', ',');
        }
        
        // Removed LoyaltyDescription fallback to ensure only IET/manual names are used

        // Add stock information
        item.stock = result.CurrentQuantityInUnits || 0;
      } else {
        item.stock = 0;
      }
    } catch (e) {
      console.error(`Error querying catalog for item ${item.codigo}:`, e.message);
      item.stock = 0;
    }

    return item;
  }
};
