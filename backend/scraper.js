const { chromium } = require('playwright');
const path = require('path');
const { db, saveCommercialAction } = require('./db');

async function runScraper(extractionId, startDate, endDate, settings, pageSize = 50, onProgress) {
  console.log(`[DEBUG] runScraper started for ID: ${extractionId} with pageSize: ${pageSize}`);
  const browser = await chromium.launch({ headless: true });
  // ... (context and page setup same as before)
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
    
    // 1. Set page size FIRST
    try {
      onProgress({ message: `Configurando vista (${pageSize} items/página)...`, current: 10, total: 100, percentage: 12 });
      await page.click('button.btn.btn-primary.dropdown-toggle');
      await page.click(`a:has-text("${pageSize} rows")`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log(`Could not set ${pageSize} items per page`, e.message);
    }

    // 2. Apply Date Filters SECOND
    if (startDate || endDate) {
      // Get initial page count to detect change
      let initialPages = 1;
      try {
        const pBtn = page.locator('button.btn.btn-primary.dropdown-toggle').first();
        const pText = await pBtn.innerText();
        const m = pText.match(/de\s+(\d+)/i);
        if (m) initialPages = parseInt(m[1]);
      } catch (e) {}
      
      onProgress({ message: 'Aplicando filtros de fecha...', current: 5, total: 100, percentage: 7 });
      
      // Add a small wait to let the portal settle
      await page.waitForTimeout(3000);

      // Flexible selectors for date inputs
      const startInput = page.locator('input[id*="DESDE"], input[name*="DESDE"], .Attribute_TrnDate').first();
      const endInput = page.locator('input[id*="HASTA"], input[name*="HASTA"], .Attribute_TrnDate').last();
      const searchBtn = page.locator('input[value="Buscar"], #BTNBUSCAR, button:has-text("Buscar"), .Button_Standard').first();

      if (startDate) {
        await startInput.waitFor({ state: 'visible', timeout: 20000 });
        await startInput.fill(formatDateForPortal(startDate));
        await page.keyboard.press('Tab');
        await page.waitForTimeout(1000);
      }
      if (endDate) {
        await endInput.waitFor({ state: 'visible', timeout: 20000 });
        await endInput.fill(formatDateForPortal(endDate));
        await page.keyboard.press('Tab');
        await page.waitForTimeout(1000);
      }
      
      // Click Buscar
      await searchBtn.click();
      await page.waitForTimeout(2000);
      
      onProgress({ message: 'Esperando actualización de filtros...', current: 12, total: 100, percentage: 14 });
      
      // Wait for the pagination text to change from initialPages
      try {
        await page.waitForFunction(
          (oldVal) => {
            const btn = document.querySelector('button.btn.btn-primary.dropdown-toggle');
            if (!btn) return false;
            const match = btn.innerText.match(/de\s+(\d+)/i);
            return match && parseInt(match[1]) !== oldVal;
          },
          initialPages,
          { timeout: 15000 }
        );
        console.log('[DEBUG] Filter applied successfully (page count changed)');
      } catch (e) {
        console.log('[DEBUG] Filter might not have changed page count, or already applied');
      }
      
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
    }

    // 3. Detect total pages using the correct selector found by research
    let totalPages = 1;
    try {
      const paginationBtn = page.locator('button.btn.btn-primary.dropdown-toggle').first();
      const paginationText = await paginationBtn.innerText();
      console.log(`[DEBUG] Final Pagination text: ${paginationText}`);
      const match = paginationText.match(/de\s+(\d+)/i);
      if (match) {
        totalPages = parseInt(match[1]);
      }
    } catch (e) {
      console.log('Could not detect total pages', e.message);
    }

    onProgress({ message: `Iniciando extracción de ${totalPages} páginas...`, current: 0, total: totalPages, percentage: 15 });

    let totalItems = 0;
    let currentPage = 1;

    while (currentPage <= totalPages) {
      onProgress({ 
        message: `Extrayendo página ${currentPage} de ${totalPages}...`, 
        current: currentPage, 
        total: totalPages, 
        percentage: Math.min(15 + Math.floor((currentPage / totalPages) * 80), 95)
      });
      
      await page.waitForSelector('#GridContainerTbl', { timeout: 30000 });
      await page.waitForTimeout(1000);

      const rows = await page.$$eval('#GridContainerTbl tr', (trRows) => {
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
              const num = parseInt(val.replace('.', '').replace(',', ''));
              if (isNaN(num) || num > 100 || num <= 0) return '1';
              return val;
            })()
          };
        }).filter(item => item !== null && item.codigo !== '' && !isNaN(parseInt(item.codigo)));
      });

      for (const row of rows) {
        await saveCommercialAction(extractionId, row);
        totalItems++;
      }

      if (currentPage < totalPages) {
        // Use the correct Next button selector found: li.next a
        const nextButton = page.locator('li.next a, a:has-text("Sig")').first();
        if (await nextButton.isVisible()) {
          await nextButton.click();
          currentPage++;
          
          // Wait for the pagination button text to change to the new page
          try {
            await page.waitForFunction(
              (expectedPage) => {
                const btn = document.querySelector('button.btn.btn-primary.dropdown-toggle');
                return btn && btn.innerText.includes(`Página ${expectedPage}`);
              },
              currentPage,
              { timeout: 15000 }
            );
          } catch (e) {
            console.log(`Timeout waiting for page ${currentPage}, continuing...`);
            await page.waitForTimeout(2000);
          }
        } else {
          break;
        }
      } else {
        break;
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
