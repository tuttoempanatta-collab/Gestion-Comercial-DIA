/**
 * restore_extractor_golden.js
 * 
 * Script de Restauración Inmediata del Módulo de Extracción DIA
 * Restaura scraper.js y mot_scheduler.js a su versión Golden Master validada.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SCRAPER_PATH = path.join(BACKEND_DIR, 'scraper.js');
const SCHEDULER_PATH = path.join(BACKEND_DIR, 'mot_scheduler.js');
const GOLDEN_DIR = path.join(BACKEND_DIR, 'backups', 'extractor_golden_master');
const GOLDEN_SCRAPER = path.join(GOLDEN_DIR, 'scraper.golden.js');
const GOLDEN_SCHEDULER = path.join(GOLDEN_DIR, 'mot_scheduler.golden.js');

console.log('\n===============================================================');
console.log('   RESTAURACIÓN DEL EXTRACTOR DESDE GOLDEN MASTER (DIA OFICIAL) ');
console.log('===============================================================\n');

if (!fs.existsSync(GOLDEN_SCRAPER) || !fs.existsSync(GOLDEN_SCHEDULER)) {
  console.error('\x1b[31m[Error Fatal]\x1b[0m No se encontraron los archivos en backend/backups/extractor_golden_master/.');
  process.exit(1);
}

try {
  // Crear backup preventivo del estado actual antes de sobreescribir (en caso de que se quiera inspeccionar el error)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempBackupDir = path.join(BACKEND_DIR, 'backups', 'pre_restore_archives');
  if (!fs.existsSync(tempBackupDir)) fs.mkdirSync(tempBackupDir, { recursive: true });

  fs.copyFileSync(SCRAPER_PATH, path.join(tempBackupDir, `scraper_pre_restore_${timestamp}.js`));
  fs.copyFileSync(SCHEDULER_PATH, path.join(tempBackupDir, `mot_scheduler_pre_restore_${timestamp}.js`));
  console.log(`\x1b[36m[Backup Preventivo]\x1b[0m Estado actual archivado en backups/pre_restore_archives/`);

  // Restaurar desde Golden Master
  fs.copyFileSync(GOLDEN_SCRAPER, SCRAPER_PATH);
  console.log(`\x1b[32m✔ scraper.js restaurado con éxito.\x1b[0m`);

  fs.copyFileSync(GOLDEN_SCHEDULER, SCHEDULER_PATH);
  console.log(`\x1b[32m✔ mot_scheduler.js restaurado con éxito.\x1b[0m`);

  console.log('\n\x1b[32m===============================================================');
  console.log('  RESTAURACIÓN COMPLETADA. El extractor vuelve a estar 100% operativo.');
  console.log('===============================================================\x1b[0m\n');
} catch (err) {
  console.error(`\x1b[31m[Error al restaurar]\x1b[0m ${err.message}`);
  process.exit(1);
}
