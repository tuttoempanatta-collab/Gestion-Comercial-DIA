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

  // Bloquear solo imágenes y media (NO bloquear CSS — GeneXus necesita el CSS para inicializar su runtime JS)
  await context.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot,mp4,mp3,webp,ico}', route => route.abort());


  const page = await context.newPage();

  try {
    console.log(`[Ext-${extractionId}] Iniciando scraper...`);
    onProgress({ message: 'Preparando navegador...', current: 0, total: 100, percentage: 2 });
    
    await page.goto(settings.portal_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    onProgress({ message: 'Portal cargado. Identificándose...', current: 0, total: 100, percentage: 4 });

    const loginSelector = '#vSECUSERNAME, #vUSERSEGLGN';
    const passSelector = '#vSECUSERPASSWORD, #vUSERSEGPWR';
    if (await page.isVisible(loginSelector)) {
      await page.fill(loginSelector, settings.username);
      await page.fill(passSelector, settings.password);
      await page.click('#BTNENTER');
      await page.waitForTimeout(4000);
    }

    await page.waitForLoadState('domcontentloaded');
    onProgress({ message: 'Sesión iniciada. Navegando mediante menú oficial...', current: 2, total: 100, percentage: 6 });

    // ─── PASO 1: Navegar por menú lateral oficial ─────────────────────────────
    try {
      console.log(`[Ext-${extractionId}] Navegando mediante menú lateral de GeneXus...`);
      const menuBtn = page.locator('a.sidebar-toggle, button.sidebar-toggle, .navbar-toggle, [data-toggle="offcanvas"], i.fa-bars, .icon-bar').first();
      if (await menuBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await menuBtn.click();
        await page.waitForTimeout(1000);
      }

      const gestionOperativa = page.locator('text="Gestion Operativa", text="GESTION OPERATIVA", a:has-text("Gestion Operativa"), a:has-text("Gestión Operativa")').first();
      if (await gestionOperativa.isVisible({ timeout: 5000 }).catch(() => false)) {
        await gestionOperativa.click();
        await page.waitForTimeout(1000);
      }

      const accionesComerciales = page.locator('text="Acciones comerciales generales", text="ACCIONES COMERCIALES GENERALES", a:has-text("Acciones comerciales generales")').first();
      await accionesComerciales.waitFor({ state: 'visible', timeout: 15000 });
      await accionesComerciales.click();
      console.log(`[Ext-${extractionId}] Click en "Acciones comerciales generales" realizado.`);
    } catch (e) {
      console.log(`[Ext-${extractionId}] Aviso navegando menú lateral:`, e.message);
    }

    // Espera oficial de 40 segundos para que la vista ARTÍCULOS PROMO VIEW cargue completamente
    console.log(`[Ext-${extractionId}] PASO 1: Esperando 40 segundos para que cargue la vista de promociones...`);
    onProgress({ message: 'PASO 1: Esperando 40 seg. a que el portal DIA cargue la grilla...', current: 4, total: 100, percentage: 8 });
    await page.waitForTimeout(40000);

    // Detectar el frame que contiene los controles de GeneXus
    let dataFrame = await findDataFrame(page, 15000);
    console.log(`[Ext-${extractionId}] Frame GeneXus activo: ${dataFrame.url()}`);
    onProgress({ message: 'Panel GeneXus detectado.', current: 6, total: 100, percentage: 10 });

    // ─── PASO 2: Ingresar fechas en #vDESDE y #vHASTA ────────────────────────
    if (startDate || endDate) {
      const startFormatted = formatDateForPortal(startDate);
      const endFormatted = formatDateForPortal(endDate);

      console.log(`[Ext-${extractionId}] PASO 2: Ingresando fechas Desde=${startFormatted || 'Inicio'}, Hasta=${endFormatted || 'Fin'}`);
      onProgress({ message: `PASO 2: Ingresando rango de fechas (${startFormatted} a ${endFormatted})...`, current: 7, total: 100, percentage: 12 });

      try {
        if (startFormatted) {
          await fillGeneXusDate(page, dataFrame, '#vDESDE, input[name*="vDESDE"], input[name*="DESDE"]', startFormatted, 'Desde', extractionId);
        }
        if (endFormatted) {
          await fillGeneXusDate(page, dataFrame, '#vHASTA, input[name*="vHASTA"], input[name*="HASTA"]', endFormatted, 'Hasta', extractionId);
        }
      } catch (e) {
        console.log(`[Ext-${extractionId}] Error ingresando fechas:`, e.message);
      }

      // ─── PASO 3: Click en BUSCAR y esperar 40 segundos ──────────────────────
      console.log(`[Ext-${extractionId}] PASO 3: Clicando en botón BUSCAR...`);
      onProgress({ message: 'PASO 3: Clicando en BUSCAR y esperando 40 seg. a que DIA procese...', current: 9, total: 100, percentage: 14 });

      await clickGeneXusBuscar(page, dataFrame, extractionId);

      // Esperar 40 segundos para que el servidor de DIA procese la búsqueda
      await page.waitForTimeout(40000);

      // Re-detectar frame por si hubo recarga
      dataFrame = await findDataFrame(page, 8000);
      await dataFrame.waitForSelector('.gx-mask, .Loading, #Loading, .gx-mask-single', { state: 'hidden', timeout: 15000 }).catch(() => {});
      console.log(`[Ext-${extractionId}] Búsqueda procesada por portal DIA.`);

      // ─── PASO 4: Bajar al pie y cambiar a 50 filas por página ──────────────
      console.log(`[Ext-${extractionId}] PASO 4: Cambiando registros a ${pageSize} filas por página...`);
      onProgress({ message: `PASO 4: Cambiando vista a ${pageSize} filas por página...`, current: 11, total: 100, percentage: 16 });

      await applyPageSizeToPortal(page, dataFrame, pageSize, extractionId, onProgress);

      // Re-detectar frame tras cambio de tamaño de página
      dataFrame = await findDataFrame(page, 8000);
    }

    // ─── PASO 5: Mapear total de páginas y extraer una a una ─────────────────
    let totalPages = 1;
    onProgress({ message: 'Mapeando cantidad total de páginas...', current: 12, total: 100, percentage: 18 });

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const detected = await getExactTotalPages(page);
        if (detected && detected > 0) {
          totalPages = detected;
          console.log(`[Ext-${extractionId}] Total de páginas detectado: ${totalPages} (intento ${attempt})`);
          break;
        }
        await page.waitForTimeout(3000);
      } catch (e) {}
    }

    console.log(`[Ext-${extractionId}] PASO 5: Iniciando extracción de ${totalPages} página(s)...`);
    onProgress({ message: `PASO 5: Iniciando extracción de ${totalPages} páginas...`, current: 0, total: totalPages, percentage: 20 });

    let totalItems = 0;
    let totalSkipped = 0;

    for (let p = 1; p <= totalPages; p++) {
      if (global.cancelledExtractions?.has(extractionId)) {
        onProgress({ message: 'Cancelado por el usuario.', current: p, total: totalPages, percentage: 100 });
        break;
      }

      // Re-detectar frame si fuera necesario
      try {
        await dataFrame.$('body');
      } catch (e) {
        dataFrame = await findDataFrame(page, 8000);
      }

      // Re-verificar total de páginas por si GeneXus actualizó la barra de paginación
      const currentDetected = await getExactTotalPages(page).catch(() => null);
      if (currentDetected && currentDetected > 0 && currentDetected > totalPages) {
        totalPages = currentDetected;
      }

      const progressPct = 20 + Math.floor((p / totalPages) * 78);
      const statusMsg = filterExactDates && (targetExactStart || targetExactEnd)
        ? `Página ${p}/${totalPages} en proceso — ${totalItems} guardados, ${totalSkipped} omitidos por fecha`
        : `Página ${p}/${totalPages} en proceso — ${totalItems} guardados acumulados`;

      onProgress({ 
        message: statusMsg, 
        current: p, 
        total: totalPages,
        percentage: progressPct
      });

      // Esperar a que la grilla esté disponible
      await dataFrame.waitForSelector('table tr, #GridContainerTbl, .Grid_WorkWith', { timeout: 10000 }).catch(() => {});

      // ─── Extraer filas: buscar en dataFrame y en todos los frames secundarios ────
      let pageRows = [];
      let pageSkipped = 0;
      let pageDiag = '';

      const framesToScanForRows = [dataFrame, ...(page.frames ? page.frames() : [])];
      const uniqueFramesToScan = Array.from(new Set(framesToScanForRows));

      for (const f of uniqueFramesToScan) {
        try {
          const res = await f.evaluate((params) => {
            const { filterExactDates, targetExactStart, targetExactEnd } = params;
            
            // Buscar todas las filas de tabla en el documento
            let trs = Array.from(document.querySelectorAll('#GridContainerTbl tr'));
            if (trs.length === 0) trs = Array.from(document.querySelectorAll('.Grid_WorkWith tr'));
            if (trs.length === 0) trs = Array.from(document.querySelectorAll('table.Grid tr'));
            if (trs.length === 0) trs = Array.from(document.querySelectorAll('table[id*="Grid"] tr'));
            if (trs.length === 0) trs = Array.from(document.querySelectorAll('table[id*="GRID"] tr'));
            if (trs.length === 0) {
              const tables = document.querySelectorAll('table');
              for (const t of tables) {
                const r = t.querySelectorAll('tr');
                if (r.length > 2) { trs = Array.from(r); break; }
              }
            }

            const rows = [];
            let skippedCount = 0;
            let diagRow = '';

            for (const row of trs) {
              const tds = Array.from(row.querySelectorAll('td'));
              if (tds.length < 5 || row.querySelector('th') || row.classList.contains('Grid_WorkWithHeader')) {
                continue;
              }

              const cellTexts = tds.map(td => td.innerText.trim());
              if (!diagRow && cellTexts.length >= 3) {
                diagRow = cellTexts.slice(0, 7).join(' | ');
              }

              // Detección dinámica: buscar la columna que tiene el código numérico (4 a 8 dígitos)
              let codeIdx = cellTexts.findIndex((t, idx) => /^\d{4,8}$/.test(t) && idx <= 2);
              if (codeIdx === -1) {
                codeIdx = cellTexts.findIndex((t, idx) => /^\d+$/.test(t) && idx <= 2);
              }
              if (codeIdx === -1) continue; // No es fila de datos

              const codigo = cellTexts[codeIdx] || '';
              const articulo = cellTexts[codeIdx + 1] || '';
              const combo = cellTexts[codeIdx + 2] || '';
              const precio_fidelizado = '0,00';

              // Buscar fechas con formato DD/MM/YYYY en las celdas
              const dateIndices = [];
              cellTexts.forEach((t, idx) => {
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
                  dateIndices.push(idx);
                }
              });

              const fecha_desde = dateIndices.length >= 1 ? cellTexts[dateIndices[0]] : (cellTexts[codeIdx + 4] || '');
              const fecha_hasta = dateIndices.length >= 2 ? cellTexts[dateIndices[1]] : (cellTexts[codeIdx + 5] || '');
              const cantidades  = cellTexts[codeIdx + 6] || cellTexts[cellTexts.length - 1] || '1';

              const data = {
                codigo,
                articulo,
                combo,
                precio_fidelizado,
                fecha_desde,
                fecha_hasta,
                cantidades
              };

              if (data.codigo) {
                if (filterExactDates) {
                  const matchStart = !targetExactStart || data.fecha_desde === targetExactStart;
                  const matchEnd   = !targetExactEnd   || data.fecha_hasta === targetExactEnd;
                  if (!matchStart || !matchEnd) {
                    skippedCount++;
                    continue;
                  }
                }
                rows.push(data);
              }
            }
            return { rows, skippedCount, diagRow };
          }, { filterExactDates, targetExactStart, targetExactEnd });

          if (res.rows && res.rows.length > 0) {
            pageRows = res.rows;
            pageSkipped = res.skippedCount;
            pageDiag = res.diagRow;
            dataFrame = f; // Vincular al frame donde realmente están los datos
            break;
          }
        } catch (e) {}
      }

      // Guardar las filas extraídas en la base de datos
      for (const row of pageRows) {
        await saveCommercialAction(extractionId, row);
      }

      totalItems   += pageRows.length;
      totalSkipped += pageSkipped;

      console.log(`[Ext-${extractionId}] Pág. ${p}/${totalPages}: ${pageRows.length} guardados (acumulado: ${totalItems}). Muestra: [${pageDiag || 'sin datos'}]`);
      onProgress({ 
        message: `Página ${p}/${totalPages} completada (${pageRows.length} ítems en esta pág., ${totalItems} acumulados)...`, 
        current: p, 
        total: totalPages,
        percentage: progressPct
      });


      // ─── Navegar a la siguiente página si no es la última ──────────────────
      if (p < totalPages) {
        console.log(`[Ext-${extractionId}] Navegando a página ${p + 1} de ${totalPages}...`);
        
        let navSuccess = false;
        const nextSelectors = [
          '#GRIDPAGING_NEXT',
          'a[id*="GRIDPAGING_NEXT"]',
          'a[id*="PAGINGNEXT"]',
          'a[id*="NEXT"]',
          'a[id*="next"]',
          '.gx-paging-next',
          'li.next a',
          'a:has-text("Sig")',
          'a:has-text("Siguiente")',
          'a:has-text("Next")',
          '[title="Siguiente"]',
          '[title="Next"]'
        ];

        for (const nSel of nextSelectors) {
          try {
            const nextBtn = dataFrame.locator(nSel).first();
            if (await nextBtn.isVisible({ timeout: 2000 })) {
              await nextBtn.click();
              navSuccess = true;
              break;
            }
          } catch (e) {}
        }

        if (!navSuccess) {
          // Intentar disparar evento GeneXus directo si no se pudo hacer clic
          await dataFrame.evaluate(() => {
            if (window.gx && window.gx.evt && window.gx.evt.execEvt) {
              try { window.gx.evt.execEvt("E'NEXT'.", this); } catch(e) {}
            }
          }).catch(() => {});
        }

        // Esperar 4 segundos a que la tabla cargue la nueva página
        await page.waitForTimeout(4000);
      }
    }

    const finalSummaryMsg = filterExactDates && totalSkipped > 0
      ? `Extracción finalizada con éxito. ${totalItems} registros guardados (${totalSkipped} omitidos por filtro de vigencia).`
      : `Extracción finalizada con éxito. Total: ${totalItems} registros guardados en ${totalPages} páginas.`;

    console.log(`[Ext-${extractionId}] ${finalSummaryMsg}`);
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


// ─── Helpers de localización y GeneXus multi-frame ──────────────────────────

async function findDataFrame(p, maxWaitMs = 25000) {
  const specificTargets = '#vDESDE, #BTNBUSCAR, #GridContainerTbl, .Grid_WorkWith, input[name*="vDESDE"], table[id*="Grid"]';
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const allFrames = p.frames ? p.frames() : [p];
    
    // Prioridad 1: frames que contengan elementos específicos de GeneXus
    for (const f of allFrames) {
      try {
        const el = await f.$(specificTargets);
        if (el) {
          console.log(`[findDataFrame] Frame específico encontrado: ${f.url()}`);
          return f;
        }
      } catch (e) {}
    }
    
    // Prioridad 2: frame por coincidencia en URL
    for (const f of allFrames) {
      if (f.url().toLowerCase().includes('articulospromoview') || f.url().toLowerCase().includes('promo')) {
        console.log(`[findDataFrame] Frame por URL encontrado: ${f.url()}`);
        return f;
      }
    }

    if (p.waitForTimeout) {
      await p.waitForTimeout(1000);
    } else {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  return p.mainFrame ? p.mainFrame() : p;
}

async function applyPageSizeToPortal(page, frame, targetSize, extractionId, onProgress) {
  console.log(`[Ext-${extractionId}] Configurando vista de ${targetSize} filas por página en portal DIA...`);
  if (onProgress) {
    onProgress({ message: `PASO 4: Configurando vista de ${targetSize} registros por página...`, current: 11, total: 100, percentage: 16 });
  }

  try {
    const framesToTry = [frame, ...(page.frames ? page.frames() : [])];
    const uniqueFrames = Array.from(new Set(framesToTry));
    let applied = false;

    for (const f of uniqueFrames) {
      if (applied) break;

      try {
        await f.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } catch (e) {}

      // Paso 1: Intentar abrir trigger de dropdown
      const dropdownTriggers = [
        '[id*="ROWSPERPAGE"]',
        'a[id*="ROWSPERPAGE"]',
        'a[id*="rowsperpage"]',
        '.gx-pagination-page-size',
        'a:has-text("10 filas")',
        'a:has-text("5 filas")',
        'span:has-text("10 filas")',
        '.GridWithPaginationBar a',
      ];

      for (const trigger of dropdownTriggers) {
        try {
          const el = f.locator(trigger).first();
          if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log(`[Ext-${extractionId}] Abriendo menú de registros por página con: ${trigger}`);
            await el.click();
            await page.waitForTimeout(1000);
            break;
          }
        } catch (e) {}
      }

      // Paso 2: Clicar en la opción "50 filas"
      const optionLabel = `${targetSize} filas`;
      const optionSelectors = [
        `a:has-text("${optionLabel}")`,
        `span:has-text("${optionLabel}")`,
        `li:has-text("${optionLabel}")`,
        `a:has-text("${targetSize}")`,
        `li > a:has-text("${targetSize}")`,
      ];

      for (const sel of optionSelectors) {
        try {
          const optEl = f.locator(sel).first();
          if (await optEl.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log(`[Ext-${extractionId}] Haciendo click en opción "${optionLabel}" (selector: ${sel})...`);
            await optEl.click();
            console.log(`[Ext-${extractionId}] Esperando 30 segundos a que la tabla recargue con ${targetSize} filas...`);
            if (onProgress) {
              onProgress({ message: `PASO 4: Esperando 30 seg. a que cargue la vista de ${targetSize} filas...`, current: 11, total: 100, percentage: 17 });
            }
            await page.waitForTimeout(30000);
            applied = true;
            console.log(`[Ext-${extractionId}] Vista de ${targetSize} filas aplicada exitosamente.`);
            break;
          }
        } catch (e) {}
      }
    }

    if (!applied) {
      console.log(`[Ext-${extractionId}] Opción "${targetSize} filas" no encontrada. Continuando con tamaño por defecto.`);
    }

  } catch (e) {
    console.log(`[Ext-${extractionId}] Aviso en configuración de vista:`, e.message);
  }
}

async function getExactTotalPages(pageOrFrame) {
  try {
    const framesToScan = pageOrFrame.frames ? pageOrFrame.frames() : [pageOrFrame];
    for (const frame of framesToScan) {
      try {
        const result = await frame.evaluate(() => {
          const bodyText = document.body.innerText || '';

          // 1. "Página X de Y" / "Pág. X de Y" / "Page X of Y"
          const m1 = bodyText.match(/(?:P\u00e1gina|P\u00e1g\.?|Pagina|Page)\s*\d+\s*(?:de|of)\s*(\d+)/i);
          if (m1) {
            return { total: parseInt(m1[1]), source: 'bodyText-regex', match: m1[0] };
          }

          // 2. Elementos de paginación específicos de GeneXus
          const pEls = document.querySelectorAll('.gx-pagination, .PagingButtons, .GridWithPaginationBar, .gx-pagination-bar, [class*="Pagination"], [id*="Pagination"]');
          for (const el of pEls) {
            const t = el.innerText || '';
            const m2 = t.match(/(?:P\u00e1gina|P\u00e1g\.?|Pagina|Page)\s*\d+\s*(?:de|of)\s*(\d+)/i);
            if (m2) {
              return { total: parseInt(m2[1]), source: 'pagination-el', match: m2[0] };
            }
          }

          // 3. Número más alto en botones de paginación numéricos
          const pageButtons = Array.from(document.querySelectorAll(
            '.PagingButtons a, .GridWithPaginationBar a, .gx-pagination a, ul.pagination a, table td a'
          ))
            .map(el => el.innerText.trim())
            .filter(t => /^\d+$/.test(t))
            .map(t => parseInt(t));

          if (pageButtons.length > 0) {
            const maxBtn = Math.max(...pageButtons);
            return { total: maxBtn, source: 'pageButtons', match: `maxBtn=${maxBtn}` };
          }

          return null;
        });

        if (result && result.total >= 1) {
          console.log(`[PageDetect] Total=${result.total} fuente=${result.source} texto="${result.match}"`);
          return result.total;
        }
      } catch (e) {}
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function fillGeneXusDate(page, frame, selector, valueStr, fieldName, extractionId) {
  if (!valueStr) return false;
  console.log(`[Ext-${extractionId}] Registrando campo GeneXus ${fieldName}: ${valueStr}...`);

  const framesToTry = [frame, ...(page.frames ? page.frames() : [])];
  const uniqueFrames = Array.from(new Set(framesToTry));

  for (const f of uniqueFrames) {
    try {
      const el = f.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click({ clickCount: 3 });
        await page.waitForTimeout(200);
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(200);

        const digitsOnly = valueStr.replace(/\D/g, '');
        console.log(`[Ext-${extractionId}] Tipeando dígitos "${digitsOnly}" en campo ${fieldName} (frame: ${f.url()})`);

        for (const digit of digitsOnly) {
          await page.keyboard.type(digit);
          await page.waitForTimeout(80);
        }

        await page.waitForTimeout(300);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(400);

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
      if (await buscarBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
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
