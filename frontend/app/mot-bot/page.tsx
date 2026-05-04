'use client'

import { useState, useEffect, useCallback } from 'react'
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
  ChevronRight
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

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

function StatusBadge({ status }: { status: MotStatus['status'] }) {
  const map: Record<string, { label: string; color: string; dot: string }> = {
    running:    { label: 'Activo',        color: 'text-emerald-400', dot: 'bg-emerald-400 animate-pulse' },
    stopped:    { label: 'Detenido',      color: 'text-slate-400',   dot: 'bg-slate-500' },
    error:      { label: 'Error',         color: 'text-red-400',     dot: 'bg-red-500 animate-pulse' },
    needs_login:{ label: 'Sin sesión',    color: 'text-amber-400',   dot: 'bg-amber-400 animate-pulse' },
    logging_in: { label: 'Logueando...',  color: 'text-blue-400',    dot: 'bg-blue-400 animate-spin' },
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
    <span className="font-mono text-sky-400 text-lg font-bold">{secs}s</span>
  )
}

export default function MotBotPage() {
  const [data,    setData]    = useState<MotStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [action,  setAction]  = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/mot-bot/status`)
      const j = await r.json()
      setData(j)
    } catch (_) {
      setData(null)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 15000)
    return () => clearInterval(id)
  }, [fetchStatus])

  async function callApi(endpoint: string, label: string) {
    setLoading(true)
    setAction(label)
    try {
      const r = await fetch(`${API}${endpoint}`, { method: 'POST' })
      await r.json()
      await fetchStatus()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const isRunning = data?.status === 'running'
  const needsLogin = data?.status === 'needs_login' || data?.needsLogin

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600 to-rose-800 flex items-center justify-center shadow-lg shadow-red-900/40">
          <Bot size={24} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">MOT Bot</h1>
          <p className="text-slate-400 text-sm">Automatización de marcación de tareas DIA</p>
        </div>
        <button
          onClick={fetchStatus}
          className="ml-auto p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          title="Actualizar"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Control Card */}
      <div className="glass-card p-6 rounded-2xl border border-slate-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          {/* Status */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Estado</p>
            {data ? (
              <StatusBadge status={data.status} />
            ) : (
              <span className="flex items-center gap-2 text-sm text-slate-500">
                <WifiOff size={14} /> Sin conexión con el backend
              </span>
            )}
            {data?.loggedIn && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <Wifi size={12} /> Sesión MOT activa
              </div>
            )}
            {data?.lastError && (
              <div className="flex items-start gap-2 text-xs text-red-400 max-w-xs">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{data.lastError}</span>
              </div>
            )}
          </div>

          {/* Next run */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1">Próximo ciclo</p>
            <Countdown nextRunAt={data?.nextRunAt ?? null} />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {needsLogin && (
              <button
                id="mot-btn-login"
                onClick={() => callApi('/api/mot-bot/login', 'Abriendo navegador...')}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-all disabled:opacity-50"
              >
                <LogIn size={16} />
                {action === 'Abriendo navegador...' ? action : 'Login Manual'}
              </button>
            )}

            {!isRunning ? (
              <button
                id="mot-btn-start"
                onClick={() => callApi('/api/mot-bot/start', 'Iniciando...')}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all disabled:opacity-50"
              >
                <Play size={16} />
                {action === 'Iniciando...' ? action : 'Iniciar Bot'}
              </button>
            ) : (
              <button
                id="mot-btn-stop"
                onClick={() => callApi('/api/mot-bot/stop', 'Deteniendo...')}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition-all disabled:opacity-50"
              >
                <Square size={16} />
                {action === 'Deteniendo...' ? action : 'Detener Bot'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Alert: needs login */}
      {needsLogin && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 font-semibold text-sm">Primera configuración requerida</p>
            <p className="text-amber-400/80 text-xs mt-1">
              No hay sesión de Google guardada. Hacé click en <strong>Login Manual</strong> para que se abra 
              el navegador y puedas completar el inicio de sesión. La sesión se guardará automáticamente 
              para los próximos ciclos.
            </p>
          </div>
        </div>
      )}

      {/* Grid: Marcaciones + Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Marcaciones del día */}
        <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden">
          <div className="p-5 border-b border-slate-800/60 flex items-center justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" />
              Marcaciones de hoy
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {data?.marcaciones?.length ?? 0}
            </span>
          </div>
          <div className="divide-y divide-slate-800/60 max-h-80 overflow-y-auto">
            {(!data?.marcaciones || data.marcaciones.length === 0) ? (
              <div className="p-6 text-center text-slate-500 text-sm">
                <Clock size={32} className="mx-auto mb-2 opacity-30" />
                Sin marcaciones registradas hoy
              </div>
            ) : (
              data.marcaciones.map((m, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-slate-800/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    {m.estado === 'marcado' ? (
                      <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    ) : m.estado === 'error' ? (
                      <XCircle size={16} className="text-red-400 shrink-0" />
                    ) : (
                      <Clock size={16} className="text-slate-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-white font-medium truncate">{m.tarea}</p>
                      {m.msg && <p className="text-xs text-red-400 truncate">{m.msg}</p>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-xs text-slate-400">cierre {m.horarioCierre}</p>
                    <p className="text-xs text-slate-600">{new Date(m.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Log del bot */}
        <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden">
          <div className="p-5 border-b border-slate-800/60">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <ChevronRight size={16} className="text-sky-400" />
              Log del bot
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

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card rounded-xl border border-slate-800 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Ciclo de verificación</p>
          <p className="text-2xl font-bold text-white">60<span className="text-base text-slate-400 font-normal ml-1">seg</span></p>
        </div>
        <div className="glass-card rounded-xl border border-slate-800 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Ventana de marcación</p>
          <p className="text-2xl font-bold text-white">10<span className="text-base text-slate-400 font-normal ml-1">min antes</span></p>
        </div>
        <div className="glass-card rounded-xl border border-slate-800 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Marcadas hoy</p>
          <p className="text-2xl font-bold text-emerald-400">{data?.markedToday?.length ?? 0}</p>
        </div>
      </div>
    </div>
  )
}
