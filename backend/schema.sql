-- Tablas para Gestión Comercial (PostgreSQL)

-- Tabla de extracciones
CREATE TABLE IF NOT EXISTS extractions (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    status TEXT, -- 'running', 'completed', 'failed'
    start_date TEXT,
    end_date TEXT,
    items_count INTEGER DEFAULT 0,
    error_message TEXT
);

-- Tabla de acciones comerciales
CREATE TABLE IF NOT EXISTS commercial_actions (
    id SERIAL PRIMARY KEY,
    extraction_id INTEGER REFERENCES extractions(id) ON DELETE CASCADE,
    codigo TEXT,
    articulo TEXT,
    combo TEXT,
    precio_fidelizado TEXT,
    fecha_desde TEXT,
    fecha_hasta TEXT,
    cantidades TEXT,
    stock INTEGER DEFAULT 0
);

-- Tabla de configuración
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Configuración por defecto
INSERT INTO settings (key, value) VALUES ('username', 'T00624AR') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('password', 'T00624AR') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('portal_url', 'https://portalfranquicias.supermercadosdia.com.ar/servlet/com.portalsocios.login') ON CONFLICT (key) DO NOTHING;

-- Tabla de descripciones de productos
CREATE TABLE IF NOT EXISTS product_descriptions (
    codigo TEXT PRIMARY KEY,
    description TEXT,
    last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
