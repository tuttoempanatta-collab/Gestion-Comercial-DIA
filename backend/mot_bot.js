/**
 * mot_bot.js
 * Bot de automatización para mot.supermercadosdia.com.ar
 * Marca tareas con check ✓ exactamente 10 minutos antes del horario de cierre.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const MOT_URL     = 'https://mot.supermercadosdia.com.ar/com.mot.login';
const MOT_HOME    = 'https://mot.supermercadosdia.com.ar/com.mot.home';
const MOT_TAREAS  = 'https://mot.supermercadosdia.com.ar/com.mot.tareastienda';

const SESSION_DIR  = path.join(__dirname, 'playwright_data', 'mot_session');
const SESSION_FILE = path.join(SESSION_DIR, 'storage_state.json');

const MOT_EMAIL    = process.env.MOT_EMAIL    || 't00624ar@tores.diagroup.com';
const MOT_PASSWORD = process.env.MOT_PASSWORD || 't00624ar';

// Umbral en minutos antes del cierre para marcar
const MARK_BEFORE_MINUTES = 10;

// ─── Estado interno del bot ───────────────────────────────────────────────────
let _browser  = null;
let _context  = null;
let _page     = null;
let _loggedIn = false;

const botLog = [];

function log(msg, level = 'info') {
  const entry = { timestamp: new Date().toISOString(), msg, level };
  botLog.unshift(entry);
  if (botLog.length > 100) botLog.pop();
  console.log(`[MOT-Bot][${level.toUpperCase()}] ${msg}`);
}

function getLogs()    { return botLog; }
function isLoggedIn() { return _loggedIn; }

// ─── Helpers de tiempo ────────────────────────────────────────────────────────

/**
 * Convierte "HH:MM" en minutos desde medianoche (número).
 */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Devuelve los minutos actuales desde medianoche (hora local AR, UTC-3).
 */
function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Devuelve true si la tarea debe marcarse ahora
 * (cierre - ahora está entre 0 y MARK_BEFORE_MINUTES minutos, inclusive).
 */
function shouldMark(closeTimeStr) {
  const closeMin = timeToMinutes(closeTimeStr);
  const diff     = closeMin - nowMinutes();
  return diff >= 0 && diff <= MARK_BEFORE_MINUTES;
}

// ─── Sesión persistente ───────────────────────────────────────────────────────

function sessionExists() {
  return fs.existsSync(SESSION_FILE);
}

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
}

async function saveSession() {
  ensureSessionDir();
  if (_context) await _context.storageState({ path: SESSION_FILE });
  log('Sesión guardada en disco.');
}

function saveSessionData(jsonObj) {
  ensureSessionDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(jsonObj, null, 2));
  log('Archivo de sesión importado y guardado en disco.');
}

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * Realiza el login completo con Google.
 * headless: false en la primera ejecución para que el usuario pueda
 * resolver CAPTCHAs y autenticación de dos factores.
 */
async function doLogin(headless = true) {
  log(`Iniciando login Google (headless=${headless})...`);

  if (_browser) {
    try { await _browser.close(); } catch (_) {}
  }

  ensureSessionDir();

  const contextOptions = {
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-AR',
  };

  if (sessionExists()) {
    contextOptions.storageState = SESSION_FILE;
    log('Restaurando sesión previa desde disco...');
  }

  _browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=es-AR'],
    slowMo: headless ? 0 : 150,
  });

  _context = await _browser.newContext(contextOptions);
  _page    = await _context.newPage();

  // Navegar al sitio MOT
  await _page.goto(MOT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _page.waitForTimeout(2000);

  // Verificar si ya está logueado (redirigió a home)
  if (_page.url().includes('com.mot.home') || _page.url().includes('com.mot.tareas')) {
    _loggedIn = true;
    log('Sesión restaurada correctamente. Ya logueado.');
    await saveSession();
    return true;
  }

  // ── Click en "Inicie con G+" ──────────────────────────────────────────────
  log('Página de login detectada. Buscando botón Google...');
  try {
    // Selector específico para MOT DIA (#vIMAGEAUTHTYPE_0001) + genéricos de respaldo
    const googleBtn = _page.locator('#vIMAGEAUTHTYPE_0001, img[src*="Google" i], img[src*="google" i], a:has-text("G+")').first();
    await googleBtn.waitFor({ state: 'visible', timeout: 10000 });
    await googleBtn.click();
    log('Botón Google clickeado.');
  } catch (e) {
    // Intentar por xpath si no se encontró por selector
    log('Selector genérico falló, intentando por href de oauth...', 'warn');
    const links = await _page.$$('a');
    let clicked = false;
    for (const link of links) {
      const href  = await link.getAttribute('href') || '';
      const txt   = await link.innerText().catch(() => '');
      const cls   = await link.getAttribute('class') || '';
      if (href.includes('google') || href.includes('oauth') || txt.toLowerCase().includes('g') || cls.includes('google')) {
        await link.click();
        clicked = true;
        log(`Enlace Google encontrado y clickeado (href: ${href.slice(0, 60)})`);
        break;
      }
    }
    if (!clicked) throw new Error('No se encontró el botón de login con Google.');
  }

  // ── Esperar redirección a Google OAuth ────────────────────────────────────
  log('Esperando página de Google...');
  await _page.waitForURL('**/accounts.google.com/**', { timeout: 15000 });
  await _page.waitForTimeout(1500);

  // ── Email ─────────────────────────────────────────────────────────────────
  log('Ingresando email...');
  const emailInput = _page.locator('input[type="email"]');
  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill(MOT_EMAIL);
  await _page.keyboard.press('Enter');
  await _page.waitForTimeout(2000);

  // ── Contraseña ────────────────────────────────────────────────────────────
  log('Ingresando contraseña...');
  const passInput = _page.locator('input[type="password"]').first();
  await passInput.waitFor({ timeout: 10000 });
  await passInput.fill(MOT_PASSWORD);
  await _page.keyboard.press('Enter');

  // ── Esperar redirección de vuelta al sitio MOT ────────────────────────────
  log('Esperando redirección post-login...');
  await _page.waitForURL(/mot\.supermercadosdia\.com\.ar/, { timeout: 30000 });
  await _page.waitForTimeout(2000);

  if (_page.url().includes('com.mot.home') || !_page.url().includes('login')) {
    _loggedIn = true;
    log('Login completado exitosamente.');
    await saveSession();
    return true;
  }

  throw new Error(`Login fallido. URL actual: ${_page.url()}`);
}

// ─── Lectura y marcación de tareas ────────────────────────────────────────────

/**
 * Navega a la sección Tareas y lee todas las tareas disponibles.
 * Devuelve un array de { nombre, horarioInicio, horarioCierre, tieneBotonCheck, elemento }
 */
async function readTasks() {
  log('Navegando a sección Tareas...');
  
  // Si no estamos ya en la página de tareas, navegar
  if (!_page.url().includes('tareastienda')) {
    // Intentar hacer click en el menú "Tareas" de la barra lateral
    try {
      await _page.goto(MOT_TAREAS, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      log('Navegación directa a Tareas falló, intentando por menú...', 'warn');
      // Como alternativa, buscar el enlace en el sidebar
      await _page.click('text=Tareas', { timeout: 5000 });
    }
    await _page.waitForTimeout(3000);
  }

  // Esperar que aparezca la lista de tareas
  await _page.waitForSelector('li, .task-item, [class*="tarea"], [class*="task"]', { timeout: 15000 }).catch(() => {
    log('Selector de tareas no encontrado, intentando con estructura genérica...', 'warn');
  });

  // Capturar el HTML para analizar la estructura real
  const tasks = await _page.evaluate((markBefore) => {
    const results = [];

    // Buscar todos los elementos que tengan un rango de tiempo (HH:MM - HH:MM)
    const timePattern = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/;

    // Recorrer todos los elementos del DOM buscando combinaciones nombre+horario+botón
    const items = Array.from(document.querySelectorAll('li, .row, [class*="item"], [class*="tarea"], [class*="task"]'));

    for (const item of items) {
      const text  = item.innerText || '';
      const match = text.match(timePattern);
      if (!match) continue;

      // Extraer horario
      const horarioInicio  = match[1];
      const horarioCierre  = match[2];

      // Nombre: primera línea de texto antes del horario
      const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
      const nombre = lines[0] || 'Sin nombre';

      // Verificar si tiene botón de check (✓ verde / marcación positiva)
      // Los botones son: ✓ (check), ✗ (no), ⊖ (omitir)
      // Solo nos interesan los que tienen el botón ✓
      const allButtons = Array.from(item.querySelectorAll('button, a, [role="button"], svg, img, [class*="check"], [class*="ok"], [class*="confirm"]'));
      
      // Heurística: tiene botón si hay al menos 2-3 elementos interactivos a la derecha
      // O si hay íconos circulares tipo ✓ ✗ ⊖
      const hasBotones = item.querySelectorAll('button, [class*="btn"], [class*="check"], [class*="icon"], svg circle, img').length >= 2;
      
      // Intento alternativo: buscar botones padre/hermano  
      const parent   = item.parentElement;
      const siblings = parent ? Array.from(parent.querySelectorAll('button, [class*="btn"], [class*="icon"]')) : [];
      const tieneBotonCheck = hasBotones || siblings.length >= 2;

      results.push({
        nombre,
        horarioInicio,
        horarioCierre,
        tieneBotonCheck,
        textoCompleto: text.slice(0, 200),
      });
    }

    return results;
  }, MARK_BEFORE_MINUTES);

  log(`Tareas leídas: ${tasks.length} (con botón: ${tasks.filter(t => t.tieneBotonCheck).length})`);
  return tasks;
}

/**
 * Intenta marcar (click en ✓) las tareas que están dentro de la ventana de tiempo.
 * Devuelve un array de resultados de marcación.
 */
async function markDueTasks(markedToday = new Set()) {
  const results = [];

  if (!_loggedIn || !_page) {
    log('Bot no logueado, omitiendo ciclo.', 'warn');
    return results;
  }

  // Verificar que la sesión sigue activa
  try {
    if (_page.url().includes('login')) {
      log('Sesión expirada detectada, re-logueando...', 'warn');
      _loggedIn = false;
      await doLogin(true);
    }
  } catch (e) {
    log(`Error verificando sesión: ${e.message}`, 'error');
    _loggedIn = false;
    return results;
  }

  // Navegar/refrescar la página de tareas
  try {
    await _page.goto(MOT_TAREAS, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await _page.waitForTimeout(2000);
  } catch (e) {
    log(`Error navegando a Tareas: ${e.message}`, 'error');
    return results;
  }

  // Leer tareas actuales
  let tasks = [];
  try {
    tasks = await readTasks();
  } catch (e) {
    log(`Error leyendo tareas: ${e.message}`, 'error');
    return results;
  }

  // Evaluar cuáles deben marcarse
  for (const task of tasks) {
    if (!task.tieneBotonCheck) {
      log(`Omitiendo tarea sin botón: "${task.nombre}"`, 'info');
      continue;
    }

    // Generar clave única para evitar doble-marcación
    const key = `${task.nombre}|${task.horarioCierre}`;
    if (markedToday.has(key)) {
      continue; // ya marcada hoy
    }

    if (!shouldMark(task.horarioCierre)) {
      continue; // aún no es el momento
    }

    // ── Es el momento de marcar esta tarea ───────────────────────────────
    log(`Marcando: "${task.nombre}" (cierre: ${task.horarioCierre})`);
    try {
      const clickResult = await _page.evaluate((taskName) => {
        const timePattern = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/;

        // Buscar el contenedor de la tarea por nombre
        const allItems = Array.from(document.querySelectorAll('li, .row, [class*="item"], [class*="tarea"]'));
        for (const item of allItems) {
          const text = item.innerText || '';
          if (text.includes(taskName) && timePattern.test(text)) {
            // Dentro del item, buscar el primer botón de tipo "check" / confirmación
            // Generalmente el primer botón/ícono de los tres (✓ ✗ ⊖)
            const buttons  = Array.from(item.querySelectorAll('button, a[role="button"], [class*="btn"], [class*="check"], [class*="ok"], [class*="confirm"], img, svg'));
            const checkBtn = buttons.find(b => {
              const cls   = (b.className || '').toLowerCase();
              const src   = (b.getAttribute('src') || '').toLowerCase();
              const title = (b.getAttribute('title') || b.getAttribute('aria-label') || '').toLowerCase();
              return cls.includes('check') || cls.includes('ok') || cls.includes('confirm') ||
                     src.includes('check') || src.includes('ok') ||
                     title.includes('ok') || title.includes('cumplid') || title.includes('completad') ||
                     title.includes('check');
            }) || buttons[0]; // fallback al primer botón

            if (checkBtn) {
              checkBtn.click();
              return { clicked: true, btnClass: checkBtn.className, btnTag: checkBtn.tagName };
            }
            return { clicked: false, reason: 'No se encontró botón check en el item' };
          }
        }
        return { clicked: false, reason: `Tarea "${taskName}" no encontrada en el DOM` };
      }, task.nombre);

      if (clickResult.clicked) {
        markedToday.add(key);
        results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'marcado', ts: new Date().toISOString() });
        log(`✓ Marcada: "${task.nombre}"`);
        await _page.waitForTimeout(1500); // Esperar respuesta del servidor
      } else {
        results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: clickResult.reason, ts: new Date().toISOString() });
        log(`✗ No se pudo marcar "${task.nombre}": ${clickResult.reason}`, 'warn');
      }
    } catch (e) {
      results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: e.message, ts: new Date().toISOString() });
      log(`Error marcando "${task.nombre}": ${e.message}`, 'error');
    }
  }

  return results;
}

// ─── Captura de pantalla para debug ──────────────────────────────────────────

async function captureDebugScreenshot(label = 'debug') {
  if (!_page) return null;
  const dir  = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `mot_${label}_${Date.now()}.png`);
  await _page.screenshot({ path: file, fullPage: true });
  log(`Screenshot guardado: ${path.basename(file)}`);
  return file;
}

// ─── Cerrar navegador ─────────────────────────────────────────────────────────

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser  = null;
    _context  = null;
    _page     = null;
    _loggedIn = false;
    log('Navegador cerrado.');
  }
}

module.exports = {
  doLogin,
  markDueTasks,
  closeBrowser,
  captureDebugScreenshot,
  getLogs,
  isLoggedIn,
  sessionExists,
  saveSessionData,
  MARK_BEFORE_MINUTES,
};
