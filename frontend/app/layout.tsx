'use client'

import { useState, useEffect } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'
import { 
  LayoutDashboard, 
  Download, 
  Database, 
  Settings, 
  FileText, 
  Menu, 
  ChevronLeft, 
  ChevronRight,
  X,
  Bot
} from 'lucide-react'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [])

  const navItems = [
    { name: 'Dashboard',      href: '/',        icon: <LayoutDashboard size={20} /> },
    { name: 'Extracción',     href: '/extract', icon: <Download size={20} /> },
    { name: 'Datos',          href: '/data',    icon: <Database size={20} /> },
    { name: 'Cartelería',     href: '/data',    icon: <FileText size={20} />, highlight: true },
    { name: 'MOT Bot',        href: '/mot-bot', icon: <Bot size={20} />,     bot: true },
    { name: 'Configuración',  href: '/settings', icon: <Settings size={20} /> },
  ]

  return (
    <html lang="es">
      <body className={`${inter.className} bg-[#0a0f1c] text-slate-100`}>
        <div className="flex min-h-screen overflow-hidden">
          
          {/* Mobile Overlay */}
          {isMobileMenuOpen && (
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {/* Sidebar */}
          <aside className={`
            fixed lg:relative z-50 h-full glass-card rounded-none border-y-0 border-l-0 border-r border-slate-800 
            transition-all duration-300 ease-in-out flex flex-col
            ${isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}
            ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}
          `}>
            {/* Header / Logo */}
            <div className="flex items-center justify-between p-6 h-20 border-b border-slate-800/50">
              <div className={`flex items-center gap-3 overflow-hidden ${isCollapsed ? 'lg:hidden' : 'flex'}`}>
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center font-bold text-xl shrink-0">D</div>
                <h1 className="font-bold text-lg tracking-tight whitespace-nowrap">DIA Extractor</h1>
              </div>
              
              {/* Desktop Collapse Toggle */}
              <button 
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="hidden lg:flex p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors"
              >
                {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>

              {/* Mobile Close Button */}
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                className="lg:hidden p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* Navigation */}
            <nav className="flex-1 p-4 flex flex-col gap-2 overflow-y-auto">
              {navItems.map((item) => (
                <a 
                  key={item.name}
                  href={item.href} 
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group
                    ${item.highlight 
                      ? 'text-red-400 hover:bg-red-600/10' 
                      : item.bot
                        ? 'text-rose-300 hover:bg-rose-600/10'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
                  `}
                  title={isCollapsed ? item.name : ''}
                >
                  <span className={`shrink-0 ${item.highlight ? 'text-red-500' : item.bot ? 'text-rose-400' : 'group-hover:scale-110 transition-transform'}`}>
                    {item.icon}
                  </span>
                  <span className={`font-medium whitespace-nowrap transition-opacity duration-300 ${isCollapsed ? 'lg:opacity-0 lg:w-0' : 'opacity-100'}`}>
                    {item.name}
                  </span>
                  {item.bot && !isCollapsed && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  )}
                </a>
              ))}
            </nav>


            {/* Footer / Info */}
            {!isCollapsed && (
              <div className="p-6 border-t border-slate-800/50">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Versión 2.0</div>
                <div className="text-xs text-slate-400">© 2024 DIA Extractor</div>
              </div>
            )}
          </aside>

          {/* Main Content */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Topbar (Mobile only) */}
            <header className="lg:hidden h-16 border-b border-slate-800 flex items-center px-6 glass-card rounded-none border-x-0 shrink-0">
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2 -ml-2 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <Menu size={24} />
              </button>
              <div className="ml-4 flex items-center gap-2">
                <div className="w-6 h-6 bg-red-600 rounded flex items-center justify-center font-bold text-sm">D</div>
                <span className="font-bold text-sm uppercase tracking-wider">DIA Extractor</span>
              </div>
            </header>

            <main className="flex-1 overflow-auto">
              <div className="max-w-[1600px] mx-auto p-4 md:p-8">
                {children}
              </div>
            </main>
          </div>
        </div>
      </body>
    </html>
  )
}
