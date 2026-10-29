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

    // 3. Aplicar Filtros de Fecha
    if (startDate || endDate) {
      onProgress({ message: 'Aplicando filtros de fecha...', current: 5, total: 100, percentage: 10 });

      const startFormatted = formatDateForPortal(startDate);
      const endFormatted = formatDateForPortal(endDate);

      console.log(`[Ext-${extractionId}] Aplicando filtros: Desde=${startFormatted || 'Inicio'}, Hasta=${endFormatted || 'Hoy'}`);

      try {
        if (startFormatted) {
          await fillGeneXusDate(page, dataFrame, '#vDESDE, input[name*="vDESDE"], input[name*="DESDE"]', startFormatted, 'DESDE', extractionId);
        }

        if (endFormatted) {
          await fillGeneXusDate(page, dataFrame, '#vHASTA, input[name*="vHASTA"], input[name*="HASTA"]', endFormatted, 'HASTA', extractionId);
        }

        await clickGeneXusBuscar(page, dataFrame, extractionId);

        onProgress({ message: 'Esperando actualización de la grilla...', current: 5, total: 100, percentage: 11 });
        await page.waitForTimeout(3000);
        await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1500);
      } catch (e) {
        console.log(`[Ext-${extractionId}] Error aplicando filtros:`, e.message);
        onProgress({ message: `Aviso: Error en filtros (${e.message.slice(0, 40)})`, current: 5, total: 100, percentage: 10 });
      }

      onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 12 });
    }

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

    // 4. Detectar estado inicial y aplicar el filtro de filas por página (ej. 50 filas)
    let gridState = await getGridState();
    let totalPages = gridState.totalPages;
    console.log(`[Ext-${extractionId}] Estado inicial tras búsqueda: Página ${gridState.currentPage} de ${totalPages} (${gridState.validRows} filas visibles)`);

    const targetSize = parseInt(pageSize) || 50;
    if (targetSize !== 10 && gridState.validRows > 0) {
      onProgress({ message: `Aplicando filtro de ${targetSize} filas por página...`, current: 12, total: 100, percentage: 13 });
      console.log(`[Ext-${extractionId}] Aplicando configuración de ${targetSize} filas por página (actual: ${gridState.validRows} filas, ${totalPages} págs)...`);

      let sizeApplied = false;
      for (let attempt = 1; attempt <= 2 && !sizeApplied; attempt++) {
        dataFrame = await findDataFrame(page);
        const framesToTry = Array.from(new Set([dataFrame, ...(page.frames ? page.frames() : [])]));

        for (const f of framesToTry) {
          if (sizeApplied) break;
          try {
            await f.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
            await page.waitForTimeout(600);

            // Paso A: Localizar el botón "Página X de Y" abajo a la izquierda de la tabla
            const triggerFound = await f.evaluate(() => {
              document.querySelectorAll('[data-gx-page-trigger]').forEach(el => el.removeAttribute('data-gx-page-trigger'));
              const regex = /^(?:P\u00e1gina|Página|Pagina|P\u00e1g\.?|Pág\.?)\s+\d+\s+(?:de|of)\s+\d+/i;
              const candidates = Array.from(document.querySelectorAll('button, a, span, div, td')).filter(el => {
                const t = (el.innerText || '').trim();
                if (!regex.test(t) || t.length > 40) return false;
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
              console.log(`[Ext-${extractionId}] [Intento ${attempt}] Abriendo menú en "${triggerFound.text}" (${triggerFound.tag})...`);
              const triggerLoc = f.locator('[data-gx-page-trigger="true"]').first();
              await triggerLoc.click({ timeout: 5000 }).catch(async () => {
                await f.evaluate(() => {
                  const el = document.querySelector('[data-gx-page-trigger="true"]');
                  if (el) el.click();
                });
              });
              await page.waitForTimeout(1200);
            } else {
              // Fallback por selector de texto en Playwright
              const fbTrigger = f.locator('button:has-text("Página "), a:has-text("Página "), text=/^P[aá]gina\\s+\\d+\\s+de\\s+\\d+/i').first();
              if (await fbTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
                await fbTrigger.click().catch(() => {});
                await page.waitForTimeout(1200);
              }
            }

            // Paso B: Buscar y hacer clic en la opción "${targetSize} filas" (ej. "50 filas")
            const optionFound = await f.evaluate((size) => {
              document.querySelectorAll('[data-gx-rows-opt]').forEach(el => el.removeAttribute('data-gx-rows-opt'));
              const optRegex = new RegExp(`^${size}\\s*(?:filas|rows|registros)$`, 'i');

              const allMatches = Array.from(document.querySelectorAll('a, span, li, div, button')).filter(el => {
                const t = (el.innerText || '').trim();
                return optRegex.test(t);
              });

              if (allMatches.length === 0) return null;

              const visibleMatches = allMatches.filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });

              const pool = visibleMatches.length > 0 ? visibleMatches : allMatches;
              let best = pool.find(el => el.tagName === 'A' || el.tagName === 'BUTTON') || pool[pool.length - 1];
              const linkParent = best.closest('a, button');
              if (linkParent && optRegex.test((linkParent.innerText || '').trim())) {
                best = linkParent;
              }

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
              if (optionFound.visible) {
                await f.locator('[data-gx-rows-opt="true"]').first().click({ timeout: 5000 }).catch(async () => {
                  await f.evaluate(() => {
                    const el = document.querySelector('[data-gx-rows-opt="true"]');
                    if (el) el.click();
                  });
                });
              } else {
                await f.evaluate(() => {
                  const el = document.querySelector('[data-gx-rows-opt="true"]');
                  if (el) {
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    if (el.parentElement) el.parentElement.click();
                  }
                });
              }

              // Esperar que GeneXus recargue la tabla con las nuevas filas
              await page.waitForTimeout(2000);
              await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});

              const prevTotal = totalPages;
              const prevRows = gridState.validRows;
              console.log(`[Ext-${extractionId}] Esperando actualización de grilla a ${targetSize} filas (previo: ${prevRows} filas, ${prevTotal} págs)...`);

              for (let waitStep = 0; waitStep < 20; waitStep++) {
                await page.waitForTimeout(1000);
                const updated = await getGridState();
                
                // Criterio de éxito: El total de páginas debe haber cambiado respecto al previo de 17 filas (ej. 88 -> 30)
                // y las filas visibles deben reflejar la nueva densidad (>= 25 filas para target 50)
                const pageCountChanged = (prevTotal > 1 && updated.totalPages !== prevTotal && updated.totalPages > 0);
                const rowsUpdated = (targetSize >= 50 ? (updated.validRows >= 25 || updated.validRows === targetSize) : (updated.validRows === targetSize));
                
                if (pageCountChanged && rowsUpdated) {
                  gridState = updated;
                  totalPages = updated.totalPages;
                  sizeApplied = true;
                  console.log(`[Ext-${extractionId}] ¡Filtro de ${targetSize} filas confirmado en paso ${waitStep + 1}! Total de páginas: ${totalPages} (filas visibles: ${gridState.validRows})`);
                  break;
                }
              }

              // Verificación y sincronización final
              await page.waitForTimeout(1500);
              const finalCheck = await getGridState();
              if (finalCheck.totalPages > 0 && (finalCheck.totalPages !== prevTotal || prevTotal === 1)) {
                gridState = finalCheck;
                totalPages = finalCheck.totalPages;
                sizeApplied = true;
              }
              console.log(`[Ext-${extractionId}] Vista actualizada: ${gridState.validRows} filas en pág 1, Total de páginas: ${totalPages}`);
              if (sizeApplied) break;
            }
          } catch (err) {
            console.log(`[Ext-${extractionId}] Aviso en intento ${attempt} de cambio de filas:`, err.message);
          }
        }
      }
    }

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
        let firstCode = '';
        for (const row of trs) {
          const tds = row.querySelectorAll('td');
          if (tds.length >= 7 && !row.querySelector('th') && !row.classList.contains('Grid_WorkWithHeader')) {
            const rawPrice = tds[3]?.innerText.trim() || '0,00';
            const codigoStr = tds[0]?.innerText.trim() || '';

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
              if (!firstCode) firstCode = data.codigo;
              try {
                const saved = await window.saveRowToDb(data);
                if (saved) count++;
              } catch (saveErr) {
                console.warn('Error en saveRowToDb:', saveErr);
              }
            }
          }
        }
        return { count, firstCode };
      });

      totalItems += pageResults.count;
      console.log(`[Ext-${extractionId}] Pág ${currentPage}: Guardados ${pageResults.count} artículos (acumulado: ${totalItems}, primer código: ${pageResults.firstCode || 'ninguno'})`);

      // Forzar liberación inmediata de memoria RAM tras procesar la página
      if (global.gc) {
        try { global.gc(); } catch (_) {}
      }

      // Detección de fin si no hay filas o si la página se repite
      if (pageResults.count === 0) {
        console.log(`[Ext-${extractionId}] Fin de datos: 0 filas en página ${currentPage}.`);
        break;
      }

      if (pageResults.firstCode && pageResults.firstCode === lastFirstCode) {
        duplicatePagesCount++;
        if (duplicatePagesCount >= 2) {
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
                await nextBtn.click().catch(() => {});
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

async function fillGeneXusDate(page, frame, selector, valueStr, fieldName, extractionId) {
  if (!valueStr) return false;
  console.log(`[Ext-${extractionId}] Registrando campo GeneXus ${fieldName}: ${valueStr}...`);

  const framesToTry = [frame, ...(page.frames ? page.frames() : [])];
  const uniqueFrames = Array.from(new Set(framesToTry));

  for (const f of uniqueFrames) {
    try {
      const el = f.locator(selector).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click({ clickCount: 3 });
        await page.waitForTimeout(200);
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(200);

        const digitsOnly = valueStr.replace(/\D/g, '');
        console.log(`[Ext-${extractionId}] Tipeando dígitos "${digitsOnly}" en campo ${fieldName} (frame: ${f.url()})`);

        for (const digit of digitsOnly) {
          await page.keyboard.type(digit);
          await page.waitForTimeout(60);
        }

        await page.waitForTimeout(300);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(300);

        const finalValue = await el.inputValue().catch(() => 'N/A');
        console.log(`[Ext-${extractionId}] Campo ${fieldName} = "${finalValue}" (esperado: "${valueStr}").`);
        return true;
      }
    } catch (e) {}
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
