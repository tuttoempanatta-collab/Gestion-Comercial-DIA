/**
 * mot_scheduler.js
 * Scheduler autónomo 24/7 que despierta automáticamente al robot todos los días a las 05:30 AM (Hora Argentina),
 * queda en espera activa marcando cada tarea 10 minutos después de su horario de inicio,
 * y se apaga/entra en reposo nocturno automáticamente a las 22:40 hs hasta las 05:30 AM del día siguiente.
 * No requiere dejar abierta la página web ni el APK.
 */

process.env.TZ = 'America/Argentina/Buenos_Aires';

const {
  doLogin,
  readTasks,
  getMotDashboard,
  getTaskDetail,
  markTaskOnMot,
  markDueTasks,
  runPreSleepSweepAndResolve,
  closeBrowser,
  log,
  getLogs,
  isLoggedIn,
  sessionExists,
  getNowArgentina,
  captureDebugScreenshot
} = require('./mot_bot');

// ─── Configuración de Horario Automático Diario (Hora Argentina UTC-3) ───────
const DAILY_WAKE_TIME      = '05:30'; // Se despierta solo todos los días a las 05:30 AM
const DAILY_PRE_SLEEP_TIME = '22:30'; // Pasada preventiva 10 min antes del cierre definitivo
const DAILY_SLEEP_TIME     = '22:40'; // Cierra y descansa a las 22:40 hs (última tarea cierra 22:35)
const WAKE_MINUTES         = 5 * 60 + 30;   // 330 min (05:30)
const PRE_SLEEP_MINUTES    = 22 * 60 + 30;  // 1350 min (22:30)
const SLEEP_MINUTES        = 22 * 60 + 40;  // 1360 min (22:40)

// ─── Estado del scheduler ─────────────────────────────────────────────────────
let _interval               = null;
let _guardianInterval       = null;
let _status                 = 'sleeping'; // 'running' | 'sleeping' | 'stopped' | 'error' | 'logging_in'
let _lastError              = null;
let _startedAt              = null;
let _nextRunAt              = null;
let _needsLogin             = false;
let _autoScheduleEnabled    = true;       // Guardia automática 05:30 - 22:40 hs activa por defecto
let _pausedManuallyToday    = false;      // Si el usuario pausó manualmente dentro de la franja 05:30-22:40
let _forcedNightRun         = false;      // Si el usuario forzó encendido manual fuera de horario (22:40-05:30)
let _isRunningCycle         = false;
let _preSleepSweepDoneToday = false;

const MARKED_FILE = path.join(__dirname, 'mot_marked_today.json');

function loadMarkedToday() {
  try {
    if (fs.existsSync(MARKED_FILE)) {
      const data = JSON.parse(fs.readFileSync(MARKED_FILE, 'utf8'));
      if (data && data.date === todayStringArg() && Array.isArray(data.items)) {
        return new Set(data.items);
      }
    }
  } catch (_) {}
  return new Set();
}

function saveMarkedToday(set) {
  try {
    fs.writeFileSync(MARKED_FILE, JSON.stringify({ date: todayStringArg(), items: Array.from(set) }, null, 2), 'utf8');
  } catch (_) {}
}

// Historial de marcaciones del día (persistido en disco y reiniciado a medianoche de Argentina)
let _markedToday   = loadMarkedToday();
let _todayStr      = todayStringArg();
const _marcaciones = [];

function todayStringArg() {
  const nowArg = getNowArgentina();
  const yyyy = nowArg.getFullYear();
  const mm   = String(nowArg.getMonth() + 1).padStart(2, '0');
  const dd   = String(nowArg.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getArgentinaHHMM() {
  const nowArg = getNowArgentina();
  const hh = String(nowArg.getHours()).padStart(2, '0');
  const mm = String(nowArg.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getArgentinaMinutes() {
  const nowArg = getNowArgentina();
  return nowArg.getHours() * 60 + nowArg.getMinutes();
}

function isWithinOperatingWindow() {
  const mins = getArgentinaMinutes();
  return mins >= WAKE_MINUTES && mins < SLEEP_MINUTES;
}

function checkDayRollover() {
  const today = todayStringArg();
  if (today !== _todayStr) {
    _todayStr               = today;
    _markedToday            = new Set();
    saveMarkedToday(_markedToday);
    _pausedManuallyToday    = false;
    _preSleepSweepDoneToday = false;
    log(`📅 Nuevo día detectado en Argentina (${today}). Contador de marcaciones diarias reiniciado.`);
    try {
      const mb = require('./mot_bot');
      mb.syncTodayLegajosFromSchedule();
    } catch (_) {}
  }
}

// ─── Ciclo principal (corre cada 60s mientras está despierto) ─────────────────

async function runCycle() {
  if (_isRunningCycle) return;
  _isRunningCycle = true;

  try {
    checkDayRollover();

    // Verificar si llegó la hora de cierre diario (22:40 hs) y no fue forzado en horario nocturno
    if (_autoScheduleEnabled && !isWithinOperatingWindow() && !_forcedNightRun) {
      await enterNightSleep('Horario de cierre diario alcanzado (22:40 hs).');
      return;
    }

    const argTime = getArgentinaHHMM();
    const currentMins = getArgentinaMinutes();

    // Pasada preventiva a partir de las 22:30 hs (10 min antes del cierre definitivo)
    if (_autoScheduleEnabled && currentMins >= PRE_SLEEP_MINUTES && currentMins < SLEEP_MINUTES && !_preSleepSweepDoneToday) {
      _preSleepSweepDoneToday = true;
      log(`⏰ [Pre-Cierre Preventivo ${DAILY_PRE_SLEEP_TIME} hs] Auditando tareas del día para asegurar 100% de cumplimiento antes del descanso...`);
      try {
        const sweep = await runPreSleepSweepAndResolve();
        if (sweep && sweep.rescuedCount > 0) {
          log(`🎉 [Pre-Cierre Preventivo] Se rescataron y completaron ${sweep.rescuedCount} tarea(s) antes de las ${DAILY_SLEEP_TIME} hs.`);
        }
      } catch (err) {
        log(`⚠️ [Pre-Cierre Preventivo] Error en barrido: ${err.message}`, 'warn');
      }
    }

    console.log(`[MOT-Scheduler] Ejecutando ciclo (${argTime} hs AR)...`);
    _nextRunAt = new Date(Date.now() + 60 * 1000).toISOString();

    if (!isLoggedIn()) {
      log(`🌅 [Auto-Bot] Conectando sesión automática en MOT (${argTime} hs)...`);
      await doLogin(true);
    }

    _needsLogin = false;
    const results = await markDueTasks(_markedToday);
    saveMarkedToday(_markedToday);

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
  } finally {
    _isRunningCycle = false;
  }
}

// ─── Transición a Reposo Nocturno (22:40 hs a 05:30 hs) ──────────────────────

async function enterNightSleep(reason = 'Reposo nocturno automático') {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _forcedNightRun = false;
  _nextRunAt      = null;
  _status         = 'sleeping';

  // ── SEGUNDO CHEQUEO PRE-DORMICIÓN CON MOTOR IA ──
  try {
    const argTime = getArgentinaHHMM();
    log(`🌙 [Segundo Chequeo Pre-Dormición ${argTime} hs] Auditando y verificando tareas pendientes o incompletas antes de apagar... Motivo: ${reason}`);
    const sweepRes = await runPreSleepSweepAndResolve();
    if (sweepRes && sweepRes.rescuedCount > 0) {
      log(`🎉 [Segundo Chequeo Pre-Dormición] ¡Éxito! Se finalizaron ${sweepRes.rescuedCount} tarea(s) que habían quedado sin terminar.`);
    } else {
      log(`👍 [Segundo Chequeo Pre-Dormición] Verificado: 0 tareas pendientes. Todo el plan diario fue completado.`);
    }

    const mb = require('./mot_bot');
    const day = mb.getAudit(mb.getTodayKey());
    const ok = day.filter(e => e.estado === 'verificada').length;
    const rev = day.filter(e => e.estado !== 'verificada').length;
    log(`📋 [Reporte de Auditoría Diario] ${ok} tareas verificadas en MOT, ${rev} requieren revisión.`);
  } catch (err) {
    log(`⚠️ [Segundo Chequeo Pre-Dormición] Error en el chequeo final antes de dormir: ${err.message}`, 'error');
  }

  await closeBrowser();
  log(`🌙 [Auto-Sleep] ${reason} Robot en reposo nocturno. Se despertará solo a las ${DAILY_WAKE_TIME} hs.`);
}

// ─── Demonio Guardián 24/7 (Verifica horario 05:30 AM y 22:40 HS) ────────────

async function checkGuardianSchedule() {
  checkDayRollover();
  if (!_autoScheduleEnabled) return;

  const inWindow = isWithinOperatingWindow();
  const argTime  = getArgentinaHHMM();

  if (inWindow) {
    // Estamos entre las 05:30 y las 22:40 hs
    _forcedNightRun = false;
    if (!_interval && !_pausedManuallyToday && !_isRunningCycle) {
      log(`🌅 [Auto-Despertar ${DAILY_WAKE_TIME} hs] Hora Argentina ${argTime}. Despertando robot automáticamente en espera activa hasta las ${DAILY_SLEEP_TIME} hs.`);
      await start({ autoWoken: true });
    }
  } else {
    // Estamos fuera de horario (>= 22:40 hs o < 05:30 hs)
    _pausedManuallyToday = false;
    if (_interval && !_forcedNightRun) {
      await enterNightSleep(`Hora de cierre alcanzada (${argTime} hs AR >= ${DAILY_SLEEP_TIME} hs).`);
    } else if (!_interval && _status === 'stopped') {
      _status = 'sleeping';
    }
  }
}

function initAutoGuardian() {
  if (_guardianInterval) return;
  const argTime  = getArgentinaHHMM();
  const inWindow = isWithinOperatingWindow();

  log(`⏰ Guardián Automático MOT configurado: Despierta ${DAILY_WAKE_TIME} hs | Cierra ${DAILY_SLEEP_TIME} hs (Hora actual AR: ${argTime} hs).`);

  if (inWindow) {
    start({ autoWoken: true }).catch(err => {
      console.error('[MOT-Guardian] Error al auto-iniciar en franja operativa:', err.message);
    });
  } else {
    _status = 'sleeping';
    log(`🌙 Horario nocturno detectado (${argTime} hs AR). El robot permanece en reposo y se despertará solo a las ${DAILY_WAKE_TIME} hs.`);
  }

  _guardianInterval = setInterval(() => {
    checkGuardianSchedule().catch(err => {
      console.error('[MOT-Guardian] Error en chequeo de horario:', err.message);
    });
  }, 30 * 1000);

  // Keep-alive anti-hibernación para Render: ping cada 4 min en franja operativa (05:30-22:40 hs)
  const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://gestion-comercial-dia.onrender.com';
  setInterval(() => {
    if (isWithinOperatingWindow()) {
      try {
        const https = require('https');
        https.get(`${RENDER_EXTERNAL_URL}/health`, (res) => {}).on('error', () => {});
      } catch (_) {}
    }
  }, 4 * 60 * 1000);
}

// ─── Control del scheduler ────────────────────────────────────────────────────

async function start(options = {}) {
  const { autoWoken = false, manual = false } = options;

  if (_interval) {
    console.log('[MOT-Scheduler] Ya está corriendo.');
    return;
  }

  if (manual) {
    _pausedManuallyToday = false;
    if (!isWithinOperatingWindow()) {
      _forcedNightRun = true;
      log(`⚡ Inicio manual activado fuera de franja horaria (${getArgentinaHHMM()} hs AR).`);
    } else {
      log(`▶️ Robot activado manualmente (${getArgentinaHHMM()} hs AR). Operará hasta las ${DAILY_SLEEP_TIME} hs.`);
    }
  }

  _status    = 'running';
  _startedAt = new Date().toISOString();
  _lastError = null;

  console.log(`[MOT-Scheduler] Iniciando (${autoWoken ? 'Auto-Despertar 05:30' : 'Manual'})...`);
  try {
    log(`🔄 [Sincronización al Despertar] Sincronizando grilla de tareas del día con MOT Oficial...`);
    const syncData = await getMotDashboard(true);
    const totalCount = syncData?.tasks?.length || 0;
    log(`✅ [Sincronización Completada] ${totalCount} tareas del día verificadas en MOT. Robot en espera activa para marcar cada tarea +10 min después de su inicio (omitiendo las 5 tareas manuales de tienda).`);
  } catch (syncErr) {
    log(`⚠️ Aviso en sincronización inicial al despertar: ${syncErr.message}`, 'warn');
  }

  try {
    await require('./mot_bot').preflightCheck();
    log('🕒 [Pre-vuelo] Reloj del navegador verificado en hora Argentina (UTC-3). Robot autorizado a marcar.');
  } catch (pfErr) {
    log(`⛔ [Pre-vuelo] ${pfErr.message}`, 'error');
  }

  await runCycle();
  _interval = setInterval(runCycle, 60 * 1000);
}

async function stop(options = {}) {
  const { manual = true } = options;
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _forcedNightRun = false;
  _nextRunAt      = null;

  if (manual && isWithinOperatingWindow()) {
    _pausedManuallyToday = true;
    _status = 'stopped';
    log(`⏸️ Robot pausado manualmente a las ${getArgentinaHHMM()} hs. Volverá a despertar mañana a las ${DAILY_WAKE_TIME} hs (o al reactivarlo).`);
  } else if (!isWithinOperatingWindow() && _autoScheduleEnabled) {
    _status = 'sleeping';
    log(`🌙 Robot en modo reposo nocturno. Despertará automáticamente a las ${DAILY_WAKE_TIME} hs.`);
  } else {
    _status = 'stopped';
    log('⏹️ Robot detenido.');
  }

  await closeBrowser();
}

async function doManualLogin() {
  const isCloud = process.env.RENDER || process.env.NODE_ENV === 'production';
  console.log(`[MOT-Scheduler] Forzando login (headless: ${!!isCloud})...`);
  _status = 'logging_in';
  try {
    await doLogin(true);
    _needsLogin = false;
    _status     = _interval ? 'running' : (isWithinOperatingWindow() ? 'stopped' : 'sleeping');
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
    _markedToday.add(`${taskName}|${params.horarioInicio || ''}-${closeHour}`);
    saveMarkedToday(_markedToday);
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

function getTodayAlerts() {
  try {
    const mb = require('./mot_bot');
    const day = mb.getAudit(mb.getTodayKey());
    const latest = new Map();
    // la entrada más reciente por tarea manda (la lista viene con la más nueva primero)
    for (const e of day) if (!latest.has(e.tarea)) latest.set(e.tarea, e);

    // Cruzar con el estado actual de tareas: si en MOT la tarea ya está cumplida ('C' o 'FT'), no es una alerta
    const cached = mb.getCachedTasks ? mb.getCachedTasks() : [];
    const doneSet = new Set(
      cached
        .filter(t => ['C', 'FT', 'NC', 'NA'].includes(t.estadoCode) || (t.horaCumplimiento && t.horaCumplimiento !== '00:00'))
        .map(t => t.nombre)
    );

    return Array.from(latest.values())
      .filter(e => e.estado !== 'verificada' && !doneSet.has(e.tarea))
      .map(e => ({ tarea: e.tarea, estado: e.estado, motivo: e.motivo || '', intentos: e.intentos || null, ts: e.ts }));
  } catch (_) {
    return [];
  }
}

function getStatus() {
  return {
    status:               _status,
    needsLogin:           _needsLogin,
    loggedIn:             isLoggedIn(),
    startedAt:            _startedAt,
    nextRunAt:            _nextRunAt,
    lastError:            _lastError,
    autoScheduleEnabled:  _autoScheduleEnabled,
    wakeTime:             DAILY_WAKE_TIME,
    sleepTime:            DAILY_SLEEP_TIME,
    serverTimeArg:        getArgentinaHHMM(),
    isWithinActiveHours:  isWithinOperatingWindow(),
    pausedManuallyToday:  _pausedManuallyToday,
    markedToday:          Array.from(_markedToday),
    marcaciones:          _marcaciones.slice(0, 50),
    alertas:              getTodayAlerts(),
    botLogs:              getLogs().slice(0, 50),
  };
}

async function reset() {
  console.log('[MOT-Scheduler] Reiniciando bot a 0%...');
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _status              = isWithinOperatingWindow() ? 'stopped' : 'sleeping';
  _lastError           = null;
  _startedAt           = null;
  _nextRunAt           = null;
  _needsLogin          = false;
  _pausedManuallyToday = false;
  _forcedNightRun      = false;
  _markedToday         = new Set();
  saveMarkedToday(_markedToday);
  _marcaciones.length  = 0;

  const motBot = require('./mot_bot');
  if (motBot.clearLogs) motBot.clearLogs();
  if (motBot.closeBrowser) {
    try { await motBot.closeBrowser(); } catch (_) {}
  }

  return { ok: true };
}

module.exports = {
  initAutoGuardian,
  checkGuardianSchedule,
  start,
  stop,
  reset,
  doManualLogin,
  fetchDashboard,
  fetchTaskDetail,
  markSingleTask,
  getStatus,
};
