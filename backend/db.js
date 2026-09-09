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
      // Deduplication check: prevent multiple rows for the same product code in the same extraction
      const existing = await pool.query(
        'SELECT id, cantidades, precio_fidelizado, stock FROM commercial_actions WHERE extraction_id = $1 AND codigo = $2',
        [extractionId, String(enrichedData.codigo)]
      );

      if (existing.rows && existing.rows.length > 0) {
        const row = existing.rows[0];
        const currentCantidades = parseInt(row.cantidades || '0');
        const newCantidades = parseInt(enrichedData.cantidades || '0');
        
        // Keep smaller positive cantidades if applicable (e.g. 3 instead of 6000 stock limit)
        let bestCantidades = row.cantidades;
        if (newCantidades > 0 && (currentCantidades === 0 || newCantidades < currentCantidades)) {
          bestCantidades = enrichedData.cantidades;
        }

        let bestPrice = row.precio_fidelizado;
        if ((!bestPrice || bestPrice === '0,00' || bestPrice === '0') && enrichedData.precio_fidelizado && enrichedData.precio_fidelizado !== '0,00') {
          bestPrice = enrichedData.precio_fidelizado;
        }

        const updateQuery = `
          UPDATE commercial_actions 
          SET cantidades = $1, precio_fidelizado = $2, stock = $3
          WHERE id = $4
        `;
        await pool.query(updateQuery, [bestCantidades, bestPrice, Math.max(row.stock || 0, enrichedData.stock || 0), row.id]);
        return;
      }

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
      const query = 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
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
  },

  mergeExtractions: async (extractionIds) => {
    if (!Array.isArray(extractionIds) || extractionIds.length < 2) {
      throw new Error('Debe seleccionar al menos 2 extracciones para fusionar.');
    }

    await pool.query('BEGIN');
    try {
      // 1. Get metadata of extractions to be merged
      const extRes = await pool.query(
        'SELECT * FROM extractions WHERE id = ANY($1::int[]) ORDER BY timestamp ASC',
        [extractionIds]
      );
      if (!extRes.rows || extRes.rows.length === 0) {
        throw new Error('No se encontraron las extracciones especificadas.');
      }

      const firstExt = extRes.rows[0];
      const lastExt = extRes.rows[extRes.rows.length - 1];
      const startDate = firstExt.start_date;
      const endDate = lastExt.end_date;

      // 2. Fetch all commercial actions for these extractions
      const actionsRes = await pool.query(
        'SELECT * FROM commercial_actions WHERE extraction_id = ANY($1::int[]) ORDER BY id ASC',
        [extractionIds]
      );

      // 3. Deduplicate by codigo
      const uniqueMap = new Map();
      for (const item of actionsRes.rows) {
        const code = (item.codigo || '').toString().trim();
        if (!code) continue;

        if (!uniqueMap.has(code)) {
          uniqueMap.set(code, { ...item });
        } else {
          const existing = uniqueMap.get(code);
          let bestPrice = existing.precio_fidelizado;
          if ((!bestPrice || bestPrice === '0,00' || bestPrice === '0') && item.precio_fidelizado && item.precio_fidelizado !== '0,00') {
            bestPrice = item.precio_fidelizado;
          }

          const currentCant = parseInt(existing.cantidades || '0');
          const newCant = parseInt(item.cantidades || '0');
          let bestCant = existing.cantidades;
          if (newCant > 0 && (currentCant === 0 || newCant < currentCant)) {
            bestCant = item.cantidades;
          }

          uniqueMap.set(code, {
            ...existing,
            combo: item.combo || existing.combo,
            precio_fidelizado: bestPrice,
            cantidades: bestCant,
            stock: Math.max(existing.stock || 0, item.stock || 0)
          });
        }
      }

      const deduplicatedItems = Array.from(uniqueMap.values());

      // 4. Create new merged extraction entry
      const insertExtQuery = `
        INSERT INTO extractions (status, start_date, end_date, items_count) 
        VALUES ($1, $2, $3, $4) 
        RETURNING id
      `;
      const newExtRes = await pool.query(insertExtQuery, ['completed', startDate, endDate, deduplicatedItems.length]);
      const newId = newExtRes.rows[0].id;

      // 5. Insert deduplicated items into commercial_actions under newId
      for (const item of deduplicatedItems) {
        const insertActionQuery = `
          INSERT INTO commercial_actions 
          (extraction_id, codigo, articulo, combo, precio_fidelizado, fecha_desde, fecha_hasta, cantidades, stock) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        await pool.query(insertActionQuery, [
          newId,
          item.codigo,
          item.articulo,
          item.combo,
          item.precio_fidelizado,
          item.fecha_desde,
          item.fecha_hasta,
          item.cantidades,
          item.stock || 0
        ]);
      }

      // 6. Delete old extractions (CASCADE deletes old commercial_actions rows)
      await pool.query('DELETE FROM extractions WHERE id = ANY($1::int[])', [extractionIds]);

      await pool.query('COMMIT');
      console.log(`[DB] Extracciones ${extractionIds.join(', ')} fusionadas exitosamente en la nueva Extracción #${newId} con ${deduplicatedItems.length} ítems.`);
      return { mergedExtractionId: newId, itemsCount: deduplicatedItems.length };
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error('[DB Error] Error al fusionar extracciones:', e.message);
      throw e;
    }
  }
};

