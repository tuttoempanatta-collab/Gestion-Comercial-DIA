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
    onProgress({ message: 'Sesión iniciada. Navegando mediante menú oficial...', current: 5, total: 100, percentage: 5 });

    await context.route('**/*.{png,jpg,jpeg,gif,svg}', route => route.abort());

    // Navegar siempre por el menú lateral oficial para garantizar el árbol de sesión de GeneXus
    try {
      console.log(`[Ext-${extractionId}] Navegando mediante menú lateral de GeneXus...`);
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
      console.log(`[Ext-${extractionId}] Navegación por menú completada.`);
    } catch (e) {
      console.log(`[Ext-${extractionId}] Aviso navegando menú lateral:`, e.message);
    }

    onProgress({ message: 'Buscando panel de datos GeneXus...', current: 5, total: 100, percentage: 7 });
    
    const findDataFrameRecursive = async (parent) => {
      const frames = parent.childFrames();
      for (const f of frames) {
        try {
          const hasTable = await f.$('#GridContainerTbl, .Grid_WorkWith, #vDESDE, #BTNBUSCAR, table, [id*="Grid"], [id*="GRID"]');
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

    let dataFrame = await findDataFrame(page);
    console.log(`[Ext-${extractionId}] Frame de datos de GeneXus detectado: ${dataFrame.url()}`);

    try {
      await dataFrame.waitForSelector('#vDESDE, #GridContainerTbl', { state: 'visible', timeout: 40000 });
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
          await fillGeneXusDate(page, dataFrame, '#vDESDE', startFormatted, 'Desde', extractionId);
        }

        if (endFormatted) {
          await fillGeneXusDate(page, dataFrame, '#vHASTA', endFormatted, 'Hasta', extractionId);
        }

        await clickGeneXusBuscar(page, dataFrame, extractionId);

        console.log(`[Ext-${extractionId}] Búsqueda enviada. Esperando 1 MINUTO COMPLETO (60s) a que el portal DIA procese el filtro de fechas...`);
        onProgress({ message: 'Filtros enviados. Esperando 1 MINUTO COMPLETO (60s) a respuesta del portal DIA...', current: 7, total: 100, percentage: 11 });

        // Pausa incondicional de 60 segundos para permitir que DIA procese el filtro de fechas en su servidor sin interferencias
        await page.waitForTimeout(60000);

        // Re-detectar dataFrame por si el submit recargó el iframe
        dataFrame = await findDataFrame(page);

        // Esperar si aún hubiera alguna máscara activa
        await dataFrame.waitForSelector('.gx-mask, .Loading, #Loading, .gx-mask-single', { state: 'hidden', timeout: 30000 }).catch(() => {});
        console.log(`[Ext-${extractionId}] Minuto de espera completado. Filtros de fecha procesados por portal DIA.`);

        // Aplicar tamaño de página (50 registros por página) y confirmar carga
        await applyPageSizeToPortal(page, dataFrame, pageSize, extractionId, onProgress);

      } catch (e) {
        console.log(`[Ext-${extractionId}] Error aplicando filtros:`, e.message);
        onProgress({ message: `Aviso: Error en filtros (${e.message.slice(0, 40)})`, current: 5, total: 100, percentage: 10 });
      }
      
      onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 14 });
    }

    let totalPages = 1;
    onProgress({ message: 'Calculando total de páginas reales (vista de 50 ítems)...', current: 12, total: 100, percentage: 14 });
    
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        dataFrame = await findDataFrame(page);
        const detected = await getExactTotalPages(dataFrame);
        if (detected && detected > 0) {
          totalPages = detected;
          console.log(`[Ext-${extractionId}] Total páginas detectadas exitosamente: ${totalPages} (intento ${attempt})`);
          break;
        }
        await page.waitForTimeout(3000);
      } catch (e) {}
    }

    onProgress({ message: `Iniciando extracción a velocidad normal (${totalPages} páginas)...`, current: 0, total: totalPages, percentage: 15 });

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

      // Auto-corregir totalPages si la grilla refrescó tardíamente y reporta un total menor (ej. 66 en lugar de 451)
      const currentDetected = await getExactTotalPages(dataFrame);
      if (currentDetected && currentDetected > 0 && currentDetected < totalPages) {
        console.log(`[Ext-${extractionId}] Total de páginas actualizado en tiempo real: ${totalPages} -> ${currentDetected}`);
        totalPages = currentDetected;
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
        const trs = Array.from(document.querySelectorAll('#GridContainerTbl tr, .Grid_WorkWith tr, table.Grid tr, table[id*="Grid"] tr, table[id*="GRID"] tr'));
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

async function applyPageSizeToPortal(page, frame, targetSize, extractionId, onProgress) {
  console.log(`[Ext-${extractionId}] Aplicando vista de ${targetSize} registros por página en portal DIA...`);
  if (onProgress) {
    onProgress({ message: `Configurando vista de ${targetSize} registros por página...`, current: 10, total: 100, percentage: 13 });
  }
  const targetStr = String(targetSize);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let applied = false;

      // Método A: Buscar y presionar botón de desplegable de paginación en la grilla GeneXus
      const dropdownBtns = await frame.locator('button.dropdown-toggle, .GridWithPaginationBar button, .gx-pagination-bar button, button.btn-primary, .dropdown-toggle').all();
      for (const btn of dropdownBtns) {
        if (await btn.isVisible()) {
          console.log(`[Ext-${extractionId}] (Intento ${attempt}) Clic en botón desplegable de paginación...`);
          await btn.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(1500);

          const optionEl = frame.locator(`a:has-text("${targetStr}"), span:has-text("${targetStr}"), li:has-text("${targetStr}"), option[value="${targetStr}"]`).first();
          if (await optionEl.isVisible()) {
            console.log(`[Ext-${extractionId}] Opción ${targetStr} registros seleccionada.`);
            await optionEl.click({ timeout: 4000 }).catch(() => {});
            applied = true;
            break;
          }
        }
      }

      // Método B: Elemento <select>
      if (!applied) {
        const selectElements = await frame.locator('select[name*="GRID"], select[name*="PAGE"], select[id*="GRID"], select[id*="PAGE"], select').all();
        for (const sel of selectElements) {
          if (await sel.isVisible()) {
            const text = await sel.innerText().catch(() => '');
            if (text.includes(targetStr)) {
              console.log(`[Ext-${extractionId}] (Intento ${attempt}) Seleccionando ${targetStr} en elemento <select>...`);
              await sel.selectOption(targetStr).catch(() => {});
              await sel.dispatchEvent('change').catch(() => {});
              await sel.dispatchEvent('blur').catch(() => {});
              applied = true;
              break;
            }
          }
        }
      }

      console.log(`[Ext-${extractionId}] Esperando actualización AJAX de ${targetStr} filas (hasta 45s)...`);
      await page.waitForTimeout(8000);

      // Esperar activamente la carga de la grilla de 50 elementos
      const startTime = Date.now();
      while (Date.now() - startTime < 35000) {
        const trCount = await frame.evaluate(() => {
          const trs = document.querySelectorAll('#GridContainerTbl tr, .Grid_WorkWith tr, table.Grid tr, table[id*="Grid"] tr, table[id*="GRID"] tr, table tr');
          let validRows = 0;
          for (const tr of trs) {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 7 && !tr.querySelector('th') && !tr.classList.contains('Grid_WorkWithHeader')) {
              validRows++;
            }
          }
          return validRows;
        }).catch(() => 0);

        if (trCount > 15) {
          console.log(`[Ext-${extractionId}] Confirmado: ${trCount} filas presentes en la tabla (vista de ${targetStr} aplicada exitosamente).`);
          return;
        }
        await page.waitForTimeout(3000);
      }

    } catch (e) {
      console.log(`[Ext-${extractionId}] Intento ${attempt} de cambiar tamaño de página tuvo aviso:`, e.message);
    }
  }
}

async function getExactTotalPages(pageOrFrame) {
  try {
    const framesToScan = pageOrFrame.frames ? pageOrFrame.frames() : [pageOrFrame];
    for (const frame of framesToScan) {
      try {
        const total = await frame.evaluate(() => {
          const bodyText = document.body.innerText || '';

          // 1. Coincidencia flexible de "Página X de Y", "Pág. X de Y", "Pagina X de Y", "Page X of Y"
          const m1 = bodyText.match(/(?:P\u00e1gina|P\u00e1g\.?|Pagina|Page)\s*\d+\s*(?:de|of)\s*(\d+)/i);
          if (m1) {
            const p = parseInt(m1[1]);
            if (p > 0) return p;
          }

          // 2. Buscar en elementos de paginación específicos de GeneXus
          const pEls = document.querySelectorAll('.gx-pagination, .PagingButtons, .GridWithPaginationBar, .gx-pagination-bar, [class*="Pagination"], [id*="Pagination"]');
          for (const el of pEls) {
            const t = el.innerText || '';
            const m2 = t.match(/(?:P\u00e1gina|P\u00e1g\.?|Pagina|Page)\s*\d+\s*(?:de|of)\s*(\d+)/i) || t.match(/\b(?:de|of)\s*(\d+)\b/i);
            if (m2) {
              const p = parseInt(m2[1]);
              if (p > 0) return p;
            }
          }

          // 3. Obtener el número de página más alto de los botones numéricos de paginación
          const pageButtons = Array.from(document.querySelectorAll('.PagingButtons a, .GridWithPaginationBar a, .gx-pagination a, ul.pagination a, table td a'))
            .map(el => el.innerText.trim())
            .filter(t => /^\d+$/.test(t))
            .map(t => parseInt(t));

          if (pageButtons.length > 0) {
            const maxBtn = Math.max(...pageButtons);
            if (maxBtn > 1) return maxBtn;
          }

          return null;
        });

        if (total && total > 0) return total;
      } catch (e) {}
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function fillGeneXusDate(page, frame, selector, valueStr, fieldName, extractionId) {
  if (!valueStr) return;
  console.log(`[Ext-${extractionId}] Registrando campo GeneXus ${fieldName}: ${valueStr}...`);

  try {
    const el = frame.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await el.focus();
    await page.waitForTimeout(300);

    // 1. Inyección directa en el DOM para asegurar que el valor quede en la propiedad y atributo de HTML
    await el.evaluate((input, val) => {
      input.value = val;
      input.setAttribute('value', val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }, valueStr);

    // 2. Simulación de tipeo físico para forzar al parser de eventos de GeneXus
    await el.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await el.type(valueStr, { delay: 80 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    console.log(`[Ext-${extractionId}] Campo ${fieldName} registrado exitosamente.`);
  } catch (e) {
    console.log(`[Ext-${extractionId}] Error registrando campo ${fieldName}:`, e.message);
  }
}

async function clickGeneXusBuscar(page, frame, extractionId) {
  console.log(`[Ext-${extractionId}] Disparando evento de búsqueda GeneXus...`);
  try {
    const buscarBtn = frame.locator('#BTNBUSCAR, input[value="Buscar"], button:has-text("Buscar"), input[name="BTNBUSCAR"]').first();
    if (await buscarBtn.isVisible()) {
      await buscarBtn.click();
    }

    // Disparar además el evento nativo del framework GeneXus si está disponible
    await frame.evaluate(() => {
      if (window.gx && window.gx.evt && window.gx.evt.execEvt) {
        try {
          window.gx.evt.execEvt("E'BUSCAR'.", this);
        } catch(e) {}
      }
    }).catch(() => {});
  } catch (e) {
    console.log(`[Ext-${extractionId}] Aviso al presionar Buscar:`, e.message);
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
