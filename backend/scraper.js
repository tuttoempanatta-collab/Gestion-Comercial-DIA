const { chromium } = require('playwright');
const path = require('path');
const { db, saveCommercialAction } = require('./db');

async function runScraper(extractionId, startDate, endDate, settings, pageSize = 50, onProgress) {
  console.log(`[DEBUG] runScraper started for ID: ${extractionId} with pageSize: ${pageSize}`);
  const browser = await chromium.launch({ 
    headless: true,
    args: [
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

    if (await page.isVisible('#vUSERSEGLGN')) {
      await page.fill('#vUSERSEGLGN', settings.username);
      await page.fill('#vUSERSEGPWR', settings.password);
      await page.click('#BTNENTER');
      await page.waitForTimeout(5000);
    }

    await page.waitForLoadState('load');
    onProgress({ message: 'Sesión iniciada. Navegando a la tabla...', current: 5, total: 100, percentage: 5 });

    try {
      await page.goto('https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.articulospromoview', { 
        waitUntil: 'commit',
        timeout: 60000 
      });
      await page.waitForLoadState('load');
    } catch (e) {
      console.log('Navigation to table had issues, but attempting to continue...', e.message);
    }
    
    // 0. Disable images to save RAM
    await context.route('**/*.{png,jpg,jpeg,gif,svg}', route => route.abort());

    // 1. Set page size FIRST (Main page usually handles this)
    try {
      onProgress({ message: `Configurando vista (${pageSize} items/página)...`, current: 10, total: 100, percentage: 12 });
      await page.click('button.btn.btn-primary.dropdown-toggle', { timeout: 5000 }).catch(() => {});
      await page.click(`a:has-text("${pageSize} rows")`, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
    } catch (e) {}

    // 2. Find the Data Frame (Robust search)
    onProgress({ message: 'Buscando panel de datos...', current: 5, total: 100, percentage: 7 });
    let dataFrame = page;
    
    // Give it a moment to load frames
    await page.waitForTimeout(3000);
    
    const frames = page.frames();
    console.log(`[DEBUG] Total frames found: ${frames.length}`);
    
    for (const frame of frames) {
      try {
        const hasInputs = await frame.locator('input[id*="DESDE"], #vDESDE').count() > 0;
        const hasTable = await frame.locator('#GridContainerTbl, .Grid_WorkWith').count() > 0;
        if (hasInputs || hasTable) {
          dataFrame = frame;
          console.log('[DEBUG] Real data frame identified!');
          break;
        }
      } catch (e) {}
    }

    // 3. Apply Date Filters
    if (startDate || endDate) {
      onProgress({ message: 'Aplicando filtros de fecha...', current: 5, total: 100, percentage: 10 });
      
      const startInput = dataFrame.locator('input[id*="DESDE"], input[name*="vDESDE"], input[id*="FECHADESDE"]').first();
      const endInput = dataFrame.locator('input[id*="HASTA"], input[name*="vHASTA"], input[id*="FECHAHASTA"]').first();
      const searchBtn = dataFrame.locator('input[value="Buscar"], #BTNBUSCAR, button:has-text("Buscar"), .Button_Standard').first();

      try {
        console.log('[DEBUG] High-velocity search trigger...');
        await dataFrame.evaluate(({ start, end }) => {
          const startInp = document.querySelector('input[id*="DESDE"], input[name*="vDESDE"]');
          const endInp = document.querySelector('input[id*="HASTA"], input[name*="vHASTA"]');
          const btn = document.querySelector('input[value="Buscar"], #BTNBUSCAR, .Button_Standard');
          
          if (startInp) { startInp.value = start; startInp.dispatchEvent(new Event('change', { bubbles: true })); }
          if (endInp) { endInp.value = end; endInp.dispatchEvent(new Event('change', { bubbles: true })); }
          if (btn) {
            btn.click();
            btn.dispatchEvent(new Event('mousedown', { bubbles: true }));
            btn.dispatchEvent(new Event('mouseup', { bubbles: true }));
            btn.dispatchEvent(new Event('click', { bubbles: true }));
          }
        }, { start: formatDateForPortal(startDate), end: formatDateForPortal(endDate) });
        
        // Wait for the results to start loading
        await dataFrame.waitForTimeout(10000);
      } catch (e) {
        console.log('Search trigger failed:', e.message);
      }
      
      onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 14 });
    }

    // 4. Detect total pages with retry
    let totalPages = 1;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await dataFrame.waitForSelector('button.btn.btn-primary.dropdown-toggle, .PagingButtons', { timeout: 15000 });
        const paginationBtn = dataFrame.locator('button.btn.btn-primary.dropdown-toggle, .PagingButtons').first();
        const paginationText = await paginationBtn.innerText();
        const match = paginationText.match(/de\s+(\d+)/i);
        if (match) {
          totalPages = parseInt(match[1]);
          break;
        }
      } catch (e) {
        if (attempt === 1) {
          console.log('[DEBUG] Pagination not found, clicking Buscar again...');
          await dataFrame.click('input[value="Buscar"], #BTNBUSCAR').catch(() => {});
          await dataFrame.waitForTimeout(8000);
        }
      }
    }

    onProgress({ message: `Iniciando extracción de ${totalPages} páginas...`, current: 0, total: totalPages, percentage: 15 });

    // Function to find the data frame dynamically
    const findDataFrame = async (p) => {
      const frames = p.frames();
      for (const f of frames) {
        try {
          const hasTable = await f.$('#GridContainerTbl, .Grid_WorkWith, #vDESDE, button.btn.btn-primary.dropdown-toggle');
          if (hasTable) return f;
        } catch (e) { /* ignore frame errors */ }
      }
      return p;
    };

    let totalItems = 0;
    for (let p = 1; p <= totalPages; p++) {
      // Re-find the frame at each page to be 100% sure after reloads
      dataFrame = await findDataFrame(page);
      
      // Check for cancellation
      if (global.cancelledExtractions?.has(extractionId)) {
        console.log(`[Ext-${extractionId}] Cancellation requested. Stopping scraper.`);
        onProgress({ message: 'Extracción cancelada por el usuario.', current: p, total: totalPages, percentage: 100 });
        break;
      }

      onProgress({ 
        message: `Extrayendo página ${p} de ${totalPages}...`, 
        current: p, 
        total: totalPages,
        percentage: 15 + Math.floor((p / totalPages) * 75)
      });

      // Wait for table to be ready
      const tableSelector = '#GridContainerTbl, .Grid_WorkWith';
      try {
        await dataFrame.waitForSelector(tableSelector, { timeout: 15000, state: 'visible' });
      } catch (e) {
        console.log('[DEBUG] Table not found in current frame, re-searching all frames...');
        dataFrame = await findDataFrame(page);
        await dataFrame.waitForSelector(tableSelector, { timeout: 15000 });
      }
      
      await dataFrame.waitForTimeout(2000); // Wait for animations

      const rowsLocator = dataFrame.locator('#GridContainerTbl tr');
      const rowsCount = await rowsLocator.count();
      console.log(`[DEBUG] Page ${p}: Found ${rowsCount} potential rows`);

      for (let i = 0; i < rowsCount; i++) {
        const row = rowsLocator.nth(i);
        const cells = row.locator('td');
        const cellsCount = await cells.count();
        
        if (cellsCount >= 7) {
          const rowData = await row.evaluate(node => {
            const tds = node.querySelectorAll('td');
            if (node.querySelector('th') || node.classList.contains('Grid_WorkWithHeader')) return null;
            return {
              codigo: tds[0]?.innerText.trim() || '',
              articulo: tds[1]?.innerText.trim() || '',
              combo: tds[2]?.innerText.trim() || '',
              precio_fidelizado: tds[3]?.innerText.trim() || '',
              fecha_desde: tds[4]?.innerText.trim() || '',
              fecha_hasta: tds[5]?.innerText.trim() || '',
              cantidades: tds[6]?.innerText.trim() || ''
            };
          });

          if (rowData && rowData.codigo && !isNaN(parseInt(rowData.codigo))) {
            await saveCommercialAction(extractionId, rowData);
            totalItems++;
          }
        }
      }

      // 5. Click Next Page if needed
      if (p < totalPages) {
        const nextSelector = 'li.next a, a:has-text("Sig"), a[id*="NEXT"]';
        const nextButton = dataFrame.locator(nextSelector).first();
        
        if (await nextButton.isVisible()) {
          await nextButton.click();
          // Wait for the table to change/reload
          await dataFrame.waitForTimeout(4000);
        } else {
          console.log('[DEBUG] Next button not visible, but totalPages > current page. Attempting click by ID...');
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
  // input is YYYY-MM-DD
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

module.exports = { runScraper };
