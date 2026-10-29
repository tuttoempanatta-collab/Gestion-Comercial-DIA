/**
 * test_extractor_integrity.js
 * 
 * Suite de Verificación de Integridad y Detección de Regresiones
 * para el Módulo de Extracción de Ofertas DIA y el Árbitro de Memoria MOT.
 *
 * Ejecutar con:
 *   npm test
 *   npm run test:extractor
 *   npm run repair:extractor (para auto-restaurar desde el Golden Master ante fallos)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SCRAPER_PATH = path.join(BACKEND_DIR, 'scraper.js');
const SCHEDULER_PATH = path.join(BACKEND_DIR, 'mot_scheduler.js');
const INDEX_PATH = path.join(BACKEND_DIR, 'index.js');
const PKG_PATH = path.join(BACKEND_DIR, 'package.json');
const GOLDEN_DIR = path.join(BACKEND_DIR, 'backups', 'extractor_golden_master');
const GOLDEN_SCRAPER = path.join(GOLDEN_DIR, 'scraper.golden.js');
const GOLDEN_SCHEDULER = path.join(GOLDEN_DIR, 'mot_scheduler.golden.js');
const MANIFEST_PATH = path.join(GOLDEN_DIR, 'manifest.json');

const autoFix = process.argv.includes('--fix');

let totalTests = 0;
let passedTests = 0;
let failedTests = [];

function runAssert(testName, assertionFn) {
  totalTests++;
  try {
    const result = assertionFn();
    if (result !== false) {
      passedTests++;
      console.log(`  \x1b[32m✓\x1b[0m ${testName}`);
      return true;
    } else {
      failedTests.push({ name: testName, error: 'Assertion returned false' });
      console.log(`  \x1b[31m✗\x1b[0m ${testName}`);
      return false;
    }
  } catch (err) {
    failedTests.push({ name: testName, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${testName} -> \x1b[31m${err.message}\x1b[0m`);
    return false;
  }
}

function restoreFile(srcGolden, destActive, label) {
  if (!fs.existsSync(srcGolden)) {
    console.error(`\x1b[31m[Error Auto-Reparación]\x1b[0m No se encontró archivo golden: ${srcGolden}`);
    return false;
  }
  const goldenContent = fs.readFileSync(srcGolden, 'utf8');
  fs.writeFileSync(destActive, goldenContent, 'utf8');
  console.log(`  \x1b[33m⚡ [Auto-Reparación]\x1b[0m ${label} restaurado exitosamente desde Golden Master.`);
  return true;
}

console.log('\n===============================================================');
console.log('   AUDITORÍA DE INTEGRIDAD: MÓDULO DE EXTRACCIÓN Y ÁRBITRO RAM  ');
console.log('===============================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Verificación de Sintaxis Node.js
// ─────────────────────────────────────────────────────────────────────────────
console.log('\x1b[36m[Fase 1: Verificación de Sintaxis JavaScript]\x1b[0m');

runAssert('Sintaxis de scraper.js es válida', () => {
  execSync(`node -c "${SCRAPER_PATH}"`, { stdio: 'pipe' });
  return true;
});

runAssert('Sintaxis de mot_scheduler.js es válida', () => {
  execSync(`node -c "${SCHEDULER_PATH}"`, { stdio: 'pipe' });
  return true;
});

runAssert('Sintaxis de index.js es válida', () => {
  execSync(`node -c "${INDEX_PATH}"`, { stdio: 'pipe' });
  return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Patrones Prohibidos (Anti-Patrones que provocan caídas o cuelgues)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[36m[Fase 2: Patrones Prohibidos / Anti-Regresiones de Memoria]\x1b[0m');

const scraperCode = fs.readFileSync(SCRAPER_PATH, 'utf8');
const schedulerCode = fs.readFileSync(SCHEDULER_PATH, 'utf8');
const packageCode = fs.readFileSync(PKG_PATH, 'utf8');

runAssert('NO contiene flag destructiva "--single-process" en scraper.js', () => {
  if (scraperCode.includes('--single-process')) {
    throw new Error('Detectada flag experimental "--single-process". Bloquea hilos de Playwright en Linux.');
  }
  return true;
});

runAssert('NO contiene bucle de escaneo no acotado "locateFilterFrame" en scraper.js', () => {
  if (scraperCode.includes('locateFilterFrame')) {
    throw new Error('Detectada función obsoleta "locateFilterFrame". Provoca cuelgue de 105s por frames zombis.');
  }
  return true;
});

runAssert('NO contiene límite artificial destructivo "--max-old-space-size=160" en package.json', () => {
  if (packageCode.includes('--max-old-space-size=160')) {
    throw new Error('Detectado tripwire de 160MB en package.json. Causa suicidio del proceso Node.');
  }
  return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Flags Obligatorias de Reducción de Procesos y Memoria en Linux
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[36m[Fase 3: Flags Obligatorias de Protección de RAM (Render 512MB)]\x1b[0m');

runAssert('Chromium limita los renderers a 1 con "--renderer-process-limit=1"', () => {
  if (!scraperCode.includes('--renderer-process-limit=1')) {
    throw new Error('Falta flag "--renderer-process-limit=1". Chromium abrirá múltiples procesos por cada iframe.');
  }
  return true;
});

runAssert('Chromium desactiva aislamiento por sitio con "--disable-features=site-per-process"', () => {
  if (!scraperCode.includes('--disable-features=site-per-process')) {
    throw new Error('Falta flag "--disable-features=site-per-process". Provoca multiplicación de memoria en iframes.');
  }
  return true;
});

runAssert('Chromium conserva flags de contenedor seguro (--disable-dev-shm-usage, --disable-gpu, --no-zygote)', () => {
  const flags = ['--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'];
  for (const flag of flags) {
    if (!scraperCode.includes(flag)) {
      throw new Error(`Falta flag obligatoria para Linux/Docker: "${flag}"`);
    }
  }
  return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Funciones Críticas GeneXus y Selectores Oficiales DIA
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[36m[Fase 4: Funciones Críticas GeneXus y Selectores Oficiales]\x1b[0m');

runAssert('Existe función "fillGeneXusDate" para campos con máscara 99/99/9999', () => {
  if (!scraperCode.includes('function fillGeneXusDate') && !scraperCode.includes('async function fillGeneXusDate')) {
    throw new Error('Falta función "fillGeneXusDate". La carga directa de fechas romperá la máscara GeneXus.');
  }
  return true;
});

runAssert('Existe función "clickGeneXusBuscar" con respaldo de evento GeneXus', () => {
  if (!scraperCode.includes('function clickGeneXusBuscar') && !scraperCode.includes('async function clickGeneXusBuscar')) {
    throw new Error('Falta función "clickGeneXusBuscar". La búsqueda de ofertas no se ejecutará de forma fiable.');
  }
  return true;
});

runAssert('Selectores del formulario de Login presentes (#vSECUSERNAME, #vSECUSERPASSWORD, #BTNENTER)', () => {
  const selectors = ['#vSECUSERNAME', '#vSECUSERPASSWORD', '#BTNENTER'];
  for (const sel of selectors) {
    if (!scraperCode.includes(sel)) {
      throw new Error(`Falta selector de login requerido: "${sel}"`);
    }
  }
  return true;
});

runAssert('Selectores de la tabla de Promociones presentes (#vDESDE, #vHASTA, #BTNBUSCAR, #GridContainerTbl)', () => {
  const selectors = ['#vDESDE', '#vHASTA', '#BTNBUSCAR', '#GridContainerTbl'];
  for (const sel of selectors) {
    if (!scraperCode.includes(sel)) {
      throw new Error(`Falta selector de tabla de ofertas requerido: "${sel}"`);
    }
  }
  return true;
});

runAssert('Regla de Negocio: Omite códigos con precio web mayor a 0,00 (numericPrice > 0 -> continue)', () => {
  if (!scraperCode.includes('numericPrice > 0') && !scraperCode.includes('numericPrice>0')) {
    throw new Error('Falta regla de omisión de artículos con precio fidelizado web mayor a 0,00 en scraper.js');
  }
  return true;
});

runAssert('Regla Anti-Corte: Fin de datos se evalúa por filas físicas en grilla (totalRowsInGrid === 0), NUNCA por count === 0', () => {
  if (!scraperCode.includes('totalRowsInGrid === 0')) {
    throw new Error('Falta verificación por filas físicas en grilla (totalRowsInGrid === 0). Provocará corte prematuro en páginas con 0 artículos guardados.');
  }
  if (scraperCode.includes('if (pageResults.count === 0)')) {
    throw new Error('Detectada condición prohibida "if (pageResults.count === 0)". Corta la extracción prematuramente en páginas intermedias.');
  }
  return true;
});

runAssert('Paginación Robusta: getGridState() prioriza elementos visibles interactivos del paginador (pageRegex)', () => {
  if (!scraperCode.includes('pageRegex') || !scraperCode.includes('candidates.find')) {
    throw new Error('Falta detección robusta de paginador interactivo visible en getGridState().');
  }
  return true;
});

runAssert('Filtro 50 filas: Valida cambio de total de páginas (pageCountChanged) y densidad (rowsUpdated)', () => {
  if (!scraperCode.includes('pageCountChanged') || !scraperCode.includes('rowsUpdated')) {
    throw new Error('Falta validación estricta de actualización de 50 filas (pageCountChanged && rowsUpdated).');
  }
  return true;
});

runAssert('Navegación al siguiente lote: Scroll y disparo completo de eventos sobre el botón "Sig"', () => {
  if (!scraperCode.includes('scrollIntoViewIfNeeded')) {
    throw new Error('Falta scrollIntoViewIfNeeded() sobre el botón "Sig" para asegurar avance entre páginas.');
  }
  return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Árbitro de Memoria y Blindaje del Guardián MOT (mot_scheduler.js)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[36m[Fase 5: Árbitro de Memoria y Blindaje del Guardián MOT]\x1b[0m');

runAssert('mot_scheduler.js exporta pauseForExtraction y resumeAfterExtraction', () => {
  const scheduler = require(SCHEDULER_PATH);
  if (typeof scheduler.pauseForExtraction !== 'function') {
    throw new Error('mot_scheduler.js no exporta pauseForExtraction()');
  }
  if (typeof scheduler.resumeAfterExtraction !== 'function') {
    throw new Error('mot_scheduler.js no exporta resumeAfterExtraction()');
  }
  return true;
});

runAssert('Guardián de 30s ("checkGuardianSchedule") respeta _pausedByExtraction', () => {
  if (!schedulerCode.includes('if (_pausedByExtraction)')) {
    throw new Error('checkGuardianSchedule() no verifica _pausedByExtraction. Auto-despertará al MOT mid-extracción.');
  }
  return true;
});

runAssert('Método "start()" bloquea arranque si _pausedByExtraction está activo', () => {
  if (!schedulerCode.includes('if (_pausedByExtraction && !force)')) {
    throw new Error('start() no protege contra _pausedByExtraction. Puede abrir dos navegadores a la vez.');
  }
  return true;
});

runAssert('Ciclo "runCycle()" aborta si hay extracción activa y no sobreescribe _status', () => {
  if (!schedulerCode.includes('if (_pausedByExtraction || global._isExtractionRunning)')) {
    throw new Error('runCycle() no protege contra extracción en curso.');
  }
  return true;
});

runAssert('Pausa de extracción espera a que termine cualquier ciclo en vuelo ("while (_isRunningCycle")', () => {
  if (!schedulerCode.includes('while (_isRunningCycle')) {
    throw new Error('pauseForExtraction() no espera a que termine el ciclo en vuelo.');
  }
  return true;
});

runAssert('getStatus() reporta paused_by_extraction durante extracción de ofertas', () => {
  if (!schedulerCode.includes("isPaused ? 'paused_by_extraction' : _status")) {
    throw new Error('getStatus() no reporta paused_by_extraction de forma blindada.');
  }
  return true;
});

runAssert('mot_bot.js bloquea apertura de navegador si global._isExtractionRunning está activo', () => {
  const motBotCode = fs.readFileSync(path.join(BACKEND_DIR, 'mot_bot.js'), 'utf8');
  if (!motBotCode.includes('if (global._isExtractionRunning)')) {
    throw new Error('ensureBrowser en mot_bot.js no valida global._isExtractionRunning.');
  }
  return true;
});

runAssert('index.js bloquea /api/mot-bot/start con error 409 si la extracción está corriendo', () => {
  const indexCode = fs.readFileSync(INDEX_PATH, 'utf8');
  if (!indexCode.includes('if (global._isExtractionRunning)') || !indexCode.includes('409')) {
    throw new Error('index.js no protege el endpoint /api/mot-bot/start contra colisiones.');
  }
  return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Contrato de Exportación Funcional
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[36m[Fase 6: Contrato de Exportación de Módulos]\x1b[0m');

runAssert('scraper.js exporta la función asíncrona "runScraper"', () => {
  const scraper = require(SCRAPER_PATH);
  if (typeof scraper.runScraper !== 'function') {
    throw new Error('scraper.js no exporta runScraper()');
  }
  return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Comparación con el Golden Master
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[36m[Fase 7: Comparación con Snapshot Golden Master]\x1b[0m');

let hasDrift = false;
let goldenFilesValid = true;

if (!fs.existsSync(GOLDEN_SCRAPER) || !fs.existsSync(GOLDEN_SCHEDULER)) {
  console.log('  \x1b[33m⚠️ No se encontraron archivos Golden Master en backend/backups/extractor_golden_master/\x1b[0m');
  goldenFilesValid = false;
} else {
  const sCurrentHash = crypto.createHash('sha256').update(fs.readFileSync(SCRAPER_PATH)).digest('hex');
  const sGoldenHash  = crypto.createHash('sha256').update(fs.readFileSync(GOLDEN_SCRAPER)).digest('hex');

  runAssert('scraper.js coincide al 100% con Golden Master', () => {
    if (sCurrentHash !== sGoldenHash) {
      hasDrift = true;
      console.log(`    \x1b[33mAviso: scraper.js tiene variaciones respecto al Golden Master.\x1b[0m`);
      console.log(`    Hash actual: ${sCurrentHash.slice(0, 16)}... | Golden: ${sGoldenHash.slice(0, 16)}...`);
      return false;
    }
    return true;
  });

  const mCurrentHash = crypto.createHash('sha256').update(fs.readFileSync(SCHEDULER_PATH)).digest('hex');
  const mGoldenHash  = crypto.createHash('sha256').update(fs.readFileSync(GOLDEN_SCHEDULER)).digest('hex');

  runAssert('mot_scheduler.js coincide al 100% con Golden Master', () => {
    if (mCurrentHash !== mGoldenHash) {
      hasDrift = true;
      console.log(`    \x1b[33mAviso: mot_scheduler.js tiene variaciones respecto al Golden Master.\x1b[0m`);
      console.log(`    Hash actual: ${mCurrentHash.slice(0, 16)}... | Golden: ${mGoldenHash.slice(0, 16)}...`);
      return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen y Auto-Reparación
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n===============================================================');
console.log(`RESULTADO: ${passedTests} de ${totalTests} pruebas aprobadas.`);
console.log('===============================================================\n');

if (failedTests.length > 0) {
  console.log(`\x1b[31mSe detectaron ${failedTests.length} fallos de integridad:\x1b[0m`);
  failedTests.forEach((f, idx) => {
    console.log(`  ${idx + 1}. [${f.name}]: ${f.error}`);
  });

  if (autoFix && goldenFilesValid) {
    console.log('\n\x1b[33mEjecutando procedimiento de auto-reparación desde Golden Master...\x1b[0m');
    restoreFile(GOLDEN_SCRAPER, SCRAPER_PATH, 'scraper.js');
    restoreFile(GOLDEN_SCHEDULER, SCHEDULER_PATH, 'mot_scheduler.js');
    console.log('\n\x1b[32m✔ Archivos restaurados al estado Golden Master funcional. Re-ejecuta el test para confirmar.\x1b[0m\n');
    process.exit(0);
  } else if (!autoFix) {
    console.log('\n\x1b[33m💡 Para restaurar automáticamente el extractor al estado funcional:\x1b[0m');
    console.log('   Ejecuta: npm run repair:extractor\n');
    process.exit(1);
  }
} else {
  console.log('\x1b[32m✔ TODOS LOS TESTS PASARON EXITOSAMENTE. El módulo de extracción y el árbitro de memoria están 100% protegidos contra regresiones.\x1b[0m\n');
  process.exit(0);
}
