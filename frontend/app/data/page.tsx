'use client'

import { useState, useEffect } from 'react'
import { Search, FileSpreadsheet, FileJson, FileText, Calendar, Filter, Printer, Package, PackageX, Trash2, X, Download, Check } from 'lucide-react'
import { generatePosters } from '@/lib/posterGenerator'
import { Smartphone, CreditCard, Wallet, Info } from 'lucide-react'
import { API_URL } from '@/lib/api'

const PROMOS = [
  { id: 'mp', name: 'Mercado Pago', day: 'Miércoles', discount: 0.10, condition: 'Sin tope de reintegro' },
  { id: 'pp', name: 'Personal Pay', day: 'Jueves', discount: 0.15, condition: 'Sin tope de reintegro' },
  { id: 'modo', name: 'MODO', day: 'Viernes/Sábado', discount: 0.20, condition: 'Mín. $35.000 / Tope $20.000' },
  { id: 'nx', name: 'NaranjaX', day: 'Martes', discount: 0.25, condition: 'Tope $10.000/mes' },
  { id: 'bna', name: 'Banco Nación', day: 'L-V', discount: 0.05, condition: 'Tope $5.000/sem' },
  { id: 'columbia', name: 'Banco Columbia', day: 'Lun/Vie', discount: 0.20, condition: 'Tope $10.000/trans' },
  { id: 'hipo', name: 'Hipotecario', day: 'Domingo', discount: 0.25, condition: 'Segmento Black' },
  { id: 'cdni', name: 'Cuenta DNI', day: 'Lunes', discount: 0.10, condition: 'Según vigencia' },
  { id: 'anses', name: 'ANSES', day: 'Lunes', discount: 0.10, condition: 'Tope $2.000/trans' },
];

const DAYS = ['Todos', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export default function DataPage() {
  const [history, setHistory] = useState<any[]>([])
  const [selectedExtraction, setSelectedExtraction] = useState<number | null>(null)
  const [data, setData] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  
  const [selectedDay, setSelectedDay] = useState('Todos')
  const [selectedPromoId, setSelectedPromoId] = useState<string | null>(null)
  const [enrichmentStatus, setEnrichmentStatus] = useState<any>(null)
  
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editCode, setEditCode] = useState('')
  const [editUnits, setEditUnits] = useState('')
  const [selectedCombo, setSelectedCombo] = useState('')
  const [dateFilterStart, setDateFilterStart] = useState('')
  const [dateFilterEnd, setDateFilterEnd] = useState('')

  const handleUpdateRecord = (id: number) => {
    // Optimistic update
    const oldData = [...data];
    setData(prev => prev.map(item => 
      item.id === id 
        ? { ...item, articulo: editValue, codigo: editCode, cantidades: editUnits } 
        : item
    ));

    fetch(API_URL(`/api/data/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articulo: editValue, codigo: editCode, cantidades: editUnits })
    })
    .then(async res => {
      const text = await res.text();
      let responseData;
      try {
        responseData = JSON.parse(text);
      } catch (e) {
        throw new Error(`Respuesta no-JSON: ${text.substring(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(responseData.error || `Error ${res.status}`);
      }
      return responseData;
    })
    .then(() => {
      setEditingId(null);
    })
    .catch(err => {
      console.error('[Update Error Details]:', err);
      setData(oldData); // Rollback
      // Try to alert again but with more info
      alert(`No se pudo guardar. Detalle: ${err.message}`);
    });
  }

  const handleEditStart = (item: any) => {
    setEditingId(item.id)
    setEditValue(item.articulo)
    setEditCode(item.codigo)
    setEditUnits(item.cantidades || '')
  }

  const handleDeleteRecord = (id: number) => {
    if (confirm('¿Eliminar este artículo de la lista?')) {
      fetch(API_URL(`/api/data/${id}`), { method: 'DELETE' })
      .then(() => {
        setData(prev => prev.filter(item => item.id !== id))
      })
    }
  }

  const handleEnrichDescriptions = () => {
    const codes = data.map(item => item.codigo);
    if (codes.length === 0) return;

    fetch(API_URL('/api/enrich'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes })
    })
    .then(res => res.json())
    .then(res => {
      alert(`Iniciando enriquecimiento de ${res.count} artículos desde IET.`);
      startEnrichmentPolling();
    });
  }

  const startEnrichmentPolling = () => {
    const interval = setInterval(() => {
      fetch(API_URL('/api/enrich/status'))
        .then(res => res.json())
        .then(status => {
          setEnrichmentStatus(status);
          if (status.status === 'completed' || status.status === 'failed') {
            clearInterval(interval);
            if (status.status === 'completed') {
              // Reload data to show new descriptions
              if (selectedExtraction) {
                fetch(API_URL(`/api/data/${selectedExtraction}`))
                  .then(res => res.json())
                  .then(setData)
              }
            }
          }
        });
    }, 2000);
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = () => {
    fetch(API_URL('/api/history'))
      .then(res => res.json())
      .then(result => setHistory(Array.isArray(result) ? result : []))
      .catch(() => setHistory([]))
  }

  useEffect(() => {
    if (selectedExtraction) {
      fetch(API_URL(`/api/data/${selectedExtraction}`))
        .then(res => res.json())
        .then(result => setData(Array.isArray(result) ? result : []))
        .catch(() => setData([]))
      setSelectedIds(new Set())
    } else {
      setData([])
    }
  }, [selectedExtraction])

  const handleResetSystem = () => {
    if (confirm('⚠️ ¿BORRAR TODO? Se eliminarán todas las extracciones y las descripciones oficiales guardadas. Tendrás que empezar de cero.')) {
      fetch(API_URL('/api/system/reset'), { method: 'POST' })
        .then(() => {
          setSelectedExtraction(null)
          setData([])
          setHistory([])
          setEnrichmentStatus(null)
          alert('Sistema reiniciado. Todo borrado.')
          loadHistory()
        })
    }
  }

  const handleDeleteExtraction = (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (confirm('¿Estás seguro de que deseas eliminar esta extracción?')) {
      fetch(API_URL(`/api/extraction/${id}`), { method: 'DELETE' })
        .then(() => {
          if (selectedExtraction === id) setSelectedExtraction(null)
          loadHistory()
        })
    }
  }

  const parseDate = (str: string) => {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts.map(Number);
    return new Date(y, m - 1, d);
  };

  const filteredData = data.filter(item => {
    const matchesSearch = item.articulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.codigo.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCombo = selectedCombo === '' || (item.combo && item.combo.includes(selectedCombo));
    
    let matchesDate = true;
    if (dateFilterStart || dateFilterEnd) {
      const itemStart = parseDate(item.fecha_desde);
      const itemEnd = parseDate(item.fecha_hasta);
      
      if (dateFilterStart) {
        const filterStart = new Date(dateFilterStart + 'T00:00:00');
        if (itemEnd && itemEnd < filterStart) matchesDate = false;
      }
      if (dateFilterEnd) {
        const filterEnd = new Date(dateFilterEnd + 'T23:59:59');
        if (itemStart && itemStart > filterEnd) matchesDate = false;
      }
    }

    const hasStock = item.stock > 0;
    const baseFilter = matchesSearch && matchesCombo && matchesDate;
    if (showOutOfStock) return baseFilter;
    return baseFilter && hasStock;
  })

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredData.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredData.map(item => item.id)))
    }
  }

  const toggleSelectItem = (id: number) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const selectByCombo = (combo: string) => {
    const itemsWithCombo = filteredData.filter(item => item.combo === combo).map(item => item.id)
    setSelectedIds(new Set([...Array.from(selectedIds), ...itemsWithCombo]))
  }

  const handlePreviewPosters = () => {
    const selectedPromo = PROMOS.find(p => p.id === selectedPromoId);
    
    const selectedItems = data.filter(item => selectedIds.has(item.id)).map(item => {
      const finalPrice = calculateFinalPrice(item.precio_fidelizado, item.combo);
      return {
        codigo: item.codigo,
        articulo: item.articulo,
        combo: item.combo,
        precioOriginal: item.precio_fidelizado,
        precioFinal: finalPrice,
        desde: item.fecha_desde,
        hasta: item.fecha_hasta,
        cashbackPrice: selectedPromo ? finalPrice * (1 - selectedPromo.discount) : undefined,
        cashbackLabel: selectedPromo?.name,
        cashbackCondition: selectedPromo?.condition,
        cashbackPercentage: selectedPromo ? `${selectedPromo.discount * 100}%` : undefined,
        cashbackDay: selectedPromo?.day,

      };
    });
    const url = generatePosters(selectedItems, true) as string
    setPdfPreviewUrl(url)
  }

  const handleDownloadPosters = () => {
    const selectedPromo = PROMOS.find(p => p.id === selectedPromoId);
    
    const selectedItems = data.filter(item => selectedIds.has(item.id)).map(item => {
      const finalPrice = calculateFinalPrice(item.precio_fidelizado, item.combo);
      return {
        codigo: item.codigo,
        articulo: item.articulo,
        combo: item.combo,
        precioOriginal: item.precio_fidelizado,
        precioFinal: finalPrice,
        desde: item.fecha_desde,
        hasta: item.fecha_hasta,
        cashbackPrice: selectedPromo ? finalPrice * (1 - selectedPromo.discount) : undefined,
        cashbackLabel: selectedPromo?.name,
        cashbackCondition: selectedPromo?.condition,
        cashbackPercentage: selectedPromo ? `${selectedPromo.discount * 100}%` : undefined,
        cashbackDay: selectedPromo?.day,

      };
    });
    generatePosters(selectedItems, false)
  }

  const formatCurrency = (value: string | number) => {
    if (typeof value === 'string') {
      value = parseFloat(value.replace(',', '.'))
    }
    if (isNaN(value)) return '$ 0,00'
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2
    }).format(value)
  }

  const calculateFinalPrice = (priceStr: string, combo: string) => {
    let price = parseFloat(priceStr.replace(',', '.'))
    if (isNaN(price)) return 0
    if (!combo) return price
    const text = combo.toLowerCase()
    const secMatch = text.match(/2d[oa]\s+al\s+(\d+)/);
    if (secMatch) {
      const discount = parseInt(secMatch[1]);
      return (price + (price * (1 - discount / 100))) / 2;
    }
    const nxmMatch = text.match(/(\d+)x(\d+)/);
    if (nxmMatch) {
      const n = parseInt(nxmMatch[1]);
      const m = parseInt(nxmMatch[2]);
      return (price * m) / n;
    }
    const pctMatch = text.match(/(\d+)\s*%/);
    if (pctMatch) {
      const discount = parseInt(pctMatch[1]);
      return price * (1 - discount / 100);
    }
    const fixedMatch = text.match(/llevando\s+\d+[:\s]+\$?\s*(\d+)/);
    if (fixedMatch) {
      return parseFloat(fixedMatch[1]);
    }
    return price
  }

  const handleExport = (type: string) => {
    if (!selectedExtraction) return
    window.open(API_URL(`/api/export/${type}/${selectedExtraction}`))
  }

  const uniqueCombos = Array.from(new Set(data.map(item => item.combo))).filter(Boolean)

  return (
    <>
      {/* PDF PREVIEW MODAL - MOVED TO TOP OF FRAGMENT */}
      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl h-[95vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
              <div className="flex flex-col">
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  <Printer size={18} className="text-red-500" />
                  Vista Previa de Cartelería
                </h3>
                <p className="text-xs text-slate-400">Revisa el diseño antes de descargar el PDF final.</p>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleDownloadPosters}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-500 py-2.5 px-6 text-sm shadow-emerald-900/20"
                >
                  <Download size={16} /> Descargar PDF
                </button>
                <button 
                  onClick={() => setPdfPreviewUrl(null)}
                  className="p-2.5 hover:bg-slate-800 rounded-full text-slate-400 transition-all active:scale-90"
                >
                  <X size={24} />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-950">
              <iframe 
                src={pdfPreviewUrl} 
                className="w-full h-full border-none" 
                title="PDF Preview"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 animate-fade-in">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Explorador de Datos</h2>
            <div className="flex items-center gap-4">
              <p className="text-slate-400 text-sm">Visualiza y gestiona la cartelería de tus productos.</p>
              <div className="h-4 w-[1px] bg-slate-800 hidden sm:block"></div>
              <button 
                onClick={() => setShowOutOfStock(!showOutOfStock)}
                className={`flex items-center gap-2 text-xs font-bold transition-colors ${showOutOfStock ? 'text-red-400' : 'text-emerald-400'}`}
              >
                {showOutOfStock ? <PackageX size={14} /> : <Package size={14} />}
                {showOutOfStock ? 'Mostrando todo' : 'Filtrando por Stock Real'}
              </button>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <button 
              onClick={handlePreviewPosters}
              className="btn-primary px-6 py-3 bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/40 animate-bounce-subtle"
            >
              <Printer size={20} />
              <span className="hidden sm:inline">Previsualizar {selectedIds.size} Carteles</span>
              <span className="sm:hidden">Preview ({selectedIds.size})</span>
            </button>
          )}
        </header>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Extraction History */}
          <div className="lg:w-72 shrink-0">
            <div className="glass-card p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Calendar size={14} /> Historial
                </h3>
                <button 
                  onClick={handleResetSystem}
                  className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors border border-red-500/20 rounded-md hover:bg-red-500/10"
                >
                  <Trash2 size={12} /> REINICIAR
                </button>
              </div>
              <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[500px] pb-2 lg:pb-0 scrollbar-hide">
                {history.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedExtraction(run.id)}
                    className={`group relative p-3 rounded-xl text-left transition-all border min-w-[180px] lg:min-w-0 ${
                      selectedExtraction === run.id 
                      ? 'bg-red-600/20 border-red-500/40 text-white shadow-inner' 
                      : 'bg-slate-900/30 border-slate-800/50 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold truncate pr-6">
                      {new Date(run.timestamp).toLocaleDateString()} - {new Date(run.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                    <div className="text-[10px] opacity-50 mt-1 flex justify-between items-center">
                      <span>{run.items_count} items</span>
                      <span className="capitalize">{run.status}</span>
                    </div>
                    <div 
                      onClick={(e) => handleDeleteExtraction(e, run.id)}
                      className="absolute top-3 right-3 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-600 hover:text-white transition-all text-slate-500"
                    >
                      <Trash2 size={12} />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* NEW: PROMOTION PANEL */}
            <div className="mt-6 flex flex-col gap-4 animate-slide-up">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Wallet size={14} className="text-emerald-500" /> Beneficios Bancarios
                </h3>
                {selectedPromoId && (
                  <button onClick={() => setSelectedPromoId(null)} className="text-[10px] text-red-400 hover:underline">Limpiar</button>
                )}
              </div>
              
              {/* Day Selector */}
              <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
                {DAYS.map(day => (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${
                      selectedDay === day ? 'bg-white text-slate-900 shadow-lg' : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {day === 'Todos' ? 'TODOS' : day.substring(0, 3).toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Promo List */}
              <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {PROMOS.filter(p => selectedDay === 'Todos' || p.day.includes(selectedDay.substring(0, 3))).map(promo => (
                  <button
                    key={promo.id}
                    onClick={() => setSelectedPromoId(promo.id === selectedPromoId ? null : promo.id)}
                    className={`p-3 rounded-xl border transition-all text-left group ${
                      selectedPromoId === promo.id
                      ? 'bg-emerald-600/20 border-emerald-500/40 ring-1 ring-emerald-500/20'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className={`font-bold text-xs ${selectedPromoId === promo.id ? 'text-emerald-400' : 'text-slate-200'}`}>
                        {promo.name}
                      </span>
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full">
                        -{promo.discount * 100}%
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <Calendar size={10} /> {promo.day}
                      </div>
                      <div className="flex items-center gap-1 italic">
                        <Info size={10} /> {promo.condition}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Results Area */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            {/* DUAL PROGRESS BARS */}
            {(selectedExtraction && history.find(h => h.id === selectedExtraction)?.status === 'running' || enrichmentStatus?.status === 'running') && (
              <div className="glass-card p-6 border-indigo-500/30 bg-indigo-500/5 animate-pulse-subtle">
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></div>
                      Procesando Automatización de Datos
                    </h3>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full font-mono uppercase tracking-tighter">
                      Cero a Cartel
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Step 1: Portal */}
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400 flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            history.find(h => h.id === selectedExtraction)?.status === 'completed' 
                            ? 'bg-emerald-500 text-white' 
                            : 'bg-indigo-600 text-white'
                          }`}>1</span>
                          Importando Promos (Portal)
                        </span>
                        <span className="text-indigo-400 font-bold">
                          {history.find(h => h.id === selectedExtraction)?.status === 'completed' ? '100%' : 'En curso...'}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            history.find(h => h.id === selectedExtraction)?.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: history.find(h => h.id === selectedExtraction)?.status === 'completed' ? '100%' : '45%' }}
                        ></div>
                      </div>
                      <p className="text-[10px] text-slate-500 italic truncate">
                        {history.find(h => h.id === selectedExtraction)?.status === 'completed' 
                          ? '✓ Datos básicos capturados' 
                          : 'Capturando códigos y combinaciones comerciales...'}
                      </p>
                    </div>

                    {/* Step 2: IET */}
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400 flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            enrichmentStatus?.status === 'completed' 
                            ? 'bg-emerald-500 text-white' 
                            : enrichmentStatus?.status === 'running' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-500'
                          }`}>2</span>
                          Enriquecimiento Oficial (IET)
                        </span>
                        <span className="text-purple-400 font-bold">
                          {enrichmentStatus?.status === 'completed' ? '100%' : enrichmentStatus?.status === 'running' ? 'En curso...' : 'Esperando...'}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            enrichmentStatus?.status === 'completed' ? 'bg-emerald-500' : 'bg-purple-500'
                          }`}
                          style={{ width: enrichmentStatus?.status === 'completed' ? '100%' : enrichmentStatus?.status === 'running' ? '65%' : '0%' }}
                        ></div>
                      </div>
                      <p className="text-[10px] text-slate-500 italic truncate">
                        {enrichmentStatus?.message || 'Pendiente de inicio automático...'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Toolbar */}
            <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between border-slate-800/50">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input 
                  type="text" 
                  placeholder="Buscar código o nombre..." 
                  className="input-field pl-10 text-sm py-2"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1">
                <div className="flex flex-col">
                  <label className="text-[8px] text-slate-500 uppercase font-bold px-1">Desde</label>
                  <input 
                    type="date" 
                    className="bg-transparent text-[10px] text-white focus:outline-none cursor-pointer"
                    value={dateFilterStart}
                    onChange={(e) => setDateFilterStart(e.target.value)}
                  />
                </div>
                <div className="w-[1px] h-6 bg-slate-800"></div>
                <div className="flex flex-col">
                  <label className="text-[8px] text-slate-500 uppercase font-bold px-1">Hasta</label>
                  <input 
                    type="date" 
                    className="bg-transparent text-[10px] text-white focus:outline-none cursor-pointer"
                    value={dateFilterEnd}
                    onChange={(e) => setDateFilterEnd(e.target.value)}
                  />
                </div>
                {(dateFilterStart || dateFilterEnd) && (
                  <button 
                    onClick={() => { setDateFilterStart(''); setDateFilterEnd(''); }}
                    className="p-1 hover:bg-slate-800 rounded text-red-400"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 scrollbar-hide">
                {uniqueCombos.length > 0 && (
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-2 shrink-0">
                    <Filter size={14} className="text-slate-500" />
                    <select 
                      value={selectedCombo}
                      onChange={(e) => setSelectedCombo(e.target.value)}
                      className="bg-slate-900 text-xs py-2 pr-2 text-slate-200 focus:outline-none cursor-pointer"
                    >
                      <option value="" className="bg-slate-900 text-slate-400">Todos los combos</option>
                      {uniqueCombos.map(c => (
                        <option key={c} value={c} className="bg-slate-900 text-slate-200">
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-1 shrink-0">
                  <button 
                    onClick={handleEnrichDescriptions} 
                    disabled={data.length === 0 || enrichmentStatus?.status === 'running'}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-2 px-3 text-xs font-bold ${
                      enrichmentStatus?.status === 'running' 
                      ? 'bg-indigo-600/40 text-indigo-200 cursor-not-allowed' 
                      : 'bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20'
                    }`}
                    title="Completar descripciones oficiales desde IET"
                  >
                    <Search size={16} />
                    <span>Enriquecer</span>
                  </button>

                  <div className="w-[1px] h-6 bg-slate-800 mx-1"></div>

                  <button onClick={() => handleExport('excel')} className="p-2 bg-emerald-600/10 text-emerald-500 rounded-lg hover:bg-emerald-600/20 transition-colors" title="Exportar Excel">
                    <FileSpreadsheet size={18} />
                  </button>
                  <button onClick={() => handleExport('csv')} className="p-2 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 transition-colors" title="Exportar CSV">
                    <FileText size={18} />
                  </button>
                  <button onClick={() => handleExport('json')} className="p-2 bg-blue-600/10 text-blue-500 rounded-lg hover:bg-blue-600/20 transition-colors" title="Exportar JSON">
                    <FileJson size={18} />
                  </button>
                </div>
              </div>

              {enrichmentStatus?.status === 'running' && (
                <div className="absolute -bottom-1 left-0 right-0 h-1 overflow-hidden rounded-full px-4">
                  <div className="h-full bg-indigo-500 animate-pulse-fast"></div>
                </div>
              )}
            </div>
            
            {enrichmentStatus && (
              <div className={`text-[10px] px-4 py-1.5 rounded-lg border flex items-center gap-2 ${
                enrichmentStatus.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                enrichmentStatus.status === 'failed' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
              }`}>
                <Info size={12} />
                <span className="font-medium">{enrichmentStatus.message}</span>
                {enrichmentStatus.status === 'running' && <span className="animate-pulse">...</span>}
              </div>
            )}

            <div className="glass-card overflow-hidden border-slate-800/50 shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-900/80 text-slate-500 text-[10px] uppercase tracking-[0.15em] font-bold">
                      <th className="px-6 py-4 border-b border-slate-800 w-12 text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.size > 0 && selectedIds.size === filteredData.length}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-red-600 focus:ring-red-500 focus:ring-offset-slate-900"
                        />
                      </th>
                      <th className="px-6 py-4 border-b border-slate-800">Producto</th>
                      <th className="px-6 py-4 border-b border-slate-800">Desde</th>
                      <th className="px-6 py-4 border-b border-slate-800">Hasta</th>
                      <th className="px-6 py-4 border-b border-slate-800">Stock</th>
                      <th className="px-6 py-4 border-b border-slate-800">Combo</th>
                      <th className="px-6 py-4 border-b border-slate-800">Precio</th>
                      <th className="px-6 py-4 border-b border-slate-800">Final</th>
                      <th className="px-6 py-4 border-b border-slate-800 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 text-xs">
                    {filteredData.length > 0 ? filteredData.map((row) => {
                      const finalPrice = calculateFinalPrice(row.precio_fidelizado, row.combo);
                      const isSelected = selectedIds.has(row.id);
                      const outOfStock = row.stock <= 0;
                      const isEditing = editingId === row.id;

                      return (
                        <tr 
                          key={row.id} 
                          className={`group transition-all duration-150 ${isSelected ? 'bg-red-600/5' : 'hover:bg-slate-800/20'} ${outOfStock ? 'opacity-60' : ''}`}
                          onClick={() => !isEditing && toggleSelectItem(row.id)}
                        >
                          <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => toggleSelectItem(row.id)}
                              className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-red-600 focus:ring-red-500 focus:ring-offset-slate-900"
                            />
                          </td>
                          <td className="px-6 py-4">
                            {isEditing ? (
                              <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                                <input 
                                  className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white w-full"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  placeholder="Nombre del artículo"
                                />
                                <div className="flex gap-2">
                                  <input 
                                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-[10px] w-24"
                                    value={editCode}
                                    onChange={(e) => setEditCode(e.target.value)}
                                    placeholder="Código"
                                  />
                                  {(row.combo || '').toLowerCase().includes('llevando') && (
                                    <input 
                                      className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-[10px] w-24"
                                      value={editUnits}
                                      onChange={(e) => setEditUnits(e.target.value)}
                                      placeholder="Unidades"
                                      type="number"
                                    />
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <span className="text-white font-semibold group-hover:text-red-400 transition-colors uppercase">{row.articulo || '(Sin descripción)'}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-500 font-mono tracking-tighter">ID: {row.codigo}</span>
                                  {(row.combo || '').toLowerCase().includes('llevando') && row.cantidades && (
                                    <span className="text-[10px] bg-red-600/20 text-red-400 px-1 rounded font-bold">REQ: {row.cantidades}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-slate-400 font-mono text-[10px]">{row.fecha_desde}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-slate-400 font-mono text-[10px]">{row.fecha_hasta}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold ${outOfStock ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                              {row.stock} un.
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold ${row.combo ? 'bg-red-500/10 text-red-400' : 'text-slate-600'}`}>
                              {row.combo || 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-500 line-through decoration-red-500/30">
                            {formatCurrency(row.precio_fidelizado)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-400 font-bold text-sm">{formatCurrency(finalPrice)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              {isEditing ? (
                                <>
                                  <button onClick={() => handleUpdateRecord(row.id)} className="p-1.5 bg-emerald-600/20 text-emerald-400 rounded-md hover:bg-emerald-600/40">
                                    <Check size={14} />
                                  </button>
                                  <button onClick={() => setEditingId(null)} className="p-1.5 bg-slate-800 text-slate-400 rounded-md hover:bg-slate-700">
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button 
                                    onClick={() => handleEditStart(row)} 
                                    className="p-1.5 bg-blue-600/10 text-blue-400 rounded-md hover:bg-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Search size={14} />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteRecord(row.id)} 
                                    className="p-1.5 bg-red-600/10 text-red-400 rounded-md hover:bg-red-600/20 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    }) : (
                      <tr>
                        <td colSpan={6} className="px-6 py-16 text-center text-slate-600">
                          <div className="flex flex-col items-center gap-2">
                            <Search size={40} className="opacity-20" />
                            <p className="italic">No hay artículos con stock real para mostrar.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
