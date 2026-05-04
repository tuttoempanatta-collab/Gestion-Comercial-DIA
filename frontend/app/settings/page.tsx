'use client'

import { useState, useEffect, useRef } from 'react'
import { Save, Lock, User, Globe, ShieldCheck, AlertTriangle, Database, Upload, RefreshCw, Search, Package, CheckCircle2, Loader2 } from 'lucide-react'
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

const hasFSA = typeof window !== 'undefined' && 'showOpenFilePicker' in window

// ─────────────────────────────────────────────────────────────────────────────

interface CatalogStatus { total: number; lastUpdate: string | null }
interface CatalogItem { item_id: string; loyalty_description: string; price_amount: number; current_quantity: number }

export default function SettingsPage() {
  const [settings, setSettings] = useState({ username: '', password: '', portal_url: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

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

  useEffect(() => {
    fetch(API_URL('/api/settings')).then(r => r.json()).then(setSettings)
    fetchCatalogStatus()
    loadFileHandle().then(h => {
      if (h) { setSavedHandle(h); setSavedHandleName(h.name) }
    })
  }, [])

  useEffect(() => {
    if (catalogStatus && catalogStatus.total > 0) fetchCatalogItems()
  }, [catalogSearch, catalogPage])

  const fetchCatalogStatus = async () => {
    try {
      const r = await fetch(API_URL('/api/catalog-status'))
      const d = await r.json()
      setCatalogStatus(d)
      if (d.total > 0) fetchCatalogItems()
    } catch {}
  }

  const fetchCatalogItems = async () => {
    setIsLoadingItems(true)
    try {
      const params = new URLSearchParams({ search: catalogSearch, page: String(catalogPage), limit: '50' })
      const r = await fetch(API_URL(`/api/catalog-items?${params}`))
      const d = await r.json()
      setCatalogItems(d.items)
      setCatalogTotal(d.total)
    } finally {
      setIsLoadingItems(false)
    }
  }

  const uploadFile = async (file: File) => {
    setIsUploading(true)
    setUploadResult(null)
    setUploadError('')
    try {
      const form = new FormData()
      form.append('catalog', file)
      const r = await fetch(API_URL('/api/upload-catalog'), { method: 'POST', body: form })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Error al importar')
      setUploadResult(d)
      fetchCatalogStatus()
      setCatalogPage(1)
    } catch (e: any) {
      setUploadError(e.message)
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

          {/* ── Catalog Upload ── */}
          <div className="glass-card p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database className="text-violet-400" size={20} /> Catálogo de Productos
              </h3>
              {catalogStatus && (
                <span className="text-xs text-slate-500 bg-slate-800 px-3 py-1 rounded-full">
                  {catalogStatus.total.toLocaleString()} productos
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
                ✅ <strong>{uploadResult.imported.toLocaleString()}</strong> productos importados correctamente.
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
                <span className="text-xs text-slate-500">{catalogTotal.toLocaleString()} resultados</span>
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
                <span className="text-slate-300">PostgreSQL (Supabase)</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Catálogo</span>
                <span className="text-slate-300">{catalogStatus ? `${catalogStatus.total.toLocaleString()} items` : '—'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
