const { chromium } = require('playwright');
const { saveDescription } = require('./description_db');
const { updateArticleDescription } = require('./db');
const path = require('path');
const fs = require('fs');

async function fetchDescriptionsFromIET(codigos, onProgress) {
  const userDataDir = path.join(__dirname, 'playwright_data');
  const screenshotDir = path.join(__dirname, 'screenshots');
  
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launchPersistentContext(userDataDir, { 
    headless: true, 
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await browser.newPage();

  async function ensureOnForm() {
    try {
      const field = await page.$('#vARTICOD');
      if (field && await field.isVisible()) return true;

      if (onProgress) onProgress('Restableciendo posición en el formulario IET...');
      
      // Intentar ir al dashboard
      await page.goto('https://iet.supermercadosdia.com.ar/servlet/com.tiendas.iet.solicitudww', { waitUntil: 'networkidle', timeout: 30000 });
      
      // Si redirige a login, loguear
      if (await page.$('#vUSERSEGLGN')) {
        if (onProgress) onProgress('Sesión expirada. Re-logueando...');
        await page.fill('#vUSERSEGLGN', 'T00624');
        await page.fill('#vUSERSEGPWR', 'CAMPO567');
        await page.click('#BTNENTER');
        await page.waitForNavigation({ waitUntil: 'networkidle' });
        await page.goto('https://iet.supermercadosdia.com.ar/servlet/com.tiendas.iet.solicitudww', { waitUntil: 'networkidle' });
      }

      const btn = await page.waitForSelector('#BTNAGREGAR', { timeout: 20000 });
      await btn.click();
      await page.waitForSelector('#vARTICOD', { timeout: 20000 });
      return true;
    } catch (e) {
      console.error('[IET Recovery Error]', e.message);
      await page.screenshot({ path: path.join(screenshotDir, `error_recovery_${Date.now()}.png`) });
      return false;
    }
  }

  try {
    if (onProgress) onProgress('Iniciando sistema de enriquecimiento...');
    await ensureOnForm();

    for (let i = 0; i < codigos.length; i++) {
      const codigoActual = codigos[i];
      const progressPercent = Math.round(((i + 1) / codigos.length) * 100);
      
      if (onProgress) onProgress(`[${progressPercent}%] Procesando: ${codigoActual}`);

      try {
        // Verificar si seguimos en el formulario antes de cada artículo
        const ready = await ensureOnForm();
        if (!ready) throw new Error('No se pudo restablecer la conexión con el formulario.');

        // 1. Escribir código
        await page.fill('#vARTICOD', '');
        await page.type('#vARTICOD', codigoActual.toString(), { delay: 50 });
        await page.dispatchEvent('#vARTICOD', 'change');
        await page.waitForTimeout(1000);

        // 2. Fleje 1
        await page.waitForSelector('#vCANTETQ_0001', { timeout: 10000 });
        await page.fill('#vCANTETQ_0001', '1');
        await page.dispatchEvent('#vCANTETQ_0001', 'change');
        await page.waitForTimeout(2000);

        // 3. Click Código
        await page.click('#vARTICOD');
        await page.waitForTimeout(1000);

        // 4. Fleje 2
        await page.fill('#vCANTETQ_0001', '2');
        await page.dispatchEvent('#vCANTETQ_0001', 'change');
        
        // Esperar descripción
        await page.waitForTimeout(4000);
        
        const descriptionElement = await page.$('#span_vDSCARTICULO');
        if (descriptionElement) {
          const rawText = await descriptionElement.textContent();
          const cleanDesc = rawText ? rawText.trim() : "";

          if (cleanDesc && cleanDesc !== "0" && !cleanDesc.toLowerCase().includes('no encontrado')) {
            await saveDescription(codigoActual, cleanDesc);
            await updateArticleDescription(codigoActual, cleanDesc);
            if (onProgress) onProgress(`✓ ${codigoActual}: ${cleanDesc}`);
          } else {
            // Reintento rápido si el texto no cambió (posible lag de IET)
            await page.waitForTimeout(3000);
            const secondText = await page.textContent('#span_vDSCARTICULO');
            const cleanSecond = secondText ? secondText.trim() : "";
            if (cleanSecond && cleanSecond !== "0" && !cleanSecond.toLowerCase().includes('no encontrado')) {
               await saveDescription(codigoActual, cleanSecond);
               await updateArticleDescription(codigoActual, cleanSecond);
               if (onProgress) onProgress(`✓ ${codigoActual}: ${cleanSecond} (tras espera extra)`);
            } else {
               if (onProgress) onProgress(`! ${codigoActual}: Sin descripción.`);
            }
          }
        }

        // Estabilidad
        await page.waitForTimeout(2000);
        
      } catch (err) {
        console.error(`[Error Articulo ${codigoActual}]`, err.message);
        if (onProgress) onProgress(`Error en ${codigoActual}: ${err.message}. Recuperando...`);
        await page.screenshot({ path: path.join(screenshotDir, `error_${codigoActual}_${Date.now()}.png`) });
      }
    }
    
    if (onProgress) onProgress('Enriquecimiento finalizado.');
  } finally {
    await browser.close();
  }
}

module.exports = { fetchDescriptionsFromIET };
