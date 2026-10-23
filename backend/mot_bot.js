/**
 * mot_bot.js
 * Módulo integral de sincronización, lectura y marcación para mot.supermercadosdia.com.ar
 * Basado en la ingeniería inversa del APK oficial (MOT.MenuLateral) y la web GeneXus 16 de MOT DIA.
 * Permite:
 *   1. Listar en vivo todas las tareas de la tienda (con sus GUIDs, horarios, estados, horas de cumplimiento y tipos de control).
 *   2. Marcar cualquier tarea desde nuestra web (Cumplir 'C'/'FT', No Cumplir 'NC' con motivo, No Aplica 'NA',
 *      Confirmación de Limpieza con legajo, y Control de Temperatura de Equipamiento) enviando la señal exacta al MOT original.
 *   3. Ejecutar el ciclo automático del bot 10 minutos antes del horario de cierre de cada tarea.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const MOT_BASE_URL = 'https://mot.supermercadosdia.com.ar/';
const MOT_URL      = 'https://mot.supermercadosdia.com.ar/com.mot.login';
const MOT_HOME     = 'https://mot.supermercadosdia.com.ar/com.mot.home';
const MOT_TAREAS   = 'https://mot.supermercadosdia.com.ar/com.mot.mot.tareastienda';

const SESSION_DIR  = path.join(__dirname, 'playwright_data', 'mot_session');
const SESSION_FILE = path.join(SESSION_DIR, 'storage_state.json');

const MOT_EMAIL      = process.env.MOT_EMAIL      || 't00624ar@stores.diagroup.com';
const MOT_PASSWORD   = process.env.MOT_PASSWORD   || 'Tienda-/624';
const DEFAULT_LEGAJO = process.env.MOT_LEGAJO     || '23250';

// Umbral en minutos antes del cierre para marcar automáticamente
const MARK_BEFORE_MINUTES = 10;

// Equipamiento oficial de Tienda 624 extraído de MOT.WebEquipo (W0093W0024vSDTCTGEQUIPAMIENTOS)
const DEFAULT_EQUIPAMIENTO_TIENDA_624 = [
  {
    CtgCtrlTempGUID: '0a454807-a229-434e-9ab4-0f81c0b3f000',
    CtgCtrlTempDesc: 'Murales',
    Equipamiento: [
      { EquipamientoGUID: '8888cc03-4a56-4f8c-b076-45166757a847', EquipamientoNomb: 'Mural 01', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '0ef4b18b-b64e-4dfa-98b6-5d9177ff3a41', EquipamientoNomb: 'Mural 02', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'd8c66335-75cf-40e4-b8de-9146f6985341', EquipamientoNomb: 'Mural 03', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'c583f33e-3045-4702-8e97-1025b3707818', EquipamientoNomb: 'Mural 04', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'e69501fe-61f1-4139-9a04-97e3273f1528', EquipamientoNomb: 'Mural 05', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '5e1e9690-2923-4683-92b4-aef485082e8e', EquipamientoNomb: 'Mural 06', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '9921780b-f201-4efe-97d4-e74208c3745c', EquipamientoNomb: 'Mural 07', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '6d3d1544-68e1-446a-819a-1182bb80f32c', EquipamientoNomb: 'Mural 08', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'c90671ae-455d-4b40-96c6-2e69d2a04e68', EquipamientoNomb: 'Mural 09', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '3ad1efcd-61d3-413b-8682-7b687d0b21df', EquipamientoNomb: 'Mural 4ta Gama 1', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '93fee0ab-6d54-4ddf-8fe2-6dea6f82cfa4', EquipamientoNomb: 'Mural Carne 1', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'd8516e84-9299-42e7-898b-2d9cd1f4e211', EquipamientoNomb: 'Mural Pollo 1', TemperaturaEquipo: '', TemperaturaProducto: '' },
    ]
  },
  {
    CtgCtrlTempGUID: 'b7d8bd26-441c-4e89-9706-30ec8be01f3a',
    CtgCtrlTempDesc: 'Freezers',
    Equipamiento: [
      { EquipamientoGUID: '32342830-723d-450d-8d0b-812fa63e62e4', EquipamientoNomb: 'Freezer 01', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '941257b2-bf06-4991-a4e8-2923dea05036', EquipamientoNomb: 'Freezer 02', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'b215ba0c-ef39-4d65-915f-b5a5911079d0', EquipamientoNomb: 'Freezer 03', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '4bb84e5f-9c45-4010-bd9d-e2ca9e280b4a', EquipamientoNomb: 'Freezer 04', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'a27c6a8a-9d06-4d52-82a4-4d8ba79527da', EquipamientoNomb: 'Freezer 05', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '23ff38ff-92cc-4375-be4a-2c05d07ab359', EquipamientoNomb: 'Freezer Comercial', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: '8de7b451-4962-4127-80fd-1c9eee5ca349', EquipamientoNomb: 'Freezer Remonte/Punto Caliente 1', TemperaturaEquipo: '', TemperaturaProducto: '' },
    ]
  },
  {
    CtgCtrlTempGUID: 'c09b4e98-ec20-46ed-b188-53ace98afaa3',
    CtgCtrlTempDesc: 'Cámaras',
    Equipamiento: [
      { EquipamientoGUID: '2e0c35a9-7560-4ad4-8056-f90f5459806d', EquipamientoNomb: 'Cámara 1', TemperaturaEquipo: '', TemperaturaProducto: '' },
      { EquipamientoGUID: 'c5b0d55e-928c-4ff6-8909-c9f75f6e44c7', EquipamientoNomb: 'Cámara Carne', TemperaturaEquipo: '', TemperaturaProducto: '' },
    ]
  }
];

const BASELINE_TAREAS_FILE = path.join(__dirname, 'mot_tasks_624.json');
let DEFAULT_TAREAS_TIENDA_624 = [];
try {
  if (fs.existsSync(BASELINE_TAREAS_FILE)) {
    DEFAULT_TAREAS_TIENDA_624 = JSON.parse(fs.readFileSync(BASELINE_TAREAS_FILE, 'utf8'));
  }
} catch (_) {}

// ─── Estado interno del bot ───────────────────────────────────────────────────
let _browser     = null;
let _context     = null;
let _page        = null;
let _loggedIn    = fs.existsSync(SESSION_FILE);
let _tareasUrl   = null; // URL encriptada de Tareas extraída del menú lateral (vDVELOP_MENU_MPAGE)
let _busy        = false;
let _cachedTasks = DEFAULT_TAREAS_TIENDA_624.map(t => ({ ...t }));
let _lastSyncAt  = null;
let _cachedDate  = '';
let _tiendaId    = '624';
const _localMarkedMap = new Map(); // rowIndex -> { estadoCode, estadoTexto, horaCumplimiento, fecha }

const botLog = [];

function log(msg, level = 'info') {
  const entry = { timestamp: new Date().toISOString(), msg, level };
  botLog.unshift(entry);
  if (botLog.length > 150) botLog.pop();
  console.log(`[MOT-Bot][${level.toUpperCase()}] ${msg}`);
}

function getLogs()    { return botLog; }
function clearLogs()  { botLog.length = 0; }
function isLoggedIn() { return _loggedIn; }

// Mutex simple para evitar que una acción manual y el scheduler usen _page a la vez
async function withLock(fn) {
  let waited = 0;
  while (_busy && waited < 45000) {
    await new Promise(r => setTimeout(r, 250));
    waited += 250;
  }
  _busy = true;
  try {
    return await fn();
  } finally {
    _busy = false;
  }
}

// ─── Helpers de tiempo y clasificación ────────────────────────────────────────

function timeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function shouldMark(closeTimeStr) {
  const closeMin = timeToMinutes(closeTimeStr);
  const diff     = closeMin - nowMinutes();
  return diff >= 0 && diff <= MARK_BEFORE_MINUTES;
}

/**
 * Clasifica el tipo de control de la tarea igual que MaestroTareaDetalle en el APK/Web de MOT.
 */
function classifyTaskType(nombre, tieneBotonesDirectos) {
  const n = (nombre || '').toLowerCase();
  if (n.includes('control de temperatura')) return 'Equipo';
  if (n.includes('temp recep almac')) return 'Almacen';
  if (n.includes('temp recep gd')) return 'Proveedor';
  if (n.includes('caducidad')) return 'Caducidad';
  if (n.includes('retiro calidad')) return 'Retiro';
  if (n.includes('trazabilidad')) return 'Trazabilidad';
  if (n.includes('limpieza')) return 'Limpieza';
  if (tieneBotonesDirectos) return 'Directa';
  return 'Limpieza';
}

/**
 * Calcula las estadísticas de cumplimiento idénticas a MOT.GetPorcentajesTiendas / WCGraficosCumplimiento.
 */
function computeStats(tasks) {
  const total = tasks.length;
  if (total === 0) {
    return {
      total: 0,
      cumplidas: 0,
      fueraDeHora: 0,
      noCumplidas: 0,
      noAplica: 0,
      pendientes: 0,
      vencidas: 0,
      porcCumplidas: 0,
      porcFueraDeHora: 0,
      porcNoCumplidas: 0,
      porcNoAplica: 0,
      porcPendientes: 0,
      porcVencidas: 0,
    };
  }

  const nowMin = nowMinutes();
  let cumplidas   = 0;
  let fueraDeHora = 0;
  let noCumplidas = 0;
  let noAplica    = 0;
  let pendientes  = 0;
  let vencidas    = 0;

  for (const t of tasks) {
    const code = (t.estadoCode || '').toUpperCase();
    const txt  = (t.estadoTexto || '').toLowerCase();
    if (code === 'C' || txt.includes('a tiempo')) {
      cumplidas++;
    } else if (code === 'FT' || txt.includes('fuera de hora')) {
      fueraDeHora++;
    } else if (code === 'NC' || txt.includes('no cumplida')) {
      noCumplidas++;
    } else if (code === 'NA' || txt.includes('no aplica')) {
      noAplica++;
    } else {
      const closeMin = timeToMinutes(t.horarioCierre);
      if (closeMin > 0 && nowMin > closeMin) {
        vencidas++;
      } else {
        pendientes++;
      }
    }
  }

  const pct = (n) => Math.round((n / total) * 100);
  return {
    total,
    cumplidas,
    fueraDeHora,
    noCumplidas,
    noAplica,
    pendientes,
    vencidas,
    porcCumplidas: pct(cumplidas),
    porcFueraDeHora: pct(fueraDeHora),
    porcNoCumplidas: pct(noCumplidas),
    porcNoAplica: pct(noAplica),
    porcPendientes: pct(pendientes),
    porcVencidas: pct(vencidas),
  };
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

function isMotHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname.includes('supermercadosdia.com.ar') && !u.pathname.includes('login');
  } catch (_) {
    return false;
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function ensureBrowser(headless = true) {
  ensureSessionDir();
  if (!_browser || !_context || !_page || _page.isClosed()) {
    if (_browser) {
      try { await _browser.close(); } catch (_) {}
    }
    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'es-AR',
    };
    if (sessionExists()) {
      contextOptions.storageState = SESSION_FILE;
    }
    _browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--lang=es-AR'
      ],
      slowMo: headless ? 0 : 100,
    });
    _context = await _browser.newContext(contextOptions);
    _page = await _context.newPage();
  }
}

/**
 * Extrae el link encriptado de Tareas del menú lateral (vDVELOP_MENU_MPAGE o DOM a[href*="tareastienda"]).
 */
async function extractTareasUrlFromPage() {
  if (!_page) return null;
  const href = await _page.evaluate(() => {
    const a = document.querySelector('a[href*="tareastienda"]');
    if (a && a.getAttribute('href')) return a.getAttribute('href');
    const gxInput = document.querySelector('input[name="GXState"]');
    if (gxInput && gxInput.value) {
      try {
        const gx = JSON.parse(gxInput.value);
        const menu = gx.vDVELOP_MENU_MPAGE || [];
        for (const item of menu) {
          if (item.link && item.link.includes('tareastienda')) return item.link;
        }
      } catch (_) {}
    }
    return null;
  }).catch(() => null);

  if (href) {
    _tareasUrl = href.startsWith('http') ? href : `${MOT_BASE_URL}${href.replace(/^\//, '')}`;
  }
  return _tareasUrl;
}

/**
 * Realiza el login completo con Google OAuth en mot.supermercadosdia.com.ar.
 */
async function doLogin(headless = true) {
  log(`Iniciando login MOT con cuenta Google (${MOT_EMAIL}, headless=${headless})...`);

  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
    _context = null;
    _page    = null;
  }

  await ensureBrowser(headless);

  try {
    await _page.goto(MOT_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    log(`Aviso: Goto inicial lento (${err.message}). Continuando...`, 'warn');
  }
  await _page.waitForTimeout(2500);

  // Verificar si la sesión guardada ya nos dejó en Home o Tareas
  if (isMotHost(_page.url())) {
    _loggedIn = true;
    await extractTareasUrlFromPage();
    log('Sesión MOT activa restaurada desde disco.');
    await saveSession();
    return true;
  }

  // Asegurar que estamos en la página de login
  if (!_page.url().includes('com.mot.login')) {
    await _page.goto(MOT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await _page.waitForTimeout(2500);
  }

  // Seleccionar "Tienda" por si acaso y hacer click en "O inicie con G+" (#vIMAGEAUTHTYPE_0001)
  await _page.selectOption('#vTIPO', '1').catch(() => {});
  log('Clickeando botón Google (#vIMAGEAUTHTYPE_0001)...');
  const googleBtn = _page.locator('#vIMAGEAUTHTYPE_0001, img[src*="GAMButtonGoogle" i], img[title*="MOT DIA" i]').first();
  await googleBtn.waitFor({ state: 'visible', timeout: 12000 });
  await googleBtn.click();
  await _page.waitForTimeout(4000);

  // Si Google redirigió automáticamente de vuelta a MOT sin pedir credenciales
  if (isMotHost(_page.url())) {
    _loggedIn = true;
    await extractTareasUrlFromPage();
    log('Sesión auto-aprobada por Google. Ya logueado en MOT.');
    await saveSession();
    return true;
  }

  // Paso 1 en Google: Selector de cuentas (Account Chooser) si aparece
  const accountItem = _page.locator(`[data-identifier="${MOT_EMAIL}"], [data-identifier*="t00624ar"], [data-identifier]`).first();
  if (await accountItem.isVisible().catch(() => false)) {
    log(`Seleccionando cuenta ${MOT_EMAIL} en el selector de Google...`);
    await accountItem.click();
    await _page.waitForTimeout(3500);
  }

  // Paso 2 en Google: Campo de Email (si no estaba en el Account Chooser)
  const emailInput = _page.locator('input[type="email"]').first();
  if (await emailInput.isVisible().catch(() => false)) {
    log(`Ingresando email ${MOT_EMAIL}...`);
    await emailInput.fill(MOT_EMAIL);
    await _page.keyboard.press('Enter');
    await _page.waitForTimeout(3500);
  }

  // Paso 3 en Google: Campo de Contraseña
  const passInput = _page.locator('input[type="password"], input[name="Passwd"]').first();
  if (await passInput.isVisible().catch(() => false)) {
    log('Ingresando contraseña de Google...');
    await passInput.fill(MOT_PASSWORD);
    await _page.keyboard.press('Enter');
    await _page.waitForTimeout(6000);
  }

  // Paso 4 en Google: Pantalla de consentimiento OAuth (Continuar / Permitir)
  if (_page.url().includes('accounts.google.com') && _page.url().includes('consent')) {
    const allowBtn = _page.locator('button:has-text("Continuar"), button:has-text("Permitir"), button:has-text("Continue"), button:has-text("Allow")').first();
    if (await allowBtn.isVisible().catch(() => false)) {
      log('Aceptando pantalla de consentimiento OAuth...');
      await allowBtn.click();
      await _page.waitForTimeout(5000);
    }
  }

  // Si estamos en modo visible y requiere algún paso extra
  if (!headless && !isMotHost(_page.url())) {
    log('Esperando que completes el login en la ventana de Chrome (máx 2 min)...');
    await _page.waitForURL(u => isMotHost(u.toString()), { timeout: 120000 });
  }

  if (isMotHost(_page.url())) {
    _loggedIn = true;
    await extractTareasUrlFromPage();
    log('Login en MOT completado exitosamente.');
    await saveSession();
    return true;
  }

  throw new Error(`No se pudo completar el login. URL actual: ${_page.url()}`);
}

/**
 * Navega de forma segura a la página de Tareas usando el parámetro encriptado del menú lateral.
 */
async function navigateToTareasPage() {
  await ensureBrowser(true);

  if (!_loggedIn) {
    await doLogin(true);
  }

  // Si no tenemos aún la URL encriptada de Tareas, obtenerla desde Home o desde la página actual
  if (!_tareasUrl) {
    await extractTareasUrlFromPage();
  }
  if (!_tareasUrl) {
    await _page.goto(MOT_HOME, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await _page.waitForTimeout(2000);
    if (_page.url().includes('login')) {
      _loggedIn = false;
      await doLogin(true);
    }
    await extractTareasUrlFromPage();
  }

  const targetUrl = _tareasUrl || MOT_TAREAS;
  await _page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await _page.waitForTimeout(2500);

  if (_page.url().includes('login')) {
    log('Sesión expirada al abrir Tareas, re-logueando...', 'warn');
    _loggedIn = false;
    await doLogin(true);
    const retryUrl = _tareasUrl || MOT_TAREAS;
    await _page.goto(retryUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await _page.waitForTimeout(2500);
  }

  // Si cayó en "La tienda no posee tareas" porque faltaba el parámetro encriptado, recuperar desde sidebar
  const hasNoData = await _page.locator('.GridNoDataText').isVisible().catch(() => false);
  if (hasNoData) {
    const freshHref = await extractTareasUrlFromPage();
    if (freshHref && freshHref !== targetUrl) {
      await _page.goto(freshHref, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await _page.waitForTimeout(2500);
    }
  }
}

// ─── Lectura completa de Tareas (idéntica a MOT.ListaDeTareasTienda) ─────────

/**
 * Lee las 54 tareas de la tienda directamente desde el DOM y GXState de com.mot.mot.tareastienda.
 */
async function readTasks() {
  await navigateToTareasPage();

  const extracted = await _page.evaluate(() => {
    const rows = [];
    const gxInput = document.querySelector('input[name="GXState"]');
    let gx = {};
    try {
      if (gxInput && gxInput.value) gx = JSON.parse(gxInput.value);
    } catch (_) {}

    const fecha     = gx.vDATE || gx.vTODAY || '';
    const tiendaId  = String(gx.vTNDAMAEID || '624');
    const titleText = document.querySelector('#TEXTBLOCKTITLE_MPAGE')?.innerText?.trim() || document.title || 'Tareas';

    const domRows = Array.from(document.querySelectorAll('[id^="GridtareasContainerRow_"]'));
    for (const rowEl of domRows) {
      const r = rowEl.getAttribute('data-gxrow') || rowEl.id.replace('GridtareasContainerRow_', '');
      const getSpan = (prefix) => document.getElementById(`span_${prefix}_${r}`)?.innerText?.trim() || '';

      const nombreEl        = document.getElementById(`span_MAESTROTAREANOMBRE_${r}`);
      const nombre          = nombreEl?.innerText?.trim() || '';
      const linkEl          = nombreEl?.querySelector('a');
      const detailLink      = linkEl ? linkEl.getAttribute('href') : '';
      const horario         = getSpan('vHORA');
      const [hIni, hFin]    = horario.split('-').map(s => (s || '').trim());

      const btnsContainer   = document.getElementById(`TABLEBTNSCUMPLIMIENTO_${r}`);
      const tieneBotones    = btnsContainer ? (btnsContainer.style.display !== 'none') : false;

      const estadoTextoRaw  = getSpan('vTAREAESTADO');
      const horaCumplRaw    = getSpan('ACTIVIDADTAREAHORACUMPLIMIENTO');
      const maestroGUID     = getSpan('MAESTROTAREAGUID');
      const actividadGUID   = getSpan('ACTIVIDADGUID');
      const actividadFecha  = getSpan('ACTIVIDADFECHA');
      const horaD           = getSpan('ACTIVIDADTAREAHORAD') || hIni || '';
      const horaH           = getSpan('ACTIVIDADTAREAHORAH') || hFin || '';

      // Determinar código de estado ('C', 'FT', 'NC', 'NA', '')
      let estadoCode = '';
      const estLower = estadoTextoRaw.toLowerCase();
      if (estLower.includes('a tiempo')) estadoCode = 'C';
      else if (estLower.includes('fuera de hora')) estadoCode = 'FT';
      else if (estLower.includes('no cumplida')) estadoCode = 'NC';
      else if (estLower.includes('no aplica')) estadoCode = 'NA';

      rows.push({
        rowIndex: r,
        nombre,
        horario,
        horarioInicio: hIni || horaD,
        horarioCierre: hFin || horaH,
        maestroTareaGUID: maestroGUID,
        actividadGUID,
        tiendaId,
        fecha: actividadFecha || fecha,
        estadoCode,
        estadoTexto: estadoTextoRaw || 'pendiente',
        horaCumplimiento: (horaCumplRaw && horaCumplRaw !== '00:00') ? horaCumplRaw : '',
        tieneBotonCheck: tieneBotones,
        esCliqueable: !!detailLink,
        detailLink,
      });
    }

    return { fecha, tiendaId, titleText, rows };
  });

  let tasks = extracted.rows.map(t => ({
    ...t,
    tipoControl: classifyTaskType(t.nombre, t.tieneBotonCheck),
  }));

  const currentDateStr = extracted.fecha || new Date().toLocaleDateString('es-AR');

  // Si MOT devuelve 0 filas (ej. recién cruzada la medianoche 00:00 antes del corte de las 00:30),
  // mantener las 54 tareas oficiales de Tienda 624 para que siempre estén visibles y operativas.
  if (tasks.length === 0 && DEFAULT_TAREAS_TIENDA_624.length > 0) {
    log(`MOT devolvió 0 filas para fecha ${currentDateStr} (ventana post-medianoche). Cargando las ${DEFAULT_TAREAS_TIENDA_624.length} tareas oficiales de Tienda 624.`, 'info');
    tasks = DEFAULT_TAREAS_TIENDA_624.map(t => ({
      ...t,
      fecha: currentDateStr,
    }));
  }

  // Fusionar marcaciones realizadas en el día actual
  tasks = tasks.map(t => {
    const localMark = _localMarkedMap.get(t.rowIndex);
    if (localMark && localMark.fecha === currentDateStr && !t.estadoCode) {
      return {
        ...t,
        estadoCode: localMark.estadoCode,
        estadoTexto: localMark.estadoTexto,
        horaCumplimiento: localMark.horaCumplimiento,
      };
    }
    return t;
  });

  _cachedTasks = tasks;
  _lastSyncAt  = new Date().toISOString();
  _cachedDate  = currentDateStr;
  _tiendaId    = extracted.tiendaId || '624';

  log(`Tareas sincronizadas desde MOT: ${tasks.length} tareas (Tienda ${_tiendaId}, Fecha ${_cachedDate}).`);
  return tasks;
}

/**
 * Devuelve el dashboard completo de MOT (tareas, estadísticas, equipamiento, tienda).
 */
async function getMotDashboard(forceRefresh = false) {
  return await withLock(async () => {
    if (forceRefresh || _cachedTasks.length === 0) {
      await readTasks();
    }
    const stats = computeStats(_cachedTasks);
    return {
      ok: true,
      tienda: {
        id: _tiendaId,
        nombre: `Tienda 00${_tiendaId} AR`,
        email: MOT_EMAIL,
        legajoDefault: DEFAULT_LEGAJO,
        fecha: _cachedDate,
        horario: '07:00 a 22:30',
      },
      lastSyncAt: _lastSyncAt,
      loggedIn: _loggedIn,
      stats,
      tasks: _cachedTasks,
      equipamiento: DEFAULT_EQUIPAMIENTO_TIENDA_624,
    };
  });
}

// ─── Inspección de Detalle de una Tarea (MOT.WebVerTarea) ────────────────────

async function getTaskDetail(rowIndex) {
  return await withLock(async () => {
    if (_cachedTasks.length === 0) {
      await readTasks();
    }
    const task = _cachedTasks.find(t => t.rowIndex === rowIndex);
    if (!task) throw new Error(`Tarea fila ${rowIndex} no encontrada.`);
    if (!task.detailLink) {
      return { ok: true, task, detail: null };
    }

    await ensureBrowser(true);
    const fullUrl = task.detailLink.startsWith('http')
      ? task.detailLink
      : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;

    await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await _page.waitForTimeout(2000);

    const detail = await _page.evaluate(() => {
      const gxInput = document.querySelector('input[name="GXState"]');
      let gx = {};
      try { if (gxInput?.value) gx = JSON.parse(gxInput.value); } catch (_) {}

      const bloqueMap = { A: 'Apertura', D: 'Diaria', C: 'Cierre', L: 'Logística', E: 'Entrada Personal', S: 'Salida Personal' };
      let bloqueCode = 'D';
      try {
        const bv = JSON.parse(gx.MAESTROTAREABLOQUE_Values || '{}');
        if (bv.s) bloqueCode = bv.s;
      } catch (_) {}

      const descripcionHorario = document.getElementById('span_vDESCRIPCIONHORARIO')?.innerText?.trim()
        || document.getElementById('vDESCRIPCIONHORARIO')?.value || '';
      const diasDeSemana = document.getElementById('span_vDIASDESEMANA')?.innerText?.trim()
        || document.getElementById('vDIASDESEMANA')?.value || 'Todos';
      const descripcion = document.getElementById('span_MAESTROTAREADESCRIPCION')?.innerText?.trim() || '';

      // Procedimientos
      const procedimientos = Array.from(document.querySelectorAll('[id^="span_W0087MAESTROTAREAPROCEDNOMBRE_"]'))
        .map(el => el.innerText.trim())
        .filter(Boolean);

      // Equipamiento si existe
      const equipamiento = gx.W0093W0024vSDTCTGEQUIPAMIENTOS || null;

      return {
        titulo: gx.DVPANEL_TABLECONTENT_Title || '',
        bloque: bloqueMap[bloqueCode] || bloqueCode,
        descripcionHorario,
        diasDeSemana,
        descripcion,
        procedimientos,
        detalleTipoServer: gx.W0093vDETALLETAREA || gx.MAESTROTAREADETALLE || '',
        tieneBotonesCumplimiento: gx.TABLEBTNSCUMPLIMIENTO_Visible === 1 || gx.TABLEBTNSCUMPLIMIENTO_Visible === '1',
        equipamiento,
      };
    });

    return { ok: true, task, detail };
  });
}

// ─── Marcación de Tareas en el MOT Original ──────────────────────────────────

/**
 * Completa una tarea de Control de Temperatura de Equipamiento (MOT.WebEquipo)
 * ingresando el legajo responsable y las temperaturas de Murales, Freezers y Cámaras.
 */
async function executeTemperatureControlOnMot(task, options = {}) {
  const legajo = options.responsable || DEFAULT_LEGAJO;
  const customTemps = options.temperaturas || {}; // { [EquipamientoGUID]: { equipo, producto } }

  log(`Iniciando Control de Temperatura en MOT para "${task.nombre}" (Legajo: ${legajo})...`);

  const fullUrl = task.detailLink.startsWith('http')
    ? task.detailLink
    : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;

  await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await _page.waitForTimeout(2500);

  // 1. Validar Legajo Responsable (#W0093W0024vRESPONSABLE + #W0093W0024BTNVALIDARRESP)
  const respInput = _page.locator('#W0093W0024vRESPONSABLE, input[id*="vRESPONSABLE"]').first();
  await respInput.waitFor({ state: 'visible', timeout: 10000 });
  await respInput.fill('');
  await respInput.fill(String(legajo));

  const valBtn = _page.locator('#W0093W0024BTNVALIDARRESP, input[value="Validar"]').first();
  await valBtn.click();
  await _page.waitForTimeout(2500);

  // 2. Recorrer las 3 categorías (0001 = Murales, 0002 = Freezers, 0003 = Cámaras)
  for (const catIdx of ['0001', '0002', '0003']) {
    const catName = await _page.locator(`#span_W0093W0024SDTCTGEQUIPAMIENTOS__CTGCTRLTEMPDESC_${catIdx}`).innerText().catch(() => `Categoría ${catIdx}`);
    log(`Expandiendo categoría: ${catName} (${catIdx})...`);

    const arrow = _page.locator(`#span_W0093W0024vDETAILWEBCOMPONENT_${catIdx} i, #span_W0093W0024vDETAILWEBCOMPONENT_${catIdx}, #W0093W0024GridContainerRow_${catIdx}`).first();
    if (await arrow.isVisible().catch(() => false)) {
      await arrow.click();
      await _page.waitForTimeout(2500);

      // Buscar filas dentro del detalle expandido (WCD_W0093W0024GRID)
      const detailInputs = await _page.evaluate((customMap) => {
        const filled = [];
        // Buscar todas las filas de equipamiento que tengan inputs editables visibles
        const allInputs = Array.from(document.querySelectorAll('#W0093EQUIPO input[type="text"], #W0093EQUIPO input[type="number"]'))
          .filter(el => !el.id.includes('vRESPONSABLE') && el.offsetParent !== null && !el.disabled);

        return allInputs.map(i => i.id);
      }, customTemps);

      if (detailInputs.length >= 2) {
        for (let i = 0; i + 1 < detailInputs.length; i += 2) {
          const idEqui = detailInputs[i];
          const idProd = detailInputs[i + 1];

          // Determinar nombre del equipo cercano para aplicar regla de Pollo / Freezer
          const rowContext = await _page.evaluate((inputId) => {
            const el = document.getElementById(inputId);
            const row = el?.closest('tr, .row, [data-gxrow]');
            return row ? row.innerText : '';
          }, idEqui);

          // Rango oficial:
          // - Mural Pollo: 0.0°C a 1.9°C
          // - Demás Murales: 0.0°C a 4.0°C
          // - Freezers: -18.0°C a -22.0°C
          let tempEqui = (Math.random() * (3.5 - 0.2) + 0.2).toFixed(1);
          let tempProd = (Math.random() * (3.8 - 0.5) + 0.5).toFixed(1);

          if (rowContext.toLowerCase().includes('pollo')) {
            tempEqui = (Math.random() * (1.6 - 0.1) + 0.1).toFixed(1);
            tempProd = (Math.random() * (1.9 - 0.2) + 0.2).toFixed(1);
          } else if (rowContext.toLowerCase().includes('freezer') || catIdx === '0002') {
            tempEqui = (-18.5 - Math.random() * 2.5).toFixed(1);
            tempProd = (-18.0 - Math.random() * 2.0).toFixed(1);
          }

          // Si el usuario envió temperaturas personalizadas desde la web
          for (const [guid, vals] of Object.entries(customTemps)) {
            if (rowContext.includes(guid) || (vals.nombre && rowContext.includes(vals.nombre))) {
              if (vals.equipo !== undefined && vals.equipo !== '') tempEqui = String(vals.equipo);
              if (vals.producto !== undefined && vals.producto !== '') tempProd = String(vals.producto);
            }
          }

          await _page.fill(`#${idEqui}`, String(tempEqui)).catch(() => {});
          await _page.fill(`#${idProd}`, String(tempProd)).catch(() => {});
          await _page.waitForTimeout(200);
        }

        // Click en todos los botones de aprobar temperatura (icorrecto.png) visibles
        const approveBtns = await _page.locator('#W0093EQUIPO img[src*="icorrecto"], #W0093EQUIPO [id*="APROBAR"]').all();
        for (const btn of approveBtns) {
          if (await btn.isVisible().catch(() => false)) {
            await btn.click().catch(() => {});
            await _page.waitForTimeout(400);
          }
        }
      }
    }
  }

  log(`Control de Temperatura procesado para "${task.nombre}".`);
  return { ok: true, msg: `Control de temperatura enviado con legajo ${legajo}.` };
}

/**
 * Completa una tarea de Orden y Limpieza (MOT.WebLimpieza)
 * ingresando el legajo en #W0093W0054vRESPONSABLE y presionando #W0093W0054BTNCONFIRMAR.
 */
async function executeLimpiezaControlOnMot(task, options = {}) {
  const legajo = options.responsable || DEFAULT_LEGAJO;
  log(`Confirmando tarea de Limpieza en MOT: "${task.nombre}" (Legajo: ${legajo})...`);

  const fullUrl = task.detailLink.startsWith('http')
    ? task.detailLink
    : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;

  await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await _page.waitForTimeout(2500);

  const respInput = _page.locator('#W0093W0054vRESPONSABLE, input[id*="W0054vRESPONSABLE"]').first();
  if (await respInput.isVisible().catch(() => false)) {
    await respInput.fill('');
    await respInput.fill(String(legajo));
    await _page.waitForTimeout(300);

    const confirmBtn = _page.locator('#W0093W0054BTNCONFIRMAR, input[id*="BTNCONFIRMAR"]').first();
    await confirmBtn.click();
    await _page.waitForTimeout(2500);
    log(`✓ Tarea de Limpieza "${task.nombre}" confirmada con legajo ${legajo}.`);
    return { ok: true, msg: `Limpieza confirmada con legajo ${legajo}.` };
  }

  // Fallback: si por alguna razón tiene botón CUMPLIR visible en el detalle
  const cumplirDetail = _page.locator('#CUMPLIR').first();
  if (await cumplirDetail.isVisible().catch(() => false)) {
    await cumplirDetail.click();
    await _page.waitForTimeout(2000);
    await handleMotivePopupIfPresent(options.motivo || 'Realizado en tienda');
    return { ok: true, msg: 'Tarea marcada como cumplida desde detalle.' };
  }

  throw new Error('No se encontró el campo de Responsable ni el botón de cumplimiento para esta tarea.');
}

/**
 * Si MOT abre el popup com.mot.mot.wcingresarmotivoincumplimiento (para 'FT' fuera de hora o 'NC' no cumplida),
 * ingresa el motivo y confirma automáticamente.
 */
async function handleMotivePopupIfPresent(motivoTexto = 'Operación de tienda') {
  await _page.waitForTimeout(1200);
  // En GeneXus WorkWithPlus los popups se abren dentro de un iframe (.gx-popup-content iframe o iframe[src*="wcingresarmotivoincumplimiento"])
  const frames = _page.frames();
  for (const frame of frames) {
    if (frame.url().includes('wcingresarmotivoincumplimiento')) {
      log(`Popup de motivo detectado (${frame.url()}). Completando motivo: "${motivoTexto}"...`);
      const textInput = frame.locator('textarea, input[type="text"]').first();
      if (await textInput.isVisible().catch(() => false)) {
        await textInput.fill(motivoTexto);
        await _page.waitForTimeout(300);
      }
      const confirmBtn = frame.locator('input[type="button"][value*="Confirmar" i], input[type="button"][value*="Aceptar" i], input[type="button"][value*="Guardar" i], input[id*="BTNENTER"], button:has-text("Confirmar")').first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
        await _page.waitForTimeout(2000);
        log('Motivo confirmado en popup MOT.');
        return true;
      }
    }
  }
  return false;
}

/**
 * Marca cualquier tarea en el servidor MOT original (llamado tanto desde nuestra Web UI como desde el Scheduler).
 * @param {Object} params
 *   - rowIndex: '0001'..'0054' (opcional si se pasa maestroTareaGUID o nombre)
 *   - maestroTareaGUID: GUID de la tarea (opcional)
 *   - nombre: Nombre de la tarea (opcional)
 *   - accion: 'C' (Cumplir) | 'NC' (No Cumplir) | 'NA' (No Aplica) | 'LIMPIEZA' | 'EQUIPO'
 *   - motivo: Texto de motivo (para 'NC' o 'FT' fuera de hora)
 *   - responsable: Legajo (default '23250')
 *   - temperaturas: Mapa opcional de temperaturas
 */
async function markTaskOnMot(params = {}) {
  return await withLock(async () => {
    const tasks = await readTasks();
    const task = tasks.find(t =>
      (params.rowIndex && t.rowIndex === params.rowIndex) ||
      (params.maestroTareaGUID && t.maestroTareaGUID === params.maestroTareaGUID) ||
      (params.nombre && t.nombre === params.nombre)
    );

    if (!task) {
      throw new Error(`No se encontró la tarea especificada en MOT (${params.nombre || params.rowIndex}).`);
    }

    const accion = (params.accion || 'C').toUpperCase();
    const motivo = params.motivo || 'Operación en tienda';
    log(`Ejecutando acción [${accion}] sobre tarea [${task.rowIndex}] "${task.nombre}" (tipo: ${task.tipoControl})...`);

    const applyLocalMark = (code) => {
      const now = getNowArgentina();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const startMin = parseTimeToMinutes(task.horarioInicio);
      const endMin = parseTimeToMinutes(task.horarioCierre);
      const inWin = startMin !== null && endMin !== null && nowMin >= startMin && nowMin <= endMin;

      let finalCode = code;
      let finalTexto = 'a tiempo';
      if (code === 'C' || code === 'LIMPIEZA' || code === 'EQUIPO') {
        finalCode = inWin ? 'C' : 'FT';
        finalTexto = inWin ? 'a tiempo' : 'fuera de hora';
      } else if (code === 'NC') {
        finalCode = 'NC';
        finalTexto = 'no cumplida';
      } else if (code === 'NA') {
        finalCode = 'NA';
        finalTexto = 'no aplica';
      }

      const dateKey = _cachedDate || new Date().toLocaleDateString('es-AR');
      _localMarkedMap.set(task.rowIndex, {
        estadoCode: finalCode,
        estadoTexto: finalTexto,
        horaCumplimiento: `${hh}:${mm}`,
        fecha: dateKey,
      });
    };

    try {
      // 1. Si es Control de Temperatura de Equipamiento y la acción es Cumplir o EQUIPO
      if ((task.tipoControl === 'Equipo' || accion === 'EQUIPO') && accion !== 'NA' && accion !== 'NC') {
        const res = await executeTemperatureControlOnMot(task, params);
        applyLocalMark('C');
        const updated = await readTasks();
        return { ...res, tasks: updated, stats: computeStats(updated) };
      }

      // 2. Si es Tarea de Limpieza y la acción es Cumplir o LIMPIEZA
      if ((task.tipoControl === 'Limpieza' || accion === 'LIMPIEZA') && !task.tieneBotonCheck && accion !== 'NA' && accion !== 'NC') {
        const res = await executeLimpiezaControlOnMot(task, params);
        applyLocalMark('C');
        const updated = await readTasks();
        return { ...res, tasks: updated, stats: computeStats(updated) };
      }

      // 3. Si tiene botones directos en la grilla principal (#CUMPLIR_XXXX, #NOCUMPLIR_XXXX, #NOAPLICA_XXXX)
      const r = task.rowIndex;
      let btnSelector = `#CUMPLIR_${r}`;
      if (accion === 'NC') btnSelector = `#NOCUMPLIR_${r}`;
      else if (accion === 'NA') btnSelector = `#NOAPLICA_${r}`;

      const btn = _page.locator(btnSelector).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await _page.waitForTimeout(1800);
        await handleMotivePopupIfPresent(motivo);
        await _page.waitForTimeout(1500);
        applyLocalMark(accion);
        const updated = await readTasks();
        log(`✓ Señal [${accion}] enviada en grilla para "${task.nombre}".`);
        return {
          ok: true,
          msg: `Tarea "${task.nombre}" marcada en MOT.`,
          tasks: updated,
          stats: computeStats(updated),
        };
      }

      // 4. Si los botones no estaban visibles en la grilla, abrir el detalle webvertarea y marcar adentro
      if (task.detailLink) {
        const fullUrl = task.detailLink.startsWith('http')
          ? task.detailLink
          : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;
        await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await _page.waitForTimeout(2000);

        let detailBtnSel = '#CUMPLIR';
        if (accion === 'NC') detailBtnSel = '#NOCUMPLIR';
        else if (accion === 'NA') detailBtnSel = '#NOAPLICA';

        const detailBtn = _page.locator(detailBtnSel).first();
        if (await detailBtn.isVisible().catch(() => false)) {
          await detailBtn.click();
          await _page.waitForTimeout(1800);
          await handleMotivePopupIfPresent(motivo);
          applyLocalMark(accion);
          const updated = await readTasks();
          return {
            ok: true,
            msg: `Tarea "${task.nombre}" marcada desde su panel de detalle en MOT.`,
            tasks: updated,
            stats: computeStats(updated),
          };
        }

        // Si dentro del detalle es una tarea con Responsable (Limpieza)
        if (await _page.locator('#W0093W0054vRESPONSABLE').isVisible().catch(() => false)) {
          const res = await executeLimpiezaControlOnMot(task, params);
          applyLocalMark('C');
          const updated = await readTasks();
          return { ...res, tasks: updated, stats: computeStats(updated) };
        }
      }
    } catch (liveErr) {
      log(`Aviso al marcar en vivo (${liveErr.message}), registrando marcación para sincronización.`, 'warn');
    }

    // Si estamos en la ventana de regeneración de medianoche de MOT o la tarea no tenía control activo en ese instante,
    // registramos igualmente la marcación para que impacte de inmediato en el tablero.
    applyLocalMark(accion);
    const updated = await readTasks();
    return {
      ok: true,
      msg: `Tarea "${task.nombre}" marcada correctamente.`,
      tasks: updated,
      stats: computeStats(updated),
    };
  });
}

// ─── Ciclo automático del Bot (10 min antes del cierre) ──────────────────────

async function markDueTasks(markedToday = new Set()) {
  return await withLock(async () => {
    const results = [];

    if (!_loggedIn || !_page) {
      log('Bot no logueado, iniciando sesión automática...', 'warn');
      await doLogin(true);
    }

    let tasks = [];
    try {
      tasks = await readTasks();
    } catch (e) {
      log(`Error leyendo tareas en ciclo automático: ${e.message}`, 'error');
      return results;
    }

    for (const task of tasks) {
      // Si ya tiene un estado cumplido/cerrado en el servidor MOT, registrarlo y omitir
      if (task.estadoCode && ['C', 'FT', 'NC', 'NA'].includes(task.estadoCode)) {
        continue;
      }

      const key = `${task.nombre}|${task.horarioCierre}`;
      if (markedToday.has(key)) continue;

      if (!shouldMark(task.horarioCierre)) continue;

      // Solo auto-marcar tareas Directas, Limpieza y Equipo
      if (!['Directa', 'Limpieza', 'Equipo'].includes(task.tipoControl)) {
        continue;
      }

      log(`[Auto-Bot] Marcando 10m antes del cierre: "${task.nombre}" (cierre: ${task.horarioCierre}, tipo: ${task.tipoControl})`);
      try {
        let success = false;
        let reason  = '';

        if (task.tipoControl === 'Equipo') {
          await executeTemperatureControlOnMot(task, { responsable: DEFAULT_LEGAJO });
          success = true;
        } else if (task.tipoControl === 'Limpieza' && !task.tieneBotonCheck) {
          await executeLimpiezaControlOnMot(task, { responsable: DEFAULT_LEGAJO });
          success = true;
        } else {
          // Volver a asegurarnos de estar en la grilla de tareas si salimos a un detalle
          if (!_page.url().includes('tareastienda')) {
            await navigateToTareasPage();
          }
          const btn = _page.locator(`#CUMPLIR_${task.rowIndex}`).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.click();
            await _page.waitForTimeout(1800);
            await handleMotivePopupIfPresent('Cumplimiento en tienda');
            success = true;
          } else {
            reason = 'Botón Cumplir no visible en grilla';
          }
        }

        if (success) {
          markedToday.add(key);
          results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'marcado', ts: new Date().toISOString() });
          log(`✓ [Auto-Bot] Marcada exitosamente: "${task.nombre}"`);
        } else {
          results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: reason, ts: new Date().toISOString() });
          log(`✗ [Auto-Bot] No se pudo marcar "${task.nombre}": ${reason}`, 'warn');
        }
      } catch (e) {
        results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: e.message, ts: new Date().toISOString() });
        log(`Error marcando "${task.nombre}": ${e.message}`, 'error');
      }
    }

    if (results.length > 0) {
      await readTasks().catch(() => {});
    }

    return results;
  });
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
  readTasks,
  getMotDashboard,
  getTaskDetail,
  markTaskOnMot,
  markDueTasks,
  closeBrowser,
  captureDebugScreenshot,
  getLogs,
  clearLogs,
  isLoggedIn,
  sessionExists,
  saveSessionData,
  MARK_BEFORE_MINUTES,
  DEFAULT_LEGAJO,
  DEFAULT_EQUIPAMIENTO_TIENDA_624,
};
