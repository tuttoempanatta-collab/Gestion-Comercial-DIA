/**
 * mot_scheduler.js
 * Scheduler que corre cada 60 segundos y llama al bot de marcación MOT.
 * Además expone las funciones de sincronización en vivo de tareas, detalle y marcación manual/directa.
 */

const {
  doLogin,
  getMotDashboard,
  getTaskDetail,
  markTaskOnMot,
  markDueTasks,
  closeBrowser,
  getLogs,
  isLoggedIn,
  sessionExists,
  captureDebugScreenshot
} = require('./mot_bot');

// ─── Estado del scheduler ─────────────────────────────────────────────────────
let _interval    = null;
let _status      = 'stopped';   // 'stopped' | 'running' | 'error' | 'logging_in'
let _lastError   = null;
let _startedAt   = null;
let _nextRunAt   = null;
let _needsLogin  = false;

// Historial de marcaciones del día (se reinicia a medianoche)
let _markedToday   = new Set();
let _todayStr      = todayString();
const _marcaciones = [];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function checkDayRollover() {
  const today = todayString();
  if (today !== _todayStr) {
    _todayStr    = today;
    _markedToday = new Set();
    console.log('[MOT-Scheduler] Nuevo día detectado. Reseteando marcaciones.');
  }
}

// ─── Ciclo principal ──────────────────────────────────────────────────────────

async function runCycle() {
  checkDayRollover();
  console.log('[MOT-Scheduler] Ejecutando ciclo...');
  _nextRunAt = new Date(Date.now() + 60 * 1000).toISOString();

  try {
    if (!isLoggedIn()) {
      console.log('[MOT-Scheduler] Iniciando/restaurando sesión MOT...');
      await doLogin(true);
    }

    _needsLogin = false;
    const results = await markDueTasks(_markedToday);

    if (results.length > 0) {
      _marcaciones.unshift(...results);
      if (_marcaciones.length > 200) _marcaciones.splice(200);
    }

    _status    = 'running';
    _lastError = null;
  } catch (err) {
    console.error('[MOT-Scheduler] Error en ciclo:', err.message);
    _lastError = err.message;
    _status    = 'error';
    await captureDebugScreenshot('error').catch(() => {});
  }
}

// ─── Control del scheduler ────────────────────────────────────────────────────

async function start() {
  if (_interval) {
    console.log('[MOT-Scheduler] Ya está corriendo.');
    return;
  }

  _status    = 'running';
  _startedAt = new Date().toISOString();
  _lastError = null;

  console.log('[MOT-Scheduler] Iniciando...');
  await runCycle();
  _interval = setInterval(runCycle, 60 * 1000);
}

async function stop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _status    = 'stopped';
  _nextRunAt = null;
  await closeBrowser();
  console.log('[MOT-Scheduler] Detenido.');
}

async function doManualLogin() {
  const isCloud = process.env.RENDER || process.env.NODE_ENV === 'production';
  console.log(`[MOT-Scheduler] Forzando login (headless: ${!!isCloud})...`);
  _status = 'logging_in';
  try {
    await doLogin(true); // Usa el flujo automático con Google OAuth y sesión guardada
    _needsLogin = false;
    _status     = _interval ? 'running' : 'stopped';
    _lastError  = null;
    console.log('[MOT-Scheduler] Login completado. Sesión guardada.');
    return { ok: true };
  } catch (err) {
    _status    = 'error';
    _lastError = err.message;
    console.error('[MOT-Scheduler] Error en login:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene el dashboard completo de tareas del MOT original.
 */
async function fetchDashboard(forceRefresh = false) {
  try {
    const data = await getMotDashboard(forceRefresh);
    _lastError = null;
    return data;
  } catch (err) {
    _lastError = err.message;
    throw err;
  }
}

/**
 * Obtiene el detalle de una tarea puntual en MOT.WebVerTarea.
 */
async function fetchTaskDetail(rowIndex) {
  return await getTaskDetail(rowIndex);
}

/**
 * Marca una tarea manualmente desde nuestra interfaz web y la registra también en el historial del día.
 */
async function markSingleTask(params) {
  checkDayRollover();
  const res = await markTaskOnMot(params);
  const taskName = params.nombre || `Fila ${params.rowIndex}`;
  const closeHour = params.horarioCierre || '';
  if (taskName && closeHour) {
    _markedToday.add(`${taskName}|${closeHour}`);
  }
  _marcaciones.unshift({
    tarea: `${taskName} (${params.accion || 'C'})`,
    horarioCierre: closeHour || 'Manual Web',
    estado: 'marcado',
    ts: new Date().toISOString(),
  });
  if (_marcaciones.length > 200) _marcaciones.splice(200);
  return res;
}

function getStatus() {
  return {
    status:      _status,
    needsLogin:  _needsLogin,
    loggedIn:    isLoggedIn(),
    startedAt:   _startedAt,
    nextRunAt:   _nextRunAt,
    lastError:   _lastError,
    markedToday: Array.from(_markedToday),
    marcaciones: _marcaciones.slice(0, 50),
    botLogs:     getLogs().slice(0, 50),
  };
}

async function reset() {
  console.log('[MOT-Scheduler] Reiniciando bot a 0%...');
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _status      = 'stopped';
  _lastError   = null;
  _startedAt   = null;
  _nextRunAt   = null;
  _needsLogin  = false;
  _markedToday = new Set();
  _marcaciones.length = 0;

  const motBot = require('./mot_bot');
  if (motBot.clearLogs) motBot.clearLogs();
  if (motBot.closeBrowser) {
    try { await motBot.closeBrowser(); } catch (_) {}
  }

  return { ok: true };
}

module.exports = {
  start,
  stop,
  reset,
  doManualLogin,
  fetchDashboard,
  fetchTaskDetail,
  markSingleTask,
  getStatus,
};
