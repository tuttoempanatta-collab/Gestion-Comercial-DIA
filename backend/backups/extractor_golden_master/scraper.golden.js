const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { db, saveCommercialAction } = require('./db');

async function runScraper(extractionId, startDate, endDate, settings, pageSize = 50, onProgress, options = {}) {
  const startPageParam = parseInt(options.startPage || 1);
  const maxPagesParam = options.maxPages ? parseInt(options.maxPages) : 999;

  console.log(`[DEBUG] runScraper started for ID: ${extractionId} (startPage: ${startPageParam}, maxPages: ${maxPagesParam})`);

  const browser = await chromium.launch({ 
    headless: true,
    args: process.platform === 'win32' 
      ? ['--no-sandbox', '--disable-setuid-sandbox'] 
      : [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-zygote',
          '--renderer-process-limit=1',
          '--disable-features=site-per-process,Translate,OptimizationHints,MediaRouter',
          '--js-flags=--max-old-space-size=128',
          '--disk-cache-size=1'
        ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });

  // Bloquear imágenes pesadas y multimedia para ahorrar RAM sin romper fuentes ni estilos GeneXus
  await context.route('**/*.{png,jpg,jpeg,gif,webp,mp4,mp3}', route => route.abort());

  const page = await context.newPage();

  try {
    console.log(`[Ext-${extractionId}] Iniciando scraper...`);
    onProgress({ message: 'Preparando navegador...', current: 0, total: 100, percentage: 2 });
    
    await page.goto(settings.portal_url, { waitUntil: 'load', timeout: 60000 });
    onProgress({ message: 'Portal cargado. Identificándose...', current: 0, total: 100, percentage: 5 });

    const loginSelector = '#vSECUSERNAME, #vUSERSEGLGN';
    const passSelector = '#vSECUSERPASSWORD, #vUSERSEGPWR';

    let needsLogin = false;
    try {
      const loginInput = page.locator(loginSelector).first();
      await loginInput.waitFor({ state: 'visible', timeout: 15000 });
      needsLogin = true;
    } catch (e) {
      console.log(`[Ext-${extractionId}] Formulario de login no visible en 15s. Comprobando sesión activa...`);
    }

    if (needsLogin) {
      console.log(`[Ext-${extractionId}] Ingresando credenciales de acceso...`);
      await page.fill(loginSelector, settings.username);
      await page.fill(passSelector, settings.password);
      
      const enterBtn = page.locator('#BTNENTER, input[name="BTNENTER"], input[value="Ingresar"], button:has-text("Ingresar")').first();
      await enterBtn.waitFor({ state: 'visible', timeout: 10000 });
      await enterBtn.click();
      console.log(`[Ext-${extractionId}] Clic en Ingresar. Esperando validación de sesión...`);
      await page.waitForTimeout(3000);
      await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    }

    onProgress({ message: 'Sesión iniciada. Navegando a la tabla...', current: 5, total: 100, percentage: 5 });

    let isTableLoaded = false;
    let dataFrame = page;

    try {
      console.log(`[Ext-${extractionId}] Navegando directamente a articulospromoview...`);
      onProgress({ message: 'Conectando con tabla de promociones...', current: 5, total: 100, percentage: 6 });
      await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
        waitUntil: 'commit',
        timeout: 25000 
      });
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

      const desdeCheck = page.locator('#vDESDE, input[name*="vDESDE"]').first();
      if (await desdeCheck.isVisible({ timeout: 8000 }).catch(() => false)) {
        isTableLoaded = true;
        console.log(`[Ext-${extractionId}] Tabla cargada directamente (#vDESDE visible).`);
      }
    } catch (e) {
      console.log(`[Ext-${extractionId}] Aviso navegación directa (${e.message}). Intentando menú lateral...`);
    }

    if (!isTableLoaded) {
      onProgress({ message: 'Accediendo mediante menú lateral...', current: 5, total: 100, percentage: 6 });
      try {
        if (!page.url().includes('viewhome')) {
          await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.viewhome', { 
            waitUntil: 'domcontentloaded',
            timeout: 20000 
          });
          await page.waitForTimeout(1500);
        }
        
        console.log(`[Ext-${extractionId}] Buscando menú "Gestion Operativa"...`);
        const gestionOperativaMenu = page.locator('text="Gestion Operativa", :has-text("Gestion Operativa")').first();
        await gestionOperativaMenu.waitFor({ state: 'visible', timeout: 15000 });
        await gestionOperativaMenu.click();
        await page.waitForTimeout(2000);

        console.log(`[Ext-${extractionId}] Buscando item "Acciones comerciales generales"...`);
        const accionesGeneralesItem = page.locator('text="Acciones comerciales generales", a:has-text("Acciones comerciales generales")').first();
        await accionesGeneralesItem.waitFor({ state: 'visible', timeout: 15000 });
        await accionesGeneralesItem.click();

        console.log(`[Ext-${extractionId}] Esperando carga de la tabla (#vDESDE)...`);
        const desdeMenuCheck = page.locator('#vDESDE, input[name*="vDESDE"]').first();
        await desdeMenuCheck.waitFor({ state: 'visible', timeout: 20000 });
        isTableLoaded = true;
        console.log(`[Ext-${extractionId}] Tabla cargada exitosamente mediante el menú.`);
      } catch (menuError) {
        console.error(`[Ext-${extractionId}] Error en menú lateral:`, menuError.message);
        try {
          await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
            waitUntil: 'domcontentloaded',
            timeout: 20000 
          });
          const desdeFinalCheck = page.locator('#vDESDE, input[name*="vDESDE"]').first();
          await desdeFinalCheck.waitFor({ state: 'visible', timeout: 10000 });
          isTableLoaded = true;
        } catch (finalError) {
          console.error(`[Ext-${extractionId}] Fallaron todos los métodos de navegación.`);
        }
      }
    }

    // 2. Confirmar que el panel de filtros esté visible
    onProgress({ message: 'Panel de datos listo. Preparando filtros...', current: 5, total: 100, percentage: 8 });

    // Determinar qué frame contiene los datos si no está en el frame principal
    dataFrame = page;
    const isMainVisible = await page.locator('#vDESDE').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (!isMainVisible) {
      for (const f of page.frames()) {
        try {
          const el = f.locator('#vDESDE').first();
          if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
            dataFrame = f;
            break;
          }
        } catch (_) {}
      }
    }

    // 3. Los filtros de fecha se aplican más abajo con verificación (applyDateFilters),
    //    una vez definido getGridState() para poder confirmar la recarga real de la grilla.
    const startFormatted = formatDateForPortal(startDate);
    const endFormatted = formatDateForPortal(endDate);

    // RECURSIVE function to find the data frame anywhere in the hierarchy
    const findDataFrameRecursive = async (parent) => {
      const frames = parent.childFrames();
      for (const f of frames) {
        try {
          const hasTable = await f.$('#GridContainerTbl, .Grid_WorkWith, #vDESDE');
          if (hasTable) return f;
          const found = await findDataFrameRecursive(f);
          if (found) return found;
        } catch (e) {}
      }
      return null;
    };

    const findDataFrame = async (p) => {
      const found = await findDataFrameRecursive(p.mainFrame());
      return found || p.mainFrame();
    };

    // Helper para leer "Página X de Y" y cantidad de filas actuales en la tabla
    const getGridState = async () => {
      const df = await findDataFrame(page);
      const frames = Array.from(new Set([df, ...(page.frames ? page.frames() : [])]));
      for (const f of frames) {
        try {
          const state = await f.evaluate(() => {
            const pageRegex = /(?:P\u00e1gina|Página|Pagina|P\u00e1g\.?|Pág\.?)\s+(\d+)\s+(?:de|of)\s+(\d+)/i;
            
            // 1. Buscar en elementos visibles interactivos o del paginador (botones, links, celdas)
            const candidates = Array.from(document.querySelectorAll('button, a, span, div, td, li')).filter(el => {
              const t = (el.innerText || '').trim();
              if (!pageRegex.test(t) || t.length > 50) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });

            let m = null;
            if (candidates.length > 0) {
              const preferred = candidates.find(el => 
                el.tagName === 'BUTTON' || 
                el.tagName === 'A' || 
                el.classList.contains('dropdown-toggle') || 
                el.closest('.pagination, [class*="paging"], [id*="PAGING"]')
              ) || candidates[0];
              m = (preferred.innerText || '').trim().match(pageRegex);
            }

            if (!m) {
              const text = document.body.innerText || '';
              m = text.match(pageRegex);
            }

            const trs = Array.from(document.querySelectorAll('#GridContainerTbl tr, .Grid_WorkWith tr, table[id*="Grid"] tr'));
            let validRows = 0;
            let firstCode = '';
            for (const row of trs) {
              const tds = row.querySelectorAll('td');
              if (tds.length >= 7 && !row.querySelector('th') && !row.classList.contains('Grid_WorkWithHeader')) {
                const code = tds[0]?.innerText.trim() || '';
                if (code && !isNaN(parseInt(code))) {
                  validRows++;
                  if (!firstCode) firstCode = code;
                }
              }
            }
            if (m || validRows > 0) {
              return {
                currentPage: m ? parseInt(m[1]) : 1,
                totalPages: m ? parseInt(m[2]) : 1,
                validRows,
                firstCode
              };
            }
            return null;
          });
          if (state) return state;
        } catch (e) {}
      }
      return { currentPage: 1, totalPages: 1, validRows: 0, firstCode: '' };
    };

    // Lee el valor actual de un campo de fecha en cualquier frame
    const readDateField = async (selector) => {
      const frames = Array.from(new Set([dataFrame, ...(page.frames ? page.frames() : [])]));
      for (const f of frames) {
        try {
          const el = f.locator(selector).first();
          if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
            const val = await el.evaluate(i => i.value || i.getAttribute('value') || '').catch(() => '');
            if (val && val.trim()) return val.trim();
            const inv = await el.inputValue().catch(() => '');
            if (inv && inv.trim()) return inv.trim();
          }
        } catch (_) {}
      }
      return '';
    };

    // Espera a que la grilla cambie realmente respecto a un estado previo (total de páginas o primer código)
    const waitForGridChange = async (prev, maxSeconds = 25) => {
      for (let i = 0; i < maxSeconds; i++) {
        await page.waitForTimeout(1000);
        await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 5000 }).catch(() => {});
        const now = await getGridState();
        if (now.validRows > 0 && (now.totalPages !== prev.totalPages || now.firstCode !== prev.firstCode)) {
          return { changed: true, state: now };
        }
      }
      return { changed: false, state: await getGridState() };
    };

    // 3-bis. Aplicar filtros de fecha CON VERIFICACIÓN (valor leído + recarga real de la grilla)
    const DESDE_SEL = '#vDESDE, input[name*="vDESDE"], input[name*="DESDE"]';
    const HASTA_SEL = '#vHASTA, input[name*="vHASTA"], input[name*="HASTA"]';

    const applyDateFilters = async (attemptLabel = '') => {
      if (!startFormatted && !endFormatted) return { ok: true, changed: false };
      onProgress({ message: `Aplicando filtros de fecha${attemptLabel}...`, current: 5, total: 100, percentage: 10 });
      console.log(`[Ext-${extractionId}] Aplicando filtros: Desde=${startFormatted || 'Inicio'}, Hasta=${endFormatted || 'Hoy'}`);

      let datesOk = false;
      for (let tryNum = 1; tryNum <= 3 && !datesOk; tryNum++) {
        let fD = false;
        let fH = false;
        if (startFormatted) fD = await fillGeneXusDate(page, dataFrame, DESDE_SEL, startFormatted, 'DESDE', extractionId, tryNum);
        if (endFormatted) fH = await fillGeneXusDate(page, dataFrame, HASTA_SEL, endFormatted, 'HASTA', extractionId, tryNum);
        const vD = startFormatted ? await readDateField(DESDE_SEL) : '';
        const vH = endFormatted ? await readDateField(HASTA_SEL) : '';
        const digitsD = (startFormatted || '').replace(/\D/g, '');
        const digitsH = (endFormatted || '').replace(/\D/g, '');
        const vDDigits = vD.replace(/\D/g, '');
        const vHDigits = vH.replace(/\D/g, '');

        datesOk = (!startFormatted || vD === startFormatted || (digitsD && vDDigits === digitsD) || fD) &&
                  (!endFormatted || vH === endFormatted || (digitsH && vHDigits === digitsH) || fH);

        onProgress({ message: `Verificación fechas (intento ${tryNum}): Desde="${vD || (fD ? startFormatted : '')}" Hasta="${vH || (fH ? endFormatted : '')}" ${datesOk ? 'OK' : '-> reintentando'}`, current: 5, total: 100, percentage: 10 });
      }

      const before = await getGridState();
      await clickGeneXusBuscar(page, dataFrame, extractionId);
      onProgress({ message: 'Esperando actualización de la grilla...', current: 5, total: 100, percentage: 11 });
      const res = await waitForGridChange(before, 20);
      await page.waitForTimeout(1000);

      // Re-verificar estado tras Buscar
      const vD2 = startFormatted ? await readDateField(DESDE_SEL) : '';
      const vH2 = endFormatted ? await readDateField(HASTA_SEL) : '';
      onProgress({
        message: `Grilla tras Buscar: ${res.changed ? 'RECARGADA' : 'LISTA'} | Pág ${res.state.currentPage} de ${res.state.totalPages} | ${res.state.validRows} filas | 1er código ${res.state.firstCode || '-'} | Fechas: ${vD2 || startFormatted || '-'} - ${vH2 || endFormatted || '-'}`,
        current: 12, total: 100, percentage: 12
      });
      return { ok: true, changed: res.changed, state: res.state };
    };

    const dateResult = await applyDateFilters();
    onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 12 });

    // 4. Detectar estado inicial y aplicar el filtro de filas por página (ej. 50 filas)
    let gridState = await getGridState();
    let totalPages = gridState.totalPages;
    console.log(`[Ext-${extractionId}] Estado inicial tras búsqueda: Página ${gridState.currentPage} de ${totalPages} (${gridState.validRows} filas visibles)`);

    const targetSize = parseInt(pageSize) || 50;
    const applyPageSize = async () => {
    if (targetSize !== 10 && gridState.validRows > 0) {
      onProgress({ message: `Aplicando filtro de ${targetSize} filas por página...`, current: 12, total: 100, percentage: 13 });
      console.log(`[Ext-${extractionId}] Aplicando configuración de ${targetSize} filas por página (actual: ${gridState.validRows} filas, ${totalPages} págs)...`);

      let sizeApplied = false;
      for (let attempt = 1; attempt <= 4 && !sizeApplied; attempt++) {
        dataFrame = await findDataFrame(page);
        const framesToTry = Array.from(new Set([dataFrame, ...(page.frames ? page.frames() : [])]));

        for (const f of framesToTry) {
          if (sizeApplied) break;
          try {
            await f.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
            await page.waitForTimeout(800);

            // Paso A: Localizar el botón "Página X de Y" o "Registros por página" abajo a la izquierda de la tabla
            const triggerFound = await f.evaluate(() => {
              document.querySelectorAll('[data-gx-page-trigger]').forEach(el => el.removeAttribute('data-gx-page-trigger'));
              const regex = /^(?:P\u00e1gina|Página|Pagina|P\u00e1g\.?|Pág\.?)\s+\d+\s+(?:de|of)\s+\d+/i;
              const candidates = Array.from(document.querySelectorAll('button, a, span, div, td')).filter(el => {
                const t = (el.innerText || '').trim();
                if ((!regex.test(t) && !t.toLowerCase().includes('registros por p')) || t.length > 50) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });

              if (candidates.length === 0) return null;

              let best = candidates.find(el => el.tagName === 'BUTTON' || el.tagName === 'A' || el.classList.contains('dropdown-toggle'));
              if (!best) {
                best = candidates[candidates.length - 1];
                const interactiveParent = best.closest('button, a, .dropdown-toggle, [data-toggle="dropdown"]');
                if (interactiveParent && (interactiveParent.innerText || '').trim().length < 50) {
                  best = interactiveParent;
                }
              }

              best.scrollIntoView({ block: 'center' });
              best.setAttribute('data-gx-page-trigger', 'true');
              return { tag: best.tagName, text: (best.innerText || '').trim() };
            });

            if (triggerFound) {
              console.log(`[Ext-${extractionId}] [Intento ${attempt}] Abriendo menú de paginación en "${triggerFound.text}" (${triggerFound.tag})...`);
              const triggerLoc = f.locator('[data-gx-page-trigger="true"]').first();
              await triggerLoc.click({ timeout: 5000 }).catch(async () => {
                await f.evaluate(() => {
                  const el = document.querySelector('[data-gx-page-trigger="true"]');
                  if (el) el.click();
                });
              });
              await page.waitForTimeout(1500);
            } else {
              // Fallback por selector de texto en Playwright
              const fbTrigger = f.locator('button:has-text("Página "), a:has-text("Página "), text=/^P[aá]gina\\s+\\d+\\s+de\\s+\\d+/i, text="Registros por página"').first();
              if (await fbTrigger.isVisible({ timeout: 2500 }).catch(() => false)) {
                await fbTrigger.click().catch(() => {});
                await page.waitForTimeout(1500);
              }
            }

            // Paso B: Esperar a que el popup o dropdown-menu esté activo en el DOM
            await f.waitForSelector('.dropdown-menu, ul[class*="dropdown"], [class*="paging"]', { state: 'attached', timeout: 4000 }).catch(() => {});

            // Paso C: Buscar y hacer clic en la opción "${targetSize} filas" (ej. "50 filas")
            const optionFound = await f.evaluate((size) => {
              document.querySelectorAll('[data-gx-rows-opt]').forEach(el => el.removeAttribute('data-gx-rows-opt'));
              const optRegex = new RegExp(`^${size}\\s*(?:filas|rows|registros)$`, 'i');

              const allMatches = Array.from(document.querySelectorAll('a, span, li, div, button')).filter(el => {
                const t = (el.innerText || '').trim();
                return optRegex.test(t) || t.toLowerCase() === `${size} filas`;
              });

              if (allMatches.length === 0) return null;

              const visibleMatches = allMatches.filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });

              const pool = visibleMatches.length > 0 ? visibleMatches : allMatches;
              let best = pool.find(el => el.tagName === 'A' || el.tagName === 'BUTTON') || pool[0];

              best.setAttribute('data-gx-rows-opt', 'true');
              const rect = best.getBoundingClientRect();
              return {
                tag: best.tagName,
                text: (best.innerText || '').trim(),
                visible: rect.width > 0 && rect.height > 0
              };
            }, targetSize);

            if (optionFound) {
              console.log(`[Ext-${extractionId}] Seleccionando opción "${optionFound.text}" (${optionFound.tag}, visible=${optionFound.visible})...`);
              
              // Disparar click en Playwright y en el DOM con eventos completos de ratón
              try {
                const optLoc = f.locator('[data-gx-rows-opt="true"]').first();
                await optLoc.scrollIntoViewIfNeeded().catch(() => {});
                await optLoc.click({ timeout: 4000 }).catch(() => {});
              } catch (_) {}

              await f.evaluate(() => {
                const el = document.querySelector('[data-gx-rows-opt="true"]');
                if (el) {
                  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
                  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
                  if (el.tagName !== 'A' && el.querySelector('a')) {
                    el.querySelector('a').click();
                  } else if (el.parentElement && el.parentElement.tagName === 'A') {
                    el.parentElement.click();
                  }
                }
              }).catch(() => {});

              // Esperar que GeneXus recargue la tabla con las nuevas filas
              await page.waitForTimeout(2500);
              await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});

              const prevTotal = totalPages;
              const prevRows = gridState.validRows;
              console.log(`[Ext-${extractionId}] Esperando actualización de grilla a ${targetSize} filas (previo: ${prevRows} filas, ${prevTotal} págs)...`);

              for (let waitStep = 0; waitStep < 20; waitStep++) {
                await page.waitForTimeout(1000);
                const updated = await getGridState();
                
                // Criterio de éxito: Total de páginas debe haber disminuido respecto al inicial de 10 filas
                // y las filas visibles deben reflejar la nueva densidad de 50 filas (>= 25 filas)
                const pageCountChanged = (prevTotal > 1 ? (updated.totalPages < prevTotal) : true);
                const rowsUpdated = (targetSize >= 50 ? (updated.validRows >= 25 || updated.validRows === targetSize) : (updated.validRows === targetSize));
                
                if (pageCountChanged && rowsUpdated) {
                  gridState = updated;
                  totalPages = updated.totalPages;
                  sizeApplied = true;
                  console.log(`[Ext-${extractionId}] ¡Filtro de ${targetSize} filas confirmado en paso ${waitStep + 1}! Total de páginas: ${totalPages} (filas visibles: ${gridState.validRows})`);
                  break;
                }
              }

              // Sincronización de estado tras la espera
              const checkState = await getGridState();
              if (checkState.totalPages > 0 && (targetSize >= 50 ? checkState.validRows >= 25 : checkState.validRows === targetSize)) {
                gridState = checkState;
                totalPages = checkState.totalPages;
                sizeApplied = true;
              }
              console.log(`[Ext-${extractionId}] Estado tras intento ${attempt}: ${gridState.validRows} filas en pág 1, Total de páginas: ${totalPages}`);
              if (sizeApplied) break;
            } else {
              console.log(`[Ext-${extractionId}] Opción de ${targetSize} filas no encontrada en intento ${attempt}. Reintentando apertura...`);
            }
          } catch (err) {
            console.log(`[Ext-${extractionId}] Aviso en intento ${attempt} de cambio de filas:`, err.message);
          }
        }
      }

      // GUARDIA ESTRICTA ANTI-106 PÁGINAS (Guard Rail de Seguridad):
      // Si el usuario pidió 50 filas y la grilla sigue teniendo densidad de 10 filas (validRows < 25),
      // forzar un intento de reaplicación directa para no saturar memoria.
      if (targetSize >= 50 && gridState.validRows < 25) {
        console.warn(`[Ext-${extractionId}] ALERTA GUARDIA: La grilla no aplicó 50 filas (sigue en ${gridState.validRows} filas, ${totalPages} págs). Forzando re-aplicación...`);
        onProgress({ message: `Aviso: Re-sincronizando grilla a ${targetSize} filas para evitar desborde...`, current: 13, total: 100, percentage: 14 });
        
        try {
          const df = await findDataFrame(page);
          await df.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
          await page.waitForTimeout(1000);
          
          const trig = df.locator('button:has-text("Página "), a:has-text("Página "), [class*="paging"] button, [data-toggle="dropdown"]').first();
          if (await trig.isVisible({ timeout: 3000 }).catch(() => false)) {
            await trig.click().catch(() => {});
            await page.waitForTimeout(1200);
            const opt = df.locator('text=/^50\\s*filas/i, a:has-text("50 filas"), li:has-text("50 filas")').first();
            if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
              await opt.click().catch(() => {});
              await page.waitForTimeout(3000);
              await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});
              const finalGuardCheck = await getGridState();
              if (finalGuardCheck.totalPages > 0 && finalGuardCheck.validRows >= 25) {
                gridState = finalGuardCheck;
                totalPages = finalGuardCheck.totalPages;
                sizeApplied = true;
                console.log(`[Ext-${extractionId}] ¡Guardia resolvió con éxito! Páginas finales: ${totalPages} (${gridState.validRows} filas)`);
              }
            }
          }
        } catch (gErr) {
          console.warn(`[Ext-${extractionId}] Error en guardia de 50 filas:`, gErr.message);
        }
      }
    }
    };

    await applyPageSize();

    // GUARDIA DE COHERENCIA DE PÁGINAS (guardRail50Rows):
    // Con 50 filas, un rango corto (<= 10 días) no puede exceder MAX_COHERENT_PAGES páginas (hasta ~7500 artículos).
    // Si la grilla muestra densidad < 25 filas o supera el límite, 50 filas no quedó aplicado.
    const MAX_COHERENT_PAGES = 150;
    const rangeDays = (startFormatted && endFormatted)
      ? Math.round((parseDate(endFormatted) - parseDate(startFormatted)) / 86400000) + 1
      : 999;
    const isIncoherent = () => targetSize >= 50 && (
      (rangeDays <= 10 && totalPages > MAX_COHERENT_PAGES) ||
      gridState.validRows < 25
    );

    for (let fix = 1; fix <= 2 && isIncoherent(); fix++) {
      onProgress({ message: `Aviso: ${totalPages} páginas con ${gridState.validRows} filas es incoherente para 50 filas (${rangeDays} días). Reintentando configuración (intento ${fix})...`, current: 13, total: 100, percentage: 14 });
      await applyPageSize();
      gridState = await getGridState();
      totalPages = gridState.totalPages;
    }
    if (isIncoherent()) {
      throw new Error(`Filtro de 50 filas no aplicado: la grilla permaneció en ${totalPages} páginas de ${gridState.validRows} filas. Extracción detenida para proteger la memoria del servidor (512MB RAM). Por favor reintente.`);
    }
    onProgress({ message: `Grilla validada: ${totalPages} páginas de ${gridState.validRows} filas (rango ${rangeDays} días).`, current: 14, total: 100, percentage: 14 });

    // Si startPageParam > 1, usar el campo "Ir a página:" del popup de paginación
    if (startPageParam > 1) {
      onProgress({ message: `Saltando a página inicial ${startPageParam} de ${totalPages}...`, current: 0, total: totalPages, percentage: 14 });
      console.log(`[Ext-${extractionId}] Saltando directamente a página ${startPageParam}...`);
      dataFrame = await findDataFrame(page);
      try {
        await dataFrame.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(500);
        const triggerLoc = dataFrame.locator('[data-gx-page-trigger="true"], button:has-text("Página "), a:has-text("Página ")').first();
        if (await triggerLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
          await triggerLoc.click().catch(() => {});
          await page.waitForTimeout(1000);
          const pageInput = dataFrame.locator('.dropdown-menu input[type="text"], .dropdown-menu input[type="number"], input[id*="PAGINATION"], input[id*="PAGING"]').first();
          if (await pageInput.isVisible({ timeout: 2500 }).catch(() => false)) {
            await pageInput.fill(String(startPageParam));
            await pageInput.press('Enter');
            await page.waitForTimeout(1500);
            await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});
            await page.waitForTimeout(4000);
          }
        }
      } catch (e) {
        console.log(`[Ext-${extractionId}] Error en salto directo a página ${startPageParam}:`, e.message);
      }
    }

    console.log(`[Ext-${extractionId}] Total de páginas: ${totalPages} (${gridState.validRows} filas por página)`);
    onProgress({ message: `Iniciando extracción de ${totalPages} páginas (${gridState.validRows} filas por página)...`, current: 0, total: totalPages, percentage: 15 });

    // Expose the save function to the browser to save RAM
    await page.exposeFunction('saveRowToDb', async (row) => {
      try {
        await saveCommercialAction(extractionId, row);
        return true;
      } catch (err) {
        console.error(`[Scraper Warning] Falló inserción de artículo (${row?.codigo}):`, err.message);
        return false;
      }
    });

    // 5. Extracción continua página por página avanzando mediante botón "Sig"
    const maxPagesLimit = options.maxPages ? parseInt(options.maxPages) : 999;
    let totalItems = 0;
    let currentPage = startPageParam;
    let keepPaging = true;
    let lastFirstCode = '';
    let duplicatePagesCount = 0;

    console.log(`[Ext-${extractionId}] Iniciando extracción desde página ${startPageParam}...`);

    while (keepPaging && currentPage <= (startPageParam + maxPagesLimit - 1)) {
      dataFrame = await findDataFrame(page);

      if (global.cancelledExtractions?.has(extractionId)) {
        onProgress({ message: 'Cancelado por el usuario.', current: currentPage, total: Math.max(totalPages, currentPage), percentage: 100 });
        break;
      }

      const displayTotal = Math.max(totalPages, currentPage);
      onProgress({ 
        message: `Extrayendo página ${currentPage}${totalPages > 1 ? ` de ${totalPages}` : ''} (${totalItems} artículos guardados)...`, 
        current: currentPage, 
        total: displayTotal,
        percentage: Math.min(95, 15 + Math.floor((currentPage / (displayTotal + 1)) * 80))
      });

      // Esperar que la grilla esté lista
      await dataFrame.waitForSelector('#GridContainerTbl tr, .Grid_WorkWith tr, table[id*="Grid"] tr', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Procesar filas de la página actual en el navegador
      const pageResults = await dataFrame.evaluate(async () => {
        const trs = Array.from(document.querySelectorAll('#GridContainerTbl tr, .Grid_WorkWith tr, table[id*="Grid"] tr'));
        let count = 0;
        let totalRowsInGrid = 0;
        let firstCode = '';
        for (const row of trs) {
          const tds = row.querySelectorAll('td');
          if (tds.length >= 7 && !row.querySelector('th') && !row.classList.contains('Grid_WorkWithHeader')) {
            const rawPrice = tds[3]?.innerText.trim() || '0,00';
            const codigoStr = tds[0]?.innerText.trim() || '';

            if (codigoStr && !isNaN(parseInt(codigoStr))) {
              totalRowsInGrid++;
              if (!firstCode) firstCode = codigoStr;
            }

            // Regla oficial de cartelería: Si el precio fidelizado en el portal web es mayor a 0,00,
            // omitir el código porque ya tiene cartel impreso o precio fijo asignado.
            const cleanPriceStr = rawPrice.replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim();
            const numericPrice = parseFloat(cleanPriceStr) || 0;
            if (numericPrice > 0) {
              continue;
            }

            const data = {
              codigo: codigoStr,
              articulo: tds[1]?.innerText.trim() || '',
              combo: tds[2]?.innerText.trim() || '',
              precio_fidelizado: rawPrice,
              fecha_desde: tds[4]?.innerText.trim() || '',
              fecha_hasta: tds[5]?.innerText.trim() || '',
              cantidades: tds[6]?.innerText.trim() || '1'
            };

            if (data.codigo && !isNaN(parseInt(data.codigo))) {
              try {
                const saved = await window.saveRowToDb(data);
                if (saved) count++;
              } catch (saveErr) {
                console.warn('Error en saveRowToDb:', saveErr);
              }
            }
          }
        }
        return { count, totalRowsInGrid, firstCode };
      });

      totalItems += pageResults.count;
      console.log(`[Ext-${extractionId}] Pág ${currentPage}: Guardados ${pageResults.count} artículos con precio 0,00 (acumulado: ${totalItems}, filas en grilla: ${pageResults.totalRowsInGrid}, primer código: ${pageResults.firstCode || 'ninguno'})`);

      // Forzar liberación inmediata de memoria RAM tras procesar la página
      if (global.gc) {
        try { global.gc(); } catch (_) {}
      }

      // Detección de fin SOLO si la grilla física de GeneXus no tiene filas (tabla realmente vacía)
      // NUNCA romper si pageResults.count === 0, ya que una página completa puede tener precios > 0,00 que se omiten legítimamente.
      if (pageResults.totalRowsInGrid === 0) {
        console.log(`[Ext-${extractionId}] Fin de datos: 0 filas físicas en grilla en página ${currentPage}.`);
        break;
      }

      if (pageResults.firstCode && pageResults.firstCode === lastFirstCode) {
        duplicatePagesCount++;
        if (duplicatePagesCount >= 3) {
          console.log(`[Ext-${extractionId}] Página repetida consecutivamente (${pageResults.firstCode}). Finalizando extracción.`);
          break;
        }
      } else {
        duplicatePagesCount = 0;
        if (pageResults.firstCode) lastFirstCode = pageResults.firstCode;
      }

      // Si ya alcanzamos el total de páginas indicado por el paginador ("Página 23 de 23"), finalizar limpiamente
      const currentGridInfo = await getGridState();
      if (currentGridInfo.totalPages > 1) {
        totalPages = currentGridInfo.totalPages;
      }
      if (totalPages > 1 && currentPage >= totalPages && currentGridInfo.currentPage >= totalPages) {
        console.log(`[Ext-${extractionId}] Última página alcanzada (${currentPage} de ${totalPages}). Finalizando extracción.`);
        break;
      }

      // Buscar y hacer clic en el botón "Sig" para ir a la siguiente página
      dataFrame = await findDataFrame(page);
      const nextSelectors = [
        'a:has-text("Sig")',
        'input[value="Sig"]',
        'button:has-text("Sig")',
        '#GRIDPAGING_NEXT',
        'a[id*="PAGING_NEXT"]',
        'a[id*="NEXT"]',
        'a[id*="next"]',
        '.gx-paging-next:not(.disabled) a',
        'li.next:not(.disabled) a'
      ];

      let nextClicked = false;
      const allFrames = [dataFrame, ...(page.frames ? page.frames() : [])];
      const uniqueFrames = Array.from(new Set(allFrames));

      for (const f of uniqueFrames) {
        if (nextClicked) break;
        for (const nSel of nextSelectors) {
          try {
            const nextBtn = f.locator(nSel).first();
            if (await nextBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
              const isDisabled = await nextBtn.evaluate(el => {
                return el.classList.contains('disabled') || 
                       el.getAttribute('aria-disabled') === 'true' || 
                       el.getAttribute('disabled') !== null ||
                       el.closest('li')?.classList.contains('disabled') ||
                       el.closest('.disabled') !== null;
              }).catch(() => false);

              if (!isDisabled) {
                console.log(`[Ext-${extractionId}] Clic en botón "Sig" (avanzando a página ${currentPage + 1} de ${totalPages})...`);
                await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
                await nextBtn.click({ timeout: 5000 }).catch(async () => {
                  await nextBtn.evaluate(el => {
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    el.click();
                  }).catch(() => {});
                });
                await page.waitForTimeout(1000);
                await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 20000 }).catch(() => {});

                // Esperar activamente a que cambie el indicador de página o el primer código de la tabla
                for (let w = 0; w < 12; w++) {
                  await page.waitForTimeout(800);
                  const st = await getGridState();
                  if (st.currentPage === currentPage + 1 || (st.firstCode && st.firstCode !== lastFirstCode)) {
                    break;
                  }
                }
                await page.waitForTimeout(1500);
                nextClicked = true;
                break;
              }
            }
          } catch (e) {}
        }
      }

      if (!nextClicked) {
        console.log(`[Ext-${extractionId}] Botón "Sig" no disponible o deshabilitado. Se completaron todas las páginas disponibles (${currentPage} páginas).`);
        break;
      }

      currentPage++;
      if (currentPage > totalPages) {
        totalPages = currentPage;
      }
    }

    onProgress({ 
      message: `Extracción completada. ${totalItems} items guardados.`, 
      current: totalPages, 
      total: totalPages, 
      percentage: 100 
    });
    
    return totalItems;

  } catch (error) {
    console.error('Scraper error:', error);
    onProgress({ message: `Error crítico: ${error.message}`, current: 0, total: 100, percentage: 0, error: true });
    throw error;
  } finally {
    await browser.close();
  }
}

function parseDate(dateStr) {
  const [day, month, year] = dateStr.split('/');
  return new Date(year, month - 1, day);
}

function formatDateForPortal(dateStr) {
  if (!dateStr) return "";
  if (dateStr.includes('/')) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

async function fillGeneXusDate(page, frame, selector, valueStr, fieldName, extractionId, tryNum = 1) {
  if (!valueStr) return false;
  console.log(`[Ext-${extractionId}] Registrando campo GeneXus ${fieldName}: ${valueStr} (intento ${tryNum})...`);

  const framesToTry = [frame, ...(page.frames ? page.frames() : [])];
  const uniqueFrames = Array.from(new Set(framesToTry));

  for (const f of uniqueFrames) {
    try {
      const el = f.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.focus().catch(() => {});
        await page.waitForTimeout(150);

        // 1. Limpiar completamente el campo de fecha
        await el.click({ clickCount: 3 }).catch(() => {});
        await page.waitForTimeout(100);
        await el.press('Control+a').catch(() => {});
        await el.press('Backspace').catch(() => {});
        await page.waitForTimeout(150);

        // 2. Extraer dígitos para la máscara nativa de GeneXus (ej. 04112026 para 04/11/2026)
        const digitsOnly = valueStr.replace(/\D/g, '');
        console.log(`[Ext-${extractionId}] Tipeando dígitos "${digitsOnly}" en campo ${fieldName}...`);
        await el.type(digitsOnly, { delay: 60 }).catch(() => {});

        // 3. Inyección directa en el DOM y eventos GeneXus
        await el.evaluate((input, val) => {
          input.value = val;
          input.setAttribute('value', val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          if (window.gx && window.gx.fn && window.gx.fn.setCtrlValue) {
            try { window.gx.fn.setCtrlValue(input.id, val); } catch (_) {}
          }
        }, valueStr).catch(() => {});

        await el.press('Tab').catch(() => {});
        await page.waitForTimeout(300);

        const checkVal = await el.evaluate(i => i.value || i.getAttribute('value') || '').catch(() => '');
        console.log(`[Ext-${extractionId}] Campo ${fieldName} = "${checkVal}" (esperado: "${valueStr}").`);
        return true;
      }
    } catch (e) {
      console.log(`[Ext-${extractionId}] Aviso en campo ${fieldName}:`, e.message);
    }
  }
  console.log(`[Ext-${extractionId}] Campo ${fieldName} no encontrado.`);
  return false;
}

async function clickGeneXusBuscar(page, frame, extractionId) {
  console.log(`[Ext-${extractionId}] Disparando evento de búsqueda GeneXus...`);
  const framesToTry = [frame, ...(page.frames ? page.frames() : [])];
  const uniqueFrames = Array.from(new Set(framesToTry));

  for (const f of uniqueFrames) {
    try {
      const buscarBtn = f.locator('#BTNBUSCAR, input[value="Buscar"], button:has-text("Buscar"), input[name*="BTNBUSCAR"]').first();
      if (await buscarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await buscarBtn.click();
        console.log(`[Ext-${extractionId}] Clic en BUSCAR realizado en frame: ${f.url()}`);
        return;
      }
    } catch (e) {}
  }

  for (const f of uniqueFrames) {
    await f.evaluate(() => {
      if (window.gx && window.gx.evt && window.gx.evt.execEvt) {
        try { window.gx.evt.execEvt("E'BUSCAR'.", this); } catch(e) {}
      }
    }).catch(() => {});
  }
}

module.exports = { runScraper };
