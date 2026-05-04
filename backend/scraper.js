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
        console.log('[DEBUG] Injecting dates and clicking Buscar via JS...');
        await dataFrame.evaluate(({ start, end }) => {
          const startInp = document.querySelector('input[id*="DESDE"], input[name*="vDESDE"]');
          const endInp = document.querySelector('input[id*="HASTA"], input[name*="vHASTA"]');
          const btn = document.querySelector('input[value="Buscar"], #BTNBUSCAR, .Button_Standard');
          
          if (startInp) startInp.value = start;
          if (endInp) endInp.value = end;
          if (btn) btn.click();
        }, { start: formatDateForPortal(startDate), end: formatDateForPortal(endDate) });
        
        await dataFrame.waitForTimeout(8000);
      } catch (e) {
        console.log('JS Injection failed, trying standard click...', e.message);
        await searchBtn.click({ force: true }).catch(() => {});
        await dataFrame.waitForTimeout(8000);
      }
      
      onProgress({ message: 'Filtros procesados. Detectando páginas...', current: 12, total: 100, percentage: 14 });
    }

    // 4. Detect total pages
    let totalPages = 1;
    try {
      await dataFrame.waitForSelector('button.btn.btn-primary.dropdown-toggle, .PagingButtons', { timeout: 10000 });
      const paginationBtn = dataFrame.locator('button.btn.btn-primary.dropdown-toggle, .PagingButtons').first();
      const paginationText = await paginationBtn.innerText();
      const match = paginationText.match(/de\s+(\d+)/i);
      if (match) {
        totalPages = parseInt(match[1]);
      }
    } catch (e) {
      console.log('Could not detect total pages', e.message);
    }

    onProgress({ message: `Iniciando extracción de ${totalPages} páginas...`, current: 0, total: totalPages, percentage: 15 });

    let totalItems = 0;
    for (let p = 1; p <= totalPages; p++) {
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
      await dataFrame.waitForSelector(tableSelector, { timeout: 30000 });
      await dataFrame.waitForTimeout(2000); // Wait for animations

      const rows = await dataFrame.$$eval('#GridContainerTbl tr', (trRows) => {
        return trRows.map(row => {
          if (row.querySelector('th') || row.classList.contains('Grid_WorkWithHeader')) return null;
          const cells = row.querySelectorAll('td');
          if (cells.length < 7) return null;
          return {
            codigo: cells[0]?.innerText.trim() || '',
            articulo: cells[1]?.innerText.trim() || '',
            combo: cells[2]?.innerText.trim() || '',
            precio_fidelizado: cells[3]?.innerText.trim() || '',
            fecha_desde: cells[4]?.innerText.trim() || '',
            fecha_hasta: cells[5]?.innerText.trim() || '',
            cantidades: (() => {
              const comboText = (cells[2]?.innerText || '').toLowerCase();
              if (!comboText.includes('llevando')) return '';
              const val = cells[6]?.innerText.trim() || '1';
              return val;
            })()
          };
        }).filter(item => item !== null && item.codigo !== '');
      });

      console.log(`[DEBUG] Page ${p}: Extracted ${rows.length} rows`);
      for (const row of rows) {
        await saveCommercialAction(extractionId, row);
        totalItems++;
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
