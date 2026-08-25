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

        console.log(`[Ext-${extractionId}] Búsqueda enviada al servidor de DIA. Aguardando respuesta de consulta de mes completo (hasta 45s)...`);
        onProgress({ message: 'Filtros enviados. Aguardando respuesta de consulta de mes completo en portal DIA...', current: 7, total: 100, percentage: 11 });

        // 1. Pausa inicial y re-detección de dataFrame por si ocurrió recarga de marco
        await page.waitForTimeout(5000);
        dataFrame = await findDataFrame(page);

        // 2. Esperar a que se oculten máscaras o animaciones de carga de GeneXus
        await dataFrame.waitForSelector('.gx-mask, .Loading, #Loading, .gx-mask-single', { state: 'hidden', timeout: 40000 }).catch(() => {});

        // 3. Esperar activamente a que la grilla contenga registros o la etiqueta "Página 1 de..."
        console.log(`[Ext-${extractionId}] Verificando estabilización de grilla inicial en pantalla...`);
        const startTimeGrid = Date.now();
        while (Date.now() - startTimeGrid < 35000) {
          dataFrame = await findDataFrame(page);
          const isGridReady = await dataFrame.evaluate(() => {
            const trs = document.querySelectorAll('#GridContainerTbl tr, .Grid_WorkWith tr, table.Grid tr, table[id*="Grid"] tr, table tr');
            const text = document.body.innerText || '';
            const hasPaging = /P\u00e1gina\s+\d+/i.test(text) || /P\u00e1g\.?\s+\d+/i.test(text);
            let validRows = 0;
            for (const tr of trs) {
              const tds = tr.querySelectorAll('td');
              if (tds.length >= 7 && !tr.querySelector('th') && !tr.classList.contains('Grid_WorkWithHeader')) {
                validRows++;
              }
            }
            return validRows > 0 || hasPaging;
          }).catch(() => false);

          if (isGridReady) {
            console.log(`[Ext-${extractionId}] Grilla inicial del portal DIA cargada y estable. Procediendo a ajustar vista a ${pageSize} filas por página.`);
            break;
          }
          await page.waitForTimeout(3000);
        }

        // 4. Desplegar menú de paginación y hacer clic en la opción "50 filas"
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
  console.log(`[Ext-${extractionId}] Aplicando vista de ${targetSize} registros por página mediante menú desplegable...`);
  if (onProgress) {
    onProgress({ message: `Configurando vista de ${targetSize} registros por página...`, current: 10, total: 100, percentage: 13 });
  }
  const targetStr = String(targetSize);
  const optionText = `${targetStr} filas`; // "50 filas"

  try {
    // 1. Inyectar clic en DOM JS y Playwright locator para desplegar el pop-up de "Página 1 de 333"
    let opened = await frame.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('span, td, div, a, p'));
      const label = allEls.find(el => /P\u00e1gina\s+\d+\s+de/i.test(el.innerText || '') || /P\u00e1g\.?\s+\d+\s+de/i.test(el.innerText || ''));
      if (label) {
        label.click();
        label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }
      return false;
    }).catch(() => false);

    if (!opened) {
      const loc = frame.locator('text=/P\u00e1gina\\s+\\d+\\s+de/i, text=/P\u00e1g\\.?\\s+\\d+\\s+de/i, .GridWithPaginationBar, .PagingButtons').first();
      if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
        await loc.click({ force: true }).catch(() => {});
        opened = true;
      }
    }

    console.log(`[Ext-${extractionId}] Esperando despliegue del menú emergente (${opened ? 'etiqueta clickeada' : 'buscando pop-up'})...`);
    await page.waitForTimeout(1500);

    // 2. Buscar y hacer clic EXCLUSIVAMENTE en el nodo hoja de "50 filas"
    let selected = await frame.evaluate((targetLabel) => {
      const allEls = Array.from(document.querySelectorAll('*'));
      const leaf = allEls.find(el => el.children.length === 0 && el.textContent && el.textContent.trim() === targetLabel);
      if (leaf) {
        leaf.click();
        leaf.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        if (leaf.parentElement) {
          leaf.parentElement.click();
          leaf.parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
        return true;
      }
      const opt = allEls.find(el => el.textContent && el.textContent.trim() === targetLabel);
      if (opt) {
        opt.click();
        opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }
      return false;
    }, optionText).catch(() => false);

    if (!selected) {
      const optLoc = frame.locator(`text="${optionText}", a:has-text("${optionText}"), span:has-text("${optionText}"), td:has-text("${optionText}"), div:has-text("${optionText}")`).first();
      if (await optLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
        await optLoc.click({ force: true }).catch(() => {});
        selected = true;
      }
    }

    if (selected) {
      console.log(`[Ext-${extractionId}] Opción '${optionText}' seleccionada exitosamente. Esperando recarga de grilla a 50 filas...`);
      await page.waitForTimeout(7000);
    } else {
      console.log(`[Ext-${extractionId}] No se pudo seleccionar '${optionText}'. Continuando con grilla actual...`);
    }

  } catch (e) {
    console.log(`[Ext-${extractionId}] Aviso al cambiar a ${targetSize} filas:`, e.message);
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
            const m2 = t.match(/(?:P\u00e1gina|P\u00e1g\.?|Pagina|Page)\s*\d+\s*(?:de|of)\s*(\d+)/i);
            if (m2) {
              const p = parseInt(m2[1]);
              if (p > 0) return p;
            }
          }

          // 3. Obtener el número de página más alto de los botones numéricos de paginación (ej. 1, 2, 3... 66)
          const pageButtons = Array.from(document.querySelectorAll('.PagingButtons a, .GridWithPaginationBar a, .gx-pagination a, ul.pagination a, table td a'))
            .map(el => el.innerText.trim())
            .filter(t => /^\d+$/.test(t))
            .map(t => parseInt(t));

          if (pageButtons.length > 0) {
            const maxBtn = Math.max(...pageButtons);
            if (maxBtn > 0) return maxBtn;
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

    // 1. Hacer clic para enfocar el campo
    await el.click({ clickCount: 1 });
    await page.waitForTimeout(300);

    // 2. Seleccionar todo y eliminar el contenido actual
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // 3. Extraer sólo los dígitos (ej. "01092026" a partir de "01/09/2026")
    //    La máscara de GeneXus auto-inserta "/" al tipear solo números
    const digitsOnly = valueStr.replace(/\D/g, '');

    // 4. Tipear dígito a dígito con delay para que la máscara GeneXus procese cada uno
    await el.type(digitsOnly, { delay: 120 });
    await page.waitForTimeout(400);

    // 5. SOLO Tab para mover el foco al siguiente campo (NUNCA Enter, que submittea el form)
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // 6. Verificar que el valor quedó registrado en el DOM
    const checkVal = await el.evaluate(i => i.value).catch(() => '');
    console.log(`[Ext-${extractionId}] Campo ${fieldName} verificado en DOM: '${checkVal}' (enviado: '${valueStr}').`);

    // 7. Si el campo quedó vacío, intentar inyección directa via evaluate
    if (!checkVal || checkVal.replace(/[_\/]/g, '').length < 8) {
      console.log(`[Ext-${extractionId}] Campo ${fieldName} vacío, intentando inyección directa...`);
      await el.evaluate((input, val) => {
        input.value = val;
        input.setAttribute('value', val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }, valueStr);
      await page.waitForTimeout(300);
      const checkVal2 = await el.evaluate(i => i.value).catch(() => '');
      console.log(`[Ext-${extractionId}] Campo ${fieldName} post-inyección directa: '${checkVal2}'.`);
    }

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
  const cleaned = String(dateStr).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
    return cleaned;
  }
  const parts = cleaned.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }
  return cleaned;
}

module.exports = { runScraper };
