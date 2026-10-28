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
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--js-flags=--max-old-space-size=96'] 
      : [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-zygote',
          '--single-process',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-component-update',
          '--disable-domain-reliability',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
          '--disable-features=Translate,OptimizationHints,MediaRouter',
          '--disk-cache-size=1',
          '--js-flags=--max-old-space-size=96'
        ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });

  // Bloquear imágenes pesadas, fuentes y multimedia para ahorrar RAM
  await context.route('**/*.{png,jpg,jpeg,gif,webp,mp4,mp3,woff,woff2,ttf,eot,svg}', route => route.abort());

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
      await page.waitForTimeout(4000);
      await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    }

    onProgress({ message: 'Sesión iniciada. Navegando a la tabla...', current: 5, total: 100, percentage: 5 });

    let isTableLoaded = false;
    try {
      console.log(`[Ext-${extractionId}] Intentando navegar directamente a la tabla...`);
      await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
        waitUntil: 'load',
        timeout: 30000 
      });
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 15000 });
      isTableLoaded = true;
      console.log(`[Ext-${extractionId}] Tabla cargada directamente (#vDESDE visible).`);
    } catch (e) {
      console.log(`[Ext-${extractionId}] No se pudo cargar directamente (#vDESDE no visible). Intentando menú lateral...`);
    }

    if (!isTableLoaded) {
      try {
        if (!page.url().includes('viewhome')) {
          await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.viewhome', { 
            waitUntil: 'load',
            timeout: 30000 
          });
        }
        
        console.log(`[Ext-${extractionId}] Buscando menú "Gestion Operativa"...`);
        const gestionOperativaMenu = page.locator('text="Gestion Operativa", :has-text("Gestion Operativa")').first();
        await gestionOperativaMenu.waitFor({ state: 'visible', timeout: 20000 });
        await gestionOperativaMenu.click();
        await page.waitForTimeout(3000);

        console.log(`[Ext-${extractionId}] Buscando item "Acciones comerciales generales"...`);
        const accionesGeneralesItem = page.locator('text="Acciones comerciales generales", a:has-text("Acciones comerciales generales"), span:has-text("Acciones comerciales generales")').first();
        await accionesGeneralesItem.waitFor({ state: 'visible', timeout: 20000 });
        await accionesGeneralesItem.click();

        console.log(`[Ext-${extractionId}] Esperando carga de la tabla (#vDESDE)...`);
        await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 35000 });
        isTableLoaded = true;
        console.log(`[Ext-${extractionId}] Tabla cargada exitosamente mediante el menú.`);
      } catch (menuError) {
        console.error(`[Ext-${extractionId}] Error en menú lateral:`, menuError.message);
        try {
          await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
            waitUntil: 'load',
            timeout: 30000 
          });
          await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 25000 });
          isTableLoaded = true;
        } catch (finalError) {
          console.error(`[Ext-${extractionId}] Fallaron todos los métodos de navegación.`);
        }
      }
    }

    // 2. Esperar que el panel de filtros esté visible
    onProgress({ message: 'Buscando panel de datos...', current: 5, total: 100, percentage: 7 });
    let dataFrame = page;

    try {
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 35000 });
    } catch (e) {
      for (const f of page.frames()) {
        try {
          const el = await f.$('#vDESDE');
          if (el && await el.isVisible()) {
            dataFrame = f;
            break;
          }
        } catch (err) {}
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
          const desdeEl = dataFrame.locator('#vDESDE, input[name*="vDESDE"], input[name*="DESDE"]').first();
          await desdeEl.waitFor({ state: 'visible', timeout: 15000 });
          await desdeEl.click({ clickCount: 3 });
          await desdeEl.fill(startFormatted);
          await desdeEl.dispatchEvent('change');
          await desdeEl.press('Tab');
          console.log(`[Ext-${extractionId}] Desde completado: ${startFormatted}`);
        }

        if (endFormatted) {
          const hastaEl = dataFrame.locator('#vHASTA, input[name*="vHASTA"], input[name*="HASTA"]').first();
          await hastaEl.waitFor({ state: 'visible', timeout: 15000 });
          await hastaEl.click({ clickCount: 3 });
          await hastaEl.fill(endFormatted);
          await hastaEl.dispatchEvent('change');
          await hastaEl.press('Tab');
          console.log(`[Ext-${extractionId}] Hasta completado: ${endFormatted}`);
        }

        await page.waitForTimeout(1500);

        // Click en BUSCAR
        const buscarEl = dataFrame.locator('#BTNBUSCAR, input[name="BTNBUSCAR"], button:has-text("Buscar"), input[value="Buscar"]').first();
        await buscarEl.waitFor({ state: 'visible', timeout: 10000 });
        console.log(`[Ext-${extractionId}] Clickeando botón BUSCAR...`);
        await buscarEl.click();

        // Esperar que la grilla se actualice con los resultados de la búsqueda
        console.log(`[Ext-${extractionId}] Esperando actualización de la tabla tras búsqueda...`);
        await page.waitForTimeout(20000);
        await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(3000);
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
            const text = document.body.innerText || '';
            const m = text.match(/(?:P\u00e1gina|Página|Pagina|P\u00e1g\.?|Pág\.?)\s+(\d+)\s+(?:de|of)\s+(\d+)/i);
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
                    el.click();
                    if (el.parentElement) el.parentElement.click();
                  }
                });
              }

              // Esperar que GeneXus recargue la tabla con las nuevas filas
              await page.waitForTimeout(1500);
              await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});

              const prevTotal = totalPages;
              const prevRows = gridState.validRows;
              for (let waitStep = 0; waitStep < 15; waitStep++) {
                await page.waitForTimeout(1000);
                const updated = await getGridState();
                if (
                  (updated.totalPages !== prevTotal && updated.totalPages >= 1) ||
                  (targetSize > 10 && updated.validRows > 10) ||
                  (targetSize === 5 && updated.validRows <= 5) ||
                  (prevTotal === 1 && prevRows < 10)
                ) {
                  gridState = updated;
                  totalPages = updated.totalPages;
                  sizeApplied = true;
                  break;
                }
              }

              await page.waitForTimeout(2500);
              gridState = await getGridState();
              totalPages = gridState.totalPages;
              console.log(`[Ext-${extractionId}] Vista actualizada: ${gridState.validRows} filas en pág 1, Total de páginas: ${totalPages}`);
              sizeApplied = true;
              break;
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

module.exports = { runScraper };
