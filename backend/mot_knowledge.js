/**
 * mot_knowledge.js
 * Base de conocimiento del Motor IA de Verificación del robot MOT.
 * Reglas aprendidas, registro de incidentes (autoaprendizaje) y bitácora de auditoría diaria.
 */

const fs = require('fs');
const path = require('path');

const INCIDENTS_FILE = path.join(__dirname, 'mot_incidents.json');
const AUDIT_FILE     = path.join(__dirname, 'mot_audit.json');

const RULES = {
  TZ_ID: 'America/Argentina/Buenos_Aires',
  TZ_OFFSET_MIN: 180,                // UTC-3 => getTimezoneOffset() === 180
  MARK_AFTER_START_MIN: 10,
  MAX_RETRIES: 2,                    // reintentos tras el primer intento
  HOUR_TOLERANCE_MIN: 2,             // tolerancia entre hora real de marca y hora registrada por MOT
  DONE_CODES: ['C', 'FT', 'NC', 'NA'],
  // Equipos esperados por categoría en Tienda 624
  EXPECTED_EQUIPMENT: { Murales: 12, Freezers: 7, 'Cámaras': 2 },
  // Tareas reservadas a la tienda (el robot nunca las marca)
  OMITTED_PATTERNS: ['recep', 'trazabilidad', 'retiro calidad'],
};

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return fallback;
}

function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
}

/** Registra un incidente para que el motor adapte su estrategia (autoaprendizaje). */
function recordIncident({ tarea, tipo, causa, accion }) {
  const list = readJson(INCIDENTS_FILE, []);
  list.unshift({ ts: new Date().toISOString(), tarea, tipo, causa, accion });
  if (list.length > 300) list.length = 300;
  writeJson(INCIDENTS_FILE, list);
}

/** Cantidad de incidentes recientes del mismo tipo para una tarea (estrategia adaptativa). */
function incidentCount(tarea, tipo) {
  return readJson(INCIDENTS_FILE, []).filter(i => i.tarea === tarea && i.tipo === tipo).length;
}

/** Bitácora de auditoría: una entrada por tarea y día. */
function recordAudit(dateKey, entry) {
  const all = readJson(AUDIT_FILE, {});
  if (!all[dateKey]) all[dateKey] = [];
  all[dateKey].unshift({ ts: new Date().toISOString(), ...entry });
  // conservar los últimos 14 días
  Object.keys(all).sort().slice(0, Math.max(0, Object.keys(all).length - 14)).forEach(k => delete all[k]);
  writeJson(AUDIT_FILE, all);
}

function getAudit(dateKey) {
  const all = readJson(AUDIT_FILE, {});
  return dateKey ? (all[dateKey] || []) : all;
}

function getIncidents(limit = 50) {
  return readJson(INCIDENTS_FILE, []).slice(0, limit);
}

module.exports = { RULES, recordIncident, incidentCount, recordAudit, getAudit, getIncidents };
