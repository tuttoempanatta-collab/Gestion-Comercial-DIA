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

  // Bloquear imágenes pesadas y multimedia para ahorrar RAM sin romper estilos ni iconos GeneXus
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
      // Verificar si cargó el filtro
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 15000 });
      isTableLoaded = true;
      console.log(`[Ext-${extractionId}] Tabla de acciones comerciales cargada directamente (#vDESDE visible).`);
    } catch (e) {
      console.log(`[Ext-${extractionId}] No se pudo cargar directamente (#vDESDE no visible). Intentando navegación por menú lateral...`);
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
        await page.waitForTimeout(3000); // Esperar animación de apertura

        console.log(`[Ext-${extractionId}] Buscando item "Acciones comerciales generales"...`);
        const accionesGeneralesItem = page.locator('text="Acciones comerciales generales", a:has-text("Acciones comerciales generales"), span:has-text("Acciones comerciales generales")').first();
        await accionesGeneralesItem.waitFor({ state: 'visible', timeout: 20000 });
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
          await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 25000 });
          isTableLoaded = true;
        } catch (finalError) {
          console.error(`[Ext-${extractionId}] Fallaron todos los métodos de navegación.`);
        }
      }
    }

    // 2. Esperar que la página de filtros cargue completamente
    onProgress({ message: 'Buscando panel de datos...', current: 5, total: 100, percentage: 7 });
    let dataFrame = page;

    // Esperar que el campo DESDE aparezca en la página (indica que el panel de filtros cargó)
    try {
      await page.waitForSelector('#vDESDE', { state: 'visible', timeout: 35000 });
      console.log('[DEBUG] Panel de filtros detectado (#vDESDE visible en frame principal)');
    } catch (e) {
      console.log('[DEBUG] Timeout esperando #vDESDE en página principal. Buscando en frames secundarios...');
      for (const f of page.frames()) {
        try {
          const el = await f.$('#vDESDE');
          if (el && await el.isVisible()) {
            dataFrame = f;
            console.log('[DEBUG] #vDESDE detectado dentro de frame secundario!');
            break;
          }
        } catch (err) {}
      }
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
        if (startFormatted) {
          await fillGeneXusDate(page, dataFrame, '#vDESDE, input[name*="vDESDE"], input[name*="DESDE"], [id*="DESDE"]', startFormatted, 'Desde', extractionId);
        }

        if (endFormatted) {
          await fillGeneXusDate(page, dataFrame, '#vHASTA, input[name*="vHASTA"], input[name*="HASTA"], [id*="HASTA"]', endFormatted, 'Hasta', extractionId);
        }

        await page.waitForTimeout(1500);

        // Clickear botón BUSCAR
        await clickGeneXusBuscar(page, dataFrame, extractionId);

        // Esperar que la grilla se actualice con los resultados
        console.log(`[Ext-${extractionId}] Esperando actualización de la tabla tras búsqueda (25s)...`);
        await page.waitForTimeout(25000);
        await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});

        // Configurar tamaño de página solicitado (ej. 50 filas)
        if (pageSize && pageSize !== '10') {
          await applyPageSizeToPortal(page, dataFrame, pageSize, extractionId, onProgress);
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

    // 4. Detect total pages
    onProgress({ message: 'Calculando total de páginas...', current: 12, total: 100, percentage: 14 });
    let totalPages = await getExactTotalPages(page, dataFrame);
    if (!totalPages || totalPages < 1) totalPages = 1;

    console.log(`[Ext-${extractionId}] Total páginas detectadas inicialmente: ${totalPages}`);
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
      try {
        await saveCommercialAction(extractionId, row);
        return true;
      } catch (err) {
        console.error(`[Scraper Warning] Falló inserción de artículo (${row?.codigo}):`, err.message);
        return false;
      }
    });

    // 5. Procesamiento con avance dinámico y detección de fin de paginación
    const maxPagesLimit = options.maxPages ? parseInt(options.maxPages) : 999;
    const endPageParam = Math.min(startPageParam + maxPagesLimit - 1, 999);
    let totalItems = 0;
    let p = startPageParam;
    let keepPaging = true;
    let pageConsecutiveDuplicates = 0;
    let lastPageFirstCode = '';

    console.log(`[Ext-${extractionId}] Procesando desde página ${startPageParam} (límite máx: ${endPageParam}, estimadas: ${totalPages}).`);

    // Si startPageParam > 1, salto directo a la página inicial mediante popup de GeneXus
    if (startPageParam > 1) {
      console.log(`[Ext-${extractionId}] Realizando salto directo a página inicial ${startPageParam}...`);
      onProgress({ message: `Saltando directamente a página ${startPageParam}...`, current: 0, total: totalPages, percentage: 15 });

      let jumped = false;
      const framesToTry = [dataFrame, ...(page.frames ? page.frames() : [])];
      
      for (const f of framesToTry) {
        if (jumped) break;
        try {
          // Abrir popup de paginación al pie
          const trigger = f.locator('a:has-text("Página"), span:has-text("Página"), a:has-text("Pág"), [id*="PAGING"] a').first();
          if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
            await trigger.click();
            await page.waitForTimeout(1000);
            
            // Buscar input "Ir a página:"
            const pageInput = f.locator('input[id*="PAGING_PAGE"], input[name*="PAGING_PAGE"], input[id*="PAGE"], input[type="number"], input.gx-pagination-input').first();
            if (await pageInput.isVisible({ timeout: 2000 }).catch(() => false)) {
              await pageInput.fill(String(startPageParam));
              await pageInput.press('Enter');

              // Clic en la flecha de recarga ⟳ si existe
              const refreshBtn = f.locator('a[id*="REFRESH"], button:has-text("⟳"), a:has-text("⟳")').first();
              if (await refreshBtn.isVisible().catch(() => false)) {
                await refreshBtn.click().catch(() => {});
              }

              console.log(`[Ext-${extractionId}] Esperando a que el portal DIA cargue la página ${startPageParam}...`);
              await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});
              await page.waitForTimeout(7000);
              jumped = true;
              console.log(`[Ext-${extractionId}] Salto directo a página ${startPageParam} ejecutado con éxito.`);
              break;
            }
          }
        } catch (e) {}
      }

      // Fallback: si no se pudo usar el popup, avanzar con clics de navegación
      if (!jumped) {
        console.log(`[Ext-${extractionId}] Fallback: avanzando a página ${startPageParam} mediante navegación directa...`);
        for (let skip = 1; skip < startPageParam; skip++) {
          dataFrame = await findDataFrame(page);
          const nextSelector = 'li.next a, a:has-text("Sig"), a:has-text("Next"), a:has-text("Siguiente"), a[id*="NEXT"]';
          const nextBtn = dataFrame.locator(nextSelector).first();
          if (await nextBtn.isVisible().catch(() => false)) {
            await nextBtn.click({ timeout: 5000 }).catch(() => {});
            await page.waitForSelector('.gx-mask, .Loading', { state: 'hidden', timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(4000);
          } else {
            await dataFrame.click('a[id*="NEXT"]').catch(() => {});
            await page.waitForSelector('.gx-mask, .Loading', { state: 'hidden', timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(4000);
          }
        }
      }
    }

    while (keepPaging && p <= endPageParam) {
      dataFrame = await findDataFrame(page);
      
      if (global.cancelledExtractions?.has(extractionId)) {
        onProgress({ message: 'Cancelado por el usuario.', current: p, total: Math.max(totalPages, p), percentage: 100 });
        break;
      }

      const displayTotal = Math.max(totalPages, p);
      onProgress({ 
        message: `Extrayendo página ${p} de ${displayTotal} (${totalItems} guardados)...`, 
        current: p, 
        total: displayTotal,
        percentage: 15 + Math.floor((p / (displayTotal + 1)) * 80)
      });

      await dataFrame.waitForSelector('#GridContainerTbl, .Grid_WorkWith', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2500);
      
      // Process rows INSIDE the browser to avoid moving large objects to Node.js
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
      console.log(`[Ext-${extractionId}] Pág ${p}: Guardados ${pageResults.count} artículos (primero: ${pageResults.firstCode || 'ninguno'}, acumulado: ${totalItems})`);

      // Detect duplicate page to prevent infinite loops
      if (pageResults.firstCode && pageResults.firstCode === lastPageFirstCode) {
        pageConsecutiveDuplicates++;
        if (pageConsecutiveDuplicates >= 2) {
          console.log(`[Ext-${extractionId}] Misma página detectada repetidamente (${pageResults.firstCode}). Finalizando paginación.`);
          break;
        }
      } else {
        pageConsecutiveDuplicates = 0;
        if (pageResults.firstCode) {
          lastPageFirstCode = pageResults.firstCode;
        }
      }

      // Check if we reached the maximum user requested pages
      if (p >= endPageParam) {
        console.log(`[Ext-${extractionId}] Alcanzado límite máximo de páginas (${endPageParam}).`);
        break;
      }

      // Click Next Page
      dataFrame = await findDataFrame(page);
      const nextSelectors = [
        'a:has-text("Sig")',
        '#GRIDPAGING_NEXT',
        'a[id*="GRIDPAGING_NEXT"]',
        'a[id*="PAGINGNEXT"]',
        'a[id*="NEXT"]',
        'a[id*="next"]',
        '.gx-paging-next:not(.disabled) a',
        'li.next:not(.disabled) a',
        'a:has-text("Siguiente")',
        'a:has-text("Next")'
      ];

      let nextClicked = false;
      const allFrames = [dataFrame, ...(page.frames ? page.frames() : [])];
      const uniqueFrames = Array.from(new Set(allFrames));

      for (const f of uniqueFrames) {
        if (nextClicked) break;
        for (const nSel of nextSelectors) {
          try {
            const nextButton = f.locator(nSel).first();
            if (await nextButton.isVisible({ timeout: 1500 }).catch(() => false)) {
              const isDisabled = await nextButton.evaluate(el => {
                return el.classList.contains('disabled') || 
                       el.getAttribute('aria-disabled') === 'true' || 
                       el.getAttribute('disabled') !== null ||
                       el.closest('li')?.classList.contains('disabled') ||
                       el.closest('.disabled') !== null;
              }).catch(() => false);

              if (!isDisabled) {
                console.log(`[Ext-${extractionId}] Avanzando a la siguiente página (${p + 1}) con selector: ${nSel}`);
                await nextButton.click().catch(() => {});
                await page.waitForSelector('.gx-mask, .Loading', { state: 'hidden', timeout: 20000 }).catch(() => {});
                await page.waitForTimeout(4000);
                nextClicked = true;
                break;
              }
            }
          } catch (e) {}
        }
      }

      if (!nextClicked) {
        console.log(`[Ext-${extractionId}] Fin de paginación alcanzado (botón siguiente no disponible o deshabilitado en pág ${p}).`);
        break;
      }

      p++;
      if (p > totalPages) {
        totalPages = p;
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
        console.log(`[Ext-${extractionId}] Tipeando dígitos "${digitsOnly}" en campo ${fieldName}`);

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

async function applyPageSizeToPortal(page, frame, targetSize, extractionId, onProgress) {
  console.log(`[Ext-${extractionId}] Configurando vista de ${targetSize} filas por página en portal DIA...`);
  if (onProgress) {
    onProgress({ message: `Configurando vista (${targetSize} items/página)...`, current: 10, total: 100, percentage: 12 });
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
        'button.btn.btn-primary.dropdown-toggle',
        'button.dropdown-toggle',
        '.GridWithPaginationBar button.dropdown-toggle',
        '.GridWithPaginationBar button',
        '.GridWithPaginationBar a.dropdown-toggle',
        'a:has-text("10 filas")',
        'a:has-text("10 rows")',
        'a:has-text("10")',
        'span:has-text("10 filas")'
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

      // Paso 2: Clicar en la opción "50 filas" o "50"
      const optionLabel = `${targetSize} filas`;
      const optionSelectors = [
        `a:has-text("${optionLabel}")`,
        `span:has-text("${optionLabel}")`,
        `li:has-text("${optionLabel}")`,
        `a:has-text("${targetSize} rows")`,
        `a:has-text("${targetSize}")`,
        `li > a:has-text("${targetSize}")`,
        `[data-value="${targetSize}"]`
      ];

      for (const sel of optionSelectors) {
        try {
          const optEl = f.locator(sel).first();
          if (await optEl.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log(`[Ext-${extractionId}] Haciendo click en opción "${targetSize}" (selector: ${sel})...`);
            await optEl.click();
            console.log(`[Ext-${extractionId}] Esperando a que la tabla recargue con ${targetSize} filas...`);
            await page.waitForSelector('.gx-mask, .Loading, #Loading', { state: 'hidden', timeout: 25000 }).catch(() => {});
            await page.waitForTimeout(10000);
            applied = true;
            console.log(`[Ext-${extractionId}] Vista de ${targetSize} filas aplicada exitosamente.`);
            break;
          }
        } catch (e) {}
      }
    }

    if (!applied) {
      console.log(`[Ext-${extractionId}] Opción "${targetSize} filas" no encontrada. Continuando con la vista actual.`);
    }
  } catch (e) {
    console.log(`[Ext-${extractionId}] Error configurando tamaño de página:`, e.message);
  }
}

async function getExactTotalPages(page, dataFrame) {
  try {
    const framesToScan = [dataFrame, ...(page.frames ? page.frames() : [])];
    const uniqueFrames = Array.from(new Set(framesToScan));
    for (const frame of uniqueFrames) {
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
    return 1;
  } catch (e) {
    return 1;
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
