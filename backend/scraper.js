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
          '--disk-cache-size=1',
          '--js-flags=--max-old-space-size=256'
        ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });

  // Bloquear imágenes pesadas y multimedia para ahorrar RAM
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

      onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 14 });
    }

    // 4. Detectar total de páginas estimado
    onProgress({ message: 'Calculando páginas disponibles...', current: 12, total: 100, percentage: 14 });
    let totalPages = 1;
    try {
      const detected = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const m = text.match(/(?:P\u00e1gina|Página|Pagina|P\u00e1g\.?|Pág\.?)\s+\d+\s+(?:de|of)\s+(\d+)/i);
        if (m) return parseInt(m[1]);
        return null;
      });
      if (detected && detected >= 1) totalPages = detected;
    } catch (e) {}

    console.log(`[Ext-${extractionId}] Total páginas detectadas inicialmente: ${totalPages}`);
    onProgress({ message: `Iniciando extracción (detectadas inicialmente: ${totalPages} páginas)...`, current: 0, total: totalPages, percentage: 15 });

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
                console.log(`[Ext-${extractionId}] Clic en botón "Sig" (avanzando a página ${currentPage + 1})...`);
                await nextBtn.click().catch(() => {});
                await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 20000 }).catch(() => {});
                await page.waitForTimeout(4000);
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
