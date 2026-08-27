const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { db, saveCommercialAction } = require('./db');

async function runScraper(extractionId, startDate, endDate, settings, pageSize = 50, onProgress, options = {}) {
  const startPageParam = parseInt(options.startPage || 1);
  const maxPagesParam = parseInt(options.maxPages || 15);

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
          '--single-process'
        ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // ... (Login and Navigate to table logic same as before)
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

    // 0. Disable images to save RAM
    await context.route('**/*.{png,jpg,jpeg,gif,svg}', route => route.abort());

    let isTableLoaded = false;
    try {
      console.log(`[Ext-${extractionId}] Intentando navegar directamente a la tabla...`);
      await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
        waitUntil: 'commit',
        timeout: 25000 
      });
      await page.waitForLoadState('load');
      // Verificar si cargó el filtro
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 8000 });
      isTableLoaded = true;
      console.log(`[Ext-${extractionId}] Tabla de acciones comerciales cargada directamente.`);
    } catch (e) {
      console.log(`[Ext-${extractionId}] No se pudo cargar directamente (#vDESDE no visible). Intentando navegación por menú lateral...`);
    }

    if (!isTableLoaded) {
      try {
        if (!page.url().includes('viewhome')) {
          await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.viewhome', { 
            waitUntil: 'networkidle',
            timeout: 30000 
          });
        }
        
        console.log(`[Ext-${extractionId}] Buscando menú "Gestion Operativa"...`);
        const gestionOperativaMenu = page.locator('text="Gestion Operativa", :has-text("Gestion Operativa")').first();
        await gestionOperativaMenu.waitFor({ state: 'visible', timeout: 15000 });
        await gestionOperativaMenu.click();
        await page.waitForTimeout(3000); // Esperar animación de apertura

        console.log(`[Ext-${extractionId}] Buscando item "Acciones comerciales generales"...`);
        const accionesGeneralesItem = page.locator('text="Acciones comerciales generales", a:has-text("Acciones comerciales generales"), span:has-text("Acciones comerciales generales")').first();
        await accionesGeneralesItem.waitFor({ state: 'visible', timeout: 15000 });
        await accionesGeneralesItem.click();

        console.log(`[Ext-${extractionId}] Esperando carga de la tabla (#vDESDE)...`);
        await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 35000 });
        isTableLoaded = true;
        console.log(`[Ext-${extractionId}] Tabla cargada exitosamente mediante el menú.`);
      } catch (menuError) {
        console.error(`[Ext-${extractionId}] Error en navegación por menú lateral:`, menuError.message);
        // Último intento desesperado de ir directo
        try {
          console.log(`[Ext-${extractionId}] Reintentando ir directo como último recurso...`);
          await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
            waitUntil: 'load',
            timeout: 30000 
          });
          await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 20000 });
        } catch (finalError) {
          console.error(`[Ext-${extractionId}] Fallaron todos los métodos de navegación.`);
        }
      }
    }

    // 2. Esperar que la página de filtros cargue completamente
    // Diagnóstico confirmó: no hay iframes, todo está en el frame principal
    // Selectores exactos: #vDESDE, #vHASTA, #BTNBUSCAR
    onProgress({ message: 'Buscando panel de datos...', current: 5, total: 100, percentage: 7 });
    let dataFrame = page;

    // Esperar que el campo DESDE aparezca en la página (indica que el panel de filtros cargó)
    try {
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 40000 });
      console.log('[DEBUG] Panel de filtros detectado (#vDESDE visible)');
    } catch (e) {
      console.log('[DEBUG] Timeout esperando #vDESDE, continuando...', e.message);
    }

    // 3. Aplicar Filtros de Fecha
    // Selectores exactos confirmados por diagnóstico del portal:
    //   Desde: #vDESDE | Hasta: #vHASTA | Buscar: #BTNBUSCAR
    if (startDate || endDate) {
      onProgress({ message: 'Aplicando filtros de fecha...', current: 5, total: 100, percentage: 10 });

      const startFormatted = formatDateForPortal(startDate);
      const endFormatted = formatDateForPortal(endDate);

      console.log(`[Ext-${extractionId}] Aplicando filtros: Desde=${startFormatted || 'Inicio'}, Hasta=${endFormatted || 'Hoy'}`);

      try {
        // --- Llenar campo DESDE (#vDESDE) ---
        if (startFormatted) {
          try {
            const desdeEl = page.locator('#vDESDE').first();
            await desdeEl.waitFor({ state: 'visible', timeout: 15000 });
            await desdeEl.click({ clickCount: 3 }); // seleccionar todo el texto
            await desdeEl.fill(startFormatted);
            await desdeEl.dispatchEvent('change');
            await desdeEl.press('Tab');
            console.log(`[Ext-${extractionId}] Desde llenado: ${startFormatted}`);
          } catch (e) {
            console.log('[DEBUG] Error llenando #vDESDE:', e.message);
            onProgress({ message: 'Aviso: No se encontró campo "Desde"', current: 5, total: 100, percentage: 10 });
          }
        }

        // --- Llenar campo HASTA (#vHASTA) ---
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

        await page.waitForTimeout(1500);

        // --- Clickear botón BUSCAR (#BTNBUSCAR) ---
        try {
          const buscarEl = page.locator('#BTNBUSCAR').first();
          await buscarEl.waitFor({ state: 'visible', timeout: 10000 });
          console.log(`[Ext-${extractionId}] Clickeando botón #BTNBUSCAR...`);
          await buscarEl.click();
        } catch (e) {
          console.log('[DEBUG] #BTNBUSCAR no encontrado, intentando alternativas...', e.message);
          // Fallback: intentar otros selectores
          const fallbackBtn = page.locator('input[value="Buscar"], button:has-text("Buscar")').first();
          if (await fallbackBtn.count() > 0) {
            await fallbackBtn.click();
          } else {
            await page.keyboard.press('Enter');
          }
        }

        // Esperar que la grilla se actualice con los resultados
        console.log(`[Ext-${extractionId}] Esperando actualización de la tabla...`);
        await page.waitForTimeout(25000);

        // Esperar que desaparezca cualquier máscara de carga
        await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});

        // Configurar tamaño de página (50 filas) DESPUÉS de que carguen los resultados
        try {
          onProgress({ message: `Configurando vista (${pageSize} items/página)...`, current: 10, total: 100, percentage: 12 });
          const dropdownToggle = page.locator('button.btn.btn-primary.dropdown-toggle, .GridWithPaginationBar button.dropdown-toggle').first();
          await dropdownToggle.waitFor({ state: 'visible', timeout: 15000 });
          await dropdownToggle.click();

          const option = page.locator(`a:has-text("${pageSize} rows"), a:has-text("${pageSize} filas")`).first();
          await option.waitFor({ state: 'visible', timeout: 10000 });
          await option.click();

          console.log(`[DEBUG] Page size set to ${pageSize}`);
          await page.waitForTimeout(12000); // esperar que recargue la grilla con 50 filas
        } catch (e) {
          console.log('[DEBUG] Error configurando tamaño de página (puede continuar con valor default):', e.message);
        }

      } catch (e) {
        console.log(`[Ext-${extractionId}] Error aplicando filtros:`, e.message);
        onProgress({ message: `Aviso: Error en filtros (${e.message.slice(0, 40)})`, current: 5, total: 100, percentage: 10 });
      }
      
      onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 14 });
    }

    // Capture debug screenshot to see what happened
    try {
      const screenshotDir = path.join(__dirname, 'playwright_data', 'debug');
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `extract_${extractionId}_post_filter.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`[DEBUG] Screenshot saved to ${screenshotPath}`);
    } catch (e) {}

    // 4. Detect total pages with retry
    let totalPages = 1;
    onProgress({ message: 'Calculando total de páginas...', current: 12, total: 100, percentage: 14 });
    
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        // Search for pagination in all frames
        let foundPagination = false;
        for (const f of page.frames()) {
          // 1. Try to find specific pagination text (e.g. "Página 1 de 24")
          try {
            const pageElements = await f.locator('span, td, div, p').all();
            for (const el of pageElements) {
              const text = await el.innerText();
              const match = text.match(/(?:pagina|p\u00e1gina|page)\s+\d+\s+(?:de|of)\s+(\d+)/i);
              if (match) {
                totalPages = parseInt(match[1]);
                dataFrame = f;
                foundPagination = true;
                console.log(`[DEBUG] pagination text match: "${text}" -> totalPages = ${totalPages}`);
                break;
              }
            }
          } catch (e) {
            console.log('[DEBUG] Error checking specific page text:', e.message);
          }
          if (foundPagination) break;

          // 2. Fallback to generic "de X" inside pagination classes only
          try {
            const paginationElements = await f.locator('.gx-pagination span, .PagingButtons span, .GridWithPaginationBar span, .gx-pagination-bar span').all();
            for (const el of paginationElements) {
              const text = await el.innerText();
              const match = text.match(/(?:de|of)\s+(\d+)/i);
              if (match) {
                totalPages = parseInt(match[1]);
                dataFrame = f;
                foundPagination = true;
                console.log(`[DEBUG] pagination fallback match: "${text}" -> totalPages = ${totalPages}`);
                break;
              }
            }
          } catch (e) {
            console.log('[DEBUG] Error checking fallback pagination classes:', e.message);
          }
          if (foundPagination) break;
        }
        
        if (foundPagination) {
          console.log(`[Ext-${extractionId}] Total páginas detectadas: ${totalPages} (intento ${attempt})`);
          // Si hay filtros y el total es muy alto (> 300), probablemente aún no se aplicó el filtro
          if ((startDate || endDate) && totalPages > 300 && attempt < 5) {
            console.log(`[Ext-${extractionId}] El total parece no estar filtrado (${totalPages} > 300). Reintentando...`);
          } else {
            break; 
          }
        }
        
        await page.waitForTimeout(5000);
      } catch (e) {
        console.log(`[Ext-${extractionId}] Error detectando paginación:`, e.message);
      }
    }

    onProgress({ message: `Iniciando extracción de ${totalPages} páginas...`, current: 0, total: totalPages, percentage: 15 });

    // RECURSIVE function to find the data frame anywhere in the hierarchy
    const findDataFrameRecursive = async (parent) => {
      const frames = parent.childFrames();
      for (const f of frames) {
        try {
          const hasTable = await f.$('#GridContainerTbl, .Grid_WorkWith, #vDESDE');
          if (hasTable) return f;
          // Search deeper
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
      await saveCommercialAction(extractionId, row);
    });

    // 5. Procesamiento por sub-etapa independiente de páginas (startPageParam a endPageParam)
    const endPageParam = Math.min(startPageParam + maxPagesParam - 1, totalPages);
    let totalItems = 0;

    console.log(`[Ext-${extractionId}] Procesando sub-etapa: Páginas ${startPageParam} a ${endPageParam} (de ${totalPages} totales).`);

    // Si startPageParam > 1, avanzar la paginación hasta la página inicial requerida
    if (startPageParam > 1) {
      console.log(`[Ext-${extractionId}] Avanzando paginación a página inicial ${startPageParam}...`);
      onProgress({ message: `Avanzando paginación a página ${startPageParam}...`, current: 0, total: totalPages, percentage: 15 });

      for (let skip = 1; skip < startPageParam; skip++) {
        dataFrame = await findDataFrame(page);
        const nextSelector = 'li.next a, a:has-text("Sig"), a:has-text("Next"), a:has-text("Siguiente"), a[id*="NEXT"]';
        const nextBtn = dataFrame.locator(nextSelector).first();
        if (await nextBtn.isVisible().catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(3000);
        } else {
          await dataFrame.click('a[id*="NEXT"]').catch(() => {});
          await page.waitForTimeout(3000);
        }
      }
    }

    for (let p = startPageParam; p <= endPageParam; p++) {
      dataFrame = await findDataFrame(page);
      
      if (global.cancelledExtractions?.has(extractionId)) {
        onProgress({ message: 'Cancelado por el usuario.', current: p, total: totalPages, percentage: 100 });
        break;
      }

      onProgress({ 
        message: `Extrayendo página ${p} de ${totalPages} (${totalItems} guardados en esta etapa)...`, 
        current: p, 
        total: totalPages,
        percentage: 15 + Math.floor(((p - startPageParam + 1) / (endPageParam - startPageParam + 1)) * 80)
      });

      await dataFrame.waitForSelector('#GridContainerTbl, .Grid_WorkWith', { timeout: 15000 }).catch(() => {});
      
      // Process rows INSIDE the browser to avoid moving large objects to Node.js
      const pageResults = await dataFrame.evaluate(async () => {
        const trs = Array.from(document.querySelectorAll('#GridContainerTbl tr'));
        let count = 0;
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
              await window.saveRowToDb(data);
              count++;
            }
          }
        }
        return count;
      });

      totalItems += pageResults;
      console.log(`[DEBUG] Page ${p}: Saved ${pageResults} rows (acumulado en etapa: ${totalItems})`);

      // Click Next Page if needed
      if (p < endPageParam && p < totalPages) {
        const nextSelector = 'li.next a, a:has-text("Sig"), a:has-text("Next"), a:has-text("Siguiente"), a[id*="NEXT"]';
        const nextButton = dataFrame.locator(nextSelector).first();
        
        if (await nextButton.isVisible()) {
          await nextButton.click();
          await dataFrame.waitForTimeout(4000);
        } else {
          await dataFrame.click('a[id*="NEXT"]').catch(() => {});
          await dataFrame.waitForTimeout(4000);
        }
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
  // input is YYYY-MM-DD
  const parts = dateStr.split('-');
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

module.exports = { runScraper };
