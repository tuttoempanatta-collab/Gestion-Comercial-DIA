'use client'

import { useState, useEffect, useRef } from 'react'
import { Play, Terminal, Loader2, CheckCircle2, AlertCircle, Calendar, CalendarRange } from 'lucide-react'
import { API_URL } from '@/lib/api'

export default function ExtractMonthlyPage() {
  const getDefaultMonthlyDates = () => {
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    
    const formatYMD = (d: Date) => {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    
    return {
      start: formatYMD(firstDay),
      end: formatYMD(lastDay)
    }
  }

  const defaultDates = getDefaultMonthlyDates()
  const [startDate, setStartDate] = useState(defaultDates.start)
  const [endDate, setEndDate] = useState(defaultDates.end)
  const [pageSize, setPageSize] = useState('50')
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

  const [currentStage, setCurrentStage] = useState(1)
  const [totalStagesCount, setTotalStagesCount] = useState(1)

  useEffect(() => {
    scrollToBottom()
  }, [logs])


  const runStageCall = async (startP: number, maxP: number, stageNum: number) => {
    const stageName = `Extracción Mensual - Etapa ${stageNum} (Págs ${startP}-${startP + maxP - 1})`;
    
    setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message: `🚀 Iniciando ${stageName}...` }])
    setProgress({ percentage: 0, message: `Iniciando ${stageName}...` })
    
    const res = await fetch(API_URL('/api/extract'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        startDate, 
        endDate, 
        pageSize, 
        startPage: startP, 
        maxPages: maxP, 
        stageName 
      })
    })
    const data = await res.json()
    if (!res.ok || data.extractionId == null) {
      throw new Error(data.error || `Error del servidor (${res.status}) en Etapa ${stageNum}`)
    }
    return data.extractionId
  }

  const pollStageCompletion = (id: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const pollTimer = setInterval(async () => {
        try {
          const res = await fetch(API_URL(`/api/logs/${id}`))
          const data = await res.json()
          if (data.logs && data.logs.length > 0) {
            setLogs(prev => {
              const combined = [...prev, ...data.logs]
              return combined.filter((v, i, a) => a.findIndex(t => t.timestamp === v.timestamp && t.message === v.message) === i)
            })
          }
          if (data.progress) setProgress(data.progress)
          
          const lastLog = data.logs && data.logs.length > 0 ? data.logs[data.logs.length - 1] : null
          if (lastLog?.message?.includes('finalizada') || lastLog?.message?.includes('completada')) {
            clearInterval(pollTimer)
            resolve(true)
          } else if (lastLog?.message?.includes('Error')) {
            clearInterval(pollTimer)
            resolve(false)
          }
        } catch (e) {}
      }, 2500)
    })
  }

  const calculateWeeklySubRanges = (startStr: string, endStr: string) => {
    if (!startStr || !endStr) return [{ start: startStr, end: endStr, label: 'Mes Completo' }]

    const start = new Date(startStr + 'T00:00:00')
    const end = new Date(endStr + 'T00:00:00')
    
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24))
    if (diffDays <= 10) {
      return [{ start: startStr, end: endStr, label: `Período (${startStr} a ${endStr})` }]
    }

    const year = start.getFullYear()
    const month = start.getMonth()
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate()

    const pad = (n: number) => String(n).padStart(2, '0')
    const format = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

    const w1End = Math.min(7, lastDayOfMonth)
    const w2Start = 8
    const w2End = Math.min(15, lastDayOfMonth)
    const w3Start = 16
    const w3End = Math.min(22, lastDayOfMonth)
    const w4Start = 23
    const w4End = lastDayOfMonth

    return [
      { start: format(year, month, 1),       end: format(year, month, w1End), label: `Semana 1 (${format(year, month, 1)} al ${format(year, month, w1End)})` },
      { start: format(year, month, w2Start), end: format(year, month, w2End), label: `Semana 2 (${format(year, month, w2Start)} al ${format(year, month, w2End)})` },
      { start: format(year, month, w3Start), end: format(year, month, w3End), label: `Semana 3 (${format(year, month, w3Start)} al ${format(year, month, w3End)})` },
      { start: format(year, month, w4Start), end: format(year, month, w4End), label: `Semana 4 (${format(year, month, w4Start)} al ${format(year, month, w4End)})` },
    ]
  }

  const handleStartExtraction = async () => {
    setIsExtracting(true)
    setStatus('running')
    setLogs([])
    setExtractionId(null)

    const subRanges = calculateWeeklySubRanges(startDate, endDate)
    setTotalStagesCount(subRanges.length)

    try {
      for (let i = 0; i < subRanges.length; i++) {
        const stage = subRanges[i]
        setCurrentStage(i + 1)

        setLogs(prev => [...prev, { 
          timestamp: new Date().toISOString(), 
          message: `--- LOTE SEMANAL ${i + 1}/${subRanges.length}: ${stage.label} ---` 
        }])
        
        setProgress({ percentage: 0, message: `Iniciando ${stage.label}...` })

        const res = await fetch(API_URL('/api/extract'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            startDate: stage.start, 
            endDate: stage.end, 
            pageSize, 
            startPage: 1, 
            maxPages: 30, 
            stageName: `Extracción Mensual - ${stage.label}` 
          })
        })
        const data = await res.json()
        if (!res.ok || data.extractionId == null) {
          throw new Error(data.error || `Error en Lote ${i + 1}`)
        }

        setExtractionId(data.extractionId)

        const success = await pollStageCompletion(data.extractionId)
        if (!success) {
          throw new Error(`El Lote ${i + 1} (${stage.label}) falló o se interrumpió.`)
        }

        setLogs(prev => [...prev, { 
          timestamp: new Date().toISOString(), 
          message: `✨ Lote ${i + 1}/${subRanges.length} (${stage.label}) completado con éxito. Navegador cerrado y RAM liberada.` 
        }])

        if (i < subRanges.length - 1) {
          setLogs(prev => [...prev, { 
            timestamp: new Date().toISOString(), 
            message: `⏳ Aguardando 3 segundos para liberar memoria RAM antes del siguiente lote...` 
          }])
          await new Promise(r => setTimeout(r, 3000))
        }
      }

      setIsExtracting(false)
      setStatus('completed')
      setProgress({ percentage: 100, message: '¡Extracción Mensual completada en todos los lotes semanales!' })
      setLogs(prev => [...prev, { 
        timestamp: new Date().toISOString(), 
        message: `🎉 ¡PROCESO FINALIZADO! Se han extraído las 4 semanas del mes en lotes limpios e independientes. Podés unificarlos directamente en el módulo de Cartelería.` 
      }])
    } catch (err: any) {
      console.error('[Extracción Mensual por Semanas Error]', err)
      setIsExtracting(false)
      setStatus('failed')
      setProgress({ percentage: 0, message: `❌ ${err.message}` })
    }
  }



  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-indigo-400">
            <CalendarRange size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Extracción Mensual</h2>
            <p className="text-slate-400">Configura el rango de fechas para el mes completo e inicia el bot de extracción automatizada.</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Controls */}
        <div className="glass-card p-8 flex flex-col gap-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="text-indigo-400" size={20} />
            Configuración Mensual
          </h2>
          
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-400">Fecha Desde (Inicio de Mes)</label>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-400">Fecha Hasta (Fin de Mes)</label>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-400">Items por página (Vista)</label>
              <select 
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:border-indigo-500 transition-colors appearance-none cursor-pointer"
              >
                <option value="50">50 registros por página (Recomendado)</option>
                <option value="20">20 registros por página</option>
                <option value="10">10 registros por página</option>
                <option value="5">5 registros por página</option>
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
                Procesando Extracción Mensual...
              </>
            ) : (
              <>
                <Play size={20} />
                Iniciar Extracción Mensual
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
