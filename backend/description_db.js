const { pool } = require('./pool');

module.exports = {
  getDescription: async (codigo) => {
    const res = await pool.query('SELECT description FROM product_descriptions WHERE codigo = $1', [codigo]);
    return res.rows[0] ? res.rows[0].description : null;
  },

  saveDescription: async (codigo, description) => {
    const query = 'INSERT INTO product_descriptions (codigo, description, last_updated) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (codigo) DO UPDATE SET description = $2, last_updated = CURRENT_TIMESTAMP';
    await pool.query(query, [codigo, description]);
  },

  getMissingDescriptions: async (codigos) => {
    if (!codigos || codigos.length === 0) return [];
    
    // PostgreSQL IN clause with parameters
    const res = await pool.query('SELECT codigo FROM product_descriptions WHERE codigo = ANY($1)', [codigos]);
    const existing = res.rows.map(row => row.codigo);
    return codigos.filter(c => !existing.includes(c));
  },

  clearDescriptions: async () => {
    await pool.query('DELETE FROM product_descriptions');
    console.log('Product descriptions cleared');
  }
};
