const path = require('path');
const fs = require('fs');
const https = require('https');
const { doLogin, closeBrowser, isLoggedIn, sessionExists } = require('../backend/mot_bot');

const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://gestion-comercial-dia.onrender.com';
const SESSION_FILE = path.join(__dirname, '..', 'backend', 'playwright_data', 'mot_session', 'storage_state.json');

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let respData = '';
      res.on('data', chunk => respData += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(respData)); } catch (_) { resolve(respData); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log('\n===============================================================');
  console.log('   RENOVACIÓN DE SESIÓN GOOGLE / MOT (VENTANA VISIBLE)         ');
  console.log('===============================================================\n');
  console.log('Abriendo navegador en tu pantalla para autenticarte en Google...');
  console.log('👉 Si Google pide confirmación en 2 pasos en tu teléfono (Galaxy A15 / A06),');
  console.log('   mira el número que aparece en la ventana de Chrome y tocalo en tu celular.\n');

  try {
    const ok = await doLogin(false); // Visible Chrome window
    if (!ok) {
      throw new Error('El navegador no llegó a la página de MOT.');
    }

    console.log('\n✅ ¡Inicio de sesión en MOT exitoso!');

    // 1. Verificar archivo de sesión local
    if (!fs.existsSync(SESSION_FILE)) {
      throw new Error('No se encontró storage_state.json tras el login.');
    }
    const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    console.log(`✓ Archivo de sesión local guardado (${sessionData.cookies.length} cookies).`);

    // 2. Enviar sesión fresca a Render
    console.log(`\nSincronizando sesión fresca con el servidor en la nube (${RENDER_URL})...`);
    const syncRes = await postJson(`${RENDER_URL}/api/mot-bot/session`, sessionData);
    console.log('✓ Respuesta de sincronización en Render:', syncRes);

    // 3. Iniciar el bot en Render para marcar las tareas del día
    console.log('\nIniciando MOT Bot en Render para recuperar y marcar tareas pendientes de hoy...');
    const startRes = await postJson(`${RENDER_URL}/api/mot-bot/start`, {});
    console.log('✓ Estado de arranque en Render:', startRes);

    console.log('\n===============================================================');
    console.log('   SESIÓN RENOVADA Y BOT ACTIVADO EXITOSAMENTE                 ');
    console.log('===============================================================\n');
  } catch (err) {
    console.error('\n❌ Error durante el proceso de renovación:', err.message);
  } finally {
    await closeBrowser().catch(() => {});
    process.exit(0);
  }
}

run();
