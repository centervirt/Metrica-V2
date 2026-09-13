-- Schema de Base de Datos (SQLite) para Metrica Dashboard V1

-- Usuarios del sistema
CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    avatar_url TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Gastos: Seguimiento de egresos y deudas
CREATE TABLE IF NOT EXISTS gastos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    nombre TEXT NOT NULL,
    categoria TEXT CHECK(categoria IN ('credito', 'impuesto', 'operativo')),
    detalles TEXT,
    monto REAL NOT NULL,
    monto_pagado REAL DEFAULT 0,
    vencimiento DATE,
    estado TEXT CHECK(estado IN ('pagado', 'impago', 'proximo')) DEFAULT 'impago',
    recurrente INTEGER DEFAULT 0, -- 0 o 1
    prioridad INTEGER,
    moneda TEXT DEFAULT 'ARS',
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Ingresos Proyectados: Flujo de caja esperado
CREATE TABLE IF NOT EXISTS ingresos_proyectados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    fuente TEXT NOT NULL,
    monto REAL NOT NULL,
    mes DATE NOT NULL, -- Guardado como YYYY-MM
    estado TEXT CHECK(estado IN ('proyectado', 'cobrado')) DEFAULT 'proyectado',
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Cuentas Bancarias: Saldos actuales
CREATE TABLE IF NOT EXISTS cuentas_bancarias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    nombre TEXT NOT NULL,
    banco TEXT,
    saldo REAL DEFAULT 0,
    moneda TEXT DEFAULT 'ARS',
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Inversiones: Portafolio
CREATE TABLE IF NOT EXISTS inversiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    ticker TEXT NOT NULL,
    tipo TEXT CHECK(tipo IN ('Accion', 'Acciones', 'CEDEAR', 'FCI', 'Crypto', 'Bono')),
    cantidad REAL NOT NULL,
    precio_promedio REAL,
    valor_actual REAL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);


-- Alertas: Notificaciones del sistema
CREATE TABLE IF NOT EXISTS alertas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gasto_id INTEGER,
    tipo TEXT CHECK(tipo IN ('vencimiento_proximo', 'saldo_bajo')),
    enviado INTEGER DEFAULT 0,
    FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE CASCADE
);

-- Metas de Ahorro: Objetivos financieros y cajitas
CREATE TABLE IF NOT EXISTS metas_ahorro (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    nombre TEXT NOT NULL,
    icono TEXT DEFAULT 'target',
    monto_objetivo REAL NOT NULL,
    monto_actual REAL DEFAULT 0,
    fecha_limite DATE,
    cuenta_id INTEGER,
    color TEXT DEFAULT 'emerald',
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (cuenta_id) REFERENCES cuentas_bancarias(id) ON DELETE SET NULL
);

-- Presupuestos Máximos por Categoría
CREATE TABLE IF NOT EXISTS presupuestos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    categoria TEXT NOT NULL,
    monto_limite REAL NOT NULL,
    mes TEXT NOT NULL, -- YYYY-MM
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(usuario_id, categoria, mes),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- ==========================================
-- SECCIÓN MÉTRICA NEGOCIOS & FREELANCERS
-- ==========================================

-- Clientes del Negocio o Freelancer
CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    empresa TEXT,
    email TEXT,
    telefono TEXT,
    cuit TEXT,
    condicion_fiscal TEXT DEFAULT 'Consumidor Final',
    notas TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Facturas y Cuentas por Cobrar
CREATE TABLE IF NOT EXISTS facturas_clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    cliente_id INTEGER,
    numero_factura TEXT,
    descripcion TEXT NOT NULL,
    monto REAL NOT NULL,
    moneda TEXT DEFAULT 'ARS', -- 'ARS' o 'USD'
    fecha_emision DATE DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE,
    fecha_cobro DATE,
    estado TEXT CHECK(estado IN ('pendiente', 'cobrado', 'vencido')) DEFAULT 'pendiente',
    detalles TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);

-- Proyectos y Rentabilidad Comercial
CREATE TABLE IF NOT EXISTS proyectos_negocio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    cliente_id INTEGER,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    monto_pactado REAL NOT NULL,
    moneda TEXT DEFAULT 'ARS',
    costos_estimados REAL DEFAULT 0,
    estado TEXT CHECK(estado IN ('en_progreso', 'completado', 'cancelado')) DEFAULT 'en_progreso',
    fecha_entrega DATE,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);

-- Configuración Impositiva y Metas del Negocio (Monotributo)
CREATE TABLE IF NOT EXISTS configuracion_negocio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER UNIQUE NOT NULL,
    categoria_monotributo TEXT DEFAULT 'A',
    tipo_actividad TEXT DEFAULT 'servicios', -- 'servicios' o 'bienes'
    limite_anual REAL DEFAULT 9500000,
    sueldo_dueno_objetivo REAL DEFAULT 0,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- ==========================================
-- SECCIÓN MÉTRICA CONTADOR PARTNER (B2B)
-- ==========================================

-- Clientes y Contribuyentes supervisados por el Estudio Contable
CREATE TABLE IF NOT EXISTS contador_clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contador_usuario_id INTEGER NOT NULL,
    nombre_titular TEXT NOT NULL,
    cuit TEXT NOT NULL,
    categoria_monotributo TEXT NOT NULL DEFAULT 'E',
    tipo_actividad TEXT DEFAULT 'servicios', -- 'servicios' o 'bienes'
    facturacion_acumulada_12m REAL DEFAULT 0,
    email_contacto TEXT,
    telefono TEXT,
    notas TEXT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contador_usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

