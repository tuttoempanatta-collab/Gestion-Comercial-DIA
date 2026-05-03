const express = require('express');
const cors = require('cors');
const { 
  db, // Note: This might be undefined now if db.js doesn't export it, using pool or methods instead
  pool,
  createExtraction, 
  updateExtractionStatus, 
  getHistory, 
  getExtractionData, 
  getSettings, 
  updateSettings, 
  deleteExtraction 
} = require('./db');
const { runScraper } = require('./scraper');
const { fetchDescriptionsFromIET } = require('./iet_scraper');
const { getMissingDescriptions } = require('./description_db');
const xlsx = require('xlsx');
const { createObjectCsvWriter } = require('csv-writer');

const app = express();

// Configurable CORS for production
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[Backend] ${req.method} ${req.path}`);
  next();
});

const PORT = process.env.PORT || 3001;

// Health check for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global enrichment progress
let enrichmentProgress = { percentage: 0, message: '', status: 'idle' };

// Active logs and progress for SSE
let activeLogs = {};
let activeProgress = {};

app.get('/api/history', async (req, res) => {
  try {
    const history = await getHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/data/:extractionId', async (req, res) => {
  const { extractionId } = req.params;
  try {
    const data = await getExtractionData(extractionId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    await updateSettings(req.body);
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/extract', async (req, res) => {
  const { startDate, endDate, pageSize } = req.body;
  
  try {
    const extractionId = await createExtraction(startDate, endDate);
    const settings = await getSettings();
    
    activeLogs[extractionId] = [];
    activeProgress[extractionId] = { percentage: 0, message: 'Iniciando...' };
    
    console.log(`[DEBUG] Finalizando preparación para Ext-${extractionId}. Llamando a runScraper...`);
    
    // Start scraper in background
    runScraper(extractionId, startDate, endDate, settings, pageSize, (progressObj) => {
      const normalized = typeof progressObj === 'string' 
        ? { message: progressObj, percentage: 0 } 
        : progressObj;

      console.log(`[Ext-${extractionId}] ${normalized.message}`);
      activeLogs[extractionId].push({ timestamp: new Date().toISOString(), ...normalized });
      activeProgress[extractionId] = normalized;
    })
    .then(async (count) => {
      await updateExtractionStatus(extractionId, 'completed', count);
      console.log(`[Ext-${extractionId}] Extracción finalizada con éxito. ${count} artículos procesados.`);
    })
    .catch(async (err) => {
      await updateExtractionStatus(extractionId, 'failed', 0, err.message);
      console.error(`[Ext-${extractionId}] Error en scraper:`, err.message);
    });

    res.json({ extractionId, message: 'Extraction started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/system/reset', async (req, res) => {
  const { clearAll } = require('./db');
  const { clearDescriptions } = require('./description_db');
  try {
    await clearAll();
    await clearDescriptions();
    enrichmentProgress = { percentage: 0, message: '', status: 'idle' };
    res.json({ message: 'System reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/enrich', async (req, res) => {
  const { codes } = req.body;
  try {
    const missing = await getMissingDescriptions(codes);
    
    if (missing.length === 0) {
      return res.json({ message: 'All codes already have descriptions', count: 0 });
    }

    enrichmentProgress = { percentage: 0, message: 'Iniciando enriquecimiento...', status: 'running' };

    // Run in background
    fetchDescriptionsFromIET(missing, (msg) => {
      enrichmentProgress.message = msg;
      console.log(`[Enriquecimiento Manual] ${msg}`);
    })
    .then(() => {
      enrichmentProgress = { percentage: 100, message: 'Enriquecimiento completado', status: 'completed' };
    })
    .catch((err) => {
      enrichmentProgress = { percentage: 0, message: `Error: ${err.message}`, status: 'failed' };
    });

    res.json({ message: 'Enrichment started', count: missing.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/enrich/status', (req, res) => {
  res.json(enrichmentProgress);
});

app.get('/api/logs/:extractionId', (req, res) => {
  const { extractionId } = req.params;
  res.json({
    logs: activeLogs[extractionId] || [],
    progress: activeProgress[extractionId] || { percentage: 0 }
  });
});

// Export endpoints
app.get('/api/export/excel/:extractionId', async (req, res) => {
  try {
    const data = await getExtractionData(req.params.extractionId);
    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Acciones Comerciales');
    
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=dia_export_${req.params.extractionId}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/csv/:extractionId', async (req, res) => {
  try {
    const data = await getExtractionData(req.params.extractionId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=dia_export_${req.params.extractionId}.csv`);
    
    // Create a temporary CSV and send it
    const csvWriter = createObjectCsvWriter({
      path: 'temp.csv',
      header: [
        { id: 'codigo', title: 'Código' },
        { id: 'articulo', title: 'Articulo' },
        { id: 'combo', title: 'Combo' },
        { id: 'precio_fidelizado', title: 'Precio' },
        { id: 'fecha_desde', title: 'Desde' },
        { id: 'fecha_hasta', title: 'Hasta' },
        { id: 'cantidades', title: 'Cantidades' }
      ]
    });
    
    await csvWriter.writeRecords(data);
    const fs = require('fs');
    const stream = fs.createReadStream('temp.csv');
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update single record
app.put('/api/data/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!req.body) {
    return res.status(400).json({ error: 'Cuerpo de solicitud faltante' });
  }

  const { articulo, codigo, cantidades } = req.body;
  console.log(`[Backend] PUT /api/data/${id}`, req.body);
  
  try {
    const targetId = parseInt(id);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const query = 'UPDATE commercial_actions SET articulo = $1, codigo = $2, cantidades = $3 WHERE id = $4';
    const result = await pool.query(query, [
      articulo || '', 
      codigo || '', 
      String(cantidades === undefined || cantidades === null ? '' : cantidades), 
      targetId
    ]);
    
    if (result.rowCount > 0) {
      res.json({ message: 'Registro actualizado', id: targetId });
    } else {
      res.status(404).json({ error: 'No se encontró el registro' });
    }
  } catch (err) {
    console.error(`[Backend] Error critico: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Delete single record
app.delete('/api/data/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM commercial_actions WHERE id = $1', [id]);
    res.json({ message: 'Record deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/extraction/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await deleteExtraction(id);
    res.json({ message: 'Extraction deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
