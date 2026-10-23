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

type MotStatus = {
  status: 'stopped' | 'running' | 'error' | 'needs_login' | 'logging_in'
  needsLogin: boolean
  loggedIn: boolean
  startedAt: string | null
  nextRunAt: string | null
  lastError: string | null
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
    running:     { label: 'Bot Activo',    color: 'text-emerald-400', dot: 'bg-emerald-400 animate-pulse' },
    stopped:     { label: 'Bot Detenido',  color: 'text-slate-400',   dot: 'bg-slate-500' },
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

export default function MotBotPage() {
  const [data, setData]               = useState<MotStatus | null>(null)
  const [tasks, setTasks]             = useState<MotTask[]>([])
  const [stats, setStats]             = useState<MotStats | null>(null)
  const [tiendaInfo, setTiendaInfo]   = useState<{ id: string; nombre: string; fecha: string; horario: string } | null>(null)
  const [equipamiento, setEquipamiento] = useState<EquipamientoCategoria[]>([])
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
  const [selectedTempTaskRow, setSelectedTempTaskRow] = useState<string>('0015')

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
        setTasks(j.tasks || [])
        setStats(j.stats || null)
        setTiendaInfo(j.tienda || null)
        setLastSyncAt(j.lastSyncAt || null)
        if (j.equipamiento && j.equipamiento.length > 0) {
          setEquipamiento(j.equipamiento)
        }
      }
    } catch (e) {
      console.error('Error cargando tareas MOT:', e)
    } finally {
      setSyncingTasks(false)
    }
  }, [])

  // Inicializar valores seguros de temperatura cuando se carga el equipamiento
  // Reglas de rango:
  // - Mural de Pollo: 0 a 1.9 °C
  // - Demás Murales: 0 a 4.0 °C
  // - Freezers: -18 a -22 °C
  const generateSafeTemperatures = useCallback((cats: EquipamientoCategoria[]) => {
    const next: Record<string, { equipo: string; producto: string; nombre: string }> = {}
    for (const cat of cats) {
      const isFreezer = cat.CtgCtrlTempDesc.toLowerCase().includes('freezer')
      for (const item of cat.Equipamiento) {
        const isPollo = item.EquipamientoNomb.toLowerCase().includes('pollo')
        let eq = (Math.random() * (3.5 - 0.2) + 0.2).toFixed(1)
        let pr = (Math.random() * (3.8 - 0.5) + 0.5).toFixed(1)
        if (isPollo) {
          eq = (Math.random() * (1.6 - 0.1) + 0.1).toFixed(1)
          pr = (Math.random() * (1.9 - 0.2) + 0.2).toFixed(1)
        } else if (isFreezer) {
          eq = (-18.5 - Math.random() * 2.5).toFixed(1)
          pr = (-18.0 - Math.random() * 2.0).toFixed(1)
        }
        next[item.EquipamientoGUID] = {
          equipo: eq,
          producto: pr,
          nombre: item.EquipamientoNomb,
        }
      }
    }
    setTempValues(next)
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
   * Envía la señal de marcación al MOT original desde nuestra web.
   */
  async function handleMarkTask(
    task: MotTask,
    accion: 'C' | 'NC' | 'NA' | 'LIMPIEZA' | 'EQUIPO',
    motivo?: string,
    customTemps?: Record<string, { equipo: string; producto: string; nombre: string }>
  ) {
    setMarkingRow(task.rowIndex)
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
      if (!r.ok || !j.ok) {
        throw new Error(j.error || 'No se pudo marcar la tarea en MOT.')
      }
      if (j.tasks) setTasks(j.tasks)
      if (j.stats) setStats(j.stats)
      await fetchStatus()
      if (selectedTask && selectedTask.rowIndex === task.rowIndex && j.tasks) {
        const updatedTask = j.tasks.find((t: MotTask) => t.rowIndex === task.rowIndex)
        if (updatedTask) setSelectedTask(updatedTask)
      }
    } catch (err: any) {
      alert(`Aviso al marcar en MOT: ${err.message}`)
    } finally {
      setMarkingRow(null)
    }
  }

  /**
   * Abre el modal de Detalle de Tarea (MOT.WebVerTarea) y consulta los procedimientos e instrucciones reales.
   */
  async function handleOpenDetail(task: MotTask) {
    setSelectedTask(task)
    setTaskDetail(null)
    setLoadingDetail(true)
    try {
      const r = await fetch(API_URL(`/api/mot-bot/task-detail?row=${task.rowIndex}`))
      const j = await r.json()
      if (j.ok && j.detail) {
        setTaskDetail(j.detail)
      }
    } catch (e) {
      console.error('Error cargando detalle de tarea:', e)
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
                {action === 'Iniciando...' ? action : 'Activar Auto-Bot (10m)'}
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
                  Generar Temperaturas Seguras
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
                              <span className="text-[10px] text-amber-400 font-medium">Rango: 0 a 1.9°C</span>
                            ) : cat.CtgCtrlTempDesc.toLowerCase().includes('mural') ? (
                              <span className="text-[10px] text-sky-400/80">Rango: 0 a 4°C</span>
                            ) : cat.CtgCtrlTempDesc.toLowerCase().includes('freezer') ? (
                              <span className="text-[10px] text-indigo-400/80">Rango: -18 a -22°C</span>
                            ) : (
                              <span className="text-[10px] text-emerald-400/80">Rango: 0 a 4°C</span>
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
