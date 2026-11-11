# Snapshot de Respaldo v2.0.0 — Extractor Mensual y Semanal Blindado

**Fecha de Creación**: 11 de Noviembre de 2026  
**Estado**: Validado en Producción (Render 512MB RAM + Vercel Frontend)

---

## 🎯 Objetivo de este Snapshot
Este respaldo preserva la arquitectura completa que solucionó de forma definitiva los problemas de estabilidad tanto en el extractor semanal como en el extractor mensual por etapas (`/extract-monthly`).

---

## 📦 Componentes Incluidos en este Respaldo

| Archivo en Backup | Ubicación Original | Propósito |
| :--- | :--- | :--- |
| `scraper.js` | `backend/scraper.js` | Motor Playwright con tipeo GeneXus, escaneo recursivo de iframes, verificación estricta de fechas antes de buscar y paginación en lotes de 50 filas. |
| `mot_scheduler.js` | `backend/mot_scheduler.js` | Árbitro de memoria RAM. Pausa automática del MOT Bot durante extracciones (`_pausedByExtraction`) y liberación del 100% de memoria. |
| `mot_bot.js` | `backend/mot_bot.js` | Automatización de tareas de tienda (incluyendo temperaturas con selectores universales y confirmación `#CUMPLIR`). |
| `index.js` | `backend/index.js` | API Express con soporte para `keepMotPaused: true` entre etapas consecutivas y endpoint `POST /api/mot-bot/resume`. |
| `frontend_extract_monthly_page.tsx` | `frontend/app/extract-monthly/page.tsx` | UI de extracción mensual por etapas (10 páginas por etapa), auto-reintento transitorio, botón de cancelación inmediata y fusión automática en CSV. |
| `frontend_extract_page.tsx` | `frontend/app/extract/page.tsx` | UI de extracción semanal/rango directo. |
| `manifest.json` | `backend/backups/extractor_golden_master/manifest.json` | Hashes SHA-256 oficiales y reglas críticas para auditoría de integridad. |

---

## 🛡️ Reglas Críticas Blindadas

1. **Sincronización de Iframes de Datos**:
   - Detección activa de `#vDESDE` y `#vHASTA` dentro de cualquier frame hijo antes de intentar interactuar.
2. **Validación Estricta de Fechas**:
   - Tipeo con `el.type(digitsOnly)` con máscara de GeneXus.
   - Validación obligatoria de que `Desde` y `Hasta` no estén vacíos antes de hacer clic en `Buscar`.
   - Si la fecha `Hasta` queda vacía (`/ /`), el scraper cancela la búsqueda en lugar de lanzar una consulta masiva de 482 páginas.
3. **Gestión de Memoria en Render (512MB)**:
   - Chromium corre con flags de aislamiento mínimo: `--renderer-process-limit=1`, `--disable-features=site-per-process`.
   - El MOT Bot se detiene y cierra Chromium completamente durante las extracciones.
4. **Extracción por Etapas Seguras**:
   - Cada etapa procesa 10 páginas, guarda los datos en memoria del cliente, cierra el navegador para vaciar la RAM y espera 3 segundos antes de la siguiente etapa.
