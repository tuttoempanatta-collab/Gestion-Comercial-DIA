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
const MOT_TAREAS  = 'https://mot.supermercadosdia.com.ar/com.mot.mot.tareastienda';

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
function clearLogs()  { botLog.length = 0; }
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

  // Si ya hay un browser abierto, reutilizarlo; de lo contrario lanzar uno nuevo.
  if (!_browser) {
    _browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=es-AR'],
      slowMo: headless ? 0 : 150,
    });
    _context = await _browser.newContext(contextOptions);
  }
  // Crear una nueva página (pestaña) para el login
  _page = await _context.newPage();

  // Navegar al sitio MOT de forma segura
  try {
    await _page.goto(MOT_URL, { waitUntil: 'commit', timeout: 45000 });
  } catch (err) {
    log(`Aviso: Goto lento o timeout. Intentando continuar...`);
  }
  await _page.waitForTimeout(4000); // Esperar que renderice el botón de Google

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

  if (!headless) {
    log('Modo visible: Por favor completa el login manualmente en la ventana de Chrome.');
    log('Tienes hasta 3 minutos. Resolvé cualquier captcha o paso de seguridad...');
    try {
      await _page.waitForURL(/com\.mot\.(home|tareas)/, { timeout: 180000 });
      _loggedIn = true;
      log('Login manual completado con éxito.');
      await saveSession();
      return true;
    } catch (e) {
      throw new Error('Se agotó el tiempo de 3 minutos para el login manual.');
    }
  }

  // ── Esperar redirección a Google OAuth o a Home directamente ──────────────
  log('Esperando página de Google (o redirección automática)...');
  try {
    await _page.waitForURL(/accounts\.google\.com|com\.mot\.(home|tareas)/, { timeout: 15000 });
  } catch(e) {
    throw new Error(`Timeout esperando redirección. URL actual: ${_page.url()}`);
  }
  await _page.waitForTimeout(1500);

  // Si nos redirigió directamente a la app de DIA, la sesión ya estaba activa en Google
  if (_page.url().includes('com.mot.home') || _page.url().includes('com.mot.tareas')) {
    _loggedIn = true;
    log('Sesión auto-aprobada por Google. Ya logueado.');
    await saveSession();
    return true;
  }

  // Si llegamos acá, estamos en accounts.google.com
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

      // Nombre: primera línea de texto o título rojo
      const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
      let nombre = lines[0] || 'Sin nombre';

      // Identificar si es una tarea "cliqueable" por título (color rojo)
      // Buscamos si hay un elemento con color rojo o un link
      const redTitle = item.querySelector('[style*="color: rgb(204, 0, 0)"], [style*="color: red"], a');
      const esCliqueable = !!redTitle || text.toLowerCase().includes('control');

      // Verificar si tiene botón de check directo (circulares)
      const hasDirectButtons = item.querySelectorAll('button, svg circle, [class*="check"]').length >= 2;

      results.push({
        nombre,
        horarioInicio,
        horarioCierre,
        tieneBotonCheck: hasDirectButtons,
        esCliqueable,
        textoCompleto: text.slice(0, 100)
      });
    }

    return results;
  }, MARK_BEFORE_MINUTES);

  log(`Tareas leídas: ${tasks.length} (cliqueables: ${tasks.filter(t => t.esCliqueable).length})`);
  return tasks;
}

/**
 * Maneja específicamente la tarea de Control de Temperatura.
 */
async function handleTemperatureTask(task) {
  log(`Iniciando procesamiento de: ${task.nombre}`);
  
  try {
    // 1. Click en el título para abrir la tarea
    await _page.click(`text="${task.nombre}"`, { timeout: 10000 });
    await _page.waitForLoadState('networkidle');
    await _page.waitForTimeout(3000);
    
    // 2. Ingresar Legajo Responsable
    const responsableInput = _page.locator('input[id*="RESPONSABLE"], input[placeholder*="Legajo"]');
    await responsableInput.waitFor({ state: 'visible', timeout: 5000 });
    await responsableInput.fill('23250');
    
    // 3. Click en Validar
    await _page.click('input[value="Validar"], button:has-text("Validar")');
    await _page.waitForTimeout(3000);
    
    log('Responsable validado. Procesando categorías...');

    // 4. Identificar y procesar cada categoría (Murales, Freezers, Cámaras)
    const categorias = ['Murales', 'Freezers', 'Cámaras'];
    
    for (const catName of categorias) {
      log(`Buscando categoría: ${catName}...`);
      const catHeader = _page.locator(`.Categoria, .card-header, div:has-text("${catName}")`).filter({ hasText: catName }).first();
      
      if (await catHeader.isVisible()) {
        await catHeader.click().catch(() => {}); // Intentar expandir
        await _page.waitForTimeout(1500);
        
        // 5. Llenar filas dentro de la categoría
        const rows = await _page.locator('tr, .row-equipo, .grid-row').all();
        log(`Encontradas ${rows.length} filas en ${catName}.`);
        
        for (const row of rows) {
          const rowText = await row.innerText();
          if (!rowText || rowText.includes('Temperatura')) continue; // Saltar cabeceras
          
          // Buscar inputs en esta fila
          const inputs = await row.locator('input[type="text"], input[type="number"]').all();
          if (inputs.length < 2) continue;
          
          // Generar valores aleatorios según reglas del usuario
          const tempEqui = (Math.random() * (0.8 - 0.1) + 0.1).toFixed(1);
          let tempProd  = (Math.random() * (3.0 - 1.0) + 1.0).toFixed(1);
          
          // Excepción Mural Pollo: no superar 1.8
          if (rowText.toLowerCase().includes('pollo')) {
            tempProd = (Math.random() * (1.7 - 0.5) + 0.5).toFixed(1);
          }
          
          log(`  Llenando ${rowText.split('\n')[0].trim()}: Equi=${tempEqui}, Prod=${tempProd}`);
          
          await inputs[0].fill(tempEqui);
          await _page.waitForTimeout(300);
          await inputs[1].fill(tempProd);
          await _page.waitForTimeout(300);
          
          // Click en el botón verde de confirmación (✓) de la fila
          const checkBtn = row.locator('img[src*="check"], .btn-success, [class*="verde"], .fa-check').first();
          if (await checkBtn.isVisible()) {
            await checkBtn.click();
            await _page.waitForTimeout(500);
          }
        }
      }
    }

    log('Todas las temperaturas ingresadas. Finalizando tarea...');
    
    // 6. Click en Finalizar / Guardar (Botón final de la página)
    const finishBtn = _page.locator('button:has-text("Finalizar"), button:has-text("Guardar"), input[value="Finalizar"]');
    if (await finishBtn.isVisible()) {
      await finishBtn.click();
      await _page.waitForTimeout(3000);
    }

    log(`Tarea "${task.nombre}" completada exitosamente.`);
    return true;
  } catch (e) {
    log(`Error procesando tarea de temperatura: ${e.message}`, 'error');
    return false;
  }
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
    if (!task.tieneBotonCheck && !task.esCliqueable) {
      log(`Omitiendo tarea sin botón ni link: "${task.nombre}"`, 'info');
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
      let success = false;
      let reason = '';

      if (task.nombre.toLowerCase().includes('temperatura') || task.nombre.toLowerCase().includes('temp')) {
        success = await handleTemperatureTask(task);
        if (!success) reason = 'Error en el proceso de temperatura';
      } else {
        // Marcación directa
        const clickResult = await _page.evaluate((taskName) => {
          const timePattern = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/;
          const allItems = Array.from(document.querySelectorAll('li, .row, [class*="item"], [class*="tarea"]'));
          for (const item of allItems) {
            const text = item.innerText || '';
            if (text.includes(taskName) && timePattern.test(text)) {
              const buttons  = Array.from(item.querySelectorAll('button, a[role="button"], [class*="btn"], [class*="check"], img, svg'));
              const checkBtn = buttons[0]; 
              if (checkBtn) {
                checkBtn.click();
                return { clicked: true };
              }
              return { clicked: false, reason: 'No se encontró botón' };
            }
          }
          return { clicked: false, reason: 'Tarea no encontrada' };
        }, task.nombre);
        success = clickResult.clicked;
        reason = clickResult.reason;
      }

      if (success) {
        markedToday.add(key);
        results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'marcado', ts: new Date().toISOString() });
        log(`✓ Marcada exitosamente: "${task.nombre}"`);
        await _page.waitForTimeout(1500);
      } else {
        results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: reason, ts: new Date().toISOString() });
        log(`✗ Falló la marcación de "${task.nombre}": ${reason}`, 'warn');
      }
    } catch (e) {
      results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: e.message, ts: new Date().toISOString() });
      log(`Error crítico marcando "${task.nombre}": ${e.message}`, 'error');
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
  clearLogs,
  isLoggedIn,
  sessionExists,
  saveSessionData,
  MARK_BEFORE_MINUTES,
};
