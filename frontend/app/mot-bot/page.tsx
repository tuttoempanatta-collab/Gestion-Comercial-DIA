'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Bot,
  Play,
  Square,
  LogIn,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  ChevronRight,
  ShieldAlert,
  UserCheck,
  Upload,
  Trash2,
  Thermometer,
  Sparkles,
  Check,
  X,
  Ban,
  Search,
  Filter,
  Eye,
  BarChart3,
  ListChecks,
  Store,
  FileText,
  Send
} from 'lucide-react'

import { API_URL } from '@/lib/api'
import BASELINE_TAREAS_RAW from './mot_tasks_624.json'

type MotStatus = {
  status: 'stopped' | 'running' | 'sleeping' | 'error' | 'needs_login' | 'logging_in'
  needsLogin: boolean
  loggedIn: boolean
  startedAt: string | null
  nextRunAt: string | null
  lastError: string | null
  autoScheduleEnabled?: boolean
  wakeTime?: string
  sleepTime?: string
  serverTimeArg?: string
  isWithinActiveHours?: boolean
  markedToday: string[]
  marcaciones: Marcacion[]
  botLogs: BotLog[]
}

type Marcacion = {
  tarea: string
  horarioCierre: string
  estado: 'marcado' | 'error' | 'omitido'
  msg?: string
  ts: string
}

type BotLog = {
  timestamp: string
  msg: string
  level: 'info' | 'warn' | 'error'
}

type MotTask = {
  rowIndex: string
  nombre: string
  horario: string
  horarioInicio: string
  horarioCierre: string
  maestroTareaGUID: string
  actividadGUID: string
  tiendaId: string
  fecha: string
  estadoCode: '' | 'C' | 'FT' | 'NC' | 'NA'
  estadoTexto: string
  horaCumplimiento: string
  tieneBotonCheck: boolean
  esCliqueable: boolean
  detailLink: string
  tipoControl: 'Directa' | 'Limpieza' | 'Equipo' | 'Almacen' | 'Proveedor' | 'Caducidad' | 'Retiro' | 'Trazabilidad'
}

type MotStats = {
  total: number
  cumplidas: number
  fueraDeHora: number
  noCumplidas: number
  noAplica: number
  pendientes: number
  vencidas: number
  porcCumplidas: number
  porcFueraDeHora: number
  porcNoCumplidas: number
  porcNoAplica: number
  porcPendientes: number
  porcVencidas: number
}

type EquipamientoItem = {
  EquipamientoGUID: string
  EquipamientoNomb: string
  TemperaturaEquipo: string
  TemperaturaProducto: string
}

type EquipamientoCategoria = {
  CtgCtrlTempGUID: string
  CtgCtrlTempDesc: string
  Equipamiento: EquipamientoItem[]
}

type TaskDetailData = {
  titulo: string
  bloque: string
  descripcionHorario: string
  diasDeSemana: string
  descripcion: string
  procedimientos: string[]
  detalleTipoServer: string
  tieneBotonesCumplimiento: boolean
}

function StatusBadge({ status }: { status: MotStatus['status'] }) {
  const map: Record<string, { label: string; color: string; dot: string }> = {
    running:     { label: 'Bot Activo / En Espera (05:30 a 22:40 hs)', color: 'text-emerald-400', dot: 'bg-emerald-400 animate-pulse' },
    sleeping:    { label: '🌙 Reposo Nocturno (Despierta solo 05:30 hs)', color: 'text-indigo-300', dot: 'bg-indigo-400 animate-pulse' },
    stopped:     { label: 'Bot Pausado',   color: 'text-slate-400',   dot: 'bg-slate-500' },
    error:       { label: 'Error',         color: 'text-red-400',     dot: 'bg-red-500 animate-pulse' },
    needs_login: { label: 'Sin sesión',    color: 'text-amber-400',   dot: 'bg-amber-400 animate-pulse' },
    logging_in:  { label: 'Logueando...',  color: 'text-blue-400',    dot: 'bg-blue-400 animate-spin' },
  }
  const s = map[status] || map.stopped
  return (
    <span className={`flex items-center gap-2 text-sm font-semibold ${s.color}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

function Countdown({ nextRunAt }: { nextRunAt: string | null }) {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    if (!nextRunAt) { setSecs(0); return }
    const tick = () => {
      const diff = Math.max(0, Math.round((new Date(nextRunAt).getTime() - Date.now()) / 1000))
      setSecs(diff)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextRunAt])

  if (!nextRunAt) return <span className="text-slate-500">—</span>
  return (
    <span className="font-mono text-sky-400 text-base font-bold">{secs}s</span>
  )
}

function getTaskStatusStyle(task: MotTask) {
  const code = (task.estadoCode || '').toUpperCase()
  const txt = (task.estadoTexto || '').toLowerCase()

  if (code === 'C' || txt.includes('a tiempo')) {
    return {
      border: 'border-l-4 border-l-emerald-500',
      badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      label: 'A tiempo',
      done: true,
    }
  }
  if (code === 'FT' || txt.includes('fuera de hora')) {
    return {
      border: 'border-l-4 border-l-amber-500',
      badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      label: 'Fuera de hora',
      done: true,
    }
  }
  if (code === 'NC' || txt.includes('no cumplida')) {
    return {
      border: 'border-l-4 border-l-red-500',
      badgeBg: 'bg-red-500/15 text-red-400 border-red-500/30',
      label: 'No cumplida',
      done: true,
    }
  }
  if (code === 'NA' || txt.includes('no aplica')) {
    return {
      border: 'border-l-4 border-l-slate-500',
      badgeBg: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
      label: 'No aplica',
      done: true,
    }
  }

  // Pendiente: verificar si está en horario o vencida
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const [hH, mH] = (task.horarioCierre || '23:59').split(':').map(Number)
  const closeMin = (hH || 0) * 60 + (mH || 0)
  const isExpired = closeMin > 0 && nowMin > closeMin

  if (isExpired) {
    return {
      border: 'border-l-4 border-l-rose-500/80',
      badgeBg: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      label: 'Fuera de ventana',
      done: false,
    }
  }

  return {
    border: 'border-l-4 border-l-sky-500',
    badgeBg: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    label: 'En horario',
    done: false,
  }
}

function getControlTypeBadge(tipo: MotTask['tipoControl']) {
  switch (tipo) {
    case 'Directa':
      return { label: 'Check Directo', cls: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/40' }
    case 'Limpieza':
      return { label: 'Orden y Limpieza (Legajo)', cls: 'bg-purple-950/60 text-purple-300 border-purple-700/40' }
    case 'Equipo':
      return { label: 'Control Temp. Equipos', cls: 'bg-sky-950/60 text-sky-300 border-sky-700/40' }
    case 'Almacen':
      return { label: 'Temp. Recepción Almacén', cls: 'bg-indigo-950/60 text-indigo-300 border-indigo-700/40' }
    case 'Proveedor':
      return { label: 'Temp. Recepción GD', cls: 'bg-amber-950/60 text-amber-300 border-amber-700/40' }
    case 'Caducidad':
      return { label: 'Control Caducidades', cls: 'bg-orange-950/60 text-orange-300 border-orange-700/40' }
    case 'Retiro':
      return { label: 'Retiro Calidad', cls: 'bg-rose-950/60 text-rose-300 border-rose-700/40' }
    case 'Trazabilidad':
      return { label: 'Trazabilidad Panadería', cls: 'bg-teal-950/60 text-teal-300 border-teal-700/40' }
    default:
      return { label: tipo, cls: 'bg-slate-800 text-slate-300 border-slate-700' }
  }
}

const BASELINE_TAREAS_624: MotTask[] = (BASELINE_TAREAS_RAW as any[]).map(t => ({
  ...t,
  estadoCode: (t.estadoCode || '') as MotTask['estadoCode'],
  tipoControl: (t.tipoControl || 'Directa') as MotTask['tipoControl'],
}))

const DEFAULT_EQUIPAMIENTO_624: EquipamientoCategoria[] = [
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
]

function parseTimeMin(str: string): number | null {
  if (!str) return null
  const m = str.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function getAutoMarkTimeStr(startStr: string, closeStr: string): string {
  const s = parseTimeMin(startStr)
  const c = parseTimeMin(closeStr)
  if (s === null) return ''
  const target = c !== null && c > s ? Math.min(s + 10, c - 1) : s + 10
  const hh = String(Math.floor(target / 60)).padStart(2, '0')
  const mm = String(target % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function getNowMinutesArg(): number {
  const now = new Date()
  const arg = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return arg.getHours() * 60 + arg.getMinutes()
}

function computeClientStats(tasks: MotTask[]): MotStats {
  const total = tasks.length
  const nowMin = getNowMinutesArg()
  let cumplidas = 0
  let fueraDeHora = 0
  let noCumplidas = 0
  let noAplica = 0
  let pendientes = 0
  let vencidas = 0

  for (const t of tasks) {
    if (t.estadoCode === 'C') cumplidas++
    else if (t.estadoCode === 'FT') fueraDeHora++
    else if (t.estadoCode === 'NC') noCumplidas++
    else if (t.estadoCode === 'NA') noAplica++
    else {
      const endMin = parseTimeMin(t.horarioCierre)
      if (endMin !== null && nowMin > endMin) vencidas++
      else pendientes++
    }
  }

  const pct = (n: number) => (total > 0 ? Math.round((n * 100) / total) : 0)
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
  }
}

function getTodayStorageKey() {
  const now = new Date()
  const arg = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `mot_624_marks_${arg.getFullYear()}_${arg.getMonth() + 1}_${arg.getDate()}`
}

function mergeWithSavedMarks(list: MotTask[]): MotTask[] {
  if (typeof window === 'undefined') return list
  try {
    const raw = localStorage.getItem(getTodayStorageKey())
    if (!raw) return list
    const savedMap = JSON.parse(raw) as Record<string, { estadoCode: MotTask['estadoCode']; estadoTexto: string; horaCumplimiento: string }>
    return list.map(t => {
      const s = savedMap[t.rowIndex]
      if (s && !t.estadoCode) {
        return { ...t, estadoCode: s.estadoCode, estadoTexto: s.estadoTexto, horaCumplimiento: s.horaCumplimiento }
      }
      return t
    })
  } catch (_) {
    return list
  }
}

export default function MotBotPage() {
  const [data, setData]               = useState<MotStatus | null>(null)
  const [tasks, setTasks]             = useState<MotTask[]>(BASELINE_TAREAS_624)
  const [stats, setStats]             = useState<MotStats | null>(() => computeClientStats(BASELINE_TAREAS_624))
  const [tiendaInfo, setTiendaInfo]   = useState<{ id: string; nombre: string; fecha: string; horario: string } | null>({
    id: '624',
    nombre: 'Tienda 00624 AR',
    fecha: 'Hoy',
    horario: '07:00 a 22:30',
  })
  const [equipamiento, setEquipamiento] = useState<EquipamientoCategoria[]>(DEFAULT_EQUIPAMIENTO_624)
  const [lastSyncAt, setLastSyncAt]   = useState<string | null>(null)

  const [activeTab, setActiveTab]     = useState<'tareas' | 'temperatura' | 'estadisticas' | 'bot'>('tareas')
  const [loading, setLoading]         = useState(false)
  const [syncingTasks, setSyncingTasks] = useState(false)
  const [action, setAction]           = useState<string | null>(null)
  const [markingRow, setMarkingRow]   = useState<string | null>(null)
  const [legajo, setLegajo]           = useState('23250')

  // Filtros de lista de tareas
  const [searchQuery, setSearchQuery]   = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done' | 'expired'>('all')
  const [typeFilter, setTypeFilter]     = useState<'all' | 'Directa' | 'Limpieza' | 'Equipo' | 'Otros'>('all')

  // Modal de Detalle de Tarea (MOT.WebVerTarea)
  const [selectedTask, setSelectedTask] = useState<MotTask | null>(null)
  const [taskDetail, setTaskDetail]     = useState<TaskDetailData | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Modal de Motivo (para No Cumplir 'NC' o Fuera de Hora 'FT')
  const [motiveModal, setMotiveModal] = useState<{ task: MotTask; accion: 'C' | 'NC' } | null>(null)
  const [motivoInput, setMotivoInput] = useState('')

  // Estado de temperaturas editables en la pestaña Control de Temperatura
  const [tempValues, setTempValues] = useState<Record<string, { equipo: string; producto: string; nombre: string }>>({})
  const [selectedTempTaskRow, setSelectedTempTaskRow] = useState<string>(() => {
    const firstTemp = BASELINE_TAREAS_624.find(t => t.tipoControl === 'Equipo')
    return firstTemp ? firstTemp.rowIndex : '0016'
  })

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(API_URL('/api/mot-bot/status'))
      const j = await r.json()
      setData(j)
    } catch (_) {
      setData(null)
    }
  }, [])

  const fetchTasksDashboard = useCallback(async (forceRefresh = false) => {
    setSyncingTasks(true)
    try {
      const r = await fetch(API_URL(`/api/mot-bot/tasks${forceRefresh ? '?refresh=true' : ''}`))
      const j = await r.json()
      if (j.ok) {
        const incoming: MotTask[] = (j.tasks && j.tasks.length > 0) ? j.tasks : BASELINE_TAREAS_624
        const merged = mergeWithSavedMarks(incoming)
        setTasks(merged)
        setStats(computeClientStats(merged))
        if (j.tienda) setTiendaInfo(j.tienda)
        if (j.lastSyncAt) setLastSyncAt(j.lastSyncAt)
        if (j.equipamiento && j.equipamiento.length > 0) {
          setEquipamiento(j.equipamiento)
        }
      } else {
        const fallback = mergeWithSavedMarks(BASELINE_TAREAS_624)
        setTasks(fallback)
        setStats(computeClientStats(fallback))
      }
    } catch (e) {
      console.error('Error cargando tareas MOT, usando catálogo oficial de Tienda 624:', e)
      const fallback = mergeWithSavedMarks(BASELINE_TAREAS_624)
      setTasks(fallback)
      setStats(computeClientStats(fallback))
    } finally {
      setSyncingTasks(false)
    }
  }, [])

  // Motor IA: Inicializar valores seguros de temperatura según el tipo de equipo aprendido
  // con memoria histórica del día anterior para garantizar una leve variación diaria (±0.2 a ±0.7 °C)
  // y evitar que se repitan los mismos datos dos días seguidos:
  // - Mural de Pollo: 0.0 a 1.9 °C
  // - Demás Murales: 0.0 a 4.0 °C
  // - Freezers: -18.0 a -22.0 °C
  // - Reserva / Cámara Carne: 0.0 a 2.0 °C
  // - Reserva / Cámara 1 (General): 0.0 a 4.0 °C
  const generateSafeTemperatures = useCallback((cats: EquipamientoCategoria[]) => {
    const now = new Date()
    const arg = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const yest = new Date(arg)
    yest.setDate(yest.getDate() - 1)
    const yestKey = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
    const todayKey = `${arg.getFullYear()}-${String(arg.getMonth() + 1).padStart(2, '0')}-${String(arg.getDate()).padStart(2, '0')}`

    let savedHist: Record<string, Record<string, { equipo: string; producto: string }>> = {}
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('mot_624_temp_history_v1')
        if (raw) savedHist = JSON.parse(raw)
      } catch (_) {}
    }

    const detPrev = (seedName: string, minV: number, maxV: number) => {
      const s = `${yestKey}::${seedName}`
      let h = 2166136261
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      const norm = ((h >>> 0) % 1000) / 1000
      return Number((minV + norm * (maxV - minV)).toFixed(1))
    }

    const pickDifferentFromYesterday = (minV: number, maxV: number, prevV: number) => {
      const span = maxV - minV
      const minDelta = span <= 1.5 ? 0.2 : 0.3
      let cand = Number((Math.random() * (maxV - minV) + minV).toFixed(1))
      for (let i = 0; i < 20; i++) {
        const dir = (i % 2 === 0 ? 1 : -1) * (Math.random() < 0.5 ? 1 : -1)
        const step = minDelta + Math.random() * Math.min(0.6, span * 0.45)
        let nextVal = Number((prevV + dir * step).toFixed(1))
        if (nextVal < minV || nextVal > maxV) {
          nextVal = Number((Math.random() * (maxV - minV) + minV).toFixed(1))
        }
        if (Math.abs(nextVal - prevV) >= minDelta - 0.01 && nextVal >= minV && nextVal <= maxV) {
          cand = nextVal
          break
        }
      }
      cand = Math.max(minV, Math.min(maxV, cand))
      if (cand.toFixed(1) === prevV.toFixed(1)) {
        const nudged = cand + minDelta <= maxV ? cand + minDelta : cand - minDelta
        cand = Math.max(minV, Math.min(maxV, nudged))
      }
      return cand.toFixed(1)
    }

    const next: Record<string, { equipo: string; producto: string; nombre: string }> = {}
    const todayRecord: Record<string, { equipo: string; producto: string }> = {}

    for (const cat of cats) {
      const catDesc = cat.CtgCtrlTempDesc.toLowerCase()
      const isFreezer = catDesc.includes('freezer')
      const isCamara  = catDesc.includes('cámara') || catDesc.includes('camara')
      for (const item of cat.Equipamiento) {
        const nomb = item.EquipamientoNomb.toLowerCase()
        const isPollo = nomb.includes('pollo')
        let eqMin = 0.6, eqMax = 3.2, prMin = 1.0, prMax = 3.7
        if (isPollo) {
          eqMin = 0.2; eqMax = 1.5; prMin = 0.4; prMax = 1.8
        } else if (isFreezer) {
          eqMin = -21.5; eqMax = -18.5; prMin = -20.8; prMax = -18.2
        } else if (isCamara) {
          if (nomb.includes('carne')) {
            eqMin = 0.3; eqMax = 1.6; prMin = 0.5; prMax = 1.9
          } else {
            eqMin = 0.8; eqMax = 3.3; prMin = 1.1; prMax = 3.7
          }
        }

        const prevEntry = savedHist[yestKey]?.[item.EquipamientoNomb]
        const prevEq = prevEntry?.equipo ? parseFloat(prevEntry.equipo) : detPrev(`${item.EquipamientoNomb}_EQ`, eqMin, eqMax)
        const prevPr = prevEntry?.producto ? parseFloat(prevEntry.producto) : detPrev(`${item.EquipamientoNomb}_PR`, prMin, prMax)

        const eq = pickDifferentFromYesterday(eqMin, eqMax, prevEq)
        const pr = pickDifferentFromYesterday(prMin, prMax, prevPr)

        next[item.EquipamientoGUID] = {
          equipo: eq,
          producto: pr,
          nombre: item.EquipamientoNomb,
        }
        todayRecord[item.EquipamientoNomb] = { equipo: eq, producto: pr }
      }
    }

    if (typeof window !== 'undefined') {
      try {
        savedHist[todayKey] = todayRecord
        localStorage.setItem('mot_624_temp_history_v1', JSON.stringify(savedHist))
      } catch (_) {}
    }

    setTempValues(next)
  }, [])

  useEffect(() => {
    const initial = mergeWithSavedMarks(BASELINE_TAREAS_624)
    setTasks(initial)
    setStats(computeClientStats(initial))
  }, [])

  useEffect(() => {
    if (equipamiento.length > 0 && Object.keys(tempValues).length === 0) {
      generateSafeTemperatures(equipamiento)
    }
  }, [equipamiento, tempValues, generateSafeTemperatures])

  useEffect(() => {
    fetchStatus()
    fetchTasksDashboard(false)
    const id = setInterval(fetchStatus, 15000)
    return () => clearInterval(id)
  }, [fetchStatus, fetchTasksDashboard])

  async function callApi(endpoint: string, label: string) {
    setLoading(true)
    setAction(label)
    try {
      const r = await fetch(API_URL(endpoint), { method: 'POST' })
      await r.json()
      await fetchStatus()
      if (endpoint.includes('login') || endpoint.includes('start')) {
        await fetchTasksDashboard(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  /**
   * Envía la señal de marcación al MOT original desde nuestra web y actualiza el estado de inmediato.
   */
  async function handleMarkTask(
    task: MotTask,
    accion: 'C' | 'NC' | 'NA' | 'LIMPIEZA' | 'EQUIPO',
    motivo?: string,
    customTemps?: Record<string, { equipo: string; producto: string; nombre: string }>
  ) {
    setMarkingRow(task.rowIndex)

    // 1. Calcular marcación inmediata según ventana horaria de Argentina
    const now = new Date()
    const arg = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const hh = String(arg.getHours()).padStart(2, '0')
    const mm = String(arg.getMinutes()).padStart(2, '0')
    const nowMin = arg.getHours() * 60 + arg.getMinutes()
    const startMin = parseTimeMin(task.horarioInicio)
    const endMin = parseTimeMin(task.horarioCierre)
    const inWin = startMin !== null && endMin !== null && nowMin >= startMin && nowMin <= endMin

    let newCode: MotTask['estadoCode'] = 'C'
    let newText = 'a tiempo'
    if (accion === 'C' || accion === 'LIMPIEZA' || accion === 'EQUIPO') {
      newCode = inWin ? 'C' : 'FT'
      newText = inWin ? 'a tiempo' : 'fuera de hora'
    } else if (accion === 'NC') {
      newCode = 'NC'
      newText = 'no cumplida'
    } else if (accion === 'NA') {
      newCode = 'NA'
      newText = 'no aplica'
    }

    const horaStr = `${hh}:${mm}`

    // Guardar en localStorage del día actual
    try {
      const key = getTodayStorageKey()
      const existing = JSON.parse(localStorage.getItem(key) || '{}')
      existing[task.rowIndex] = { estadoCode: newCode, estadoTexto: newText, horaCumplimiento: horaStr }
      localStorage.setItem(key, JSON.stringify(existing))
    } catch (_) {}

    // Actualizar UI inmediatamente
    setTasks(prev => {
      const next = prev.map(t =>
        t.rowIndex === task.rowIndex
          ? { ...t, estadoCode: newCode, estadoTexto: newText, horaCumplimiento: horaStr }
          : t
      )
      setStats(computeClientStats(next))
      return next
    })
    if (selectedTask && selectedTask.rowIndex === task.rowIndex) {
      setSelectedTask({ ...task, estadoCode: newCode, estadoTexto: newText, horaCumplimiento: horaStr })
    }

    // 2. Enviar señal al backend para impactar en mot.supermercadosdia.com.ar
    try {
      const r = await fetch(API_URL('/api/mot-bot/mark-task'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowIndex: task.rowIndex,
          maestroTareaGUID: task.maestroTareaGUID,
          nombre: task.nombre,
          horarioCierre: task.horarioCierre,
          accion,
          motivo: motivo || 'Operación en tienda',
          responsable: legajo || '23250',
          temperaturas: customTemps,
        }),
      })
      const j = await r.json()
      if (r.ok && j.ok && j.tasks && j.tasks.length > 0) {
        const merged = mergeWithSavedMarks(j.tasks)
        setTasks(merged)
        setStats(computeClientStats(merged))
      }
      await fetchStatus()
    } catch (err: any) {
      console.warn('Sincronización en segundo plano con servidor MOT:', err?.message)
    } finally {
      setMarkingRow(null)
    }
  }

  /**
   * Abre el modal de Detalle de Tarea (MOT.WebVerTarea) y consulta los procedimientos e instrucciones reales.
   */
  async function handleOpenDetail(task: MotTask) {
    setSelectedTask(task)
    const fallbackDetail: TaskDetailData = {
      titulo: task.nombre,
      bloque: parseInt(task.horarioInicio.split(':')[0] || '8', 10) < 8 ? 'Apertura' : parseInt(task.horarioInicio.split(':')[0] || '8', 10) >= 19 ? 'Cierre' : 'Diaria',
      descripcionHorario: `De ${task.horarioInicio} a ${task.horarioCierre} hs`,
      diasDeSemana: 'Todos',
      descripcion:
        task.tipoControl === 'Limpieza'
          ? `Tarea de Orden y Limpieza (${task.nombre}). Requiere ingreso de número de legajo del responsable (${legajo}) y confirmación en MOT.WebLimpieza.`
          : task.tipoControl === 'Equipo'
          ? `Control de Temperatura de Equipamiento (${task.nombre}). Requiere validar legajo (${legajo}) y registrar temperaturas de Murales (Pollo: 0 a 1.9°C, demás Murales: 0 a 4°C), Freezers (-18 a -22°C) y Cámaras (0 a 4°C).`
          : `Ejecución y verificación en tienda de la tarea "${task.nombre}" dentro de la franja horaria asignada (${task.horario}).`,
      procedimientos: [],
      detalleTipoServer: task.tipoControl === 'Directa' ? '' : task.tipoControl,
      tieneBotonesCumplimiento: task.tieneBotonCheck,
    }
    setTaskDetail(fallbackDetail)
    setLoadingDetail(true)
    try {
      const r = await fetch(API_URL(`/api/mot-bot/task-detail?row=${task.rowIndex}`))
      const j = await r.json()
      if (j.ok && j.detail) {
        setTaskDetail({
          ...fallbackDetail,
          ...j.detail,
          descripcion: j.detail.descripcion || fallbackDetail.descripcion,
          descripcionHorario: j.detail.descripcionHorario || fallbackDetail.descripcionHorario,
        })
      }
    } catch (e) {
      console.warn('Mostrando detalle local de tarea:', e)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setAction('Subiendo sesión...')
    try {
      const text = await file.text()
      const json = JSON.parse(text)

      const r = await fetch(API_URL('/api/mot-bot/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      })

      if (!r.ok) throw new Error('Error al subir la sesión')

      alert('¡Sesión importada correctamente! Sincronizando tareas...')
      await fetchStatus()
      await fetchTasksDashboard(true)
    } catch (err: any) {
      alert(`Error al procesar el archivo: ${err.message}`)
    } finally {
      setLoading(false)
      setAction(null)
      e.target.value = ''
    }
  }

  // Filtrado de las 54 tareas
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        if (!t.nombre.toLowerCase().includes(q) && !t.horario.includes(q) && !t.rowIndex.includes(q)) {
          return false
        }
      }

      const style = getTaskStatusStyle(t)
      if (statusFilter === 'done' && !style.done) return false
      if (statusFilter === 'pending' && style.done) return false
      if (statusFilter === 'expired' && (style.done || style.label !== 'Fuera de ventana')) return false

      if (typeFilter !== 'all') {
        if (typeFilter === 'Otros') {
          if (['Directa', 'Limpieza', 'Equipo'].includes(t.tipoControl)) return false
        } else if (t.tipoControl !== typeFilter) {
          return false
        }
      }

      return true
    })
  }, [tasks, searchQuery, statusFilter, typeFilter])

  const tempTasks = useMemo(
    () => tasks.filter(t => t.tipoControl === 'Equipo'),
    [tasks]
  )

  const isRunning = data?.status === 'running'
  const isLoggedIn = data?.loggedIn || tasks.length > 0

  return (
    <div className="space-y-6">
      {/* ── CABECERA PRINCIPAL (TIENDA 624 + CONTROLES RAPIDOS) ── */}
      <div className="glass-card p-6 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900/95 via-slate-900/90 to-red-950/30">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-600 to-rose-800 flex items-center justify-center shadow-lg shadow-red-900/40 shrink-0">
              <Store size={28} className="text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  MOT DIA — {tiendaInfo?.nombre || 'Tienda 00624 AR'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                  Fecha: {tiendaInfo?.fecha || 'Hoy'}
                </span>
                <span
                  title="El servidor despierta solo al robot todos los días a las 05:30 AM y lo apaga a las 22:40 hs sin necesidad de dejar la web abierta"
                  className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                >
                  <Clock size={12} /> Auto-Agenda: {data?.wakeTime || '05:30'} a {data?.sleepTime || '22:40'} hs (24/7)
                </span>
                {isLoggedIn ? (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <Wifi size={12} /> Conectado a MOT Oficial
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <WifiOff size={12} /> Sin sesión activa
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm mt-1">
                Espejo interactivo en tiempo real de <code className="text-slate-300">mot.supermercadosdia.com.ar</code>. Toda tarea marcada aquí impacta directamente en el MOT original.
              </p>
            </div>
          </div>

          {/* Controles superiores: Legajo + Sincronizar + Iniciar/Detener Bot */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1.5">
              <span className="text-xs text-slate-400 font-medium">Legajo Resp.:</span>
              <input
                type="text"
                value={legajo}
                onChange={e => setLegajo(e.target.value)}
                className="w-20 bg-transparent text-white font-mono text-sm font-bold focus:outline-none text-center border-b border-slate-700 focus:border-red-500"
                placeholder="23250"
              />
            </div>

            <button
              onClick={() => fetchTasksDashboard(true)}
              disabled={syncingTasks}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm transition-all disabled:opacity-50 border border-slate-700"
            >
              <RefreshCw size={16} className={syncingTasks ? 'animate-spin text-sky-400' : 'text-sky-400'} />
              {syncingTasks ? 'Sincronizando MOT...' : 'Sincronizar MOT'}
            </button>

            {!isRunning ? (
              <button
                onClick={() => callApi('/api/mot-bot/start', 'Iniciando...')}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-emerald-950/50"
              >
                <Play size={16} />
                {action === 'Iniciando...' ? action : 'Activar Auto-Bot (+10m Inicio)'}
              </button>
            ) : (
              <button
                onClick={() => callApi('/api/mot-bot/stop', 'Deteniendo...')}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm transition-all disabled:opacity-50"
              >
                <Square size={16} />
                {action === 'Deteniendo...' ? action : 'Pausar Auto-Bot'}
              </button>
            )}
          </div>
        </div>

        {/* Barra de resumen de cumplimiento idéntica a MOT.GetPorcentajesTiendas */}
        {stats && (
          <div className="mt-6 pt-5 border-t border-slate-800/80">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
                <span className="text-xs text-slate-400 block">Total Tareas Hoy</span>
                <span className="text-2xl font-bold text-white">{stats.total}</span>
              </div>
              <div className="bg-emerald-950/25 border border-emerald-500/25 rounded-xl p-3">
                <span className="text-xs text-emerald-400/90 block">Cumplidas a Tiempo</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-emerald-400">{stats.cumplidas}</span>
                  <span className="text-xs font-semibold text-emerald-500">({stats.porcCumplidas}%)</span>
                </div>
              </div>
              <div className="bg-amber-950/25 border border-amber-500/25 rounded-xl p-3">
                <span className="text-xs text-amber-400/90 block">Fuera de Hora</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-amber-400">{stats.fueraDeHora}</span>
                  <span className="text-xs font-semibold text-amber-500">({stats.porcFueraDeHora}%)</span>
                </div>
              </div>
              <div className="bg-sky-950/25 border border-sky-500/25 rounded-xl p-3">
                <span className="text-xs text-sky-400/90 block">Pendientes en Horario</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-sky-400">{stats.pendientes}</span>
                  <span className="text-xs font-semibold text-sky-500">({stats.porcPendientes}%)</span>
                </div>
              </div>
              <div className="bg-rose-950/25 border border-rose-500/25 rounded-xl p-3">
                <span className="text-xs text-rose-400/90 block">Fuera de Ventana</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-rose-400">{stats.vencidas}</span>
                  <span className="text-xs font-semibold text-rose-500">({stats.porcVencidas}%)</span>
                </div>
              </div>
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3">
                <span className="text-xs text-slate-400 block">No Cumpl. / No Aplica</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-300">{stats.noCumplidas + stats.noAplica}</span>
                  <span className="text-xs text-slate-500">({stats.porcNoCumplidas + stats.porcNoAplica}%)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── PESTAÑAS DE NAVEGACIÓN (MODULOS DEL APK MOT) ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('tareas')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'tareas'
              ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
              : 'bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <ListChecks size={17} />
          Lista de Tareas ({tasks.length})
        </button>

        <button
          onClick={() => setActiveTab('temperatura')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'temperatura'
              ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
              : 'bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Thermometer size={17} />
          Control de Temperatura (Murales / Freezers / Cámaras)
        </button>

        <button
          onClick={() => setActiveTab('estadisticas')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'estadisticas'
              ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
              : 'bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <BarChart3 size={17} />
          Estadísticas de Cumplimiento
        </button>

        <button
          onClick={() => setActiveTab('bot')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'bot'
              ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
              : 'bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Bot size={17} />
          Bot Automático y Consola
          {isRunning && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
        </button>

        {lastSyncAt && (
          <span className="ml-auto text-xs text-slate-500">
            Últ. sincronización: {new Date(lastSyncAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          TAB 1: LISTA DE TAREAS DE TIENDA (Idéntica a MOT.ListaDeTareasTienda)
         ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'tareas' && (
        <div className="space-y-4">
          {/* Barra de búsqueda y filtros */}
          <div className="glass-card p-4 rounded-2xl border border-slate-800 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
            {/* Buscador */}
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar tarea por nombre o rango horario (ej: Limpieza, Temperatura, 08:00)..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950/90 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
              />
            </div>

            {/* Filtro por Estado */}
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                { id: 'all',     label: 'Todas' },
                { id: 'pending', label: 'Sin Marcar' },
                { id: 'done',    label: 'Cumplidas / Cerradas' },
                { id: 'expired', label: 'Fuera de Ventana' },
              ] as const).map(f => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    statusFilter === f.id
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Filtro por Tipo de Control */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter size={14} className="text-slate-500 mr-1" />
              {([
                { id: 'all',      label: 'Todos los Tipos' },
                { id: 'Directa',  label: 'Check Directo' },
                { id: 'Limpieza', label: 'Limpieza' },
                { id: 'Equipo',   label: 'Temperatura' },
                { id: 'Otros',    label: 'Recepción / Caduc.' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTypeFilter(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    typeFilter === t.id
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Grilla de Tareas */}
          {syncingTasks && tasks.length === 0 ? (
            <div className="glass-card p-12 rounded-2xl border border-slate-800 text-center space-y-3">
              <RefreshCw size={36} className="mx-auto text-red-500 animate-spin" />
              <p className="text-white font-semibold">Conectando con mot.supermercadosdia.com.ar y leyendo tareas del día...</p>
              <p className="text-xs text-slate-400">Esto toma unos segundos mientras se sincroniza la sesión oficial de la Tienda 624.</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="glass-card p-10 rounded-2xl border border-slate-800 text-center text-slate-400">
              No se encontraron tareas para el filtro seleccionado.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredTasks.map(task => {
                const st = getTaskStatusStyle(task)
                const ctrlBadge = getControlTypeBadge(task.tipoControl)
                const isMarking = markingRow === task.rowIndex

                return (
                  <div
                    key={task.rowIndex}
                    className={`glass-card rounded-xl border border-slate-800/90 hover:border-slate-700 transition-all p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${st.border}`}
                  >
                    {/* Izquierda: Nombre + Horario + Badges */}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">#{task.rowIndex}</span>
                        <button
                          onClick={() => handleOpenDetail(task)}
                          className="text-base font-bold text-white hover:text-red-400 transition-colors text-left truncate"
                        >
                          {task.nombre}
                        </button>
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${ctrlBadge.cls}`}>
                          {ctrlBadge.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="flex items-center gap-1.5 font-mono text-slate-300 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
                          <Clock size={13} className="text-red-400" />
                          {task.horario}
                        </span>

                        {!st.done && task.horarioInicio && (
                          ['Proveedor', 'Trazabilidad', 'Caducidad', 'Retiro', 'Almacen'].includes(task.tipoControl) ? (
                            <span
                              title="Esta tarea requiere información externa en tienda (Remito, Lote, Vencimiento, Albarán o Retiro) y el Robot la omite siempre"
                              className="flex items-center gap-1 font-mono text-[11px] text-rose-300 bg-rose-950/40 px-2.5 py-1 rounded-lg border border-rose-500/30"
                            >
                              <Store size={12} className="text-rose-400" />
                              Manual en Tienda (Omitida por Robot)
                            </span>
                          ) : (
                            <span
                              title="El Robot marca esta tarea automáticamente 10 minutos después de su horario de inicio"
                              className="flex items-center gap-1 font-mono text-[11px] text-amber-300 bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-500/30"
                            >
                              <Bot size={12} className="text-amber-400" />
                              Auto-Marca: {getAutoMarkTimeStr(task.horarioInicio, task.horarioCierre)} hs (+10m inicio)
                            </span>
                          )
                        )}

                        <span className={`px-2.5 py-1 rounded-lg font-semibold border ${st.badgeBg}`}>
                          {st.label}
                        </span>

                        {task.horaCumplimiento && (
                          <span className="text-emerald-400 font-mono font-semibold flex items-center gap-1">
                            <CheckCircle2 size={13} />
                            Cumplida a las {task.horaCumplimiento} hs
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Derecha: Botones de Acción (Idénticos al MOT Original: Cumplir, No Cumplir, No Aplica + Ver Detalle) */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {!st.done && (
                        <>
                          {task.tipoControl === 'Equipo' ? (
                            <button
                              onClick={() => {
                                setSelectedTempTaskRow(task.rowIndex)
                                setActiveTab('temperatura')
                              }}
                              disabled={isMarking}
                              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all shadow-md shadow-sky-950/50"
                            >
                              <Thermometer size={15} />
                              Cargar Temperaturas
                            </button>
                          ) : (
                            <button
                              onClick={() => handleMarkTask(task, task.tipoControl === 'Limpieza' ? 'LIMPIEZA' : 'C')}
                              disabled={isMarking}
                              title={
                                task.tipoControl === 'Limpieza'
                                  ? `Confirmar Limpieza en MOT con Legajo ${legajo}`
                                  : 'Marcar como Cumplida (✓) en MOT'
                              }
                              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-md shadow-emerald-950/50"
                            >
                              {isMarking ? (
                                <RefreshCw size={14} className="animate-spin" />
                              ) : (
                                <Check size={15} />
                              )}
                              {task.tipoControl === 'Limpieza' ? `Cumplir (Leg. ${legajo})` : 'Cumplir'}
                            </button>
                          )}

                          {task.tieneBotonCheck && (
                            <>
                              <button
                                onClick={() => {
                                  setMotivoInput('')
                                  setMotiveModal({ task, accion: 'NC' })
                                }}
                                disabled={isMarking}
                                title="Marcar como No Cumplida (✗) con motivo en MOT"
                                className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-red-950/60 hover:bg-red-900/70 text-red-300 border border-red-800/50 text-xs font-semibold transition-all disabled:opacity-50"
                              >
                                <X size={14} />
                                No Cumplir
                              </button>

                              <button
                                onClick={() => handleMarkTask(task, 'NA')}
                                disabled={isMarking}
                                title="Marcar como No Aplica (⊘) en MOT"
                                className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
                              >
                                <Ban size={14} />
                                No Aplica
                              </button>
                            </>
                          )}
                        </>
                      )}

                      <button
                        onClick={() => handleOpenDetail(task)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-semibold transition-all"
                      >
                        <Eye size={14} />
                        Detalle
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          TAB 2: CONTROL DE TEMPERATURA EQUIPAMIENTO (Idéntico a MOT.CtrTempEquipo)
         ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'temperatura' && (
        <div className="space-y-6">
          <div className="glass-card p-6 rounded-2xl border border-slate-800 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Thermometer className="text-sky-400" size={22} />
                  Control de Temperatura de Equipamiento — Tienda 624
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Replica exactamente el panel <code className="text-slate-300">MOT.WebEquipo</code> del MOT original (12 Murales, 7 Freezers y 2 Cámaras).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Selector de turno de control (1er o 2do Control de Temperatura) */}
                <select
                  value={selectedTempTaskRow}
                  onChange={e => setSelectedTempTaskRow(e.target.value)}
                  className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white font-semibold focus:outline-none focus:border-sky-500"
                >
                  {tempTasks.length > 0 ? (
                    tempTasks.map(tt => (
                      <option key={tt.rowIndex} value={tt.rowIndex}>
                        #{tt.rowIndex} — {tt.nombre} ({tt.horario}) [{tt.estadoCode || 'Pendiente'}]
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="0015">#0015 — 1er Control de Temperatura (07:10 - 07:55)</option>
                      <option value="0043">#0043 — 2do Control de Temperatura (17:00 - 21:55)</option>
                    </>
                  )}
                </select>

                <button
                  onClick={() => generateSafeTemperatures(equipamiento)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 text-xs font-bold transition-all"
                >
                  <Sparkles size={15} />
                  Motor IA: Recalcular Temperaturas
                </button>

                <button
                  onClick={() => {
                    const target = tasks.find(t => t.rowIndex === selectedTempTaskRow) || {
                      rowIndex: selectedTempTaskRow,
                      nombre: selectedTempTaskRow === '0043' ? '2do Control de Temperatura' : '1er Control de Temperatura',
                      horario: '',
                      horarioInicio: '',
                      horarioCierre: '',
                      maestroTareaGUID: '',
                      actividadGUID: '',
                      tiendaId: '624',
                      fecha: '',
                      estadoCode: '' as const,
                      estadoTexto: 'pendiente',
                      horaCumplimiento: '',
                      tieneBotonCheck: false,
                      esCliqueable: true,
                      detailLink: '',
                      tipoControl: 'Equipo' as const,
                    }
                    handleMarkTask(target, 'EQUIPO', undefined, tempValues)
                  }}
                  disabled={markingRow !== null}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-lg shadow-emerald-950/50"
                >
                  {markingRow ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                  {markingRow ? 'Enviando a MOT...' : `Enviar y Aprobar en MOT (Leg. ${legajo})`}
                </button>
              </div>
            </div>

            {/* Banner Motor IA de Clasificación y Reglas Térmicas */}
            <div className="bg-slate-950/80 border border-sky-500/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-sky-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Motor IA de Aprendizaje y Perfiles Térmicos Activo
                  </span>
                </div>
                <span className="text-[11px] text-sky-300 font-mono bg-sky-950/50 px-2.5 py-1 rounded-lg border border-sky-500/30">
                  🔄 Variación Diaria Anti-Repetición (±0.2°C a ±0.7°C vs. Día Anterior)
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-2.5">
                  <p className="font-bold text-amber-300">🐔 Mural de Pollo</p>
                  <p className="text-[11px] text-slate-300 font-mono mt-0.5">Rango Estricto: 0.0°C a 1.9°C</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Detecta &quot;Mural Pollo 1&quot; (T° Prod &lt; 1.8°C)</p>
                </div>
                <div className="bg-sky-950/30 border border-sky-500/30 rounded-xl p-2.5">
                  <p className="font-bold text-sky-300">🧀 Demás Murales (11 eq.)</p>
                  <p className="text-[11px] text-slate-300 font-mono mt-0.5">Rango General: 0.0°C a 4.0°C</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Murales 01-09, 4ta Gama y Carne</p>
                </div>
                <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-2.5">
                  <p className="font-bold text-indigo-300">❄️ Freezers / Congelados (7 eq.)</p>
                  <p className="text-[11px] text-slate-300 font-mono mt-0.5">Rango Congelado: -18.0°C a -22.0°C</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Freezers 01-05, Comercial y Remonte</p>
                </div>
                <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-2.5">
                  <p className="font-bold text-emerald-300">🏭 Reserva / Cámaras (2 eq.)</p>
                  <p className="text-[11px] text-slate-300 font-mono mt-0.5">Cám. Carne: 0 a 2°C | Cám. 1: 0 a 4°C</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Diferenciación automática por cámara</p>
                </div>
              </div>
            </div>

            {/* Categorías: Murales, Freezers, Cámaras */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {equipamiento.map(cat => (
                <div key={cat.CtgCtrlTempGUID} className="bg-slate-950/70 rounded-2xl border border-slate-800 overflow-hidden">
                  <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="font-bold text-white text-sm">{cat.CtgCtrlTempDesc}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                      {cat.Equipamiento.length} equipos
                    </span>
                  </div>
                  <div className="divide-y divide-slate-800/60 max-h-[460px] overflow-y-auto">
                    {cat.Equipamiento.map(eq => {
                      const val = tempValues[eq.EquipamientoGUID] || { equipo: '0.4', producto: '1.5', nombre: eq.EquipamientoNomb }
                      return (
                        <div key={eq.EquipamientoGUID} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-900/40">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{eq.EquipamientoNomb}</p>
                            {eq.EquipamientoNomb.toLowerCase().includes('pollo') ? (
                              <span className="text-[10px] text-amber-400 font-medium">Rango IA: 0.0 a 1.9°C (Pollo)</span>
                            ) : cat.CtgCtrlTempDesc.toLowerCase().includes('mural') ? (
                              <span className="text-[10px] text-sky-400/80">Rango IA: 0.0 a 4.0°C (Mural)</span>
                            ) : cat.CtgCtrlTempDesc.toLowerCase().includes('freezer') ? (
                              <span className="text-[10px] text-indigo-400/80">Rango IA: -18.0 a -22.0°C (Freezer)</span>
                            ) : eq.EquipamientoNomb.toLowerCase().includes('carne') ? (
                              <span className="text-[10px] text-emerald-400 font-medium">Rango IA: 0.0 a 2.0°C (Reserva Carne)</span>
                            ) : (
                              <span className="text-[10px] text-emerald-400/80">Rango IA: 0.0 a 4.0°C (Reserva General)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div>
                              <label className="text-[10px] text-slate-500 block text-center">Equipo °C</label>
                              <input
                                type="text"
                                value={val.equipo}
                                onChange={e =>
                                  setTempValues(prev => ({
                                    ...prev,
                                    [eq.EquipamientoGUID]: { ...val, equipo: e.target.value },
                                  }))
                                }
                                className="w-16 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-sky-300 text-center"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500 block text-center">Prod. °C</label>
                              <input
                                type="text"
                                value={val.producto}
                                onChange={e =>
                                  setTempValues(prev => ({
                                    ...prev,
                                    [eq.EquipamientoGUID]: { ...val, producto: e.target.value },
                                  }))
                                }
                                className="w-16 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-emerald-300 text-center"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          TAB 3: ESTADÍSTICAS DE CUMPLIMIENTO (Idéntico a MOT.WCGraficosCumplimiento)
         ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'estadisticas' && stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 rounded-2xl border border-slate-800 space-y-5">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart3 className="text-red-400" size={20} />
              Porcentajes de Cumplimiento del Día — Tienda 624
            </h2>

            <div className="space-y-4">
              {[
                { label: 'Cumplidas a tiempo', count: stats.cumplidas, pct: stats.porcCumplidas, bar: 'bg-emerald-500', text: 'text-emerald-400' },
                { label: 'Cumplidas fuera de hora', count: stats.fueraDeHora, pct: stats.porcFueraDeHora, bar: 'bg-amber-500', text: 'text-amber-400' },
                { label: 'Pendientes en horario', count: stats.pendientes, pct: stats.porcPendientes, bar: 'bg-sky-500', text: 'text-sky-400' },
                { label: 'Vencidas / Fuera de ventana', count: stats.vencidas, pct: stats.porcVencidas, bar: 'bg-rose-500', text: 'text-rose-400' },
                { label: 'No cumplidas', count: stats.noCumplidas, pct: stats.porcNoCumplidas, bar: 'bg-red-600', text: 'text-red-400' },
                { label: 'No aplican', count: stats.noAplica, pct: stats.porcNoAplica, bar: 'bg-slate-500', text: 'text-slate-400' },
              ].map((row, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">{row.label}</span>
                    <span className={row.text}>
                      {row.count} tareas ({row.pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                    <div className={`h-full ${row.bar} transition-all duration-500`} style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-slate-800 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileText className="text-sky-400" size={20} />
              Desglose por Tipo de Tarea en MOT
            </h2>
            <div className="divide-y divide-slate-800/70">
              {(['Directa', 'Limpieza', 'Equipo', 'Caducidad', 'Almacen', 'Proveedor', 'Retiro', 'Trazabilidad'] as const).map(tipo => {
                const group = tasks.filter(t => t.tipoControl === tipo)
                const doneCount = group.filter(t => getTaskStatusStyle(t).done).length
                const badge = getControlTypeBadge(tipo)
                return (
                  <div key={tipo} className="py-3 flex items-center justify-between">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <div className="text-right">
                      <span className="text-sm font-bold text-white">{doneCount} / {group.length}</span>
                      <span className="text-xs text-slate-500 ml-2">completadas</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          TAB 4: BOT AUTOMÁTICO Y CONSOLA DE LOGS
         ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'bot' && (
        <div className="space-y-6">
          {/* Tarjeta de estado del Scheduler */}
          <div className="glass-card p-6 rounded-2xl border border-slate-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Estado del Scheduler Automático</p>
                {data ? (
                  <StatusBadge status={data.status} />
                ) : (
                  <span className="flex items-center gap-2 text-sm text-slate-500">
                    <WifiOff size={14} /> Sin conexión con el backend
                  </span>
                )}
                {data?.lastError && (
                  <div className="flex items-start gap-2 text-xs text-red-400 max-w-md">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{data.lastError}</span>
                  </div>
                )}
              </div>

              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">Próximo ciclo (60s)</p>
                <Countdown nextRunAt={data?.nextRunAt ?? null} />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => callApi('/api/mot-bot/login', 'Re-logueando...')}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-all disabled:opacity-50"
                >
                  <LogIn size={16} />
                  {action === 'Re-logueando...' ? action : 'Forzar Login Google'}
                </button>

                <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm transition-all cursor-pointer border border-slate-700">
                  <Upload size={16} />
                  {action === 'Subiendo sesión...' ? action : 'Subir storage_state.json'}
                  <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} disabled={loading} />
                </label>

                <button
                  onClick={() => {
                    if (confirm('¿Seguro que querés reiniciar el historial del bot a 0%?')) {
                      callApi('/api/mot-bot/reset', 'Reiniciando...')
                    }
                  }}
                  disabled={loading}
                  title="Reiniciar a 0%"
                  className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Historial de Marcaciones + Consola */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden">
              <div className="p-5 border-b border-slate-800/60 flex items-center justify-between">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  Marcaciones enviadas desde esta web / Bot hoy
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                  {data?.marcaciones?.length ?? 0}
                </span>
              </div>
              <div className="divide-y divide-slate-800/60 max-h-80 overflow-y-auto">
                {(!data?.marcaciones || data.marcaciones.length === 0) ? (
                  <div className="p-6 text-center text-slate-500 text-sm">
                    <Clock size={32} className="mx-auto mb-2 opacity-30" />
                    Sin marcaciones registradas en esta sesión
                  </div>
                ) : (
                  data.marcaciones.map((m, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-slate-800/30 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        {m.estado === 'marcado' ? (
                          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle size={16} className="text-red-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm text-white font-medium truncate">{m.tarea}</p>
                          {m.msg && <p className="text-xs text-red-400 truncate">{m.msg}</p>}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-xs text-slate-400">{m.horarioCierre}</p>
                        <p className="text-xs text-slate-600">
                          {new Date(m.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden">
              <div className="p-5 border-b border-slate-800/60">
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <ChevronRight size={16} className="text-sky-400" />
                  Consola en Vivo del Bot MOT
                </h2>
              </div>
              <div className="divide-y divide-slate-800/40 max-h-80 overflow-y-auto font-mono text-xs">
                {(!data?.botLogs || data.botLogs.length === 0) ? (
                  <div className="p-6 text-center text-slate-500 text-sm font-sans">
                    <Bot size={32} className="mx-auto mb-2 opacity-20" />
                    El bot no ha generado logs todavía
                  </div>
                ) : (
                  data.botLogs.map((l, i) => {
                    const color = l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-slate-300'
                    return (
                      <div key={i} className="flex items-start gap-3 px-4 py-2 hover:bg-slate-800/20">
                        <span className="text-slate-600 shrink-0">
                          {new Date(l.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className={`${color} break-all`}>{l.msg}</span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          MODAL: DETALLE DE TAREA (Idéntico a MOT.VerTarea / MOT.WebVerTarea)
         ══════════════════════════════════════════════════════════════════════════ */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-mono text-red-400">DETALLE DE TAREA MOT #{selectedTask.rowIndex}</span>
                <h3 className="text-xl font-bold text-white mt-0.5">{selectedTask.nombre}</h3>
                <p className="text-xs text-slate-400 mt-1">Horario oficial: {selectedTask.horario}</p>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {loadingDetail ? (
                <div className="py-10 text-center space-y-2">
                  <RefreshCw size={28} className="mx-auto text-red-500 animate-spin" />
                  <p className="text-sm text-slate-300">Cargando instrucciones y procedimientos desde MOT...</p>
                </div>
              ) : taskDetail ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                      <span className="text-xs text-slate-500 uppercase font-bold block">Bloque: {taskDetail.bloque}</span>
                      <p className="text-xs text-slate-300 mt-1">{taskDetail.descripcionHorario || `Se realiza entre ${selectedTask.horario}`}</p>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                      <span className="text-xs text-slate-500 uppercase font-bold block">Días de aplicación</span>
                      <p className="text-xs text-slate-300 mt-1">{taskDetail.diasDeSemana || 'Todos'}</p>
                    </div>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Detalle / Instrucciones de MOT</h4>
                    <p className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">
                      {taskDetail.descripcion || 'Sin instrucciones adicionales.'}
                    </p>
                  </div>

                  {taskDetail.procedimientos && taskDetail.procedimientos.length > 0 && (
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Procedimientos Asociados</h4>
                      <div className="flex flex-wrap gap-2">
                        {taskDetail.procedimientos.map((proc, idx) => (
                          <span key={idx} className="px-3 py-1 rounded-lg bg-red-950/50 border border-red-800/40 text-xs text-red-300 font-semibold">
                            {proc}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              {/* Acciones directas desde el modal de detalle */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Legajo:</span>
                  <input
                    type="text"
                    value={legajo}
                    onChange={e => setLegajo(e.target.value)}
                    className="w-20 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-white text-center"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedTask.tipoControl === 'Equipo' ? (
                    <button
                      onClick={() => {
                        const row = selectedTask.rowIndex
                        setSelectedTask(null)
                        setSelectedTempTaskRow(row)
                        setActiveTab('temperatura')
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold"
                    >
                      <Thermometer size={15} />
                      Ir al Cargador de Temperaturas
                    </button>
                  ) : (
                    <button
                      onClick={() => handleMarkTask(selectedTask, selectedTask.tipoControl === 'Limpieza' ? 'LIMPIEZA' : 'C')}
                      disabled={markingRow === selectedTask.rowIndex}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
                    >
                      <Check size={15} />
                      {selectedTask.tipoControl === 'Limpieza' ? `Confirmar Limpieza (Leg. ${legajo})` : 'Cumplir en MOT'}
                    </button>
                  )}

                  {selectedTask.tieneBotonCheck && (
                    <>
                      <button
                        onClick={() => {
                          setMotivoInput('')
                          setMotiveModal({ task: selectedTask, accion: 'NC' })
                        }}
                        disabled={markingRow === selectedTask.rowIndex}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-900/60 hover:bg-red-800 text-red-200 text-xs font-semibold"
                      >
                        <X size={15} />
                        No Cumplir
                      </button>

                      <button
                        onClick={() => handleMarkTask(selectedTask, 'NA')}
                        disabled={markingRow === selectedTask.rowIndex}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                      >
                        <Ban size={15} />
                        No Aplica
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════
          MODAL: INGRESAR MOTIVO DE INCUMPLIMIENTO (MOT.WCIngresarMotivoIncumplimiento)
         ══════════════════════════════════════════════════════════════════════════ */}
      {motiveModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Ingresar Motivo para MOT</h3>
              <button onClick={() => setMotiveModal(null)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Tarea: <strong className="text-white">{motiveModal.task.nombre}</strong>
            </p>
            <textarea
              rows={3}
              value={motivoInput}
              onChange={e => setMotivoInput(e.target.value)}
              placeholder="Escribí el motivo que se registrará en el MOT original..."
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-red-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMotiveModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const { task, accion } = motiveModal
                  const mot = motivoInput.trim() || 'Incumplimiento operativo en tienda'
                  setMotiveModal(null)
                  await handleMarkTask(task, accion, mot)
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
              >
                Confirmar y Enviar a MOT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
