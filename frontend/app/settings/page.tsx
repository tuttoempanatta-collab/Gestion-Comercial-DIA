'use client'

import { useState, useEffect, useRef } from 'react'
import { Save, Lock, User, Globe, ShieldCheck, AlertTriangle, Database, Upload, RefreshCw, Search, Package, CheckCircle2, Loader2, Users, Plus, Trash2, Sun, Moon, Calendar, Copy, Check } from 'lucide-react'
import { API_URL } from '@/lib/api'

// ── File System Access API helpers ──────────────────────────────────────────
const DB_STORE = 'catalog-file-store'
const DB_KEY = 'catalogFileHandle'

async function saveFileHandle(handle: FileSystemFileHandle) {
  const db: IDBDatabase = await new Promise((res, rej) => {
    const req = indexedDB.open(DB_STORE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('handles')
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('handles', 'readwrite')
    tx.objectStore('handles').put(handle, DB_KEY)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

async function loadFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const req = indexedDB.open(DB_STORE, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('handles')
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    return await new Promise((res) => {
      const tx = db.transaction('handles', 'readonly')
      const req = tx.objectStore('handles').get(DB_KEY)
      req.onsuccess = () => res(req.result || null)
      req.onerror = () => res(null)
    })
  } catch {
    return null
  }
}


// ─────────────────────────────────────────────────────────────────────────────

interface CatalogStatus { total: number; lastUpdate: string | null }
interface CatalogItem { item_id: string; loyalty_description: string; price_amount: number; current_quantity: number }
interface DbStatus { provider: string; isSqlite: boolean; hasDatabaseUrl: boolean; error: string | null; active: boolean }

interface ScheduleDay {
  date: string
  dayName: string
  formattedDate: string
  fullLabel: string
  manana: string
  tarde: string
  isToday: boolean
}

interface WeekInfo {
  id: string
  label: string
  startDate: string
  endDate: string
  days: ScheduleDay[]
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({ username: '', password: '', portal_url: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  // Database connection status
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)

  // Catalog state
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ imported: number } | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [savedHandle, setSavedHandle] = useState<FileSystemFileHandle | null>(null)
  const [savedHandleName, setSavedHandleName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Catalog items table
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogPage, setCatalogPage] = useState(1)
  const [isLoadingItems, setIsLoadingItems] = useState(false)

  // Legajos MOT (Turnos Mañana y Tarde)
  const [legajosList, setLegajosList] = useState<{ legajo: string; nombre: string }[]>([])
  const [legajoManana, setLegajoManana] = useState('23250')
  const [legajoTarde, setLegajoTarde] = useState('23250')
  const [newLegajoNum, setNewLegajoNum] = useState('')
  const [newLegajoNombre, setNewLegajoNombre] = useState('')
  const [isSavingLegajo, setIsSavingLegajo] = useState(false)
  const [legajoMsg, setLegajoMsg] = useState('')

  // Calendario Semanal Dinámico (2 Semanas)
  const [selectedWeekTab, setSelectedWeekTab] = useState<'current' | 'next'>('current')
  const [currentWeek, setCurrentWeek] = useState<WeekInfo | null>(null)
  const [nextWeek, setNextWeek] = useState<WeekInfo | null>(null)
  const [todayInfo, setTodayInfo] = useState<ScheduleDay | null>(null)
  const [isSavingSchedule, setIsSavingSchedule] = useState(false)
  const [scheduleMsg, setScheduleMsg] = useState('')

  // Feature detection (client-only, avoids hydration mismatch)
  const [hasFSA, setHasFSA] = useState(false)

  useEffect(() => {
    setHasFSA(typeof window !== 'undefined' && 'showOpenFilePicker' in window)
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchCatalogStatus()
    fetchDbStatus()
    fetchLegajos()
    fetchSchedule()
    loadFileHandle().then(h => {
      if (h) { setSavedHandle(h); setSavedHandleName(h.name) }
    })
  }, [])

  const fetchSchedule = async () => {
    try {
      const res = await fetch(API_URL('/api/mot-bot/schedule'))
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setCurrentWeek(data.currentWeek)
          setNextWeek(data.nextWeek)
          setTodayInfo(data.today)
          if (Array.isArray(data.legajosList) && data.legajosList.length > 0) {
            setLegajosList(data.legajosList)
          }
        }
      }
    } catch (_) {}
  }

  const handleDayShiftChange = (weekType: 'current' | 'next', date: string, shift: 'manana' | 'tarde', val: string) => {
    const updateWeek = (prev: WeekInfo | null): WeekInfo | null => {
      if (!prev) return null
      return {
        ...prev,
        days: prev.days.map(d => (d.date === date ? { ...d, [shift]: val } : d)),
      }
    }
    if (weekType === 'current') {
      setCurrentWeek(updateWeek)
    } else {
      setNextWeek(updateWeek)
    }
  }

  const handleSaveSchedule = async () => {
    if (!currentWeek || !nextWeek) return
    setIsSavingSchedule(true)
    setScheduleMsg('')
    try {
      const scheduleMap: Record<string, { manana: string; tarde: string }> = {}
      currentWeek.days.forEach(d => {
        scheduleMap[d.date] = { manana: d.manana, tarde: d.tarde }
      })
      nextWeek.days.forEach(d => {
        scheduleMap[d.date] = { manana: d.manana, tarde: d.tarde }
      })

      const res = await fetch(API_URL('/api/mot-bot/schedule'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: scheduleMap }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setCurrentWeek(data.currentWeek)
          setNextWeek(data.nextWeek)
          setTodayInfo(data.today)
          setScheduleMsg('✓ Planificación guardada correctamente.')
          setTimeout(() => setScheduleMsg(''), 3000)
        }
      }
    } catch {
      setScheduleMsg('Error al guardar la planificación.')
    } finally {
      setIsSavingSchedule(false)
    }
  }

  const handleCopyWeek = async () => {
    setIsSavingSchedule(true)
    setScheduleMsg('')
    try {
      const res = await fetch(API_URL('/api/mot-bot/schedule/copy-week'), {
        method: 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setCurrentWeek(data.currentWeek)
          setNextWeek(data.nextWeek)
          setTodayInfo(data.today)
          setScheduleMsg('✓ Semana actual copiada a la semana siguiente.')
          setTimeout(() => setScheduleMsg(''), 3000)
        }
      }
    } catch {
      setScheduleMsg('Error al copiar semana.')
    } finally {
      setIsSavingSchedule(false)
    }
  }

  const fetchLegajos = async () => {
    try {
      const res = await fetch(API_URL('/api/mot-bot/legajos'))
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          if (Array.isArray(data.legajos)) setLegajosList(data.legajos)
          if (data.manana) setLegajoManana(data.manana)
          if (data.tarde) setLegajoTarde(data.tarde)
        }
      }
    } catch (_) {}
  }

  const handleAddLegajo = async () => {
    if (!newLegajoNum.trim()) return
    setIsSavingLegajo(true)
    setLegajoMsg('')
    try {
      const res = await fetch(API_URL('/api/mot-bot/legajos'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legajo: newLegajoNum.trim(), nombre: newLegajoNombre.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setLegajosList(data.legajos)
          setNewLegajoNum('')
          setNewLegajoNombre('')
          setLegajoMsg('Legajo agregado correctamente.')
          setTimeout(() => setLegajoMsg(''), 3000)
        }
      }
    } catch {
      setLegajoMsg('Error al agregar legajo.')
    } finally {
      setIsSavingLegajo(false)
    }
  }

  const handleDeleteLegajo = async (legajoToDelete: string) => {
    try {
      const res = await fetch(API_URL(`/api/mot-bot/legajos/${encodeURIComponent(legajoToDelete)}`), {
        method: 'DELETE',
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setLegajosList(data.legajos)
          if (data.manana) setLegajoManana(data.manana)
          if (data.tarde) setLegajoTarde(data.tarde)
        }
      }
    } catch (_) {}
  }

  const handleSaveShiftSelection = async (manana: string, tarde: string) => {
    setLegajoManana(manana)
    setLegajoTarde(tarde)
    try {
      await fetch(API_URL('/api/mot-bot/legajos/selection'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manana, tarde }),
      })
      setLegajoMsg('Turnos actualizados.')
      setTimeout(() => setLegajoMsg(''), 2500)
    } catch (_) {}
  }

  const fetchDbStatus = async () => {
    try {
      const r = await fetch(API_URL('/api/db-status'))
      if (r.ok) {
        const d = await r.json()
        setDbStatus(d)
      }
    } catch (_) {
      setTimeout(async () => {
        try {
          const retry = await fetch(API_URL('/api/db-status'))
          if (retry.ok) setDbStatus(await retry.json())
        } catch (_) {}
      }, 2500)
    }
  }

  const fetchSettings = async () => {
    try {
      const r = await fetch(API_URL('/api/settings'))
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      if (d) setSettings(d)
    } catch (_) {
      setTimeout(async () => {
        try {
          const retry = await fetch(API_URL('/api/settings'))
          if (retry.ok) setSettings(await retry.json())
        } catch (_) {}
      }, 2500)
    }
  }

  useEffect(() => {
    if (catalogStatus && catalogStatus.total > 0) fetchCatalogItems()
  }, [catalogSearch, catalogPage])

  const fetchCatalogStatus = async () => {
    try {
      const r = await fetch(API_URL('/api/catalog-status'))
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setCatalogStatus(d)
      if (d && d.total > 0) fetchCatalogItems()
    } catch (err) {
      setTimeout(async () => {
        try {
          const retry = await fetch(API_URL('/api/catalog-status'))
          if (retry.ok) {
            const d = await retry.json()
            setCatalogStatus(d)
            if (d && d.total > 0) fetchCatalogItems()
          }
        } catch (_) {}
      }, 2500)
    }
  }

  const fetchCatalogItems = async () => {
    setIsLoadingItems(true)
    try {
      const params = new URLSearchParams({ search: catalogSearch, page: String(catalogPage), limit: '50' })
      const r = await fetch(API_URL(`/api/catalog-items?${params}`))
      const d = await r.json()
      setCatalogItems(Array.isArray(d.items) ? d.items : [])
      setCatalogTotal(Number(d.total) || 0)
    } finally {
      setIsLoadingItems(false)
    }
  }

  const uploadFile = async (file: File) => {
    setIsUploading(true)
    setUploadResult(null)
    setUploadError('')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    try {
      const form = new FormData()
      form.append('catalog', file)
      const r = await fetch(API_URL('/api/upload-catalog'), {
        method: 'POST',
        body: form,
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Error al importar')
      setUploadResult(d)
      fetchCatalogStatus()
      fetchDbStatus()
      setCatalogPage(1)
    } catch (e: any) {
      clearTimeout(timeoutId)
      if (e.name === 'AbortError') {
        setUploadError('La carga tardó demasiado tiempo (timeout). Es muy probable que Supabase esté pausado o con conexión demorada. Revisá el estado de la base de datos a la derecha.')
      } else {
        setUploadError(e.message || 'Error al importar el catálogo')
      }
    } finally {
      setIsUploading(false)
    }
  }

  // File System Access API: pick + remember
  const handleFSAPick = async () => {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{ description: 'SQLite Database', accept: { 'application/octet-stream': ['.db'] } }],
        multiple: false
      })
      await saveFileHandle(handle)
      setSavedHandle(handle)
      setSavedHandleName(handle.name)
      const file = await handle.getFile()
      await uploadFile(file)
    } catch (e: any) {
      if (e.name !== 'AbortError') setUploadError('No se pudo seleccionar el archivo.')
    }
  }

  // File System Access API: use remembered handle
  const handleFSAReuse = async () => {
    if (!savedHandle) return
    try {
      const perm = await (savedHandle as any).queryPermission({ mode: 'read' })
      if (perm !== 'granted') {
        await (savedHandle as any).requestPermission({ mode: 'read' })
      }
      const file = await savedHandle.getFile()
      await uploadFile(file)
    } catch (e: any) {
      setUploadError('No se pudo leer el archivo guardado. Seleccioná de nuevo.')
      setSavedHandle(null)
      setSavedHandleName('')
    }
  }

  // Fallback: regular file input
  const handleFallbackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadFile(file)
    e.target.value = ''
  }

  const handleSave = async () => {
    setIsSaving(true); setMessage('')
    try {
      await fetch(API_URL('/api/settings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
      setMessage('Configuración guardada correctamente.')
    } catch { setMessage('Error al guardar la configuración.') }
    finally { setIsSaving(false) }
  }

  const totalPages = Math.ceil(catalogTotal / 50)

  return (
    <div className="flex flex-col gap-8 animate-fade-in max-w-5xl">
      <header className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-white">Configuración</h2>
        <p className="text-slate-400">Gestiona las credenciales, el catálogo de productos y parámetros del sistema.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 flex flex-col gap-6">

          {/* ── Credentials ── */}
          <div className="glass-card p-6 flex flex-col gap-6">
            <h3 className="text-xl font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="text-blue-400" size={20} /> Credenciales del Portal
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400 flex items-center gap-2"><User size={14} /> Usuario (Legajo)</label>
                <input type="text" className="input-field" value={settings.username} onChange={e => setSettings({...settings, username: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400 flex items-center gap-2"><Lock size={14} /> Contraseña</label>
                <input type="password" className="input-field" value={settings.password} onChange={e => setSettings({...settings, password: e.target.value})} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400 flex items-center gap-2"><Globe size={14} /> URL del Portal</label>
                <input type="text" className="input-field" value={settings.portal_url} onChange={e => setSettings({...settings, portal_url: e.target.value})} />
              </div>
            </div>
            <button className="btn-primary self-start mt-4 px-8" onClick={handleSave} disabled={isSaving}>
              <Save size={18} />
              {isSaving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
            {message && <p className={`text-sm mt-2 ${message.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{message}</p>}
          </div>

          {/* ── Gestión de Legajos MOT (Turnos Mañana y Tarde) ── */}
          <div className="glass-card p-6 flex flex-col gap-5 border-red-950/40 bg-slate-900/60">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <Users className="text-red-400" size={20} /> Gestión de Legajos MOT (Turnos)
              </h3>
              <span className="text-xs bg-red-950/60 text-red-300 border border-red-800/40 px-2.5 py-1 rounded-full font-medium">
                {legajosList.length} legajos registrados
              </span>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Configura los legajos utilizados para confirmar tareas en MOT. El robot asignará automáticamente el legajo de la <strong className="text-amber-400">Mañana (hasta 14:30 hs)</strong> o de la <strong className="text-purple-400">Tarde (desde 15:00 hs)</strong> según el horario de cada tarea.
            </p>

            {/* Asignación Rápida de Turnos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                  <Sun size={14} /> Turno Mañana (hasta 14:30 hs)
                </label>
                <select
                  value={legajoManana}
                  onChange={e => handleSaveShiftSelection(e.target.value, legajoTarde)}
                  className="bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-red-500 font-mono font-bold"
                >
                  {legajosList.map(l => (
                    <option key={`m-${l.legajo}`} value={l.legajo}>
                      {l.legajo} — {l.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-purple-400 flex items-center gap-1.5">
                  <Moon size={14} /> Turno Tarde (desde 15:00 hs)
                </label>
                <select
                  value={legajoTarde}
                  onChange={e => handleSaveShiftSelection(legajoManana, e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-red-500 font-mono font-bold"
                >
                  {legajosList.map(l => (
                    <option key={`t-${l.legajo}`} value={l.legajo}>
                      {l.legajo} — {l.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Formulario para agregar nuevo legajo */}
            <div className="flex flex-col gap-3 pt-3 border-t border-slate-800">
              <h4 className="text-sm font-semibold text-slate-300">Agregar Nuevo Legajo</h4>
              <div className="flex flex-wrap sm:flex-nowrap gap-3 items-center">
                <input
                  type="text"
                  placeholder="N° Legajo (ej: 31420)"
                  value={newLegajoNum}
                  onChange={e => setNewLegajoNum(e.target.value)}
                  className="w-36 bg-slate-950 border border-slate-800 text-white text-sm rounded-lg px-3 py-2 font-mono font-bold focus:outline-none focus:border-red-500"
                />
                <input
                  type="text"
                  placeholder="Nombre / Responsable (opcional)"
                  value={newLegajoNombre}
                  onChange={e => setNewLegajoNombre(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={handleAddLegajo}
                  disabled={isSavingLegajo || !newLegajoNum.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 shrink-0"
                >
                  <Plus size={16} /> Agregar
                </button>
              </div>
              {legajoMsg && <span className="text-xs text-emerald-400 font-medium">{legajoMsg}</span>}
            </div>

            {/* Listado de Legajos con botón de eliminar */}
            <div className="flex flex-col gap-2 pt-2">
              <h4 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Legajos Registrados</h4>
              <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                {legajosList.map(item => (
                  <div key={item.legajo} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-red-300 bg-red-950/60 border border-red-900/40 px-2 py-0.5 rounded">
                        {item.legajo}
                      </span>
                      <span className="text-sm text-slate-200 font-medium">{item.nombre}</span>
                      {item.legajo === legajoManana && (
                        <span className="text-[10px] bg-amber-950/70 text-amber-300 border border-amber-800/50 px-2 py-0.5 rounded-full font-bold">
                          Mañana
                        </span>
                      )}
                      {item.legajo === legajoTarde && (
                        <span className="text-[10px] bg-purple-950/70 text-purple-300 border border-purple-800/50 px-2 py-0.5 rounded-full font-bold">
                          Tarde
                        </span>
                      )}
                    </div>
                    {legajosList.length > 1 && (
                      <button
                        onClick={() => handleDeleteLegajo(item.legajo)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded transition-colors"
                        title="Eliminar legajo"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Planificador Semanal de Turnos (2 Semanas con Rollover Dinámico) ── */}
          <div className="glass-card p-6 flex flex-col gap-6 border-amber-950/40 bg-slate-900/60">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                  <Calendar className="text-amber-400" size={20} /> Planificador Semanal de Turnos (2 Semanas)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Planifica con anticipación la semana en curso y la entrante. Cada Lunes a las 00:00 hs, la Semana Siguiente se convierte automáticamente en la Semana Actual.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyWeek}
                  disabled={isSavingSchedule}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
                  title="Clona todos los turnos de la semana actual a la semana siguiente"
                >
                  <Copy size={14} className="text-amber-400" />
                  Duplicar Semana a Siguiente
                </button>
                <button
                  onClick={handleSaveSchedule}
                  disabled={isSavingSchedule}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-950/40 transition-colors disabled:opacity-50"
                >
                  {isSavingSchedule ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  Guardar Planificación
                </button>
              </div>
            </div>

            {/* Pestañas de Semanas */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setSelectedWeekTab('current')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  selectedWeekTab === 'current'
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-950/50'
                    : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <Sun size={14} />
                {currentWeek?.label || 'Semana Actual'}
                <span className="text-[10px] bg-black/40 px-2 py-0.5 rounded-full font-mono">En Curso</span>
              </button>

              <button
                onClick={() => setSelectedWeekTab('next')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  selectedWeekTab === 'next'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-950/50'
                    : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <Moon size={14} />
                {nextWeek?.label || 'Semana Siguiente'}
                <span className="text-[10px] bg-black/40 px-2 py-0.5 rounded-full font-mono">Planificación</span>
              </button>

              {scheduleMsg && (
                <span className="ml-auto text-xs text-emerald-400 font-medium animate-fade-in flex items-center gap-1">
                  <Check size={14} /> {scheduleMsg}
                </span>
              )}
            </div>

            {/* Grilla de los 7 Días (Lunes a Domingo) */}
            {(() => {
              const activeWeek = selectedWeekTab === 'current' ? currentWeek : nextWeek
              if (!activeWeek || !activeWeek.days) {
                return (
                  <div className="py-8 text-center text-slate-500 text-sm">
                    Cargando calendario semanal de turnos...
                  </div>
                )
              }
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
                  {activeWeek.days.map(d => (
                    <div
                      key={d.date}
                      className={`flex flex-col gap-2 p-3 rounded-xl border transition-all ${
                        d.isToday
                          ? 'bg-amber-950/30 border-amber-500 shadow-md shadow-amber-950/40'
                          : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* Cabecera del día */}
                      <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
                        <div className="flex flex-col">
                          <span className={`text-xs font-bold ${d.isToday ? 'text-amber-400' : 'text-slate-200'}`}>
                            {d.dayName}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {d.formattedDate}
                          </span>
                        </div>
                        {d.isToday && (
                          <span className="text-[9px] bg-amber-500 text-black font-extrabold px-1.5 py-0.5 rounded uppercase">
                            HOY
                          </span>
                        )}
                      </div>

                      {/* Selector Turno Mañana */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-amber-300/80 flex items-center gap-1">
                          <Sun size={10} /> Mañana (≤14:30)
                        </label>
                        <select
                          value={d.manana}
                          onChange={e => handleDayShiftChange(selectedWeekTab, d.date, 'manana', e.target.value)}
                          className="bg-slate-900 border border-slate-700 text-white text-xs font-mono rounded px-2 py-1 focus:outline-none focus:border-amber-500 font-bold"
                        >
                          {legajosList.map(l => (
                            <option key={`cal-m-${d.date}-${l.legajo}`} value={l.legajo}>
                              {l.legajo} {l.nombre ? `(${l.nombre.slice(0, 10)})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Selector Turno Tarde */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-purple-300/80 flex items-center gap-1">
                          <Moon size={10} /> Tarde (≥15:00)
                        </label>
                        <select
                          value={d.tarde}
                          onChange={e => handleDayShiftChange(selectedWeekTab, d.date, 'tarde', e.target.value)}
                          className="bg-slate-900 border border-slate-700 text-white text-xs font-mono rounded px-2 py-1 focus:outline-none focus:border-purple-500 font-bold"
                        >
                          {legajosList.map(l => (
                            <option key={`cal-t-${d.date}-${l.legajo}`} value={l.legajo}>
                              {l.legajo} {l.nombre ? `(${l.nombre.slice(0, 10)})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* ── Catalog Upload ── */}
          <div className="glass-card p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database className="text-violet-400" size={20} /> Catálogo de Productos
              </h3>
              {catalogStatus && (
                <span className="text-xs text-slate-500 bg-slate-800 px-3 py-1 rounded-full">
                  {(Number(catalogStatus.total) || 0).toLocaleString()} productos
                  {catalogStatus.lastUpdate && ` · ${new Date(catalogStatus.lastUpdate).toLocaleDateString('es-AR')}`}
                </span>
              )}
            </div>

            <p className="text-sm text-slate-400">
              Importá el archivo <code className="bg-slate-800 px-1.5 py-0.5 rounded text-violet-300">catalog.db</code> desde tu dispositivo para actualizar precios y stock.
              {hasFSA && savedHandleName && (
                <span className="ml-2 text-emerald-400">✓ Archivo recordado: <strong>{savedHandleName}</strong></span>
              )}
            </p>

            <div className="flex flex-wrap gap-3">
              {hasFSA ? (
                <>
                  {savedHandle ? (
                    <button
                      onClick={handleFSAReuse}
                      disabled={isUploading}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-all disabled:opacity-50"
                    >
                      {isUploading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                      Actualizar desde {savedHandleName}
                    </button>
                  ) : null}
                  <button
                    onClick={handleFSAPick}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-violet-500/50 text-violet-400 hover:bg-violet-500/10 font-semibold transition-all disabled:opacity-50"
                  >
                    <Upload size={18} />
                    {savedHandle ? 'Cambiar archivo...' : 'Seleccionar catalog.db'}
                  </button>
                </>
              ) : (
                /* Fallback for Safari/iOS */
                <>
                  <input ref={fileInputRef} type="file" accept=".db" className="hidden" onChange={handleFallbackUpload} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-all disabled:opacity-50"
                  >
                    {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                    {isUploading ? 'Importando...' : 'Seleccionar catalog.db'}
                  </button>
                </>
              )}
            </div>

            {/* Progress / Result */}
            {isUploading && (
              <div className="flex items-center gap-3 text-sm text-violet-300 bg-violet-900/20 rounded-lg p-3">
                <Loader2 size={16} className="animate-spin shrink-0" />
                Leyendo archivo e importando a Supabase... esto puede tardar unos segundos.
              </div>
            )}
              {uploadResult && (
              <div className="flex items-center gap-3 text-sm text-emerald-300 bg-emerald-900/20 rounded-lg p-3">
                <CheckCircle2 size={16} className="shrink-0" />
                ✅ <strong>{(Number(uploadResult.imported) || 0).toLocaleString()}</strong> productos importados correctamente.
              </div>
            )}
            {uploadError && (
              <div className="text-sm text-red-400 bg-red-900/20 rounded-lg p-3">{uploadError}</div>
            )}
          </div>

          {/* ── Catalog Items Table ── */}
          {catalogStatus && catalogStatus.total > 0 && (
            <div className="glass-card p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Package className="text-violet-400" size={18} /> Items del Catálogo
                </h3>
                <span className="text-xs text-slate-500">{(Number(catalogTotal) || 0).toLocaleString()} resultados</span>
              </div>

              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Buscar por código o descripción..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
                  value={catalogSearch}
                  onChange={e => { setCatalogSearch(e.target.value); setCatalogPage(1) }}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900/80 text-slate-400 text-left">
                      <th className="px-4 py-3 font-medium">Código</th>
                      <th className="px-4 py-3 font-medium">Descripción</th>
                      <th className="px-4 py-3 font-medium text-right">Precio</th>
                      <th className="px-4 py-3 font-medium text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingItems ? (
                      <tr><td colSpan={4} className="text-center py-8 text-slate-500"><Loader2 size={20} className="animate-spin inline" /></td></tr>
                    ) : catalogItems.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-8 text-slate-600">Sin resultados</td></tr>
                    ) : catalogItems.map(item => (
                      <tr key={item.item_id} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-violet-300">{item.item_id}</td>
                        <td className="px-4 py-2.5 text-slate-200">{item.loyalty_description}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-400 font-medium">
                          ${Number(item.price_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${Number(item.current_quantity) > 0 ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
                            {Number(item.current_quantity)} u.
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-2">
                  <button onClick={() => setCatalogPage(p => Math.max(1, p - 1))} disabled={catalogPage === 1} className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-sm disabled:opacity-40">‹</button>
                  <span className="px-3 py-1 text-slate-400 text-sm">{catalogPage} / {totalPages}</span>
                  <button onClick={() => setCatalogPage(p => Math.min(totalPages, p + 1))} disabled={catalogPage === totalPages} className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-sm disabled:opacity-40">›</button>
                </div>
              )}
            </div>
          )}

          <div className="glass-card border-amber-900/30 bg-amber-900/10 p-6 flex items-start gap-4">
            <AlertTriangle className="text-amber-500 shrink-0" size={24} />
            <div className="flex flex-col gap-1">
              <h4 className="text-amber-200 font-bold">Aviso de Seguridad</h4>
              <p className="text-amber-200/60 text-sm">Las credenciales se almacenan de forma segura en la base de datos de Supabase.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="glass-card p-6">
            <h4 className="font-bold text-white mb-4">Información del Sistema</h4>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Versión App</span>
                <span className="text-slate-300">2.0.0</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Motor Scraping</span>
                <span className="text-slate-300">Playwright</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Base de Datos</span>
                <span className={`font-medium ${dbStatus?.isSqlite ? 'text-amber-400' : dbStatus ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {dbStatus ? dbStatus.provider : 'Conectando...'}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Catálogo</span>
                <span className="text-slate-300">{catalogStatus ? `${(Number(catalogStatus.total) || 0).toLocaleString()} items` : '—'}</span>
              </div>
            </div>
          </div>

          {dbStatus?.isSqlite && (
            <div className="glass-card border-amber-500/40 bg-amber-950/20 p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                <AlertTriangle size={18} /> Supabase Pausado o Inaccesible
              </div>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                El backend no pudo conectarse a PostgreSQL en Supabase y está operando temporalmente en SQLite local.
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                En las cuentas gratuitas de Supabase, las bases de datos se pausan tras 7 días de inactividad.
              </p>
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="mt-1 text-center py-2 px-3 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs transition-colors"
              >
                Abrir Supabase Dashboard para Reactivar
              </a>
              {dbStatus.error && (
                <div className="mt-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Detalle del error:</span>
                  <p className="text-[11px] font-mono bg-black/40 p-2 rounded text-red-300 break-all mt-1">
                    {dbStatus.error}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
