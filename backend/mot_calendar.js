/**
 * mot_calendar.js
 * Utilidades para el Calendario Semanal Dinámico y Perpetuo de Turnos (Argentina UTC-3).
 * Maneja ventana rodante de 2 semanas (Semana Actual y Semana Siguiente),
 * transiciones de mes/año y auto-asignación diaria.
 */

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Obtiene la fecha actual en Argentina (UTC-3)
 */
function getNowArgentina() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc - 3 * 3600000);
}

/**
 * Formatea Date a 'YYYY-MM-DD'
 */
function formatDateISO(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formatea Date a 'DD/MM'
 */
function formatDateShort(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * Calcula el Lunes (a las 00:00:00) de la semana correspondiente a una fecha dada.
 */
function getMondayOfWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Genera los 7 días (Lunes a Domingo) a partir de una fecha de Lunes dada.
 */
function generateWeekDays(mondayDate, scheduleMap = {}, defaultManana = '23250', defaultTarde = '23250', todayStr = '') {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(mondayDate);
    current.setDate(mondayDate.getDate() + i);

    const iso = formatDateISO(current);
    const dayName = DAY_NAMES[current.getDay()];
    const shortDate = formatDateShort(current);

    const scheduled = scheduleMap[iso] || {};
    const manana = scheduled.manana || defaultManana;
    const tarde = scheduled.tarde || defaultTarde;

    days.push({
      date: iso,
      dayName,
      formattedDate: shortDate,
      fullLabel: `${dayName} ${shortDate}`,
      manana,
      tarde,
      isToday: iso === todayStr,
    });
  }
  return days;
}

/**
 * Calcula las 2 semanas continuas (Semana Actual y Semana Siguiente) según el calendario anual.
 */
function getCalendarWeeksInfo(scheduleMap = {}, defaultManana = '23250', defaultTarde = '23250') {
  const nowArg = getNowArgentina();
  const todayStr = formatDateISO(nowArg);

  // 1. Lunes de la semana actual
  const currentMonday = getMondayOfWeek(nowArg);
  const currentSunday = new Date(currentMonday);
  currentSunday.setDate(currentMonday.getDate() + 6);

  // 2. Lunes de la semana siguiente (+7 días)
  const nextMonday = new Date(currentMonday);
  nextMonday.setDate(currentMonday.getDate() + 7);
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);

  const currentWeekDays = generateWeekDays(currentMonday, scheduleMap, defaultManana, defaultTarde, todayStr);
  const nextWeekDays = generateWeekDays(nextMonday, scheduleMap, defaultManana, defaultTarde, todayStr);

  const todayDayInfo = currentWeekDays.find(d => d.date === todayStr) || {
    date: todayStr,
    dayName: DAY_NAMES[nowArg.getDay()],
    formattedDate: formatDateShort(nowArg),
    fullLabel: `${DAY_NAMES[nowArg.getDay()]} ${formatDateShort(nowArg)}`,
    manana: (scheduleMap[todayStr]?.manana) || defaultManana,
    tarde: (scheduleMap[todayStr]?.tarde) || defaultTarde,
    isToday: true,
  };

  return {
    today: todayDayInfo,
    currentWeek: {
      id: `week-${formatDateISO(currentMonday)}`,
      label: `Semana Actual (${formatDateShort(currentMonday)} al ${formatDateShort(currentSunday)})`,
      startDate: formatDateISO(currentMonday),
      endDate: formatDateISO(currentSunday),
      days: currentWeekDays,
    },
    nextWeek: {
      id: `week-${formatDateISO(nextMonday)}`,
      label: `Semana Siguiente (${formatDateShort(nextMonday)} al ${formatDateShort(nextSunday)})`,
      startDate: formatDateISO(nextMonday),
      endDate: formatDateISO(nextSunday),
      days: nextWeekDays,
    },
  };
}

module.exports = {
  getNowArgentina,
  formatDateISO,
  formatDateShort,
  getMondayOfWeek,
  getCalendarWeeksInfo,
};
