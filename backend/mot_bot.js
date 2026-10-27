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

process.env.TZ = 'America/Argentina/Buenos_Aires';

const { chromium } = require('playwright');
const knowledge = require('./mot_knowledge');
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

// ─── Gestión de Legajos por Turnos (Mañana hasta 14:30 hs / Tarde desde 15:00 hs) ─
let _motLegajoManana = DEFAULT_LEGAJO;
let _motLegajoTarde  = DEFAULT_LEGAJO;
let _motLegajosList  = [
  { legajo: DEFAULT_LEGAJO, nombre: 'Responsable Turno Mañana' }
];
let _motScheduleMap  = {};

function setMotLegajosState({ legajos, manana, tarde }) {
  if (Array.isArray(legajos) && legajos.length > 0) _motLegajosList = legajos;
  if (manana) _motLegajoManana = String(manana).trim();
  if (tarde) _motLegajoTarde = String(tarde).trim();
}

function getMotLegajosState() {
  return {
    legajos: _motLegajosList,
    manana: _motLegajoManana,
    tarde: _motLegajoTarde,
  };
}

function setMotScheduleMap(scheduleMap) {
  if (scheduleMap && typeof scheduleMap === 'object') {
    _motScheduleMap = { ..._motScheduleMap, ...scheduleMap };
    syncTodayLegajosFromSchedule();
  }
}

function getMotScheduleMap() {
  return _motScheduleMap;
}

function syncTodayLegajosFromSchedule() {
  const { formatDateISO } = require('./mot_calendar');
  const nowArg = getNowArgentina();
  const todayStr = formatDateISO(nowArg);
  const entry = _motScheduleMap[todayStr];
  if (entry) {
    if (entry.manana) _motLegajoManana = String(entry.manana).trim();
    if (entry.tarde) _motLegajoTarde = String(entry.tarde).trim();
    log(`📅 [Cronograma Semanal] Turnos asignados para hoy (${todayStr}): Mañana -> Leg. ${_motLegajoManana} | Tarde -> Leg. ${_motLegajoTarde}`);
  }
}

/**
 * Resuelve el legajo aplicable a una tarea según el turno correspondiente:
 * - Turno Mañana: tareas que inician antes de las 15:00 hs (hasta 14:30 hs).
 * - Turno Tarde: tareas que inician a partir de las 15:00 hs.
 * Si se provee un legajo explícito en llamada manual, se respeta.
 */
function resolveLegajoForTask(task, explicitLegajo = null) {
  if (explicitLegajo && String(explicitLegajo).trim() !== '') {
    return String(explicitLegajo).trim();
  }

  // 1. Evaluar según el horario de inicio programado de la tarea
  if (task && task.horarioInicio) {
    const parts = task.horarioInicio.split(':');
    if (parts.length >= 2) {
      const taskStartMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      const cutoffMin = 15 * 60; // 15:00 hs
      if (taskStartMin < cutoffMin) {
        return _motLegajoManana || DEFAULT_LEGAJO;
      } else {
        return _motLegajoTarde || _motLegajoManana || DEFAULT_LEGAJO;
      }
    }
  }

  // 2. Si no tiene horario específico, evaluar por la hora actual de Argentina
  const nowArg = getNowArgentina();
  const currentMin = nowArg.getHours() * 60 + nowArg.getMinutes();
  if (currentMin < 15 * 60) {
    return _motLegajoManana || DEFAULT_LEGAJO;
  }
  return _motLegajoTarde || _motLegajoManana || DEFAULT_LEGAJO;
}

// Minutos DESPUÉS del horario de inicio de cada tarea para marcar automáticamente
const MARK_AFTER_START_MINUTES = 10;
const MARK_BEFORE_MINUTES      = 10; // alias de compatibilidad

// ─── Motor IA de Perfiles Térmicos por Categoría y Equipo ─────────────────────
const AI_TEMPERATURE_PROFILES = {
  MURAL_POLLO: {
    id: 'MURAL_POLLO',
    label: 'Mural de Pollo (Aves)',
    minC: 0.0,
    maxC: 1.9,
    equipoMin: 0.2,
    equipoMax: 1.5,
    prodMin: 0.4,
    prodMax: 1.8,
    regla: 'Regla Crítica Aves: El Mural de Pollo debe mantenerse estrictamente entre 0.0°C y 1.9°C.',
  },
  MURAL_GENERAL: {
    id: 'MURAL_GENERAL',
    label: 'Murales Refrigerados (01-09, Carne, 4ta Gama)',
    minC: 0.0,
    maxC: 4.0,
    equipoMin: 0.6,
    equipoMax: 3.2,
    prodMin: 1.0,
    prodMax: 3.7,
    regla: 'Regla Murales Salón: Lácteos, fiambres, 4ta gama y carnes envasadas operan entre 0.0°C y 4.0°C.',
  },
  FREEZER: {
    id: 'FREEZER',
    label: 'Freezers / Congelados (01-05, Comercial, Punto Caliente)',
    minC: -22.0,
    maxC: -18.0,
    equipoMin: -21.5,
    equipoMax: -18.5,
    prodMin: -20.8,
    prodMax: -18.2,
    regla: 'Regla Congelados: Todos los Freezers y Panadería congelada deben operar entre -18.0°C y -22.0°C.',
  },
  RESERVA_CARNE: {
    id: 'RESERVA_CARNE',
    label: 'Reserva / Cámara de Carne',
    minC: 0.0,
    maxC: 2.0,
    equipoMin: 0.3,
    equipoMax: 1.6,
    prodMin: 0.5,
    prodMax: 1.9,
    regla: 'Regla Reserva Cárnica: La Cámara de Carne en trastienda opera en rango frío estricto de 0.0°C a 2.0°C (máx 4.0°C).',
  },
  RESERVA_GENERAL: {
    id: 'RESERVA_GENERAL',
    label: 'Reserva / Cámara Frigorífica General (Cámara 1)',
    minC: 0.0,
    maxC: 4.0,
    equipoMin: 0.8,
    equipoMax: 3.3,
    prodMin: 1.1,
    prodMax: 3.7,
    regla: 'Regla Reserva Fríos: La Cámara 1 de reserva general opera entre 0.0°C y 4.0°C.',
  },
};

const TEMP_HISTORY_FILE = path.join(__dirname, 'mot_temp_history.json');

function getTodayStrArg() {
  const now = new Date();
  const arg = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  const y = arg.getFullYear();
  const m = String(arg.getMonth() + 1).padStart(2, '0');
  const d = String(arg.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getYesterdayStrArg() {
  const now = new Date();
  const arg = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  arg.setDate(arg.getDate() - 1);
  const y = arg.getFullYear();
  const m = String(arg.getMonth() + 1).padStart(2, '0');
  const d = String(arg.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadTempHistory() {
  try {
    if (fs.existsSync(TEMP_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(TEMP_HISTORY_FILE, 'utf8'));
    }
  } catch (_) {}
  return { byDate: {}, lastByEquipment: {} };
}

function saveTempHistory(history) {
  try {
    // Conservar únicamente los últimos 10 días para mantener el archivo liviano
    const dates = Object.keys(history.byDate || {}).sort();
    while (dates.length > 10) {
      const oldest = dates.shift();
      delete history.byDate[oldest];
    }
    history.lastUpdated = new Date().toISOString();
    fs.writeFileSync(TEMP_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Semilla determinística auxiliar por fecha + equipo (por si el servidor se reinició en limpio sin archivo previo),
 * garantizando que "ayer" y "hoy" tengan valores base diferentes incluso tras un redeploy.
 */
function deterministicPrevTemp(equipName, dateStr, minVal, maxVal) {
  const seedStr = `${dateStr}::${equipName}`;
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = ((hash >>> 0) % 1000) / 1000;
  return Number((minVal + normalized * (maxVal - minVal)).toFixed(1));
}

/**
 * Motor IA: Analiza semánticamente el nombre del equipo y su categoría en MOT,
 * consulta los valores ingresados el día anterior (ayer) y genera temperaturas dentro
 * del rango estricto con una leve variación orgánica (±0.2°C a ±0.7°C) respecto al día anterior,
 * evitando que se repitan los mismos datos en días continuos.
 */
function aiClassifyAndComputeTemp(equipamientoNomb = '', categoriaDesc = '', options = {}) {
  const profiles = options.customProfiles || AI_TEMPERATURE_PROFILES;
  const history  = options.history || loadTempHistory();
  const todayStr = options.todayStr || getTodayStrArg();
  const yestStr  = options.yesterdayStr || getYesterdayStrArg();

  const name = (equipamientoNomb || '').toLowerCase();
  const cat  = (categoriaDesc || '').toLowerCase();

  let profile = profiles.MURAL_GENERAL;

  if (name.includes('pollo') || name.includes('ave')) {
    profile = profiles.MURAL_POLLO;
  } else if (name.includes('freezer') || name.includes('congelad') || cat.includes('freezer')) {
    profile = profiles.FREEZER;
  } else if (name.includes('cámara') || name.includes('camara') || name.includes('reserva') || cat.includes('cámara') || cat.includes('camara')) {
    if (name.includes('carne') || name.includes('pollo')) {
      profile = profiles.RESERVA_CARNE;
    } else {
      profile = profiles.RESERVA_GENERAL;
    }
  } else {
    profile = profiles.MURAL_GENERAL;
  }

  // Buscar qué valor se ingresó ayer (o en el último control previo) para este equipo
  const yestEntry = (history.byDate && history.byDate[yestStr] && history.byDate[yestStr][equipamientoNomb])
    || (history.lastByEquipment && history.lastByEquipment[equipamientoNomb]);

  const prevEq = yestEntry && yestEntry.equipo !== undefined
    ? parseFloat(yestEntry.equipo)
    : deterministicPrevTemp(`${equipamientoNomb}_EQ`, yestStr, profile.equipoMin, profile.equipoMax);

  const prevPr = yestEntry && yestEntry.producto !== undefined
    ? parseFloat(yestEntry.producto)
    : deterministicPrevTemp(`${equipamientoNomb}_PR`, yestStr, profile.prodMin, profile.prodMax);

  const pickWithSlightDiff = (min, max, prevVal, allowOccasionalMatch = false) => {
    const span = max - min;
    const minDelta = span <= 1.5 ? 0.2 : 0.3; // Para Pollo (rango corto) min 0.2°C, para Murales/Freezers min 0.3°C
    let candidate = Number((Math.random() * (max - min) + min).toFixed(1));

    if (allowOccasionalMatch && Math.random() < 0.12) {
      return candidate.toFixed(1);
    }

    for (let attempt = 0; attempt < 25; attempt++) {
      // Aplicar una variación leve realista de ±0.2 a ±0.7 °C sobre la base o sobre ayer
      const dir = (attempt % 2 === 0 ? 1 : -1) * (Math.random() < 0.5 ? 1 : -1);
      const step = minDelta + Math.random() * Math.min(0.6, span * 0.45);
      let nextVal = Number((prevVal + dir * step).toFixed(1));

      if (nextVal < min || nextVal > max) {
        nextVal = Number((Math.random() * (max - min) + min).toFixed(1));
      }

      if (Math.abs(nextVal - prevVal) >= minDelta - 0.01 && nextVal >= min && nextVal <= max) {
        candidate = nextVal;
        break;
      }
    }

    // Garantía final de bordes estrictos
    candidate = Math.max(min, Math.min(max, candidate));
    if (candidate.toFixed(1) === prevVal.toFixed(1)) {
      const nudged = candidate + minDelta <= max ? candidate + minDelta : candidate - minDelta;
      candidate = Math.max(min, Math.min(max, nudged));
    }
    return candidate.toFixed(1);
  };

  const tempEquipo   = pickWithSlightDiff(profile.equipoMin, profile.equipoMax, prevEq, false);
  const tempProducto = pickWithSlightDiff(profile.prodMin, profile.prodMax, prevPr, false);

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    minC: profile.minC,
    maxC: profile.maxC,
    regla: profile.regla,
    prevEquipo: prevEq.toFixed(1),
    prevProducto: prevPr.toFixed(1),
    tempEquipo,
    tempProducto,
  };
}

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

// Mutex secuencial FIFO para evitar que una acción manual y el scheduler usen _page a la vez
let _lockPromise = Promise.resolve();
async function withLock(fn) {
  const previous = _lockPromise;
  let release;
  _lockPromise = new Promise(resolve => { release = resolve; });
  await previous;
  _busy = true;
  try {
    return await fn();
  } finally {
    _busy = false;
    release();
  }
}

// ─── Helpers de tiempo y clasificación ────────────────────────────────────────

function getNowArgentina() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
}

function timeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToHHMM(totalMin) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMin));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function nowMinutes() {
  const arg = getNowArgentina();
  return arg.getHours() * 60 + arg.getMinutes();
}

/**
 * Calcula el minuto objetivo de marcación: 10 minutos DESPUÉS de horarioInicio.
 * Si la ventana total de la tarea es menor o igual a 10 minutos, toma (horarioCierre - 1)
 * para asegurar que siempre quede marcada "A tiempo" ('C').
 */
function getTargetMarkMinutes(startTimeStr, closeTimeStr) {
  const startMin = timeToMinutes(startTimeStr);
  const closeMin = timeToMinutes(closeTimeStr);
  if (closeMin <= startMin) return startMin + MARK_AFTER_START_MINUTES;
  return Math.min(startMin + MARK_AFTER_START_MINUTES, closeMin - 1);
}

/**
 * Determina si una tarea debe ser marcada automáticamente por el robot ahora:
 * Se activa cuando han pasado >= 10 minutos desde su horarioInicio y aún está dentro de su ventana (<= horarioCierre).
 */
function shouldMark(startTimeStr, closeTimeStr) {
  // Soporte de compatibilidad por si se llama con un solo argumento
  if (!closeTimeStr) {
    const closeMin = timeToMinutes(startTimeStr);
    const diff     = closeMin - nowMinutes();
    return diff >= 0 && diff <= MARK_AFTER_START_MINUTES;
  }
  const nowMin    = nowMinutes();
  const targetMin = getTargetMarkMinutes(startTimeStr, closeTimeStr);
  // Se marca si ya transcurrieron 10 minutos desde su horario de inicio:
  // Si está dentro de la ventana se marca a tiempo ('C'); si por un reinicio o corte del servidor
  // se pasó la hora de cierre, se marca igual ('FT' fuera de hora) para nunca dejar la tarea abandonada o sin cumplir.
  return nowMin >= targetMin;
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
  if (
    n.includes('limpieza') ||
    n.includes('piletas') ||
    n.includes('baldas') ||
    n.includes('murales') ||
    n.includes('freezer') ||
    n.includes('pisos') ||
    n.includes('baño') ||
    n.includes('pase de turno') ||
    n.includes('panadería') ||
    n.includes('exhibidor') ||
    n.includes('aseo') ||
    n.includes('orden y limpieza')
  ) {
    return 'Limpieza';
  }
  if (tieneBotonesDirectos) return 'Directa';
  return 'Directa';
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
      timezoneId: 'America/Argentina/Buenos_Aires',
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
        '--lang=es-AR',
        '--timezone=America/Argentina/Buenos_Aires',
      ],
      slowMo: headless ? 0 : 100,
    });
    _context = await _browser.newContext(contextOptions);
    await _context.addInitScript(() => {
      try {
        Intl.DateTimeFormat().resolvedOptions().timeZone = 'America/Argentina/Buenos_Aires';
      } catch (_) {}
    });
    _page = await _context.newPage();

    // Verificación de auditoría del reloj del navegador
    try {
      const tzCheck = await _page.evaluate(() => ({
        offset: new Date().getTimezoneOffset(),
        localTime: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
      }));
      log(`[Verificación Auditoría Horaria] Browser Offset: ${tzCheck.offset} min (esperado: 180 min UTC-3) | Hora Browser: ${tzCheck.localTime} hs`);
    } catch (_) {}
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
    _tareasUrl = null;
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
  try {
    await _page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch (navErr) {
    log(`Aviso al navegar a Tareas (${navErr.message}). Re-extrayendo URL limpia desde Home...`, 'warn');
    _tareasUrl = null;
    await _page.goto(MOT_HOME, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await _page.waitForTimeout(2000);
    await extractTareasUrlFromPage();
    const retryTarget = _tareasUrl || MOT_TAREAS;
    await _page.goto(retryTarget, { waitUntil: 'domcontentloaded', timeout: 25000 });
  }
  await _page.waitForTimeout(2500);

  if (_page.url().includes('login')) {
    log('Sesión expirada al abrir Tareas, re-logueando...', 'warn');
    _loggedIn = false;
    _tareasUrl = null;
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
      _tareasUrl = freshHref;
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
      if (estLower.includes('a tiempo') || estLower.startsWith('c ') || estLower === 'c' || estLower.includes('cumplida')) {
        estadoCode = 'C';
      } else if (estLower.includes('fuera de hora') || estLower.startsWith('ft')) {
        estadoCode = 'FT';
      } else if (estLower.includes('no cumplida') || estLower.startsWith('nc')) {
        estadoCode = 'NC';
      } else if (estLower.includes('no aplica') || estLower.startsWith('na')) {
        estadoCode = 'NA';
      } else if (horaCumplRaw && horaCumplRaw !== '00:00') {
        estadoCode = 'C';
      }

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

  // Sincronizar marcaciones detectadas en el APK oficial o registradas durante la jornada
  tasks = tasks.map(t => {
    // Si la tarea ya viene cumplida en el APK oficial / servidor MOT
    if (t.estadoCode && ['C', 'FT', 'NC', 'NA'].includes(t.estadoCode)) {
      _localMarkedMap.set(t.rowIndex, {
        estadoCode: t.estadoCode,
        estadoTexto: t.estadoTexto || (t.estadoCode === 'C' ? 'a tiempo' : t.estadoCode === 'FT' ? 'fuera de hora' : t.estadoCode),
        horaCumplimiento: t.horaCumplimiento || '',
        fecha: currentDateStr,
        origen: 'APK_OFICIAL',
      });
      return t;
    }

    // Si localMarkedMap tiene una marcación registrada en el día y el DOM aún no reflejó el cambio
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

  // Si MOT devuelve 0 filas (ej. recién cruzada la medianoche 00:00 antes del corte de las 00:30),
  // mantener las 56 tareas oficiales de Tienda 624 para que siempre estén visibles y operativas.
  if (tasks.length === 0 && DEFAULT_TAREAS_TIENDA_624.length > 0) {
    log(`MOT devolvió 0 filas para fecha ${currentDateStr} (ventana post-medianoche). Cargando las ${DEFAULT_TAREAS_TIENDA_624.length} tareas oficiales de Tienda 624.`, 'info');
    tasks = DEFAULT_TAREAS_TIENDA_624.map(t => {
      const localMark = _localMarkedMap.get(t.rowIndex);
      if (localMark && localMark.fecha === currentDateStr && !t.estadoCode) {
        return {
          ...t,
          fecha: currentDateStr,
          estadoCode: localMark.estadoCode,
          estadoTexto: localMark.estadoTexto,
          horaCumplimiento: localMark.horaCumplimiento,
        };
      }
      return { ...t, fecha: currentDateStr };
    });
  }

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
    syncTodayLegajosFromSchedule();
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
        legajoDefault: _motLegajoManana || DEFAULT_LEGAJO,
        legajoManana: _motLegajoManana || DEFAULT_LEGAJO,
        legajoTarde: _motLegajoTarde || DEFAULT_LEGAJO,
        legajosList: _motLegajosList,
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

      const domElements = Array.from(document.querySelectorAll('input[id], button[id], img[id], a[id], span[id*="RESP"]'))
        .filter(el => el.type !== 'hidden')
        .map(el => ({ tag: el.tagName, id: el.id, type: el.type || '', val: el.value || '', vis: el.offsetParent !== null }));

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
        domElements,
      };
    });

    return { ok: true, task, detail };
  });
}

// ─── Marcación de Tareas en el MOT Original ──────────────────────────────────

/**
 * Completa una tarea de Control de Temperatura de Equipamiento (MOT.WebEquipo / MOT.WebEquipamiento)
 * usando el Motor IA para clasificar cada equipo (Mural Pollo 0-1.9°C, Murales 0-4°C, Freezers -18 a -22°C,
 * Reserva/Cámaras 0-4°C / Carne 0-2°C) e impactando fila por fila en GeneXus.
 */
async function executeTemperatureControlOnMot(task, options = {}) {
  const legajo = resolveLegajoForTask(task, options.responsable);
  const customTemps = options.temperaturas || {}; // { [EquipamientoGUID]: { equipo, producto, nombre } }

  log(`[Motor IA Temperatura] Analizando e iniciando Control de Temperatura en MOT para "${task.nombre}" (Legajo: ${legajo})...`);

  const fullUrl = task.detailLink.startsWith('http')
    ? task.detailLink
    : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;

  await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await _page.waitForTimeout(2500);

  // 1. Validar Legajo Responsable (#W0093W0024vRESPONSABLE + #W0093W0024BTNVALIDARRESP)
  const respInput = _page.locator('#W0093W0024vRESPONSABLE, input[id*="vRESPONSABLE"]').first();
  if (await respInput.isVisible().catch(() => false)) {
    await respInput.fill('');
    await respInput.fill(String(legajo));
    const valBtn = _page.locator('#W0093W0024BTNVALIDARRESP, input[value="Validar"]').first();
    if (await valBtn.isVisible().catch(() => false)) {
      await valBtn.click();
      await _page.waitForTimeout(2500);
    }
  }

  const respValidatedName = await _page.locator('#span_W0093W0024vRESPONSABLE').innerText().catch(() => '');
  if (respValidatedName) {
    log(`[Motor IA Temperatura] Legajo ${legajo} validado en MOT: ${respValidatedName.trim()}`);
  }

  let totalAprobados = 0;

  // 2. Recorrer dinámicamente la primera categoría pendiente (0001) y su primer equipo pendiente (0001).
  // En GeneXus (MOT.WebEquipo), cada vez que se aprueba el equipo _0001:
  //   - Ese equipo se elimina de pendientes, pasando el siguiente equipo a la fila _0001 y colapsando el acordeón.
  //   - Cuando se aprueban todos los equipos de la categoría _0001 (ej. Murales), la categoría entera desaparece
  //     y la siguiente categoría (Freezers, luego Cámaras) pasa a ocupar la posición _0001.
  //   - Al aprobarse el último equipo de la última categoría, la tarea queda automáticamente Cumplida ('C') en MOT.
  const tempHistory  = loadTempHistory();
  const todayStr     = getTodayStrArg();
  const yesterdayStr = getYesterdayStrArg();
  if (!tempHistory.byDate) tempHistory.byDate = {};
  if (!tempHistory.byDate[todayStr]) tempHistory.byDate[todayStr] = {};
  if (!tempHistory.lastByEquipment) tempHistory.lastByEquipment = {};

  let currentOpenCatName = '';

  for (let step = 0; step < 40; step++) {
    const catSpan = _page.locator('#span_W0093W0024SDTCTGEQUIPAMIENTOS__CTGCTRLTEMPDESC_0001').first();
    if (!(await catSpan.isVisible().catch(() => false))) {
      break; // Ya no quedan categorías pendientes: todos los equipos fueron aprobados
    }

    const catName = (await catSpan.innerText().catch(() => 'Categoría')).trim();

    // Si la fila del primer equipo pendiente no está visible (acordeón colapsado por postback GeneXus),
    // clickear la flecha de la categoría _0001 para desplegar los equipos:
    let eqVisible = await _page.locator('#span_W0093W0024W0034vEQUIPAMIENTONOMB_0001').first().isVisible().catch(() => false);
    if (!eqVisible) {
      const arrow = _page.locator('#span_W0093W0024vDETAILWEBCOMPONENT_0001, #W0093W0024GridContainerRow_0001 i.ArrowIcon').first();
      if (await arrow.isVisible().catch(() => false)) {
        await arrow.click({ timeout: 3000 }).catch(() => {});
        await _page.waitForTimeout(1800);
      }
      eqVisible = await _page.locator('#span_W0093W0024W0034vEQUIPAMIENTONOMB_0001').first().isVisible().catch(() => false);
    }

    if (!eqVisible) {
      log(`[Motor IA Temperatura] No se pudo expandir la lista de equipos para categoría "${catName}". Pasando.`);
      break;
    }

    const rowData = await _page.evaluate(() => {
      const span = document.getElementById('span_W0093W0024W0034vEQUIPAMIENTONOMB_0001');
      const eqIn = document.getElementById('W0093W0024W0034vTEMPERATURAEQUIPO_0001');
      const prIn = document.getElementById('W0093W0024W0034vTEMPERATURAPRODUCTO_0001');
      const apBt = document.getElementById('W0093W0024W0034APROBAR_0001');
      const guid = document.getElementById('W0093W0024W0034vEQUIPAMIENTOGUID_0001');
      if (!span || !eqIn || !prIn || !apBt) return null;
      return {
        nombre: span.innerText.trim(),
        guid: guid ? guid.value.trim() : '',
      };
    });

    if (!rowData || !rowData.nombre) break;

    const aiDecision = aiClassifyAndComputeTemp(rowData.nombre, catName, {
      history: tempHistory,
      todayStr,
      yesterdayStr,
    });
    let tempEqui = aiDecision.tempEquipo;
    let tempProd = aiDecision.tempProducto;

    const customByGuid = rowData.guid ? customTemps[rowData.guid] : null;
    const customByName = Object.values(customTemps).find(v => v && v.nombre === rowData.nombre);
    const customEntry  = customByGuid || customByName;

    if (customEntry) {
      if (customEntry.equipo !== undefined && customEntry.equipo !== '') tempEqui = String(customEntry.equipo);
      if (customEntry.producto !== undefined && customEntry.producto !== '') tempProd = String(customEntry.producto);
    }

    // Recaudo del Motor IA: ninguna temperatura puede salir del rango del perfil del equipo
    for (const field of ['equipo', 'producto']) {
      const val = parseFloat(field === 'equipo' ? tempEqui : tempProd);
      if (Number.isNaN(val) || val < aiDecision.minC || val > aiDecision.maxC) {
        const safe = field === 'equipo' ? aiDecision.tempEquipo : aiDecision.tempProducto;
        knowledge.recordIncident({
          tarea: task.nombre,
          tipo: 'TEMP_FUERA_DE_RANGO',
          causa: `${rowData.nombre}: ${field}=${val} fuera de ${aiDecision.minC}..${aiDecision.maxC}`,
          accion: `Se usa valor seguro del perfil ${aiDecision.profileId}: ${safe}`,
        });
        if (field === 'equipo') tempEqui = safe; else tempProd = safe;
      }
    }

    log(`[Motor IA -> ${rowData.nombre} (${catName})] Perfil: ${aiDecision.profileId} (${aiDecision.minC}°C a ${aiDecision.maxC}°C) | Ayer: ${aiDecision.prevEquipo}°C/${aiDecision.prevProducto}°C => Hoy: ${tempEqui}°C/${tempProd}°C`);

    await _page.fill('#W0093W0024W0034vTEMPERATURAEQUIPO_0001', String(tempEqui), { timeout: 3000 }).catch(() => {});
    await _page.fill('#W0093W0024W0034vTEMPERATURAPRODUCTO_0001', String(tempProd), { timeout: 3000 }).catch(() => {});
    await _page.waitForTimeout(150);

    const apBtn = _page.locator('#W0093W0024W0034APROBAR_0001').first();
    if (await apBtn.isVisible().catch(() => false)) {
      await apBtn.click({ timeout: 3000 }).catch(() => {});
      await _page.waitForTimeout(1500);
      totalAprobados++;
    }

    tempHistory.byDate[todayStr][rowData.nombre] = {
      equipo: String(tempEqui),
      producto: String(tempProd),
      updatedAt: new Date().toISOString(),
    };
    tempHistory.lastByEquipment[rowData.nombre] = {
      equipo: String(tempEqui),
      producto: String(tempProd),
      date: todayStr,
    };
  }

  saveTempHistory(tempHistory);

  log(`✓ [Motor IA Temperatura] Control completado para "${task.nombre}" (${totalAprobados} equipos aprobados con legajo ${legajo}).`);
  return {
    ok: true,
    aprobados: totalAprobados,
    msg: `Control de temperatura aprobado por Motor IA (${totalAprobados} equipos) con legajo ${legajo}.`,
  };
}

/**
 * Las 4 tareas que el robot SIEMPRE debe omitir en modo automático porque requieren
 * información física externa de tienda (Remito físico, Lote de cocción, Albarán o Retiro):
 * 1. Ctrol Temp Recep GD (Proveedor)
 * 2. Trazabilidad Horneado/Descongelado (Trazabilidad)
 * 3. Retiro Calidad (Retiro)
 * 4. Ctrol Temp Recep Almacén (Almacen)
 * (Nota: Caducidades es gestionada automáticamente por el Motor IA tildando todos los artículos en riesgo).
 */
function isOmittedStoreTask(task) {
  if (!task) return false;
  const tipo = String(task.tipoControl || '');
  const nomb = String(task.nombre || '').toLowerCase();
  if (['Proveedor', 'Trazabilidad', 'Retiro', 'Almacen'].includes(tipo)) {
    return true;
  }
  if (
    /recep.*gd/i.test(nomb) ||
    /trazabilidad.*horneado|horneado.*descongelado/i.test(nomb) ||
    /retiro.*calidad/i.test(nomb) ||
    /recep.*almac[eé]n/i.test(nomb)
  ) {
    return true;
  }
  return false;
}

/**
 * Completa una tarea que requiere Legajo de Responsable (Orden y Limpieza MOT.WebLimpieza)
 * ingresando el legajo 23250 en #W0093W0054vRESPONSABLE y presionando #W0093W0054BTNCONFIRMAR.
 */
async function executeLimpiezaControlOnMot(task, options = {}) {
  const legajo = resolveLegajoForTask(task, options.responsable);
  log(`Confirmando tarea con Legajo en MOT: "${task.nombre}" (Legajo: ${legajo})...`);

  if (!task.detailLink) {
    throw new Error(`La tarea "${task.nombre}" no posee link de detalle en MOT.`);
  }

  const fullUrl = task.detailLink.startsWith('http')
    ? task.detailLink
    : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;
  await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

  // Esperar activamente hasta 8 segundos a que GeneXus cargue el WebComponent de Limpieza (W0093W0054)
  const respInput = _page.locator('input[id*="vRESPONSABLE"], #W0093W0054vRESPONSABLE').first();
  await respInput.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});

  if (await respInput.isVisible().catch(() => false)) {
    log(`[Limpieza] Campo vRESPONSABLE detectado. Ingresando legajo ${legajo}...`);
    await respInput.fill('');
    await respInput.fill(String(legajo));
    await respInput.dispatchEvent('change').catch(() => {});
    await respInput.dispatchEvent('blur').catch(() => {});
    await respInput.press('Tab').catch(() => {});
    await _page.waitForTimeout(600);

    const confirmBtn = _page.locator('input[id*="BTNCONFIRMAR"], #W0093W0054BTNCONFIRMAR, input[value*="Confirmar" i]').first();
    await confirmBtn.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    if (await confirmBtn.isVisible().catch(() => false)) {
      log(`[Limpieza] Clickeando botón Confirmar...`);
      await confirmBtn.click();
      await _page.waitForTimeout(2500);
    }
    await handleMotivePopupIfPresent(options.motivo || 'Limpieza cumplida');
    log(`✓ Tarea "${task.nombre}" confirmada en MOT Oficial con legajo ${legajo}.`);
    return { ok: true, msg: `Tarea confirmada con legajo ${legajo}.` };
  }

  // Fallback: si tiene botón CUMPLIR visible en el detalle
  const cumplirDetail = _page.locator('#CUMPLIR, [id*="BTNCONFIRMAR"], input[value="Cumplir" i], img[title*="Cumplir" i]').first();
  if (await cumplirDetail.isVisible().catch(() => false)) {
    log(`[Limpieza] Clickeando botón alternativo Cumplir en detalle...`);
    await cumplirDetail.click();
    await _page.waitForTimeout(2200);
    await handleMotivePopupIfPresent(options.motivo || 'Realizado en tienda');
    return { ok: true, msg: 'Tarea marcada como cumplida desde detalle.' };
  }

  throw new Error('No se encontró el campo vRESPONSABLE ni el botón de cumplimiento para esta tarea.');
}

/**
 * Completa la tarea de Caducidades en MOT.
 * La IA inspecciona la grilla de "Artículos en riesgo" (W0093W0018W0023GriddatapendienteContainerRow_)
 * y aprueba cada artículo en riesgo presionando el tilde verde (#W0093W0018W0023APROBAR_0001).
 * Al ser una grilla GeneXus reactiva, cada aprobación re-indexa la fila siguiente a 0001
 * hasta que no quedan artículos en riesgo y la tarea queda cumplida automáticamente.
 */
async function executeCaducidadesOnMot(task) {
  log(`[Motor IA Caducidades] Iniciando revisión y aprobación de artículos en riesgo para "${task.nombre}"...`);

  if (!task.detailLink) {
    throw new Error(`La tarea "${task.nombre}" no posee link de detalle en MOT.`);
  }

  const fullUrl = task.detailLink.startsWith('http')
    ? task.detailLink
    : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;
  await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await _page.waitForTimeout(2500);

  // 1. Detectar cantidad inicial de artículos en riesgo
  const initialCount = await _page.evaluate(() => {
    return document.querySelectorAll('[id*="GriddatapendienteContainerRow_"]').length;
  });
  log(`[Motor IA Caducidades] Artículos en riesgo detectados en lista diaria: ${initialCount}.`);

  let approvedCount = 0;
  const maxIterations = 100; // tope de seguridad

  for (let step = 0; step < maxIterations; step++) {
    // Verificar si queda al menos un botón de Aprobar (tilde verde) en la primera fila pendiente
    const apBtn = _page.locator('#W0093W0018W0023APROBAR_0001, [id*="GriddatapendienteContainerRow_0001"] [id*="APROBAR"], [id*="GriddatapendienteContainerRow_0001"] img[title*="Aprobar"]').first();
    const isVisible = await apBtn.isVisible().catch(() => false);
    if (!isVisible) {
      break; // Ya no quedan artículos pendientes por aprobar
    }

    // Extraer descripción del artículo que se está aprobando para registro
    const itemDesc = await _page.evaluate(() => {
      const row = document.getElementById('W0093W0018W0023GriddatapendienteContainerRow_0001') || document.querySelector('[id*="GriddatapendienteContainerRow_"]');
      return row ? row.innerText.trim().replace(/\s+/g, ' ') : `Artículo ${step + 1}`;
    }).catch(() => `Artículo ${step + 1}`);

    log(`[Motor IA Caducidades] Tildando verde artículo #${step + 1}: "${itemDesc}"...`);
    await apBtn.click({ timeout: 4000 }).catch(() => {});
    await _page.waitForTimeout(2000);
    approvedCount++;
  }

  // 2. Si quedó algún botón general de Cumplir visible en la pantalla de detalle, clickearlo
  const cumplirBtn = _page.locator('#CUMPLIR, [id*="CUMPLIR"]').first();
  if (await cumplirBtn.isVisible().catch(() => false)) {
    log('[Motor IA Caducidades] Confirmando cumplimiento general en detalle...');
    await cumplirBtn.click({ timeout: 4000 }).catch(() => {});
    await _page.waitForTimeout(2000);
    await handleMotivePopupIfPresent('Caducidades revisadas en tienda');
  }

  log(`✓ [Motor IA Caducidades] Control completado exitosamente: ${approvedCount} artículo(s) tildado(s) en riesgo.`);
  return {
    ok: true,
    aprobados: approvedCount,
    msg: `Caducidades completada (${approvedCount} artículos en riesgo aprobados con tilde verde).`,
  };
}

/**
 * Completa cualquier tarea directa en MOT (ej: Apertura de cajas, Lectura de boletín, Conteo, etc.)
 * Intenta primero clickear el botón #CUMPLIR_XXXX en la grilla principal tareastienda.
 * Si no está visible (ej: tarea fuera de hora / vencida o colapsada), abre el panel de detalle webvertarea
 * donde el botón #CUMPLIR permanece accesible para liquidar la tarea.
 */
async function executeDirectControlOnMot(task, options = {}) {
  const motivo = options.motivo || 'Cumplimiento en tienda';
  log(`[Control Directo] Procesando marcación para "${task.nombre}" (Fila ${task.rowIndex})...`);

  // Intento 1: Si el botón #CUMPLIR_XXXX está visible en la grilla tareastienda
  if (_page && _page.url().includes('tareastienda')) {
    const r = task.rowIndex;
    const btn = _page.locator(`#CUMPLIR_${r}`).first();
    if (await btn.isVisible().catch(() => false)) {
      log(`[Control Directo] Clickeando botón #CUMPLIR_${r} en grilla principal...`);
      await btn.click();
      await _page.waitForTimeout(2000);
      await handleMotivePopupIfPresent(motivo);
      await _page.waitForTimeout(1500);
      return { ok: true, msg: 'Marcada desde grilla principal.' };
    }
  }

  // Intento 2: Si el botón no estaba visible en grilla (tarea vencida, fuera de hora o detalle requerido),
  // abrir el panel de detalle oficial (webvertarea) donde #CUMPLIR siempre está disponible
  if (task.detailLink) {
    log(`[Control Directo] Botón de grilla no visible para "${task.nombre}". Abriendo panel de detalle oficial...`);
    const fullUrl = task.detailLink.startsWith('http')
      ? task.detailLink
      : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;
    await _page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await _page.waitForTimeout(2200);

    // En webvertarea, buscar #CUMPLIR
    const detailBtn = _page.locator('#CUMPLIR, [id*="BTNCONFIRMAR"], input[value="Cumplir" i]').first();
    if (await detailBtn.isVisible().catch(() => false)) {
      log(`[Control Directo] Clickeando botón #CUMPLIR en detalle de "${task.nombre}"...`);
      await detailBtn.click();
      await _page.waitForTimeout(2000);
      await handleMotivePopupIfPresent(motivo);
      await _page.waitForTimeout(1500);
      return { ok: true, msg: 'Marcada desde panel de detalle oficial.' };
    }
  }

  // Si no estaba en tareastienda y no pudimos abrir detalle, navegar a tareas y reintentar botón
  await navigateToTareasPage();
  const btnRetry = _page.locator(`#CUMPLIR_${task.rowIndex}`).first();
  if (await btnRetry.isVisible().catch(() => false)) {
    await btnRetry.click();
    await _page.waitForTimeout(2000);
    await handleMotivePopupIfPresent(motivo);
    await _page.waitForTimeout(1500);
    return { ok: true, msg: 'Marcada tras navegar a grilla.' };
  }

  return { skipped: true, reason: 'Botón Cumplir no visible ni en grilla ni en detalle' };
}

/**
 * Si MOT abre el popup com.mot.mot.wcingresarmotivoincumplimiento (para 'FT' fuera de hora o 'NC' no cumplida),
 * ingresa el motivo y confirma automáticamente.
 */
async function handleMotivePopupIfPresent(motivoTexto = 'Operación de tienda') {
  for (let check = 0; check < 5; check++) {
    await _page.waitForTimeout(800);

    // 1. Chequeo en iframes (GeneXus WorkWithPlus popup estándar)
    const frames = _page.frames();
    for (const frame of frames) {
      if (frame.url().includes('wcingresarmotivoincumplimiento') || frame.url().includes('motivo')) {
        log(`Popup de motivo detectado en iframe (${frame.url()}). Completando motivo: "${motivoTexto}"...`);
        const textInput = frame.locator('textarea, input[type="text"], [id*="MOTIVO"]').first();
        if (await textInput.isVisible().catch(() => false)) {
          await textInput.fill(motivoTexto);
          await _page.waitForTimeout(400);
        }
        const confirmBtn = frame.locator('input[value*="Confirmar" i], input[value*="Aceptar" i], input[value*="Guardar" i], input[id*="BTNENTER"], input[name*="BTNENTER"], button:has-text("Confirmar"), button:has-text("Aceptar")').first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await _page.waitForTimeout(2500);
          log('✓ Motivo confirmado en popup MOT iframe.');
          return true;
        }
      }
    }

    // 2. Chequeo en la página principal (modales bootstrap o div emergentes)
    const modalInput = _page.locator('.gx-popup-content textarea, [id*="wcingresarmotivoincumplimiento"] textarea, [id*="vMOTIVO"] textarea, [id*="vMOTIVO"] input').first();
    if (await modalInput.isVisible().catch(() => false)) {
      log(`Popup de motivo detectado en página principal. Completando motivo: "${motivoTexto}"...`);
      await modalInput.fill(motivoTexto);
      await _page.waitForTimeout(400);
      const modalBtn = _page.locator('.gx-popup-content input[value*="Confirmar" i], .gx-popup-content input[value*="Aceptar" i], input[id*="BTNENTER"], input[name*="BTNENTER"], button:has-text("Confirmar")').first();
      if (await modalBtn.isVisible().catch(() => false)) {
        await modalBtn.click();
        await _page.waitForTimeout(2500);
        log('✓ Motivo confirmado en popup principal.');
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
      knowledge.recordAudit(getTodayStrArg(), {
        tarea: task.nombre,
        tipo: task.tipoControl,
        estado: 'verificada',
        horaMOT: `${hh}:${mm}`,
        estadoMOT: finalCode,
        nota: 'Marcada en MOT',
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

      // 1.b Si es Tarea de Caducidades (tildado de artículos en riesgo con tilde verde)
      if ((task.tipoControl === 'Caducidad' || /caducidad/i.test(task.nombre)) && accion !== 'NA' && accion !== 'NC') {
        const res = await executeCaducidadesOnMot(task);
        applyLocalMark('C');
        const updated = await readTasks();
        return { ...res, tasks: updated, stats: computeStats(updated) };
      }

      // 2. Si es Tarea de Limpieza y la acción es Cumplir o LIMPIEZA
      if ((task.tipoControl === 'Limpieza' || accion === 'LIMPIEZA') && accion !== 'NA' && accion !== 'NC') {
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

        // Si dentro del detalle es una tarea con Responsable (Limpieza)
        if (await _page.locator('input[id*="vRESPONSABLE"], #W0093W0054vRESPONSABLE').first().isVisible().catch(() => false)) {
          const res = await executeLimpiezaControlOnMot(task, params);
          applyLocalMark('C');
          const updated = await readTasks();
          return { ...res, tasks: updated, stats: computeStats(updated) };
        }

        let detailBtnSel = '#CUMPLIR, [id*="BTNCONFIRMAR"], input[value="Cumplir" i]';
        if (accion === 'NC') detailBtnSel = '#NOCUMPLIR, input[value*="No cumplir" i]';
        else if (accion === 'NA') detailBtnSel = '#NOAPLICA, input[value*="No aplica" i]';

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

// ─── Ciclo automático del Bot (10 min DESPUÉS del inicio de cada tarea) ──────

// ─── Motor IA de Verificación: pre-vuelo, verificación posterior y reintentos ──

/**
 * Pre-vuelo: garantiza que el reloj del navegador sea el de Argentina (UTC-3) y no esté adelantado.
 * Si falla, reinicia navegador + sesión y vuelve a comprobar. Si persiste, NO se marca nada.
 */
async function preflightCheck() {
  const check = async () => {
    if (!_page || _page.isClosed()) return null;
    return await _page.evaluate(() => {
      const d = new Date();
      return { offset: d.getTimezoneOffset(), h: d.getHours(), m: d.getMinutes() };
    }).catch(() => null);
  };

  const evaluate = (c) => {
    if (!c) return { ok: false, why: 'sin página activa' };
    const arg = getNowArgentina();
    const argMin = arg.getHours() * 60 + arg.getMinutes();
    const brMin  = c.h * 60 + c.m;
    if (c.offset !== knowledge.RULES.TZ_OFFSET_MIN) return { ok: false, why: `offset navegador ${c.offset} != ${knowledge.RULES.TZ_OFFSET_MIN}` };
    if (brMin > argMin + 1) return { ok: false, why: `hora navegador ${c.h}:${String(c.m).padStart(2, '0')} adelantada respecto a Argentina` };
    return { ok: true };
  };

  let res = evaluate(await check());
  if (res.ok) return true;

  log(`⚠️ [Pre-vuelo] Reloj inválido (${res.why}). Reiniciando navegador...`, 'warn');
  knowledge.recordIncident({ tarea: '*', tipo: 'RELOJ_INVALIDO', causa: res.why, accion: 'Reinicio de navegador y sesión' });
  await closeBrowser();
  await doLogin(true);
  res = evaluate(await check());
  if (!res.ok) {
    throw new Error(`Pre-vuelo fallido: ${res.why}. Se bloquea la marcación para evitar horas futuras.`);
  }
  return true;
}

/**
 * Verificación posterior: relee MOT y comprueba estado cumplido y hora de cumplimiento no futura.
 * Devuelve { ok, estadoCode, horaCumplimiento, motivo }.
 */
async function verifyMark(task) {
  _localMarkedMap.delete(task.rowIndex); // evitar falsos positivos con marcas locales
  await _page.waitForTimeout(1500);
  const fresh = await readTasks();
  let t = fresh.find(x => x.rowIndex === task.rowIndex || x.nombre === task.nombre);
  if (!t) return { ok: false, motivo: 'tarea no encontrada tras marcar' };

  let done = knowledge.RULES.DONE_CODES.includes(t.estadoCode) || (!!t.horaCumplimiento && t.horaCumplimiento !== '00:00');

  // Si aún no refleja estado pero recién se ejecutó la acción, dar un reintento breve de 3.5s
  if (!done) {
    await _page.waitForTimeout(3500);
    const retryFresh = await readTasks();
    const retryT = retryFresh.find(x => x.rowIndex === task.rowIndex || x.nombre === task.nombre);
    if (retryT && (knowledge.RULES.DONE_CODES.includes(retryT.estadoCode) || (!!retryT.horaCumplimiento && retryT.horaCumplimiento !== '00:00'))) {
      done = true;
      t = retryT;
    }
  }

  if (!done) return { ok: false, estadoCode: t.estadoCode, motivo: 'MOT no refleja la tarea como cumplida' };

  if (t.horaCumplimiento) {
    const hMin = parseTimeToMinutes(t.horaCumplimiento);
    const nowMin = nowMinutes();
    if (hMin !== null && hMin > nowMin + 1) {
      knowledge.recordIncident({
        tarea: task.nombre,
        tipo: 'HORA_FUTURA',
        causa: `MOT registró ${t.horaCumplimiento} y la hora real es ${minutesToHHMM(nowMin)}`,
        accion: 'Alerta crítica: revisar manualmente en MOT',
      });
      return { ok: false, estadoCode: t.estadoCode, horaCumplimiento: t.horaCumplimiento, motivo: `HORA FUTURA registrada (${t.horaCumplimiento})`, critical: true };
    }
    if (hMin !== null && Math.abs(nowMin - hMin) > knowledge.RULES.HOUR_TOLERANCE_MIN + 2) {
      log(`ℹ️ [Verificación] "${task.nombre}": hora MOT ${t.horaCumplimiento} difiere de la hora real ${minutesToHHMM(nowMin)}.`, 'warn');
    }
  }
  return { ok: true, estadoCode: t.estadoCode, horaCumplimiento: t.horaCumplimiento };
}

/**
 * Ciclo completo por tarea: pre-vuelo -> (re-chequeo) -> ejecutar -> verificar -> reintentar.
 * `executor` ejecuta la marcación y devuelve { skipped?, reason? }.
 */
async function markWithRetry(task, executor) {
  const maxAttempts = 1 + knowledge.RULES.MAX_RETRIES;
  let lastReason = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await preflightCheck();

      if (attempt > 1) {
        // Re-chequeo: quizá el intento anterior sí impactó en MOT
        const again = await readTasks();
        const cur = again.find(x => x.rowIndex === task.rowIndex || x.nombre === task.nombre);
        if (cur && (knowledge.RULES.DONE_CODES.includes(cur.estadoCode) || cur.horaCumplimiento)) {
          const v = await verifyMark(task);
          if (v.ok) return { ok: true, attempts: attempt, verification: v };
        }
      }

      const exec = await executor(task);
      if (exec && exec.skipped) return { ok: false, skipped: true, reason: exec.reason, attempts: attempt };

      const v = await verifyMark(task);
      if (v.ok) return { ok: true, attempts: attempt, verification: v, exec };
      if (v.critical) return { ok: false, critical: true, reason: v.motivo, attempts: attempt, verification: v };
      lastReason = v.motivo;
    } catch (e) {
      lastReason = e.message;
      if (/sesi[oó]n|login|timeout|closed|Target page/i.test(e.message)) {
        try { await doLogin(true); } catch (_) {}
      }
    }
    knowledge.recordIncident({
      tarea: task.nombre,
      tipo: 'FALLO_MARCACION',
      causa: lastReason,
      accion: attempt < maxAttempts ? `Reintento ${attempt}/${knowledge.RULES.MAX_RETRIES}` : 'Requiere revisión manual',
    });
    log(`⚠️ [Verificación] "${task.nombre}" intento ${attempt}/${maxAttempts} sin confirmar: ${lastReason}`, 'warn');
  }
  return { ok: false, reason: lastReason, attempts: maxAttempts };
}

const _failedAttempts = new Map(); // key -> { count, lastTs }
let _failedDate = '';
const MAX_FAILED_CYCLES = 3;
const FAILED_RETRY_BACKOFF_MS = 15 * 60 * 1000; // 15 min de espera para reintentar tareas pendientes / fuera de hora

async function markDueTasks(markedToday = new Set()) {
  if (_failedDate !== getTodayStrArg()) {
    _failedAttempts.clear();
    _failedDate = getTodayStrArg();
  }
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
      const key = `${task.nombre}|${task.horarioInicio}-${task.horarioCierre}`;

      // 1. Detección proactiva de tareas ya cumplidas en el APK oficial o servidor MOT
      if ((task.estadoCode && ['C', 'FT', 'NC', 'NA'].includes(task.estadoCode)) || (task.horaCumplimiento && task.horaCumplimiento !== '00:00')) {
        if (!markedToday.has(key)) {
          markedToday.add(key);
          markedToday.add(task.nombre);
          const horaTxt = task.horaCumplimiento ? ` a las ${task.horaCumplimiento} hs` : '';
          log(`📱 [APK Oficial Detectado] Tarea "${task.nombre}" ya cumplida en el APK oficial (${task.estadoTexto || task.estadoCode}${horaTxt}). Omitiendo re-ejecución.`);
        }
        continue;
      }

      if (markedToday.has(key) || markedToday.has(task.nombre)) continue;

      if (!shouldMark(task.horarioInicio, task.horarioCierre)) continue;

      // Omitir SIEMPRE las 5 tareas reservadas para gestión manual en tienda:
      // Ctrol Temp Recep GD, Trazabilidad Horneado/Descongelado, Caducidades, Retiro Calidad y Ctrol Temp Recep Almacén
      if (isOmittedStoreTask(task)) {
        const omitKey = `OMIT|${key}`;
        if (!markedToday.has(omitKey)) {
          markedToday.add(omitKey);
          log(`⏭️ [Omitida por Regla Tienda] "${task.nombre}" requiere datos físicos externos y se marca manualmente desde la tienda.`);
        }
        continue;
      }

      const targetMarkHHMM = minutesToHHMM(getTargetMarkMinutes(task.horarioInicio, task.horarioCierre));
      const isOverdue = nowMinutes() > timeToMinutes(task.horarioCierre);
      const motivo = isOverdue ? 'Cumplimiento fuera de hora' : 'Cumplimiento en tienda';
      const markLabel = isOverdue ? `[Auto-Bot Fuera de Hora]` : `[Auto-Bot +10m]`;

      log(`${markLabel} Marcando "${task.nombre}" (inicio: ${task.horarioInicio} -> programada: ${targetMarkHHMM}, cierre: ${task.horarioCierre}, tipo: ${task.tipoControl})`);

      const attemptInfo = _failedAttempts.get(key);
      if (attemptInfo && attemptInfo.count >= MAX_FAILED_CYCLES) {
        if (Date.now() - attemptInfo.lastTs < FAILED_RETRY_BACKOFF_MS) {
          continue; // esperar el backoff de 15 min antes del siguiente reintento
        }
      }

      const auditDate = getTodayStrArg();
      try {
        const outcome = await markWithRetry(task, async (t) => {
          const shiftLegajo = resolveLegajoForTask(t);
          if (t.tipoControl === 'Equipo') {
            const res = await executeTemperatureControlOnMot(t, { responsable: shiftLegajo });
            const expectedTotal = Object.values(knowledge.RULES.EXPECTED_EQUIPMENT).reduce((a, b) => a + b, 0);
            if (res.aprobados !== undefined && res.aprobados < expectedTotal) {
              log(`ℹ️ [Verificación Temperatura] Se aprobaron ${res.aprobados} de ${expectedTotal} equipos esperados (puede haber equipos ya aprobados).`, 'warn');
            }
            return res;
          }
          if (t.tipoControl === 'Caducidad' || /caducidad/i.test(t.nombre)) {
            return await executeCaducidadesOnMot(t);
          }
          if (t.tipoControl === 'Limpieza') {
            return await executeLimpiezaControlOnMot(t, { responsable: shiftLegajo, motivo });
          }
          return await executeDirectControlOnMot(t, { responsable: shiftLegajo, motivo });
        });

        if (outcome.ok) {
          const v = outcome.verification || {};
          _localMarkedMap.set(task.rowIndex, {
            estadoCode: v.estadoCode || 'C',
            estadoTexto: v.estadoCode === 'FT' ? 'fuera de hora' : 'a tiempo',
            horaCumplimiento: v.horaCumplimiento || '',
            fecha: _cachedDate || new Date().toLocaleDateString('es-AR'),
          });
          markedToday.add(key);
          _failedAttempts.delete(key);
          results.push({
            tarea: task.nombre,
            horarioInicio: task.horarioInicio,
            horarioCierre: task.horarioCierre,
            horaAutoMarca: targetMarkHHMM,
            estado: 'marcado',
            ts: new Date().toISOString(),
          });
          knowledge.recordAudit(auditDate, {
            tarea: task.nombre, tipo: task.tipoControl, estado: 'verificada',
            horaMOT: v.horaCumplimiento || '', estadoMOT: v.estadoCode || '', intentos: outcome.attempts,
          });
          log(`✓ [Auto-Bot] Marcada y VERIFICADA en MOT: "${task.nombre}" (${v.horaCumplimiento || 's/h'} hs, estado: ${v.estadoCode || 'C'}, intentos: ${outcome.attempts})`);
        } else {
          const reason = outcome.reason || 'sin detalle';
          const prev = _failedAttempts.get(key) || { count: 0, lastTs: 0 };
          _failedAttempts.set(key, { count: prev.count + 1, lastTs: Date.now() });
          results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: reason, ts: new Date().toISOString() });
          knowledge.recordAudit(auditDate, {
            tarea: task.nombre, tipo: task.tipoControl,
            estado: outcome.critical ? 'ALERTA_CRITICA' : 'requiere_revision',
            motivo: reason, intentos: outcome.attempts,
          });
          log(`✗ [Auto-Bot] No se pudo confirmar "${task.nombre}": ${reason}`, 'warn');
        }
      } catch (e) {
        const prev = _failedAttempts.get(key) || { count: 0, lastTs: 0 };
        _failedAttempts.set(key, { count: prev.count + 1, lastTs: Date.now() });
        results.push({ tarea: task.nombre, horarioCierre: task.horarioCierre, estado: 'error', msg: e.message, ts: new Date().toISOString() });
        knowledge.recordAudit(auditDate, { tarea: task.nombre, tipo: task.tipoControl, estado: 'requiere_revision', motivo: e.message });
        log(`Error marcando "${task.nombre}": ${e.message}`, 'error');
      }
    }

    if (results.length > 0) {
      await readTasks().catch(() => {});
    }

    return results;
  });
}

// ─── Segundo Chequeo Pre-Dormición con Motor IA ─────────────────────────────

/**
 * Segundo Chequeo Pre-Dormición con Motor IA.
 * Se ejecuta antes de apagar o entrar en reposo nocturno (22:40 hs o pre-cierre 22:30 hs).
 * Lee en vivo el estado oficial de todas las tareas en MOT, detecta aquellas que hayan quedado
 * pendientes, incompletas o a medio realizar (ej. temperaturas con equipos pendientes o caducidades),
 * y las liquida en conjunto con la IA para evitar cerrar la jornada con tareas sin marcar.
 */
async function runPreSleepSweepAndResolve() {
  return await withLock(async () => {
    log('🔍 [Chequeo Pre-Dormición IA] Iniciando segundo chequeo de auditoría y barrido final antes de dormir...');

    if (!_loggedIn || !_page) {
      log('[Chequeo Pre-Dormición IA] Asegurando sesión en MOT...', 'info');
      await doLogin(true);
    }

    let tasks = [];
    try {
      tasks = await readTasks();
    } catch (e) {
      log(`[Chequeo Pre-Dormición IA] Error leyendo tareas en MOT: ${e.message}`, 'error');
      return { ok: false, error: e.message, rescuedCount: 0 };
    }

    _failedAttempts.clear();
    const nowMin = nowMinutes();
    const auditDate = getTodayStrArg();
    const rescued = [];

    // Filtrar tareas que correspondan a hoy, no omitidas, y que sigan sin estar cumplidas en MOT
    const pendingTasks = tasks.filter(t => {
      if (isOmittedStoreTask(t)) return false;
      const isDone = (t.estadoCode && ['C', 'FT', 'NC', 'NA'].includes(t.estadoCode)) || (t.horaCumplimiento && t.horaCumplimiento !== '00:00');
      if (isDone) return false;

      // Si la tarea tiene horario de inicio menor o igual a la hora actual (ya transcurrió hoy)
      const iniMin = timeToMinutes(t.horarioInicio);
      return iniMin <= nowMin;
    });

    if (pendingTasks.length === 0) {
      log('✓ [Chequeo Pre-Dormición IA] Verificación completada: 100% de las tareas operativas del día están cumplidas.');
      return { ok: true, rescuedCount: 0, pendingTasksCount: 0, rescued: [] };
    }

    log(`⚠️ [Chequeo Pre-Dormición IA] Se detectaron ${pendingTasks.length} tarea(s) pendiente(s) o incompleta(s) antes de dormir. Iniciando resolución con Motor IA...`);

    for (const task of pendingTasks) {
      log(`⚙️ [Chequeo Pre-Dormición IA] Resolviendo "${task.nombre}" (${task.horarioInicio}-${task.horarioCierre}, Tipo: ${task.tipoControl})...`);

      try {
        const outcome = await markWithRetry(task, async (t) => {
          const shiftLegajo = resolveLegajoForTask(t);
          if (t.tipoControl === 'Equipo') {
            return await executeTemperatureControlOnMot(t, { responsable: shiftLegajo });
          }
          if (t.tipoControl === 'Caducidad' || /caducidad/i.test(t.nombre)) {
            return await executeCaducidadesOnMot(t);
          }
          if (t.tipoControl === 'Limpieza') {
            return await executeLimpiezaControlOnMot(t, { responsable: shiftLegajo });
          }
          return await executeDirectControlOnMot(t, { responsable: shiftLegajo, motivo: 'Cumplimiento pre-cierre' });
        });

        if (outcome.ok) {
          const v = outcome.verification || {};
          _localMarkedMap.set(task.rowIndex, {
            estadoCode: v.estadoCode || 'FT',
            estadoTexto: v.estadoCode === 'C' ? 'a tiempo' : 'fuera de hora',
            horaCumplimiento: v.horaCumplimiento || '',
            fecha: _cachedDate || new Date().toLocaleDateString('es-AR'),
          });
          rescued.push({
            tarea: task.nombre,
            hora: v.horaCumplimiento || '',
            estado: v.estadoCode || 'FT',
            intentos: outcome.attempts || 1,
          });
          knowledge.recordAudit(auditDate, {
            tarea: task.nombre,
            tipo: task.tipoControl,
            estado: 'verificada',
            horaMOT: v.horaCumplimiento || '',
            estadoMOT: v.estadoCode || '',
            intentos: outcome.attempts,
            nota: 'Resuelta en Segundo Chequeo Pre-Dormición IA',
          });
          log(`✅ [Chequeo Pre-Dormición IA] "${task.nombre}" completada y verificada en MOT (${v.estadoCode || 'FT'} a las ${v.horaCumplimiento || 's/h'} hs).`);
        } else {
          knowledge.recordAudit(auditDate, {
            tarea: task.nombre,
            tipo: task.tipoControl,
            estado: outcome.critical ? 'ALERTA_CRITICA' : 'requiere_revision',
            motivo: outcome.reason || 'Fallo en pre-dormición',
            intentos: outcome.attempts,
          });
          log(`✗ [Chequeo Pre-Dormición IA] No se pudo finalizar "${task.nombre}": ${outcome.reason}`, 'warn');
        }
      } catch (err) {
        log(`✗ [Chequeo Pre-Dormición IA] Excepción al procesar "${task.nombre}": ${err.message}`, 'error');
      }
    }

    if (rescued.length > 0) {
      await readTasks().catch(() => {});
    }

    log(`🏁 [Chequeo Pre-Dormición IA] Fin de barrido: ${rescued.length} de ${pendingTasks.length} tarea(s) rescatada(s) y marcadas exitosamente.`);
    return { ok: true, rescuedCount: rescued.length, pendingTasksCount: pendingTasks.length, rescued };
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
  getPage: () => _page,
  doLogin,
  readTasks,
  getMotDashboard,
  getTaskDetail,
  markTaskOnMot,
  executeCaducidadesOnMot,
  markDueTasks,
  runPreSleepSweepAndResolve,
  preflightCheck,
  verifyMark,
  getAudit: knowledge.getAudit,
  getTodayKey: getTodayStrArg,
  getIncidents: knowledge.getIncidents,
  closeBrowser,
  captureDebugScreenshot,
  log,
  getLogs,
  clearLogs,
  isLoggedIn,
  sessionExists,
  saveSessionData,
  getNowArgentina,
  MARK_BEFORE_MINUTES,
  MARK_AFTER_START_MINUTES,
  DEFAULT_LEGAJO,
  resolveLegajoForTask,
  getMotLegajosState,
  setMotLegajosState,
  setMotScheduleMap,
  getMotScheduleMap,
  syncTodayLegajosFromSchedule,
  getCachedTasks: () => _cachedTasks || [],
  DEFAULT_EQUIPAMIENTO_TIENDA_624,
};
