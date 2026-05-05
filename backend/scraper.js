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

    // 1. Set page size (Main page or Frame might handle this)
    try {
      onProgress({ message: `Configurando vista (${pageSize} items/página)...`, current: 10, total: 100, percentage: 12 });
      // Try both page and frame
      const target = dataFrame;
      await target.click('button.btn.btn-primary.dropdown-toggle', { timeout: 4000 }).catch(() => {});
      await target.click(`a:has-text("${pageSize} rows")`, { timeout: 4000 }).catch(() => {});
      await target.waitForTimeout(3000);
    } catch (e) {}

    // 3. Apply Date Filters
    if (startDate || endDate) {
      onProgress({ message: 'Aplicando filtros de fecha...', current: 5, total: 100, percentage: 10 });
      
      const startInput = dataFrame.locator('input[id*="DESDE"], input[name*="vDESDE"], input[id*="FECHADESDE"]').first();
      const endInput = dataFrame.locator('input[id*="HASTA"], input[name*="vHASTA"], input[id*="FECHAHASTA"]').first();
      const searchBtn = dataFrame.locator('input[value="Buscar"], #BTNBUSCAR, button:has-text("Buscar"), .Button_Standard').first();

      try {
        console.log('[DEBUG] Applying date filters with full event cycle...');
        await dataFrame.evaluate(({ start, end }) => {
          const fillField = (selector, value) => {
            const inp = document.querySelector(selector);
            if (!inp) return false;
            inp.value = value;
            ['input', 'change', 'blur'].forEach(ev => inp.dispatchEvent(new Event(ev, { bubbles: true })));
            return true;
          };

          const startFilled = fillField('input[id*="DESDE"], input[name*="vDESDE"], input[id*="FECHADESDE"]', start);
          const endFilled = fillField('input[id*="HASTA"], input[name*="vHASTA"], input[id*="FECHAHASTA"]', end);
          
          const btn = document.querySelector('input[value="Buscar"], #BTNBUSCAR, .Button_Standard, button:has-text("Buscar")');
          
          if (btn) {
            btn.click();
            ['mousedown', 'mouseup', 'click'].forEach(ev => btn.dispatchEvent(new Event(ev, { bubbles: true })));
          } else {
            // Fallback: Press enter on the input if button not found
            const inp = document.querySelector('input[id*="HASTA"], input[name*="vHASTA"]');
            if (inp) inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          }
        }, { start: formatDateForPortal(startDate), end: formatDateForPortal(endDate) });
        
        // Wait longer for the grid to refresh (GeneXus can be slow)
        await dataFrame.waitForTimeout(12000);
      } catch (e) {
        console.log('Search trigger failed:', e.message);
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
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await dataFrame.waitForSelector('button.btn.btn-primary.dropdown-toggle, .PagingButtons, .gx-pagination', { timeout: 10000 });
        const paginationElements = await dataFrame.locator('button.btn.btn-primary.dropdown-toggle, .PagingButtons, .gx-pagination, span:has-text("de")').all();
        
        for (const el of paginationElements) {
          const text = await el.innerText();
          const match = text.match(/(?:de|of)\s+(\d+)/i);
          if (match) {
            totalPages = parseInt(match[1]);
            break;
          }
        }
        if (totalPages > 1) break;
        
        // If still 1, maybe it's just one page, or maybe it hasn't loaded.
        await dataFrame.waitForTimeout(3000);
      } catch (e) {
        if (attempt < 3) {
          console.log(`[DEBUG] Pagination detection attempt ${attempt} failed, retrying...`);
          await dataFrame.click('input[value="Buscar"], #BTNBUSCAR').catch(() => {});
          await dataFrame.waitForTimeout(5000);
        }
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

    let totalItems = 0;
    for (let p = 1; p <= totalPages; p++) {
      dataFrame = await findDataFrame(page);
      
      if (global.cancelledExtractions?.has(extractionId)) {
        onProgress({ message: 'Cancelado.', current: p, total: totalPages, percentage: 100 });
        break;
      }

      onProgress({ 
        message: `Extrayendo página ${p} de ${totalPages}...`, 
        current: p, total: totalPages,
        percentage: 15 + Math.floor((p / totalPages) * 75)
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
              precio_fidelizado: tds[3]?.innerText.trim() || '',
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
      console.log(`[DEBUG] Page ${p}: Saved ${pageResults} rows`);

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
