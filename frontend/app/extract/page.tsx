'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Terminal, Loader2, CheckCircle2, AlertCircle, Calendar } from 'lucide-react'
import { API_URL } from '@/lib/api'

export default function ExtractPage() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pageSize, setPageSize] = useState('10')
  const [isExtracting, setIsExtracting] = useState(false)
  const [logs, setLogs] = useState<any[]>([])
  const [progress, setProgress] = useState({ percentage: 0, message: '' })
  const [extractionId, setExtractionId] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')
  const logContainerRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [logs])

  useEffect(() => {
    let interval: any
    if (isExtracting) {
      interval = setInterval(() => {
        if (extractionId) {
          fetch(API_URL(`/api/logs/${extractionId}`))
            .then(res => res.json())
            .then(data => {
              setLogs(data.logs)
              setProgress(data.progress)
              
              const lastLog = data.logs[data.logs.length - 1]
              if (lastLog?.message?.includes('finalizada') || lastLog?.message?.includes('completada')) {
                setIsExtracting(false);
                setStatus('completed');
                localStorage.removeItem('activeExtraction')
                localStorage.removeItem('activeExtractionId')
              } else if (lastLog?.message?.includes('Error')) {
                setIsExtracting(false);
                setStatus('failed');
                localStorage.removeItem('activeExtraction')
                localStorage.removeItem('activeExtractionId')
              }
            })
        }
      }, 2000)
    }
    return () => clearInterval(interval)
  }, [isExtracting, extractionId])

  const handleStartExtraction = async () => {
    setIsExtracting(true)
    setStatus('running')
    setLogs([])
    setExtractionId(null)
    setProgress({ percentage: 0, message: 'Iniciando...' })
    
    localStorage.setItem('activeExtraction', 'true')
    
    try {
      const res = await fetch(API_URL('/api/extract'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, pageSize })
      })
      const data = await res.json()

      if (!res.ok || data.extractionId == null) {
        throw new Error(data.error || `Error del servidor (${res.status}): respuesta inesperada`)
      }

      setExtractionId(data.extractionId)
      localStorage.setItem('activeExtractionId', String(data.extractionId))
    } catch (err: any) {
      console.error('[Extraccion]', err)
      setIsExtracting(false)
      setStatus('failed')
      setProgress({ percentage: 0, message: `❌ ${err.message}` })
      localStorage.removeItem('activeExtraction')
    }
  }

  useEffect(() => {
    const active = localStorage.getItem('activeExtraction')
    const id = localStorage.getItem('activeExtractionId')
    if (active === 'true' && id) {
      setIsExtracting(true)
      setStatus('running')
      setExtractionId(parseInt(id))
    }
  }, [])

  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <header className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-white">Extracción de Datos</h2>
        <p className="text-slate-400">Configura el rango de fechas e inicia el bot de extracción automatizada.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Controls */}
        <div className="glass-card p-8 flex flex-col gap-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="text-red-400" size={20} />
            Configuración
          </h2>
          
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-400">Fecha Desde</label>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-400">Fecha Hasta</label>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-400">Items por página (Vista)</label>
              <select 
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-red-500 transition-colors appearance-none cursor-pointer"
              >
                <option value="5">5 registros por página</option>
                <option value="10">10 registros por página</option>
                <option value="20">20 registros por página</option>
                <option value="50">50 registros por página</option>
              </select>
            </div>
          </div>

          <button 
            className="btn-primary w-full py-3 mt-4 bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed" 
            onClick={handleStartExtraction}
            disabled={isExtracting}
          >
            {isExtracting ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Procesando Automatización...
              </>
            ) : (
              <>
                <Play size={20} />
                Iniciar Extracción
              </>
            )}
          </button>

          {isExtracting && (
            <button 
              className="w-full py-3 mt-2 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-all font-bold flex items-center justify-center gap-2" 
              onClick={async () => {
                try {
                  await fetch(API_URL('/api/cancel-extract'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ extractionId })
                  })
                  setIsExtracting(false)
                  setStatus('idle')
                  setLogs([])
                  setProgress({ percentage: 0, message: '' })
                  localStorage.removeItem('activeExtraction')
                  localStorage.removeItem('activeExtractionId')
                } catch (err) {
                  console.error(err)
                }
              }}
            >
              <AlertCircle size={20} />
              Cancelar Extracción
            </button>
          )}
          
          <p className="text-xs text-slate-500 text-center">
            Nota: Este proceso obtendrá toda la información directamente del Portal de Franquicias.
          </p>
        </div>

        {/* Console and Progress */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* SINGLE PROGRESS BAR */}
          {(isExtracting || status === 'completed' || status === 'failed') && (
            <div className="glass-card p-6 border-indigo-500/30 bg-indigo-500/5">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300 font-bold flex items-center gap-2">
                    Progreso de Extracción
                  </span>
                  <span className="text-indigo-400 font-mono">{progress.percentage}%</span>
                </div>
                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div 
                    className={`h-full transition-all duration-500 ${status === 'completed' ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)]'}`}
                    style={{ width: `${progress.percentage}%` }}
                  ></div>
                </div>
                <p className="text-xs text-slate-400 italic">
                  {progress.message || 'Procesando datos del portal...'}
                </p>
              </div>
            </div>
          )}

          <div className="glass-card bg-slate-950/80 p-0 flex flex-col overflow-hidden border-slate-700 h-[450px]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-red-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Consola de Salida</h3>
              </div>
              {isExtracting && <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>}
            </div>
            
            <div 
              ref={logContainerRef}
              className="flex-1 p-6 font-mono text-sm overflow-y-auto flex flex-col gap-2 scroll-smooth"
            >
              {logs.length === 0 && !isExtracting && (
                <p className="text-slate-600">Esperando inicio de proceso...</p>
              )}
              {logs.map((log, index) => (
                <div key={index} className="flex gap-4">
                  <span className="text-slate-600 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span className={log.message?.includes('Error') ? 'text-red-400' : 'text-red-100'}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>

            {/* Status bar */}
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/30 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-xs">
                  {status === 'completed' ? (
                    <><CheckCircle2 size={14} className="text-emerald-400" /> <span className="text-emerald-400">Finalizado</span></>
                  ) : status === 'failed' ? (
                    <><AlertCircle size={14} className="text-red-400" /> <span className="text-red-400">Error</span></>
                  ) : isExtracting ? (
                    <><Loader2 size={14} className="animate-spin text-red-400" /> <span className="text-red-400">Procesando ({progress.percentage}%)</span></>
                  ) : (
                    <span className="text-slate-500">Inactivo</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
