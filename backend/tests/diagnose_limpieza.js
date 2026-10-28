const { doLogin, readTasks, getPage } = require('../mot_bot');
const path = require('path');
const fs = require('fs');

(async () => {
  try {
    console.log('1. Conectando a MOT...');
    await doLogin(true);
    const page = getPage();

    console.log('2. Leyendo tareas de la tienda...');
    const tasks = await readTasks();
    const task = tasks.find(t => t.nombre.toLowerCase().includes('limpieza vereda') || t.tipoControl === 'Limpieza');

    if (!task) {
      console.log('No se encontró tarea de Limpieza.');
      process.exit(1);
    }

    console.log(`3. Tarea encontrada: "${task.nombre}" (Fila ${task.rowIndex})`);
    console.log('   DetailLink:', task.detailLink);

    const MOT_BASE_URL = 'https://mot.supermercadosdia.com.ar/';
    const fullUrl = task.detailLink.startsWith('http')
      ? task.detailLink
      : `${MOT_BASE_URL}${task.detailLink.replace(/^\//, '')}`;

    console.log('4. Navegando a:', fullUrl);
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3000);

    // Inspeccionar DOM
    const info = await page.evaluate(() => {
      const resp = document.querySelector('input[id*="RESPONSABLE" i]');
      const btn = document.querySelector('input[id*="BTNCONFIRMAR" i]');
      return {
        url: window.location.href,
        title: document.title,
        respInput: resp ? {
          id: resp.id,
          name: resp.name,
          type: resp.type,
          value: resp.value,
          disabled: resp.disabled,
          readOnly: resp.readOnly,
          visible: resp.offsetParent !== null,
          outerHTML: resp.outerHTML
        } : null,
        btnConfirmar: btn ? {
          id: btn.id,
          name: btn.name,
          type: btn.type,
          value: btn.value,
          disabled: btn.disabled,
          onclick: btn.getAttribute('onclick'),
          outerHTML: btn.outerHTML
        } : null,
        bodySnippet: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400)
      };
    });

    console.log('5. Información del DOM:', JSON.stringify(info, null, 2));

    // Probar interacción Playwright buscando el input activo
    console.log('6. Probando click y tipeo con Playwright buscando campo activo...');
    const allRespLocs = page.locator('input[id*="RESPONSABLE" i]');
    const respCount = await allRespLocs.count();
    console.log('   Total de inputs coincidentes:', respCount);
    let activeRespLoc = null;
    for (let i = 0; i < respCount; i++) {
      const loc = allRespLocs.nth(i);
      const vis = await loc.isVisible().catch(() => false);
      const id = await loc.getAttribute('id').catch(() => '');
      console.log(`   Input #${i} (${id}): visible = ${vis}`);
      if (vis && !activeRespLoc) activeRespLoc = loc;
    }

    if (activeRespLoc) {
      await activeRespLoc.scrollIntoViewIfNeeded();
      await activeRespLoc.click();
      await activeRespLoc.fill('23250');
      await activeRespLoc.press('Tab');
      console.log('   Valor en input activo tras fill:', await activeRespLoc.inputValue());
    }

    // Sincronizar en evaluate
    await page.evaluate((leg) => {
      const inputs = Array.from(document.querySelectorAll('input[id*="RESPONSABLE" i]'));
      for (const inp of inputs) {
        inp.value = String(leg);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        if (window.gx && window.gx.fn && window.gx.fn.setCtrlValue) {
          try { window.gx.fn.setCtrlValue(inp.id, String(leg)); } catch (_) {}
        }
      }
      if (window.gx && window.gx.O) {
        for (const k in window.gx.O) {
          if (k.toLowerCase().includes('responsable')) window.gx.O[k] = String(leg);
        }
      }
    }, '23250');

    const allBtnLocs = page.locator('input[id*="BTNCONFIRMAR" i]');
    const btnCount = await allBtnLocs.count();
    let activeBtnLoc = null;
    for (let i = 0; i < btnCount; i++) {
      const b = allBtnLocs.nth(i);
      const vis = await b.isVisible().catch(() => false);
      const id = await b.getAttribute('id').catch(() => '');
      console.log(`   Boton #${i} (${id}): visible = ${vis}`);
      if (vis && !activeBtnLoc) activeBtnLoc = b;
    }

    console.log('7. Clickeando botón confirmar activo...');
    if (activeBtnLoc) {
      await activeBtnLoc.click();
    } else {
      await page.locator('input[id*="BTNCONFIRMAR" i]').first().click();
    }
    await page.waitForTimeout(3000);

    const postInfo = await page.evaluate(() => {
      return {
        url: window.location.href,
        bodySnippet: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
        gxErrors: Array.from(document.querySelectorAll('.ErrorViewer, .alert, .gx-error, span[id*="error" i], div[id*="error" i]')).map(e => e.innerText.trim()).filter(Boolean)
      };
    });

    console.log('8. Información post-click:', JSON.stringify(postInfo, null, 2));

    const ssPath = path.join(__dirname, 'limpieza_diag.png');
    await page.screenshot({ path: ssPath });
    console.log('Screenshot guardada en:', ssPath);

    process.exit(0);
  } catch (err) {
    console.error('ERROR EN DIAGNÓSTICO:', err);
    process.exit(1);
  }
})();
