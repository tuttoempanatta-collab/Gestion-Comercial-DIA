const { spawn, exec } = require('child_process');
const path = require('path');

console.log('🚀 Iniciando DIA Acciones Comerciales Extractor...');

// Iniciar Backend
const backend = spawn('npm', ['start'], {
  cwd: path.join(__dirname, 'backend'),
  shell: true
});

backend.stdout.on('data', (data) => {
  console.log(`[Backend] ${data}`);
});

backend.stderr.on('data', (data) => {
  console.error(`[Backend Error] ${data}`);
});

// Iniciar Frontend
const frontend = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, 'frontend'),
  shell: true
});

frontend.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(`[Frontend] ${output}`);
  
  // Abrir el navegador cuando el frontend esté listo
  if (output.toLowerCase().includes('ready') || output.toLowerCase().includes('started')) {
    console.log('🌐 Abriendo navegador en http://localhost:3000...');
    const url = 'http://localhost:3000';
    const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
    exec(`${start} ${url}`);
  }
});

frontend.stderr.on('data', (data) => {
  console.error(`[Frontend Error] ${data}`);
});

process.on('SIGINT', () => {
  backend.kill();
  frontend.kill();
  process.exit();
});
