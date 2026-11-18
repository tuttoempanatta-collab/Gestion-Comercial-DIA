/**
 * test_catalog_price_sync.js
 * 
 * Verifica que el sistema tome siempre el precio más actualizado del catálogo (.db)
 * tanto para visualización de datos como para la confección de cartelería.
 */
const { pool } = require('../pool');
const db = require('../db');

function calculateFinalPrice(priceStr, combo) {
  if (priceStr === null || priceStr === undefined || priceStr === '') return 0;
  let price = typeof priceStr === 'number' 
    ? priceStr 
    : parseFloat(String(priceStr).replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim());
  if (isNaN(price)) return 0;
  if (!combo) return price;
  const text = String(combo).toLowerCase();
  const secMatch = text.match(/2d[oa]\s+al\s+(\d+)/);
  if (secMatch) {
    const discount = parseInt(secMatch[1]);
    return (price + (price * (1 - discount / 100))) / 2;
  }
  const nxmMatch = text.match(/(\d+)x(\d+)/);
  if (nxmMatch) {
    const n = parseInt(nxmMatch[1]);
    const m = parseInt(nxmMatch[2]);
    return (price * m) / n;
  }
  const pctMatch = text.match(/(\d+)\s*%/);
  if (pctMatch) {
    const discount = parseInt(pctMatch[1]);
    return price * (1 - discount / 100);
  }
  const fixedMatch = text.match(/llevando\s+\d+[:\s]+\$?\s*(\d+)/);
  if (fixedMatch) {
    return parseFloat(fixedMatch[1]);
  }
  return price;
}

async function runTest() {
  console.log('\n===============================================================');
  console.log('   TEST: PRIORIDAD DEL PRECIO MÁS ACTUALIZADO DEL .DB         ');
  console.log('===============================================================\n');

  const testCode = 'TEST999999';

  try {
    // 1. Crear una extracción de prueba
    const extRes = await pool.query(
      "INSERT INTO extractions (status, start_date, end_date, items_count) VALUES ('completed', '16/11/2026', '23/11/2026', 1) RETURNING id"
    );
    const extId = extRes.rows[0].id;

    // 2. Insertar una acción comercial con precio antiguo (extraída ayer: $1.000,00)
    await pool.query(
      `INSERT INTO commercial_actions 
       (extraction_id, codigo, articulo, combo, precio_fidelizado, fecha_desde, fecha_hasta, cantidades, stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [extId, testCode, 'PRODUCTO TEST SYNC', '2DO AL 50%', '1000,00', '16/11/2026', '23/11/2026', '1', 0]
    );

    // 3. Simular que hoy se importó un catalog.db nuevo con precio actualizado a $5.540,00 y stock 15
    await pool.query(
      `INSERT INTO catalog_items (item_id, loyalty_description, price_amount, current_quantity, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (item_id) DO UPDATE SET
         loyalty_description = EXCLUDED.loyalty_description,
         price_amount = EXCLUDED.price_amount,
         current_quantity = EXCLUDED.current_quantity,
         updated_at = CURRENT_TIMESTAMP`,
      [testCode, 'PRODUCTO TEST ACTUALIZADO', 5540.00, 15]
    );

    // 4. Ejecutar getExtractionData(extId)
    const items = await db.getExtractionData(extId);
    const item = items.find(it => it.codigo === testCode);

    if (!item) {
      throw new Error('No se encontró el ítem en getExtractionData.');
    }

    console.log(`  Precio en extracción: ${item.precio_fidelizado} (esperado: 5540,00)`);
    console.log(`  Stock en extracción: ${item.stock} (esperado: 15)`);

    if (item.precio_fidelizado !== '5540,00') {
      throw new Error(`FALLO: El precio retornado fue "${item.precio_fidelizado}", no tomó el precio de catalog.db (5540,00).`);
    }

    if (item.stock !== 15) {
      throw new Error(`FALLO: El stock retornado fue ${item.stock}, no tomó el stock de catalog.db (15).`);
    }

    // 5. Verificar cálculo de cartelería con el precio actualizado
    const finalPrice = calculateFinalPrice(item.precio_fidelizado, item.combo);
    console.log(`  Precio final para cartel (${item.combo}): $${finalPrice} (esperado: 4155)`);

    if (finalPrice !== 4155) {
      throw new Error(`FALLO: El precio final calculado para el cartel fue ${finalPrice}, se esperaba 4155.`);
    }

    console.log('\n  \x1b[32m✔ TEST EXITOSO: El sistema toma siempre el precio más actualizado del .db.\x1b[0m\n');

    // Limpieza
    await pool.query('DELETE FROM commercial_actions WHERE extraction_id = $1', [extId]);
    await pool.query('DELETE FROM extractions WHERE id = $1', [extId]);
    await pool.query('DELETE FROM catalog_items WHERE item_id = $1', [testCode]);

  } catch (err) {
    console.error('\n  \x1b[31m✗ FALLO EN EL TEST:\x1b[0m', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

runTest();
