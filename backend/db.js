const { pool } = require('./pool');

module.exports = {
  pool,
  
  createExtraction: async (startDate, endDate) => {
    const query = 'INSERT INTO extractions (status, start_date, end_date) VALUES ($1, $2, $3) RETURNING id';
    const values = ['running', startDate, endDate];
    const res = await pool.query(query, values);
    const id = res.rows[0].id;
    console.log(`[DB] Created new extraction entry with ID: ${id}`);
    return id;
  },

  updateExtractionStatus: async (id, status, itemsCount, errorMessage = null) => {
    const query = 'UPDATE extractions SET status = $1, items_count = $2, error_message = $3 WHERE id = $4';
    await pool.query(query, [status, itemsCount, errorMessage, id]);
  },

  saveCommercialAction: async (extractionId, data) => {
    // Enrich data with catalog.db (still local SQLite) if price is 0
    const { enrichWithCatalog } = require('./catalog');
    const enrichedData = await enrichWithCatalog(data);

    try {
      const query = `
        INSERT INTO commercial_actions 
        (extraction_id, codigo, articulo, combo, precio_fidelizado, fecha_desde, fecha_hasta, cantidades, stock) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      const values = [
        extractionId, 
        enrichedData.codigo, 
        enrichedData.articulo, 
        enrichedData.combo, 
        enrichedData.precio_fidelizado, 
        enrichedData.fecha_desde, 
        enrichedData.fecha_hasta, 
        enrichedData.cantidades,
        enrichedData.stock || 0
      ];
      await pool.query(query, values);
    } catch (err) {
      console.error(`[DB Error] Failed to save commercial action for extraction ${extractionId}:`, err.message);
      throw err;
    }
  },

  getHistory: async () => {
    const res = await pool.query('SELECT * FROM extractions ORDER BY timestamp DESC LIMIT 50');
    return res.rows;
  },

  getExtractionData: async (extractionId) => {
    const res = await pool.query('SELECT * FROM commercial_actions WHERE extraction_id = $1', [extractionId]);
    return res.rows;
  },

  getSettings: async () => {
    const res = await pool.query('SELECT * FROM settings');
    return res.rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  },

  updateSettings: async (settings) => {
    for (const [key, value] of Object.entries(settings)) {
      const query = 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2';
      await pool.query(query, [key, value]);
    }
  },

  deleteExtraction: async (id) => {
    // Foreign key with ON DELETE CASCADE handles commercial_actions
    await pool.query('DELETE FROM extractions WHERE id = $1', [id]);
  },

  updateArticleDescription: async (codigo, description) => {
    const query = 'UPDATE commercial_actions SET articulo = $1 WHERE codigo = $2';
    await pool.query(query, [description, codigo]);
  },

  clearAll: async () => {
    await pool.query('BEGIN');
    try {
      await pool.query('DELETE FROM commercial_actions');
      await pool.query('DELETE FROM extractions');
      await pool.query('COMMIT');
      console.log('Database extractions and actions cleared atomically');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};
