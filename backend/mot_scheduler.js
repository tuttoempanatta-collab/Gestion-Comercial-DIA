/**
 * mot_scheduler.js
 * Scheduler que corre cada 60 segundos y llama al bot de marcación MOT.
 * Expone funciones para controlar el ciclo desde la API REST.
 */

const { doLogin, markDueTasks, closeBrowser, getLogs, isLoggedIn, sessionExists, captureDebugScreenshot } = require('./mot_bot');

// ─── Estado del scheduler ─────────────────────────────────────────────────────
let _interval    = null;
let _status      = 'stopped';   // 'stopped' | 'running' | 'error'
let _lastError   = null;
let _startedAt   = null;
let _nextRunAt   = null;
let _needsLogin  = false;       // true si hay que hacer el primer login manual

// Historial de marcaciones del día (se reinicia a medianoche)
let _markedToday   = new Set();
let _todayStr      = todayString();
const _marcaciones = [];         // historial persistente en memoria

function todayString() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Reiniciar el Set de marcaciones al cambiar de día
function checkDayRollover() {
  const today = todayString();
  if (today !== _todayStr) {
    _todayStr   = today;
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
    // Si no está logueado, intentar restore de sesión
    if (!isLoggedIn()) {
      if (!sessionExists()) {
        console.log('[MOT-Scheduler] No hay sesión guardada. Intentando login automático headless...');
        await doLogin(true); // Intento de login automático sin GUI
      } else {
        console.log('[MOT-Scheduler] Re-logueando con sesión guardada...');
        await doLogin(true); // headless, usa storageState
      }
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
    // Tomar screenshot para diagnóstico
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

  // Primera ejecución inmediata
  await runCycle();

  // Luego cada 60 segundos
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

/**
 * Forzar un intento de login automático (headless: true).
 * Esto permite al usuario disparar el login desde la web de Vercel
 * sin depender de una ventana gráfica (que Render no soporta).
 */
async function doManualLogin() {
  console.log('[MOT-Scheduler] Forzando login automático (headless: true)...');
  _status = 'logging_in';
  try {
    await doLogin(true); // ventana oculta para servidores
    _needsLogin = false;
    _status     = 'running';
    _lastError  = null;
    console.log('[MOT-Scheduler] Login automático completado. Sesión guardada.');
    // Arrancar ciclo automático si no está corriendo
    if (!_interval) await start();
    return { ok: true };
  } catch (err) {
    _status    = 'error';
    _lastError = err.message;
    console.error('[MOT-Scheduler] Error en login manual:', err.message);
    return { ok: false, error: err.message };
  }
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
    botLogs:     getLogs().slice(0, 30),
  };
}

module.exports = { start, stop, doManualLogin, getStatus };
