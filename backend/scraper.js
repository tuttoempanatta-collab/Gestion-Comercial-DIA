const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { db, saveCommercialAction } = require('./db');

async function runScraper(extractionId, startDate, endDate, settings, pageSize = 50, onProgress, options = {}) {
  const { filterExactDates = false, exactStartDate = '', exactEndDate = '' } = options;
  const targetExactStart = filterExactDates ? (formatDateForPortal(exactStartDate) || formatDateForPortal(startDate)) : '';
  const targetExactEnd = filterExactDates ? (formatDateForPortal(exactEndDate) || formatDateForPortal(endDate)) : '';

  if (filterExactDates) {
    console.log(`[Ext-${extractionId}] Filtro exacto activo: Vigencia requerida = ${targetExactStart || 'Cualquiera'} a ${targetExactEnd || 'Cualquiera'}`);
  }

  console.log(`[DEBUG] runScraper started for ID: ${extractionId} with pageSize: ${pageSize}`);
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
          '--single-process'
        ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`[Ext-${extractionId}] Iniciando scraper...`);
    onProgress({ message: 'Preparando navegador...', current: 0, total: 100, percentage: 2 });
    
    await page.goto(settings.portal_url, { waitUntil: 'networkidle', timeout: 60000 });
    onProgress({ message: 'Portal cargado. Identificándose...', current: 0, total: 100, percentage: 5 });

    const loginSelector = '#vSECUSERNAME, #vUSERSEGLGN';
    const passSelector = '#vSECUSERPASSWORD, #vUSERSEGPWR';
    if (await page.isVisible(loginSelector)) {
      await page.fill(loginSelector, settings.username);
      await page.fill(passSelector, settings.password);
      await page.click('#BTNENTER');
      await page.waitForTimeout(5000);
    }

    await page.waitForLoadState('load');
    onProgress({ message: 'Sesión iniciada. Navegando a la tabla...', current: 5, total: 100, percentage: 5 });

    await context.route('**/*.{png,jpg,jpeg,gif,svg}', route => route.abort());

    let isTableLoaded = false;
    try {
      console.log(`[Ext-${extractionId}] Intentando navegar directamente a la tabla...`);
      await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
        waitUntil: 'commit',
        timeout: 25000 
      });
      await page.waitForLoadState('load');
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 8000 });
      isTableLoaded = true;
      console.log(`[Ext-${extractionId}] Navegación directa exitosa.`);
    } catch (e) {
      console.log(`[Ext-${extractionId}] Navegación directa no disponible, usando menú lateral...`);
    }

    if (!isTableLoaded) {
      try {
        const menuBtn = page.locator('a.sidebar-toggle, button.sidebar-toggle, .navbar-toggle, [data-toggle="offcanvas"], i.fa-bars, .icon-bar').first();
        if (await menuBtn.isVisible()) {
          await menuBtn.click();
          await page.waitForTimeout(1000);
        }

        const gestionOperativa = page.locator('text="Gestion Operativa", text="GESTION OPERATIVA", a:has-text("Gestion Operativa")').first();
        if (await gestionOperativa.isVisible()) {
          await gestionOperativa.click();
          await page.waitForTimeout(1000);
        }

        const accionesComerciales = page.locator('text="Acciones comerciales generales", text="ACCIONES COMERCIALES GENERALES", a:has-text("Acciones comerciales generales")').first();
        await accionesComerciales.waitFor({ state: 'visible', timeout: 15000 });
        await accionesComerciales.click();
        await page.waitForLoadState('load');
      } catch (e) {
        console.log(`[Ext-${extractionId}] Aviso en menú lateral:`, e.message);
      }
    }

    onProgress({ message: 'Buscando panel de datos...', current: 5, total: 100, percentage: 7 });
    let dataFrame = page;

    try {
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 40000 });
      console.log('[DEBUG] Panel de filtros detectado (#vDESDE visible)');
    } catch (e) {
      console.log('[DEBUG] Timeout esperando #vDESDE, continuando...', e.message);
    }

    if (startDate || endDate) {
      onProgress({ message: 'Aplicando filtros de fecha en portal DIA...', current: 5, total: 100, percentage: 10 });

      const startFormatted = formatDateForPortal(startDate);
      const endFormatted = formatDateForPortal(endDate);

      console.log(`[Ext-${extractionId}] Aplicando filtros: Desde=${startFormatted || 'Inicio'}, Hasta=${endFormatted || 'Hoy'}`);

      try {
        if (startFormatted) {
          try {
            const desdeEl = page.locator('#vDESDE').first();
            await desdeEl.waitFor({ state: 'visible', timeout: 15000 });
            await desdeEl.click({ clickCount: 3 });
            await desdeEl.fill(startFormatted);
            await desdeEl.dispatchEvent('change');
            await desdeEl.press('Tab');
            console.log(`[Ext-${extractionId}] Desde llenado: ${startFormatted}`);
          } catch (e) {
            console.log('[DEBUG] Error llenando #vDESDE:', e.message);
            onProgress({ message: 'Aviso: No se encontró campo "Desde"', current: 5, total: 100, percentage: 10 });
          }
        }

        if (endFormatted) {
          try {
            const hastaEl = page.locator('#vHASTA').first();
            await hastaEl.waitFor({ state: 'visible', timeout: 15000 });
            await hastaEl.click();
            await hastaEl.fill(endFormatted);
            await hastaEl.dispatchEvent('change');
            await hastaEl.press('Tab');
            console.log(`[Ext-${extractionId}] Hasta llenado: ${endFormatted}`);
          } catch (e) {
            console.log('[DEBUG] Error llenando #vHASTA:', e.message);
            onProgress({ message: 'Aviso: No se encontró campo "Hasta"', current: 5, total: 100, percentage: 10 });
          }
        }

        const buscarBtn = page.locator('#BTNBUSCAR, input[value="Buscar"], button:has-text("Buscar")').first();
        if (await buscarBtn.isVisible()) {
          await buscarBtn.click();
          console.log(`[Ext-${extractionId}] Botón Buscar presionado. Esperando actualización de datos...`);
          await page.waitForTimeout(8000);
        }

        try {
          const selectPageSize = page.locator('select[name*="GRID1PAGE"], select[name*="vPAGE"], select[id*="PAGE"], select[class*="Grid"]').first();
          if (await selectPageSize.isVisible()) {
            console.log(`[Ext-${extractionId}] Cambiando tamaño de página en portal a ${pageSize}...`);
            await selectPageSize.selectOption(String(pageSize));
            await page.waitForTimeout(8000);
          }
        } catch (e) {}

      } catch (e) {
        console.log(`[Ext-${extractionId}] Error aplicando filtros:`, e.message);
        onProgress({ message: `Aviso: Error en filtros (${e.message.slice(0, 40)})`, current: 5, total: 100, percentage: 10 });
      }
      
      onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 14 });
    }

    let totalPages = 1;
    onProgress({ message: 'Calculando total de páginas...', current: 12, total: 100, percentage: 14 });
    
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        let foundPagination = false;
        for (const f of page.frames()) {
          try {
            const pageElements = await f.locator('span, td, div, p').all();
            for (const el of pageElements) {
              const text = await el.innerText();
              const match = text.match(/(?:pagina|p\u00e1gina|page)\s+\d+\s+(?:de|of)\s+(\d+)/i);
              if (match) {
                totalPages = parseInt(match[1]);
                dataFrame = f;
                foundPagination = true;
                break;
              }
            }
          } catch (e) {}
          if (foundPagination) break;

          try {
            const paginationElements = await f.locator('.gx-pagination span, .PagingButtons span, .GridWithPaginationBar span, .gx-pagination-bar span').all();
            for (const el of paginationElements) {
              const text = await el.innerText();
              const match = text.match(/(?:de|of)\s+(\d+)/i);
              if (match) {
                totalPages = parseInt(match[1]);
                dataFrame = f;
                foundPagination = true;
                break;
              }
            }
          } catch (e) {}
          if (foundPagination) break;
        }
        
        if (foundPagination) {
          console.log(`[Ext-${extractionId}] Total páginas detectadas: ${totalPages}`);
          break;
        }
        
        await page.waitForTimeout(4000);
      } catch (e) {}
    }

    onProgress({ message: `Iniciando extracción de ${totalPages} páginas...`, current: 0, total: totalPages, percentage: 15 });

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

    await page.exposeFunction('saveRowToDb', async (row) => {
      await saveCommercialAction(extractionId, row);
    });

    let totalItems = 0;
    let totalSkipped = 0;
    for (let p = 1; p <= totalPages; p++) {
      dataFrame = await findDataFrame(page);
      
      if (global.cancelledExtractions?.has(extractionId)) {
        onProgress({ message: 'Cancelado.', current: p, total: totalPages, percentage: 100 });
        break;
      }

      const statusMsg = filterExactDates && (targetExactStart || targetExactEnd)
        ? `Extrayendo pág. ${p}/${totalPages} (${totalItems} guardados, ${totalSkipped} omitidos por fecha)...`
        : `Extrayendo pág. ${p}/${totalPages} (${totalItems} guardados)...`;

      onProgress({ 
        message: statusMsg, 
        current: p, total: totalPages,
        percentage: 15 + Math.floor((p / totalPages) * 75)
      });

      await dataFrame.waitForSelector('#GridContainerTbl, .Grid_WorkWith', { timeout: 15000 }).catch(() => {});
      
      const pageResults = await dataFrame.evaluate(async (params) => {
        const { filterExactDates, targetExactStart, targetExactEnd } = params;
        const trs = Array.from(document.querySelectorAll('#GridContainerTbl tr'));
        let savedCount = 0;
        let skippedCount = 0;

        for (const row of trs) {
          const tds = row.querySelectorAll('td');
          if (tds.length >= 7 && !row.querySelector('th') && !row.classList.contains('Grid_WorkWithHeader')) {
            const data = {
              codigo: tds[0]?.innerText.trim() || '',
              articulo: tds[1]?.innerText.trim() || '',
              combo: tds[2]?.innerText.trim() || '',
              precio_fidelizado: '0,00',
              fecha_desde: tds[4]?.innerText.trim() || '',
              fecha_hasta: tds[5]?.innerText.trim() || '',
              cantidades: tds[6]?.innerText.trim() || ''
            };

            if (data.codigo && !isNaN(parseInt(data.codigo))) {
              if (filterExactDates) {
                const matchStart = !targetExactStart || data.fecha_desde === targetExactStart;
                const matchEnd = !targetExactEnd || data.fecha_hasta === targetExactEnd;
                if (!matchStart || !matchEnd) {
                  skippedCount++;
                  continue;
                }
              }

              await window.saveRowToDb(data);
              savedCount++;
            }
          }
        }
        return { savedCount, skippedCount };
      }, { filterExactDates, targetExactStart, targetExactEnd });

      totalItems += pageResults.savedCount;
      totalSkipped += pageResults.skippedCount;
      console.log(`[DEBUG] Page ${p}: Saved ${pageResults.savedCount} rows, Skipped ${pageResults.skippedCount} rows`);

      if (p < totalPages) {
        const nextSelector = 'li.next a, a:has-text("Sig"), a:has-text("Next"), a:has-text("Siguiente"), a[id*="NEXT"]';
        const nextButton = dataFrame.locator(nextSelector).first();
        
        if (await nextButton.isVisible()) {
          await nextButton.click();
          await dataFrame.waitForTimeout(5000);
        } else {
          await dataFrame.click('a[id*="NEXT"]').catch(() => {});
          await dataFrame.waitForTimeout(5000);
        }
      }
    }

    const finalSummaryMsg = filterExactDates && totalSkipped > 0
      ? `Extracción completada. ${totalItems} ítems guardados (${totalSkipped} ofertas de otras fechas omitidas).`
      : `Extracción completada. ${totalItems} ítems guardados.`;

    onProgress({ 
      message: finalSummaryMsg, 
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
  // input is YYYY-MM-DD
  const parts = dateStr.split('-');
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

module.exports = { runScraper };
