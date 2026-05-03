'use client'

import { useState, useEffect } from 'react'
import { Save, Lock, User, Globe, ShieldCheck, AlertTriangle } from 'lucide-react'
import { API_URL } from '@/lib/api'

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    username: '',
    password: '',
    portal_url: ''
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch(API_URL('/api/settings'))
      .then(res => res.json())
      .then(setSettings)
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setMessage('')
    try {
      await fetch(API_URL('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      setMessage('Configuración guardada correctamente.')
    } catch (err) {
      console.error(err)
      setMessage('Error al guardar la configuración.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8 animate-fade-in max-w-4xl">
      <header className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight text-white">Configuración</h2>
        <p className="text-slate-400">Gestiona las credenciales de acceso y parámetros del sistema.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 flex flex-col gap-6">
          <div className="glass-card p-6 flex flex-col gap-6">
            <h3 className="text-xl font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="text-blue-400" size={20} /> Credenciales del Portal
            </h3>
            
            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400 flex items-center gap-2">
                  <User size={14} /> Usuario (Legajo)
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={settings.username}
                  onChange={(e) => setSettings({...settings, username: e.target.value})}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400 flex items-center gap-2">
                  <Lock size={14} /> Contraseña
                </label>
                <input 
                  type="password" 
                  className="input-field"
                  value={settings.password}
                  onChange={(e) => setSettings({...settings, password: e.target.value})}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-400 flex items-center gap-2">
                  <Globe size={14} /> URL del Portal
                </label>
                <input 
                  type="text" 
                  className="input-field"
                  value={settings.portal_url}
                  onChange={(e) => setSettings({...settings, portal_url: e.target.value})}
                />
              </div>
            </div>

            <button 
              className="btn-primary self-start mt-4 px-8" 
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save size={18} />
              {isSaving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
            
            {message && (
              <p className={`text-sm mt-2 ${message.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                {message}
              </p>
            )}
          </div>

          <div className="glass-card border-amber-900/30 bg-amber-900/10 p-6 flex items-start gap-4">
            <AlertTriangle className="text-amber-500 shrink-0" size={24} />
            <div className="flex flex-col gap-1">
              <h4 className="text-amber-200 font-bold">Aviso de Seguridad</h4>
              <p className="text-amber-200/60 text-sm">
                Las credenciales se almacenan de forma segura en la base de datos de Supabase. Asegúrate de configurar correctamente las variables de entorno.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="glass-card p-6">
            <h4 className="font-bold text-white mb-4">Información del Sistema</h4>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Versión App</span>
                <span className="text-slate-300">1.0.0</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Motor Scraping</span>
                <span className="text-slate-300">Playwright</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-500">Base de Datos</span>
                <span className="text-slate-300">PostgreSQL (Supabase)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
