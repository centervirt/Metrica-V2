const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const dbPath = path.resolve(process.env.DATABASE_PATH || './db/metrica.db');
const schemaPath = path.resolve(__dirname, 'schema.sql');

// Asegurar que el directorio de la DB exista
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath, { verbose: console.log });
db.pragma('foreign_keys = ON');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = crypto.scryptSync(password, salt, 64);
    return `${salt}:${key.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, key] = storedHash.split(':');
    const derived = crypto.scryptSync(password, salt, 64);
    return key === derived.toString('hex');
}

/**
 * Migra columnas necesarias si las tablas ya existían sin usuario_id
 */
function runMigrations() {
    const tables = ['gastos', 'cuentas_bancarias', 'ingresos_proyectados', 'inversiones'];
    for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all();
        const hasUsuarioId = columns.some(col => col.name === 'usuario_id');
        if (!hasUsuarioId) {
            console.log(`Migrando tabla ${table}: agregando columna usuario_id...`);
            db.exec(`ALTER TABLE ${table} ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE`);
        }
    }

    // Migración para usuarios: plan_suscripcion y rol
    const userColumns = db.prepare('PRAGMA table_info(usuarios)').all();
    if (!userColumns.some(col => col.name === 'plan_suscripcion')) {
        console.log('Migrando tabla usuarios: agregando columna plan_suscripcion...');
        db.exec("ALTER TABLE usuarios ADD COLUMN plan_suscripcion TEXT DEFAULT 'free'");
    }
    if (!userColumns.some(col => col.name === 'rol')) {
        console.log('Migrando tabla usuarios: agregando columna rol...');
        db.exec("ALTER TABLE usuarios ADD COLUMN rol TEXT DEFAULT 'user'");
    }

    // Columnas para Mercado Pago en usuarios
    const mpCols = [
        { name: 'mp_preapproval_id', type: 'TEXT' },
        { name: 'mp_estado', type: 'TEXT' },
        { name: 'mp_periodo', type: 'TEXT' },
        { name: 'mp_fecha_inicio', type: 'TEXT' },
        { name: 'mp_fecha_proximo_cobro', type: 'TEXT' }
    ];
    for (const col of mpCols) {
        if (!userColumns.some(c => c.name === col.name)) {
            console.log(`Migrando tabla usuarios: agregando columna ${col.name}...`);
            db.exec(`ALTER TABLE usuarios ADD COLUMN ${col.name} ${col.type}`);
        }
    }

    // Migración para tabla inversiones: permitir Accion y Bono
    try {
        const invDef = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inversiones'").get();
        if (invDef && !invDef.sql.includes('Accion')) {
            console.log("Migrando tabla inversiones: ampliando tipos a Acciones Argentinas y Bonos...");
            db.exec(`
                PRAGMA foreign_keys = OFF;
                CREATE TABLE IF NOT EXISTS inversiones_temp (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    usuario_id INTEGER,
                    ticker TEXT NOT NULL,
                    tipo TEXT CHECK(tipo IN ('Accion', 'Acciones', 'CEDEAR', 'FCI', 'Crypto', 'Bono')),
                    cantidad REAL NOT NULL,
                    precio_promedio REAL,
                    valor_actual REAL,
                    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
                );
                INSERT INTO inversiones_temp (id, usuario_id, ticker, tipo, cantidad, precio_promedio, valor_actual)
                SELECT id, usuario_id, ticker, tipo, cantidad, precio_promedio, valor_actual FROM inversiones;
                DROP TABLE inversiones;
                ALTER TABLE inversiones_temp RENAME TO inversiones;
                PRAGMA foreign_keys = ON;
            `);
        }
    } catch (e) {
        console.warn('Nota en migración de inversiones:', e.message);
    }

}


/**
 * Inicializa la base de datos si las tablas no existen y aplica migraciones.
 */
function initDB() {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    runMigrations();

    // Crear usuario demo inicial si la tabla usuarios está vacía
    const userCount = db.prepare('SELECT COUNT(*) as count FROM usuarios').get().count;
    if (userCount === 0) {
        const defaultPasswordHash = hashPassword('demo123');
        const info = db.prepare(`
            INSERT INTO usuarios (nombre, email, password_hash)
            VALUES (?, ?, ?)
        `).run('Usuario Demo', 'demo@metrica.app', defaultPasswordHash);

        const defaultUserId = info.lastInsertRowid;
        console.log(`Usuario demo creado con ID: ${defaultUserId} (demo@metrica.app / demo123)`);

        // Asignar los registros huérfanos anteriores al usuario demo
        db.prepare('UPDATE gastos SET usuario_id = ? WHERE usuario_id IS NULL').run(defaultUserId);
        db.prepare('UPDATE cuentas_bancarias SET usuario_id = ? WHERE usuario_id IS NULL').run(defaultUserId);
        db.prepare('UPDATE ingresos_proyectados SET usuario_id = ? WHERE usuario_id IS NULL').run(defaultUserId);
        db.prepare('UPDATE inversiones SET usuario_id = ? WHERE usuario_id IS NULL').run(defaultUserId);
    }

    // Sembrar datos de negocio para usuario demo si aún no tiene clientes
    const demoUser = db.prepare('SELECT id FROM usuarios WHERE email = ?').get('demo@metrica.app');
    if (demoUser) {
        const clientCount = db.prepare('SELECT COUNT(*) as count FROM clientes WHERE usuario_id = ?').get(demoUser.id).count;
        if (clientCount === 0) {
            console.log('Sembrando datos de demostración para Métrica Negocios...');
            
            // Configuración de Monotributo (Categoría E - Servicios)
            db.prepare(`
                INSERT OR REPLACE INTO configuracion_negocio 
                (usuario_id, categoria_monotributo, tipo_actividad, limite_anual, sueldo_dueno_objetivo)
                VALUES (?, 'E', 'servicios', 36028231.33, 1200000)
            `).run(demoUser.id);


            // Clientes
            const insCliente = db.prepare(`
                INSERT INTO clientes (usuario_id, nombre, empresa, email, telefono, cuit, condicion_fiscal, notas)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const c1 = insCliente.run(demoUser.id, 'Sarah Jenkins', 'Acme Corp Tech (EE.UU.)', 'sarah@acmecorp.io', '+1 415 555-0192', 'US-998822', 'Cliente Exterior', 'Cliente recurrente desarrollo backend en USD').lastInsertRowid;
            const c2 = insCliente.run(demoUser.id, 'Martín Gómez', 'Distribuidora San Martín S.R.L.', 'compras@sanmartin.com.ar', '11 4455-8899', '30-71234567-9', 'Responsable Inscripto', 'Abono mensual soporte y e-commerce').lastInsertRowid;
            const c3 = insCliente.run(demoUser.id, 'Dra. Valeria Rossi', 'Estudio Rossi & Asoc.', 'valeria@estudiorossi.com', '11 5566-7788', '27-32111222-4', 'Monotributo', 'Desarrollo web institucional y automatizaciones').lastInsertRowid;

            // Facturas
            const insFactura = db.prepare(`
                INSERT INTO facturas_clientes (usuario_id, cliente_id, numero_factura, descripcion, monto, moneda, fecha_emision, fecha_vencimiento, fecha_cobro, estado, detalles)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const hoy = new Date().toISOString().slice(0, 10);
            insFactura.run(demoUser.id, c2, 'FC-0001-0045', 'Mantenimiento Plataforma E-Commerce B2B', 850000, 'ARS', hoy, hoy, hoy, 'cobrado', 'Cobrado vía transferencia bancaria');
            insFactura.run(demoUser.id, c3, 'FC-0001-0046', 'Automatización de Expedientes y CRM', 480000, 'ARS', hoy, '2026-09-25', null, 'pendiente', 'Pendiente de cobro a 15 días');
            insFactura.run(demoUser.id, c1, 'INV-2026-09', 'Sprints Desarrollo API Cloud (USD)', 1500, 'USD', hoy, '2026-09-30', null, 'pendiente', 'Cobro vía Wise / Deel');

            // Proyectos
            const insProyecto = db.prepare(`
                INSERT INTO proyectos_negocio (usuario_id, cliente_id, nombre, descripcion, monto_pactado, moneda, costos_estimados, estado, fecha_entrega)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            insProyecto.run(demoUser.id, c1, 'Plataforma Cloud Microservicios', 'Arquitectura backend distribuida y APIs REST en Node.js', 3500, 'USD', 500, 'en_progreso', '2026-10-30');
            insProyecto.run(demoUser.id, c2, 'Rediseño Portal Mayorista San Martín', 'Renovación de catálogo y checkout B2B con integración de stock', 1800000, 'ARS', 290000, 'en_progreso', '2026-10-15');
        }

        // Sembrar 15 clientes para el módulo B2B Métrica Contador Partner
        const contadorClientCount = db.prepare('SELECT COUNT(*) as count FROM contador_clientes WHERE contador_usuario_id = ?').get(demoUser.id).count;
        if (contadorClientCount === 0) {
            console.log('Sembrando 15 clientes tributarios para Métrica Contador Partner (Hito B2B)...');
            const insContador = db.prepare(`
                INSERT INTO contador_clientes 
                (contador_usuario_id, nombre_titular, cuit, categoria_monotributo, tipo_actividad, facturacion_acumulada_12m, email_contacto, telefono, notas)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const clientesSeed = [
                // Críticos (>90% de la categoría)
                ['Dr. Alejandro Rossi', '20-28941022-3', 'E', 'servicios', 33500000, 'alejandro.rossi@med.ar', '11 4022-1133', 'Médico especialista. Muy cerca del tope Cat E ($36.0M).'],
                ['Lic. Sofía Carrizo', '27-34882190-4', 'D', 'servicios', 27900000, 'sofia.carrizo@psico.com', '11 5533-8899', 'Psicóloga clínica. 97.8% del tope Cat D. Requiere recategorización inmediata.'],
                ['Santiago Vega', '20-30889900-7', 'K', 'bienes', 121500000, 'santiago@vegamuebles.com', '11 6677-2211', 'Comercializadora. 95.9% del tope máximo Cat K. Riesgo de paso a Régimen General.'],
                ['Mariana Albornoz', '27-29334455-8', 'C', 'servicios', 19800000, 'mariana.albornoz@diseno.ar', '11 4411-9900', 'Diseñadora UX. 92.4% del tope Cat C.'],
                
                // Zona de Precaución (70% - 90%)
                ['Esteban Méndez Dev', '20-35112233-1', 'H', 'servicios', 48200000, 'esteban@mendezdev.io', '11 6622-4411', 'Exportador de servicios IT. 70.8% del tope Cat H.'],
                ['Nicolás Peralta', '20-33667788-9', 'F', 'servicios', 38000000, 'nicolas.peralta@ing.ar', '11 5544-7722', 'Ingeniero civil. 84.3% del tope Cat F.'],
                ['Lucía Domínguez', '27-36778899-3', 'G', 'servicios', 46000000, 'lucia@dominguezasoc.ar', '11 3322-8811', 'Asesora legal. 85.1% del tope Cat G.'],
                ['Florencia Ibarra', '27-33990011-0', 'J', 'bienes', 78000000, 'flor@ibarratech.com', '11 4488-6633', 'Distribuidora mayorista. 74.2% del tope Cat J.'],
                ['Joaquín Castro', '20-37112244-4', 'I', 'bienes', 62000000, 'joaquin@castromuebles.ar', '11 6611-3344', 'Fabricante. 69.6% del tope Cat I.'],

                // Zona Segura (<70%)
                ['Tomás Benítez', '20-38445566-2', 'B', 'servicios', 11500000, 'tomas.benitez@transp.ar', '11 7711-2244', 'Servicios de logística. 68.8% del tope Cat B.'],
                ['Clara Varela', '27-31556677-5', 'A', 'servicios', 7200000, 'clara.varela@edu.ar', '11 4422-9988', 'Docente particular. 59.9% del tope Cat A.'],
                ['Camila Fontana', '27-35223355-6', 'D', 'servicios', 18500000, 'camila@fontanacomms.ar', '11 8899-1122', 'Comunicadora social. 64.8% del tope Cat D.'],
                ['Federico Navarro', '20-32334466-8', 'C', 'servicios', 12100000, 'fede.navarro@audio.ar', '11 3311-6655', 'Productor musical. 56.5% del tope Cat C.'],
                ['Agustina Morales', '27-38445577-1', 'B', 'servicios', 8900000, 'agustina@moralesfoto.com', '11 9922-4411', 'Fotógrafa comercial. 53.2% del tope Cat B.'],
                ['Gonzalo Quiroga', '20-34556688-3', 'A', 'servicios', 5400000, 'gonzalo@quirogafitness.ar', '11 2233-7766', 'Entrenador personal. 44.9% del tope Cat A.']
            ];

            for (const c of clientesSeed) {
                insContador.run(demoUser.id, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
            }
        }
    }

    console.log('Database initialized successfully with auth schema and B2B Contador Partner data.');
}

module.exports = {
    db,
    initDB,
    hashPassword,
    verifyPassword
};
