'use client'

import { useEffect, useState } from 'react'
import { Activity, Clock, Database, Download, FileText } from 'lucide-react'
import { API_URL } from '@/lib/api'

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalExtractions: 0,
    lastRun: 'Nunca',
    totalItems: 0,
    status: 'Inactivo'
  })

  useEffect(() => {
    fetch(API_URL('/api/history'))
      .then(res => res.json())
      .then(history => {
        if (history.length > 0) {
          const totalItems = history.reduce((acc: number, curr: any) => acc + (curr.items_count || 0), 0)
          setStats({
            totalExtractions: history.length,
            lastRun: new Date(history[0].timestamp).toLocaleString(),
            totalItems: totalItems,
            status: history[0].status === 'running' ? 'En proceso' : 'Listo'
          })
        }
      })
      .catch(err => console.error('Error fetching history:', err))
  }, [])

  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <header className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-white">Dashboard</h2>
        <p className="text-slate-400">Resumen del estado del extractor y datos capturados.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Extracciones" 
          value={stats.totalExtractions.toString()} 
          icon={<Database className="text-red-400" />} 
          description="Ejecuciones totales"
        />
        <StatCard 
          title="Última Ejecución" 
          value={stats.lastRun} 
          icon={<Clock className="text-purple-400" />} 
          description="Fecha y hora"
        />
        <StatCard 
          title="Items Totales" 
          value={stats.totalItems.toLocaleString()} 
          icon={<Download className="text-emerald-400" />} 
          description="Acciones comerciales guardadas"
        />
        <StatCard 
          title="Estado Sistema" 
          value={stats.status} 
          icon={<Activity className="text-amber-400" />} 
          description="Estado actual del bot"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="glass-card p-6 flex flex-col gap-4">
          <h3 className="text-xl font-semibold text-white">Acciones Rápidas</h3>
          <div className="grid grid-cols-3 gap-4">
            <button 
              className="btn-primary h-24 flex-col gap-2"
              onClick={() => window.location.href = '/extract'}
            >
              <Download size={24} />
              <span>Nueva Extracción</span>
            </button>
            <button 
              className="btn-secondary h-24 flex-col gap-2"
              onClick={() => window.location.href = '/data'}
            >
              <Database size={24} />
              <span>Ver Historial</span>
            </button>
            <button 
              className="btn-secondary h-24 flex-col gap-2 border-red-500/30 text-red-400"
              onClick={() => window.location.href = '/data'}
            >
              <FileText size={24} />
              <span>Generar Carteles</span>
            </button>
          </div>
        </div>

        <div className="glass-card p-6 flex flex-col gap-4">
          <h3 className="text-xl font-semibold text-white">Próximos Pasos</h3>
          <ul className="text-slate-400 space-y-4">
            <li className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              Configura tus credenciales en el apartado de ajustes.
            </li>
            <li className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              Inicia una extracción manual para validar la conexión.
            </li>
            <li className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              Exporta los resultados a Excel para su análisis.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value, icon, description }: any) {
  return (
    <div className="glass-card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-400">{title}</span>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <p className="text-xs text-slate-500 mt-1">{description}</p>
      </div>
    </div>
  )
}
