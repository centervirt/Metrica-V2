const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { authMiddleware } = require('./auth');

// ==========================================
// RUTA PÚBLICA: PRICING DINÁMICO BIMONETARIO (CONDICIÓN 1 TERM SHEET)
// ==========================================
router.get('/pricing', async (req, res) => {
    try {
        let tipoCambioMEP = 1530;
        try {
            const dolRes = await fetch('https://dolarapi.com/v1/dolares/bolsa');
            if (dolRes.ok) {
                const dolData = await dolRes.json();
                tipoCambioMEP = dolData.venta || tipoCambioMEP;
            }
        } catch (e) {
            console.warn('Usando cotización MEP de resguardo para pricing');
        }

        const planes = [
            {
                id: 'starter',
                nombre: 'Métrica Starter',
                badge: 'Gratis',
                descripcion: 'Ideal para comenzar a organizar tus finanzas personales y cuentas diarias.',
                precioUSD: 0,
                precioARS: 0,
                caracteristicas: [
                    'Cuentas bancarias y billeteras ilimitadas',
                    'Registro manual de gastos e ingresos',
                    'Gráficos de flujo de caja anual',
                    'Conversor multidivisa ARS / USD MEP',
                    'Guías didácticas y diagnóstico financiero'
                ]
            },
            {
                id: 'pro_personal',
                nombre: 'Métrica Pro Personal',
                badge: 'Popular',
                descripcion: 'Para ahorristas e inversores que quieren automatizar su dinero con Inteligencia Artificial.',
                precioUSD: 3.50,
                precioARS: Math.round(3.50 * tipoCambioMEP),
                caracteristicas: [
                    'Todo lo incluido en Starter',
                    'Copiloto Financiero IA ilimitado (chat y gastos por voz/texto)',
                    'Escaneo de tickets y facturas físicas con Visión Multimodal OCR',
                    'Simulador de Deudas interactivo (Bola de Nieve & Avalancha)',
                    'Metas de ahorro inteligentes con cálculo de plazos y aportes',
                    'Presupuestos mensuales por categoría con alertas'
                ]
            },
            {
                id: 'pro_negocios',
                nombre: 'Métrica Negocios & Freelancers',
                badge: 'Recomendado',
                descripcion: 'Control comercial absoluto para profesionales independientes, freelancers y PyMEs.',
                precioUSD: 10.00,
                precioARS: Math.round(10.00 * tipoCambioMEP),
                caracteristicas: [
                    'Todo lo incluido en Pro Personal',
                    'Gestión de Clientes, Cuentas Corrientes y Facturas ARS/USD',
                    'Rentabilidad neta de Proyectos deduciendo costos y sueldo de dueño',
                    'Termómetro de Monotributo en tiempo real con escalas oficiales AFIP/ARCA',
                    'Copiloto IA Comercial: Redactor de Cotizaciones y Cobranzas para WhatsApp',
                    'Exportación de planillas contables en CSV'
                ]
            },
            {
                id: 'contador_partner',
                nombre: 'Métrica Contador Partner',
                badge: 'B2B Estudio',
                descripcion: 'Para contadores públicos y estudios contables que administran múltiples carteras de clientes.',
                precioUSD: 35.00,
                precioARS: Math.round(35.00 * tipoCambioMEP),
                caracteristicas: [
                    'Panel Multi-Cliente centralizado con semáforo de Monotributo',
                    'Alertas predictivas de recategorización semestral y exclusión al Régimen General',
                    'Exportación masiva de reportes fiscales para liquidaciones ARCA/AFIP en 1 clic',
                    'Generador de links de invitación segura para autónomos y monotributistas',
                    'Soporte prioritario y certificación de Partner Oficial'
                ]
            }
        ];

        res.json({
            tipoCambioMEP,
            monedaReferencia: 'USD / USDC',
            clausulaInflacion: 'Precios referenciados al Dólar MEP oficial en tiempo real vía DolarApi. Tarifa mensual protegida contractualmente contra la devaluación e inflación local.',
            planes
        });
    } catch (error) {
        console.error('Error al obtener pricing dinámico:', error);
        res.status(500).json({ error: 'Error al consultar planes' });
    }
});

// Proteger todas las rutas privadas de /api con autenticación
router.use(authMiddleware);

// ==========================================
// 1. RESUMEN FINANCIERO CONSOLIDADO (POR USUARIO)
// ==========================================
router.get('/resumen', (req, res) => {
    try {
        const userId = req.user.id;

        const saldoTotal = db.prepare(`
            SELECT COALESCE(SUM(saldo), 0) as total 
            FROM cuentas_bancarias 
            WHERE usuario_id = ?
        `).get(userId).total;
        
        const gastosPendientes = db.prepare(`
            SELECT COALESCE(SUM(monto - monto_pagado), 0) as total 
            FROM gastos 
            WHERE usuario_id = ? AND estado != 'pagado'
        `).get(userId).total;

        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const ingresosProyectadosMes = db.prepare(`
            SELECT COALESCE(SUM(monto), 0) as total 
            FROM ingresos_proyectados 
            WHERE usuario_id = ? AND mes = ?
        `).get(userId, currentMonth).total;

        const totalInversiones = db.prepare(`
            SELECT COALESCE(SUM(cantidad * COALESCE(valor_actual, precio_promedio, 0)), 0) as total 
            FROM inversiones
            WHERE usuario_id = ?
        `).get(userId).total;

        const gastosProximos = db.prepare(`
            SELECT * FROM gastos 
            WHERE usuario_id = ? AND estado != 'pagado' 
            ORDER BY vencimiento ASC 
            LIMIT 5
        `).all(userId);

        res.json({
            saldoTotal,
            gastosPendientes,
            ingresosProyectadosMes,
            totalInversiones,
            balanceNetoEstimado: (saldoTotal + ingresosProyectadosMes) - gastosPendientes,
            gastosProximos
        });
    } catch (error) {
        console.error('Error al obtener resumen:', error);
        res.status(500).json({ error: 'Error al calcular resumen financiero' });
    }
});

// ==========================================
// 1.0 COTIZACIONES DEL DÓLAR EN VIVO (ARGENTINA)
// ==========================================
let cachedDolarData = null;
let lastDolarFetch = 0;

router.get('/dolar', async (req, res) => {
    try {
        const now = Date.now();
        if (cachedDolarData && (now - lastDolarFetch < 5 * 60 * 1000)) {
            return res.json(cachedDolarData);
        }

        const response = await fetch('https://dolarapi.com/v1/dolares');
        if (!response.ok) throw new Error('Error al consultar dolarapi.com');
        const data = await response.json();

        const mapa = {};
        data.forEach(item => {
            const key = (item.casa || '').toLowerCase();
            mapa[key] = {
                nombre: item.nombre,
                compra: item.compra,
                venta: item.venta,
                fechaActualizacion: item.fechaActualizacion
            };
        });

        if (mapa.bolsa && !mapa.mep) {
            mapa.mep = mapa.bolsa;
        }

        cachedDolarData = {
            cotizaciones: mapa,
            actualizadoEn: new Date().toISOString()
        };
        lastDolarFetch = now;

        res.json(cachedDolarData);
    } catch (err) {
        console.warn('Fallo al obtener dólar en vivo, usando cotizaciones de respaldo:', err.message);
        const fallback = {
            cotizaciones: {
                blue: { nombre: 'Dólar Blue', compra: 1525, venta: 1545, fechaActualizacion: new Date().toISOString() },
                mep: { nombre: 'Dólar MEP', compra: 1520, venta: 1530, fechaActualizacion: new Date().toISOString() },
                oficial: { nombre: 'Dólar Oficial', compra: 1490, venta: 1530, fechaActualizacion: new Date().toISOString() },
                cripto: { nombre: 'Dólar Cripto', compra: 1560, venta: 1583, fechaActualizacion: new Date().toISOString() }
            },
            actualizadoEn: new Date().toISOString(),
            isFallback: true
        };
        res.json(cachedDolarData || fallback);
    }
});

// ==========================================
// 1.1 FLUJO DE CAJA ANUAL (INGRESOS VS GASTOS)
// ==========================================
router.get('/flujo-anual', (req, res) => {
    try {
        const userId = req.user.id;
        const year = req.query.year || new Date().getFullYear().toString();

        const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const datosMeses = Array.from({ length: 12 }, (_, i) => {
            const numMes = String(i + 1).padStart(2, '0');
            return { mesNum: numMes, nombre: mesesNombres[i], ingresos: 0, gastos: 0, gastosPagados: 0 };
        });

        // 1. Sumar ingresos por mes
        const ingresosRaw = db.prepare(`
            SELECT substr(mes, 6, 2) as mesNum, COALESCE(SUM(monto), 0) as total
            FROM ingresos_proyectados
            WHERE usuario_id = ? AND substr(mes, 1, 4) = ?
            GROUP BY mesNum
        `).all(userId, year);

        ingresosRaw.forEach(row => {
            const idx = parseInt(row.mesNum, 10) - 1;
            if (idx >= 0 && idx < 12) {
                datosMeses[idx].ingresos = row.total;
            }
        });

        // 2. Sumar gastos totales y gastos ya pagados/abonados por mes (vencimiento o creado_en)
        const gastosRaw = db.prepare(`
            SELECT 
                substr(COALESCE(vencimiento, creado_en), 6, 2) as mesNum, 
                COALESCE(SUM(monto), 0) as total,
                COALESCE(SUM(monto_pagado), 0) as totalPagado
            FROM gastos
            WHERE usuario_id = ? AND substr(COALESCE(vencimiento, creado_en), 1, 4) = ?
            GROUP BY mesNum
        `).all(userId, year);

        gastosRaw.forEach(row => {
            const idx = parseInt(row.mesNum, 10) - 1;
            if (idx >= 0 && idx < 12) {
                datosMeses[idx].gastos = row.total;
                datosMeses[idx].gastosPagados = row.totalPagado;
            }
        });

        const ingresosSerie = datosMeses.map(d => d.ingresos);
        const gastosSerie = datosMeses.map(d => d.gastos);
        const gastosPagadosSerie = datosMeses.map(d => d.gastosPagados);
        // Dinero disponible real: Ingresos del mes menos pagos efectivamente realizados
        const dineroDisponibleSerie = datosMeses.map(d => d.ingresos - d.gastosPagados);
        const superavitSerie = datosMeses.map(d => d.ingresos - d.gastos);

        const totalIngresosAnual = ingresosSerie.reduce((a, b) => a + b, 0);
        const totalGastosAnual = gastosSerie.reduce((a, b) => a + b, 0);
        const totalPagadoAnual = gastosPagadosSerie.reduce((a, b) => a + b, 0);
        const totalDineroDisponibleAnual = totalIngresosAnual - totalPagadoAnual;
        const balanceAnual = totalIngresosAnual - totalGastosAnual;

        res.json({
            year,
            meses: mesesNombres,
            ingresos: ingresosSerie,
            gastos: gastosSerie,
            gastosPagados: gastosPagadosSerie,
            dineroDisponible: dineroDisponibleSerie,
            superavit: superavitSerie,
            totalIngresosAnual,
            totalGastosAnual,
            totalPagadoAnual,
            totalDineroDisponibleAnual,
            balanceAnual
        });
    } catch (error) {
        console.error('Error al calcular flujo anual:', error);
        res.status(500).json({ error: 'Error al calcular flujo de caja anual' });
    }
});

// ==========================================
// 2. GASTOS (POR USUARIO)
// ==========================================
router.get('/gastos', (req, res) => {
    try {
        const userId = req.user.id;
        const { estado, categoria } = req.query;
        let query = 'SELECT * FROM gastos WHERE usuario_id = ?';
        const params = [userId];

        if (estado) {
            query += ' AND estado = ?';
            params.push(estado);
        }
        if (categoria) {
            query += ' AND categoria = ?';
            params.push(categoria);
        }

        query += ' ORDER BY vencimiento ASC, prioridad ASC';
        const gastos = db.prepare(query).all(...params);
        res.json(gastos);
    } catch (error) {
        console.error('Error al listar gastos:', error);
        res.status(500).json({ error: 'Error al obtener gastos' });
    }
});

router.post('/gastos', (req, res) => {
    try {
        const userId = req.user.id;
        const {
            nombre,
            categoria,
            detalles,
            monto,
            monto_pagado = 0,
            vencimiento,
            estado = 'impago',
            recurrente = 0,
            prioridad = 1,
            moneda = 'ARS'
        } = req.body;

        if (!nombre || monto === undefined) {
            return res.status(400).json({ error: 'El nombre y el monto son requeridos' });
        }

        const stmt = db.prepare(`
            INSERT INTO gastos (usuario_id, nombre, categoria, detalles, monto, monto_pagado, vencimiento, estado, recurrente, prioridad, moneda)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(userId, nombre, categoria || null, detalles || null, monto, monto_pagado, vencimiento || null, estado, recurrente ? 1 : 0, prioridad, moneda);
        const nuevoGasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json(nuevoGasto);
    } catch (error) {
        console.error('Error al crear gasto:', error);
        res.status(500).json({ error: 'Error al registrar gasto' });
    }
});

router.put('/gastos/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const gastoExistente = db.prepare('SELECT * FROM gastos WHERE id = ? AND usuario_id = ?').get(id, userId);
        if (!gastoExistente) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        let {
            nombre = gastoExistente.nombre,
            categoria = gastoExistente.categoria,
            detalles = gastoExistente.detalles,
            monto = gastoExistente.monto,
            monto_pagado = gastoExistente.monto_pagado,
            vencimiento = gastoExistente.vencimiento,
            estado = gastoExistente.estado,
            recurrente = gastoExistente.recurrente,
            prioridad = gastoExistente.prioridad,
            moneda = gastoExistente.moneda,
            cuenta_id = null,
            monto_abonado = null
        } = req.body;

        monto = parseFloat(monto) || 0;
        monto_pagado = Math.max(0, parseFloat(monto_pagado) || 0);

        // Si se pagó la totalidad o más, el estado pasa automáticamente a 'pagado'
        if (monto_pagado >= monto && monto > 0) {
            estado = 'pagado';
        } else if (monto_pagado > 0 && estado === 'pagado') {
            // Si el monto pagado es menor al total pero venía con estado 'pagado', dejarlo impago o proximo
            estado = 'impago';
        }

        // Ejecutar actualización de gasto y descuento de saldo bancario opcional
        const actualizarConTransaccion = db.transaction(() => {
            const stmt = db.prepare(`
                UPDATE gastos 
                SET nombre = ?, categoria = ?, detalles = ?, monto = ?, monto_pagado = ?, vencimiento = ?, estado = ?, recurrente = ?, prioridad = ?, moneda = ?
                WHERE id = ? AND usuario_id = ?
            `);
            stmt.run(nombre, categoria, detalles, monto, monto_pagado, vencimiento, estado, recurrente ? 1 : 0, prioridad, moneda, id, userId);

            // Si se seleccionó una cuenta para descontar el pago
            if (cuenta_id && monto_abonado && parseFloat(monto_abonado) > 0) {
                const cuenta = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ? AND usuario_id = ?').get(cuenta_id, userId);
                if (cuenta) {
                    const nuevoSaldo = cuenta.saldo - parseFloat(monto_abonado);
                    db.prepare('UPDATE cuentas_bancarias SET saldo = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ?')
                      .run(nuevoSaldo, cuenta_id, userId);
                }
            }
        });

        actualizarConTransaccion();

        const gastoActualizado = db.prepare('SELECT * FROM gastos WHERE id = ?').get(id);
        res.json(gastoActualizado);
    } catch (error) {
        console.error('Error al actualizar gasto:', error);
        res.status(500).json({ error: 'Error al actualizar gasto' });
    }
});

router.delete('/gastos/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const stmt = db.prepare('DELETE FROM gastos WHERE id = ? AND usuario_id = ?');
        const info = stmt.run(id, userId);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }
        res.json({ success: true, message: 'Gasto eliminado' });
    } catch (error) {
        console.error('Error al eliminar gasto:', error);
        res.status(500).json({ error: 'Error al eliminar gasto' });
    }
});

// ==========================================
// 3. CUENTAS BANCARIAS (POR USUARIO)
// ==========================================
router.get('/cuentas', (req, res) => {
    try {
        const userId = req.user.id;
        const cuentas = db.prepare('SELECT * FROM cuentas_bancarias WHERE usuario_id = ? ORDER BY nombre ASC').all(userId);
        res.json(cuentas);
    } catch (error) {
        console.error('Error al listar cuentas:', error);
        res.status(500).json({ error: 'Error al obtener cuentas' });
    }
});

router.post('/cuentas', (req, res) => {
    try {
        const userId = req.user.id;
        const { nombre, banco, saldo = 0, moneda = 'ARS' } = req.body;
        if (!nombre) {
            return res.status(400).json({ error: 'El nombre de la cuenta es requerido' });
        }

        const stmt = db.prepare(`
            INSERT INTO cuentas_bancarias (usuario_id, nombre, banco, saldo, moneda, actualizado_en)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        const info = stmt.run(userId, nombre, banco || null, saldo, moneda);
        const nuevaCuenta = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json(nuevaCuenta);
    } catch (error) {
        console.error('Error al crear cuenta:', error);
        res.status(500).json({ error: 'Error al registrar cuenta bancaria' });
    }
});

router.put('/cuentas/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const cuentaExistente = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ? AND usuario_id = ?').get(id, userId);
        if (!cuentaExistente) {
            return res.status(404).json({ error: 'Cuenta no encontrada' });
        }

        const {
            nombre = cuentaExistente.nombre,
            banco = cuentaExistente.banco,
            saldo = cuentaExistente.saldo,
            moneda = cuentaExistente.moneda
        } = req.body;

        const stmt = db.prepare(`
            UPDATE cuentas_bancarias 
            SET nombre = ?, banco = ?, saldo = ?, moneda = ?, actualizado_en = CURRENT_TIMESTAMP
            WHERE id = ? AND usuario_id = ?
        `);
        stmt.run(nombre, banco, saldo, moneda, id, userId);
        const cuentaActualizada = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ?').get(id);
        res.json(cuentaActualizada);
    } catch (error) {
        console.error('Error al actualizar cuenta:', error);
        res.status(500).json({ error: 'Error al actualizar cuenta bancaria' });
    }
});

router.post('/cuentas/transferir', (req, res) => {
    try {
        const userId = req.user.id;
        const { cuenta_origen_id, cuenta_destino_id, monto, concepto } = req.body;

        const origenId = parseInt(cuenta_origen_id, 10);
        const destinoId = parseInt(cuenta_destino_id, 10);
        const montoNum = parseFloat(monto);

        if (!origenId || !destinoId) {
            return res.status(400).json({ error: 'Debes seleccionar cuenta de origen y destino' });
        }
        if (origenId === destinoId) {
            return res.status(400).json({ error: 'La cuenta de origen y destino no pueden ser la misma' });
        }
        if (isNaN(montoNum) || montoNum <= 0) {
            return res.status(400).json({ error: 'El monto a transferir debe ser mayor a 0' });
        }

        const origen = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ? AND usuario_id = ?').get(origenId, userId);
        if (!origen) {
            return res.status(404).json({ error: 'Cuenta de origen no encontrada' });
        }

        const destino = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ? AND usuario_id = ?').get(destinoId, userId);
        if (!destino) {
            return res.status(404).json({ error: 'Cuenta de destino no encontrada' });
        }

        if (origen.saldo < montoNum) {
            return res.status(400).json({ 
                error: `Saldo insuficiente en ${origen.nombre}. Saldo actual: $${origen.saldo.toLocaleString('es-AR')}` 
            });
        }

        const transferirTx = db.transaction(() => {
            db.prepare(`
                UPDATE cuentas_bancarias 
                SET saldo = saldo - ?, actualizado_en = CURRENT_TIMESTAMP
                WHERE id = ? AND usuario_id = ?
            `).run(montoNum, origenId, userId);

            db.prepare(`
                UPDATE cuentas_bancarias 
                SET saldo = saldo + ?, actualizado_en = CURRENT_TIMESTAMP
                WHERE id = ? AND usuario_id = ?
            `).run(montoNum, destinoId, userId);
        });

        transferirTx();

        const cuentaOrigenActualizada = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ?').get(origenId);
        const cuentaDestinoActualizada = db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ?').get(destinoId);

        res.json({
            success: true,
            message: `Transferencia de $${montoNum.toLocaleString('es-AR')} realizada con éxito`,
            origen: cuentaOrigenActualizada,
            destino: cuentaDestinoActualizada
        });
    } catch (error) {
        console.error('Error al transferir entre cuentas:', error);
        res.status(500).json({ error: 'Error al procesar la transferencia' });
    }
});

router.delete('/cuentas/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const stmt = db.prepare('DELETE FROM cuentas_bancarias WHERE id = ? AND usuario_id = ?');
        const info = stmt.run(id, userId);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Cuenta no encontrada' });
        }
        res.json({ success: true, message: 'Cuenta eliminada' });
    } catch (error) {
        console.error('Error al eliminar cuenta:', error);
        res.status(500).json({ error: 'Error al eliminar cuenta bancaria' });
    }
});

// ==========================================
// 4. INGRESOS PROYECTADOS (POR USUARIO)
// ==========================================
router.get('/ingresos', (req, res) => {
    try {
        const userId = req.user.id;
        const { mes } = req.query;
        let query = 'SELECT * FROM ingresos_proyectados WHERE usuario_id = ?';
        const params = [userId];

        if (mes) {
            query += ' AND mes = ?';
            params.push(mes);
        }

        query += ' ORDER BY mes ASC, id ASC';
        const ingresos = db.prepare(query).all(...params);
        res.json(ingresos);
    } catch (error) {
        console.error('Error al listar ingresos:', error);
        res.status(500).json({ error: 'Error al obtener ingresos proyectados' });
    }
});

router.post('/ingresos', (req, res) => {
    try {
        const userId = req.user.id;
        const { fuente, monto, mes, estado = 'proyectado' } = req.body;
        if (!fuente || monto === undefined || !mes) {
            return res.status(400).json({ error: 'Fuente, monto y mes (YYYY-MM) son requeridos' });
        }

        const stmt = db.prepare(`
            INSERT INTO ingresos_proyectados (usuario_id, fuente, monto, mes, estado)
            VALUES (?, ?, ?, ?, ?)
        `);
        const info = stmt.run(userId, fuente, monto, mes, estado);
        const nuevoIngreso = db.prepare('SELECT * FROM ingresos_proyectados WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json(nuevoIngreso);
    } catch (error) {
        console.error('Error al crear ingreso:', error);
        res.status(500).json({ error: 'Error al registrar ingreso proyectado' });
    }
});

router.put('/ingresos/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const ingresoExistente = db.prepare('SELECT * FROM ingresos_proyectados WHERE id = ? AND usuario_id = ?').get(id, userId);
        if (!ingresoExistente) {
            return res.status(404).json({ error: 'Ingreso no encontrado' });
        }

        const {
            fuente = ingresoExistente.fuente,
            monto = ingresoExistente.monto,
            mes = ingresoExistente.mes,
            estado = ingresoExistente.estado
        } = req.body;

        const stmt = db.prepare(`
            UPDATE ingresos_proyectados 
            SET fuente = ?, monto = ?, mes = ?, estado = ?
            WHERE id = ? AND usuario_id = ?
        `);
        stmt.run(fuente, monto, mes, estado, id, userId);
        const ingresoActualizado = db.prepare('SELECT * FROM ingresos_proyectados WHERE id = ?').get(id);
        res.json(ingresoActualizado);
    } catch (error) {
        console.error('Error al actualizar ingreso:', error);
        res.status(500).json({ error: 'Error al actualizar ingreso proyectado' });
    }
});

router.delete('/ingresos/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const stmt = db.prepare('DELETE FROM ingresos_proyectados WHERE id = ? AND usuario_id = ?');
        const info = stmt.run(id, userId);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Ingreso no encontrado' });
        }
        res.json({ success: true, message: 'Ingreso eliminado' });
    } catch (error) {
        console.error('Error al eliminar ingreso:', error);
        res.status(500).json({ error: 'Error al eliminar ingreso proyectado' });
    }
});

// Helper para consultar cotización en tiempo real de CEDEARs / Acciones / Cripto
async function obtenerCotizacionActivo(ticker, tipo = 'CEDEAR') {
    const symbol = ticker.trim().toUpperCase();
    try {
        if (tipo === 'Crypto' || ['BTC', 'ETH', 'SOL', 'USDT'].includes(symbol)) {
            // Cotización de Cripto
            const yahooCrypto = symbol.endsWith('-USD') ? symbol : `${symbol}-USD`;
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCrypto}?interval=1d&range=1d`;
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.ok) {
                const data = await res.json();
                const meta = data.chart?.result?.[0]?.meta;
                const precioUSD = meta?.regularMarketPrice;
                if (precioUSD) {
                    // Obtener dólar cripto o CCL para convertir a ARS
                    let cotizCriptoARS = 1550;
                    try {
                        const dolRes = await fetch('https://dolarapi.com/v1/dolares/cripto');
                        if (dolRes.ok) {
                            const dData = await dolRes.json();
                            cotizCriptoARS = dData.venta || 1550;
                        }
                    } catch (e) {}
                    return {
                        precioARS: Math.round(precioUSD * cotizCriptoARS),
                        precioUSD,
                        fuente: 'Yahoo Finance Crypto + Dólar Cripto',
                        moneda: 'ARS'
                    };
                }
            }
        } else {
            // Intentar primero directamente por BYMA (CEDEAR en pesos argentinos .BA)
            const symbolBA = symbol.endsWith('.BA') ? symbol : `${symbol}.BA`;
            const urlBA = `https://query1.finance.yahoo.com/v8/finance/chart/${symbolBA}?interval=1d&range=1d`;
            const resBA = await fetch(urlBA, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (resBA.ok) {
                const dataBA = await resBA.json();
                const metaBA = dataBA.chart?.result?.[0]?.meta;
                const precioARS = metaBA?.regularMarketPrice;
                if (precioARS && precioARS > 0) {
                    return {
                        precioARS,
                        fuente: 'BYMA / Yahoo Finance (.BA)',
                        moneda: 'ARS'
                    };
                }
            }

            // Si no está con .BA, intentar símbolo directo en USD y convertir a CCL
            const urlUSD = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
            const resUSD = await fetch(urlUSD, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (resUSD.ok) {
                const dataUSD = await resUSD.json();
                const metaUSD = dataUSD.chart?.result?.[0]?.meta;
                const precioUSD = metaUSD?.regularMarketPrice;
                if (precioUSD && precioUSD > 0) {
                    let ccl = 1580;
                    try {
                        const dolRes = await fetch('https://dolarapi.com/v1/dolares/contadoconliqui');
                        if (dolRes.ok) {
                            const dData = await dolRes.json();
                            ccl = dData.venta || 1580;
                        }
                    } catch (e) {}
                    return {
                        precioARS: Math.round(precioUSD * ccl),
                        precioUSD,
                        fuente: 'Yahoo Finance USD & Dólar CCL',
                        moneda: 'ARS'
                    };
                }
            }
        }
    } catch (err) {
        console.error(`Error obteniendo cotización para ${symbol}:`, err.message);
    }
    return null;
}

// Ruta para consultar cotización de un ticker específico
router.get('/inversiones/cotizacion/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const { tipo } = req.query;
        const cotizacion = await obtenerCotizacionActivo(ticker, tipo);
        if (!cotizacion) {
            return res.status(404).json({ error: `No se pudo obtener cotización para ${ticker}` });
        }
        res.json({ ticker: ticker.toUpperCase(), ...cotizacion });
    } catch (error) {
        console.error('Error al obtener cotización:', error);
        res.status(500).json({ error: 'Error al consultar cotización de mercado' });
    }
});

// Ruta para actualizar automáticamente los precios de todas las posiciones del usuario
router.post('/inversiones/actualizar-precios', async (req, res) => {
    try {
        const userId = req.user.id;
        const inversiones = db.prepare('SELECT * FROM inversiones WHERE usuario_id = ?').all(userId);
        const actualizadas = [];

        for (const inv of inversiones) {
            const cotiz = await obtenerCotizacionActivo(inv.ticker, inv.tipo);
            if (cotiz && cotiz.precioARS > 0) {
                db.prepare('UPDATE inversiones SET valor_actual = ? WHERE id = ? AND usuario_id = ?')
                  .run(cotiz.precioARS, inv.id, userId);
                actualizadas.push({
                    ticker: inv.ticker,
                    precioAnterior: inv.valor_actual,
                    precioNuevo: cotiz.precioARS
                });
            }
        }

        const inversionesActualizadas = db.prepare('SELECT * FROM inversiones WHERE usuario_id = ? ORDER BY ticker ASC').all(userId);
        res.json({
            mensaje: `Se actualizaron las cotizaciones de ${actualizadas.length} activos`,
            actualizadas,
            inversiones: inversionesActualizadas
        });
    } catch (error) {
        console.error('Error al actualizar precios de mercado:', error);
        res.status(500).json({ error: 'Error al actualizar precios del mercado' });
    }
});

router.get('/inversiones', (req, res) => {
    try {
        const userId = req.user.id;
        const inversiones = db.prepare('SELECT * FROM inversiones WHERE usuario_id = ? ORDER BY ticker ASC').all(userId);
        res.json(inversiones);
    } catch (error) {
        console.error('Error al listar inversiones:', error);
        res.status(500).json({ error: 'Error al obtener inversiones' });
    }
});

router.post('/inversiones', (req, res) => {
    try {
        const userId = req.user.id;
        const { ticker, tipo, cantidad, precio_promedio = 0, valor_actual = 0 } = req.body;
        if (!ticker || cantidad === undefined) {
            return res.status(400).json({ error: 'Ticker y cantidad son requeridos' });
        }

        const stmt = db.prepare(`
            INSERT INTO inversiones (usuario_id, ticker, tipo, cantidad, precio_promedio, valor_actual)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(userId, ticker.toUpperCase(), tipo || null, cantidad, precio_promedio, valor_actual);
        const nuevaInversion = db.prepare('SELECT * FROM inversiones WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json(nuevaInversion);
    } catch (error) {
        console.error('Error al crear inversión:', error);
        res.status(500).json({ error: 'Error al registrar inversión' });
    }
});

router.put('/inversiones/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const invExistente = db.prepare('SELECT * FROM inversiones WHERE id = ? AND usuario_id = ?').get(id, userId);
        if (!invExistente) {
            return res.status(404).json({ error: 'Inversión no encontrada' });
        }

        const {
            ticker = invExistente.ticker,
            tipo = invExistente.tipo,
            cantidad = invExistente.cantidad,
            precio_promedio = invExistente.precio_promedio,
            valor_actual = invExistente.valor_actual
        } = req.body;

        const stmt = db.prepare(`
            UPDATE inversiones 
            SET ticker = ?, tipo = ?, cantidad = ?, precio_promedio = ?, valor_actual = ?
            WHERE id = ? AND usuario_id = ?
        `);
        stmt.run(ticker.toUpperCase(), tipo, cantidad, precio_promedio, valor_actual, id, userId);
        const invActualizada = db.prepare('SELECT * FROM inversiones WHERE id = ?').get(id);
        res.json(invActualizada);
    } catch (error) {
        console.error('Error al actualizar inversión:', error);
        res.status(500).json({ error: 'Error al actualizar inversión' });
    }
});

router.delete('/inversiones/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const stmt = db.prepare('DELETE FROM inversiones WHERE id = ? AND usuario_id = ?');
        const info = stmt.run(id, userId);

        if (info.changes === 0) {
            return res.status(404).json({ error: 'Inversión no encontrada' });
        }
        res.json({ success: true, message: 'Inversión eliminada' });
    } catch (error) {
        console.error('Error al eliminar inversión:', error);
        res.status(500).json({ error: 'Error al eliminar inversión' });
    }
});

// ==========================================
// 6. EDUCACIÓN FINANCIERA & DIAGNÓSTICO EN VIVO (HÍBRIDO)
// ==========================================
router.get('/educacion/diagnostico', (req, res) => {
    try {
        const userId = req.user.id;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

        // 1. Ingresos del mes actual
        const ingresosMes = db.prepare(`
            SELECT COALESCE(SUM(monto), 0) as total 
            FROM ingresos_proyectados 
            WHERE usuario_id = ? AND mes = ?
        `).get(userId, currentMonth).total;

        // 2. Gastos por categoría (este mes o recurrentes)
        const gastos = db.prepare(`
            SELECT categoria, SUM(monto) as total
            FROM gastos 
            WHERE usuario_id = ?
            GROUP BY categoria
        `).all(userId);

        let necesidadesMonto = 0; // operativo, impuesto
        let deseosMonto = 0;       // credito u ocio
        let otrosGastosMonto = 0;

        gastos.forEach(g => {
            if (g.categoria === 'operativo' || g.categoria === 'impuesto') {
                necesidadesMonto += g.total;
            } else if (g.categoria === 'credito') {
                deseosMonto += g.total;
            } else {
                otrosGastosMonto += g.total;
            }
        });

        // 3. Saldo Líquido Total en Cuentas Bancarias
        const saldoTotal = db.prepare(`
            SELECT COALESCE(SUM(saldo), 0) as total 
            FROM cuentas_bancarias 
            WHERE usuario_id = ?
        `).get(userId).total;

        // 4. Inversiones
        const totalInversiones = db.prepare(`
            SELECT COALESCE(SUM(cantidad * COALESCE(valor_actual, precio_promedio, 0)), 0) as total 
            FROM inversiones 
            WHERE usuario_id = ?
        `).get(userId).total;

        // 5. Cálculo Regla 50/30/20
        const totalGastosCalc = necesidadesMonto + deseosMonto + otrosGastosMonto;
        const baseCalculo = ingresosMes > 0 ? ingresosMes : totalGastosCalc;

        let pctNecesidades = 0;
        let pctDeseos = 0;
        let pctAhorro = 0;
        let montoAhorroEstimado = 0;

        if (baseCalculo > 0) {
            pctNecesidades = Math.round((necesidadesMonto / baseCalculo) * 100);
            pctDeseos = Math.round((deseosMonto / baseCalculo) * 100);
            montoAhorroEstimado = Math.max(0, baseCalculo - totalGastosCalc);
            pctAhorro = Math.max(0, 100 - pctNecesidades - pctDeseos);
        }

        // 6. Fondo de Emergencia
        // Costo mensual indispensable (necesidades)
        const costoVidaMensual = necesidadesMonto > 0 ? necesidadesMonto : (totalGastosCalc > 0 ? totalGastosCalc * 0.6 : 1);
        const mesesFondoCubiertos = costoVidaMensual > 0 ? (saldoTotal / costoVidaMensual) : 0;
        const metaFondoMinimo = costoVidaMensual * 3; // 3 meses
        const metaFondoOptimo = costoVidaMensual * 6; // 6 meses

        // 7. Estrategias de Deuda Múltiples: Bola de Nieve, Avalancha, Flujo de Caja (CFI) y Tsunami
        // Deudas pendientes (estado != 'pagado')
        const deudasPendientes = db.prepare(`
            SELECT id, nombre, categoria, monto, monto_pagado, (monto - monto_pagado) as resto_deuda, vencimiento, prioridad
            FROM gastos 
            WHERE usuario_id = ? AND estado != 'pagado'
        `).all(userId);

        const totalDeudaPendiente = deudasPendientes.reduce((acc, d) => acc + d.resto_deuda, 0);

        // 1. Bola de Nieve: Menor saldo restante (impulso psicológico)
        const bolaDeNieve = [...deudasPendientes].sort((a, b) => a.resto_deuda - b.resto_deuda);

        // 2. Avalancha: Mayor prioridad y vencimiento más cercano (ahorro matemático de intereses)
        const avalancha = [...deudasPendientes].sort((a, b) => {
            const prioMap = { alta: 3, media: 2, baja: 1 };
            const prioDiff = (prioMap[b.prioridad] || 1) - (prioMap[a.prioridad] || 1);
            if (prioDiff !== 0) return prioDiff;
            return (a.vencimiento || '9999').localeCompare(b.vencimiento || '9999');
        });

        // 3. Índice de Flujo de Caja (CFI): Menor saldo en relación a la cuota (desahogo mensual rápido)
        const flujoCaja = [...deudasPendientes].map(d => {
            const cuotaEstimada = Math.max(Math.round(d.resto_deuda * 0.10), Math.min(d.resto_deuda, 30000));
            const cfi = Number((d.resto_deuda / (cuotaEstimada || 1)).toFixed(1));
            return { ...d, cuotaEstimada, cfi };
        }).sort((a, b) => a.cfi - b.cfi);

        // 4. Tsunami Emocional: Servicios esenciales e impuestos primero, protegiendo el hogar
        const tsunami = [...deudasPendientes].sort((a, b) => {
            const catScore = { operativo: 3, impuesto: 2, credito: 1 };
            const prioMap = { alta: 3, media: 2, baja: 1 };
            const catDiff = (catScore[b.categoria] || 1) - (catScore[a.categoria] || 1);
            if (catDiff !== 0) return catDiff;
            const prioDiff = (prioMap[b.prioridad] || 1) - (prioMap[a.prioridad] || 1);
            if (prioDiff !== 0) return prioDiff;
            return a.resto_deuda - b.resto_deuda;
        });

        const estrategiasCatalogo = {
            bolaDeNieve: {
                id: 'bolaDeNieve',
                nombre: 'Bola de Nieve',
                subtitulo: 'Método Snowball',
                icono: '⛄',
                enfoque: 'Psicológico',
                colorBadge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                descripcion: 'Pagas el mínimo en todo y atacas primero la deuda de <strong>menor saldo total</strong>. Al liquidarla rápido, ganas victorias psicológicas tempranas y liberas flujo mensual para la siguiente.',
                idealPara: 'Quienes necesitan ver progreso inmediato y eliminar cuentas rápido.',
                proximoObjetivo: bolaDeNieve[0] || null,
                orden: bolaDeNieve
            },
            avalancha: {
                id: 'avalancha',
                nombre: 'Avalancha',
                subtitulo: 'Método Avalanche',
                icono: '🏔️',
                enfoque: 'Matemático',
                colorBadge: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                descripcion: 'Pagas el mínimo de todo y atacas primero la deuda con la <strong>mayor tasa de interés (CFT) o vencimiento crítico</strong> (como el revolving de tarjetas con costos punitorios altos).',
                idealPara: 'Tarjetas de crédito y préstamos caros para ahorrar el máximo de dinero en intereses.',
                proximoObjetivo: avalancha[0] || null,
                orden: avalancha
            },
            flujoCaja: {
                id: 'flujoCaja',
                nombre: 'Flujo de Caja (CFI)',
                subtitulo: 'Cashflow Index',
                icono: '⚡',
                enfoque: 'Liquidez Inmediata',
                colorBadge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                descripcion: 'Prioriza liquidar la deuda que <strong>más cuota mensual te quita en relación a su saldo</strong> (menor índice CFI). Te devuelve la mayor cantidad de sueldo libre por cada peso pagado.',
                idealPara: 'Quienes sienten que el sueldo no alcanza a fin de mes y necesitan "aire" mensual inmediato.',
                proximoObjetivo: flujoCaja[0] || null,
                orden: flujoCaja
            },
            tsunami: {
                id: 'tsunami',
                nombre: 'Tsunami Emocional',
                subtitulo: 'Tranquilidad y Hogar',
                icono: '🌊',
                enfoque: 'Paz Mental',
                colorBadge: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                descripcion: 'Prioriza cancelar primero los <strong>servicios fijos esenciales (luz, gas, prepaga, alquiler) e impuestos</strong> antes que créditos comerciales, eliminando el estrés cotidiano.',
                idealPara: 'Proteger la estabilidad del hogar y evitar cortes de suministros o deudas agobiantes.',
                proximoObjetivo: tsunami[0] || null,
                orden: tsunami
            }
        };

        // 8. SCORE GLOBAL DE SALUD FINANCIERA (0 A 100 PUNTOS)
        // Pilar 1: Tasa de Ahorro / Regla 50-30-20 (Máx 30)
        let ptsAhorro = 0;
        if (pctAhorro >= 20) ptsAhorro = 30;
        else if (pctAhorro >= 10) ptsAhorro = 20;
        else if (pctAhorro >= 1) ptsAhorro = 10;

        // Pilar 2: Fondo de Emergencia (Máx 30)
        let ptsFondo = 0;
        if (mesesFondoCubiertos >= 6) ptsFondo = 30;
        else if (mesesFondoCubiertos >= 3) ptsFondo = 25;
        else if (mesesFondoCubiertos >= 1) ptsFondo = 15;
        else if (saldoTotal > 0) ptsFondo = 5;

        // Pilar 3: Carga de Endeudamiento vs Ingresos (Máx 25)
        let ptsDeuda = 0;
        const ratioDeuda = baseCalculo > 0 ? (totalDeudaPendiente / baseCalculo) : (totalDeudaPendiente > 0 ? 2 : 0);
        if (totalDeudaPendiente === 0) ptsDeuda = 25;
        else if (ratioDeuda <= 0.20) ptsDeuda = 20;
        else if (ratioDeuda <= 0.50) ptsDeuda = 15;
        else if (ratioDeuda <= 1.0) ptsDeuda = 8;
        else ptsDeuda = 0;

        // Pilar 4: Inversiones y Creación de Patrimonio (Máx 15)
        let ptsInversion = 0;
        if (totalInversiones >= (costoVidaMensual * 3) && totalInversiones > 0) ptsInversion = 15;
        else if (totalInversiones > 0) ptsInversion = 10;

        const totalScore = Math.min(100, Math.max(0, ptsAhorro + ptsFondo + ptsDeuda + ptsInversion));

        let nivelScore = 'Moderado';
        let labelScore = 'Atención Requerida';
        let colorScore = 'amber';

        if (totalScore >= 85) {
            nivelScore = 'Excelente';
            labelScore = 'Blindaje Financiero';
            colorScore = 'emerald';
        } else if (totalScore >= 65) {
            nivelScore = 'Bueno';
            labelScore = 'Saludable y Estable';
            colorScore = 'blue';
        } else if (totalScore < 45) {
            nivelScore = 'Crítico';
            labelScore = 'Vulnerable / En Alerta';
            colorScore = 'rose';
        }

        // Recomendaciones accionables para sumar puntos
        const tipsScore = [];
        if (ptsAhorro < 30) {
            tipsScore.push({
                texto: `Lleva tu tasa de ahorro al 20% recortando consumos variables`,
                puntosExtra: 30 - ptsAhorro,
                icono: 'piggy-bank'
            });
        }
        if (ptsFondo < 25) {
            tipsScore.push({
                texto: `Lleva tu colchón de liquidez a 3 meses de gastos fijos`,
                puntosExtra: 25 - ptsFondo,
                icono: 'shield-check'
            });
        }
        if (ptsDeuda < 25 && totalDeudaPendiente > 0) {
            tipsScore.push({
                texto: `Liquida tus deudas con el método Bola de Nieve para aliviar la carga`,
                puntosExtra: 25 - ptsDeuda,
                icono: 'flame'
            });
        }
        if (ptsInversion < 10) {
            tipsScore.push({
                texto: `Comienza a invertir en instrumentos de bajo riesgo o CEDEARs`,
                puntosExtra: 10 - ptsInversion,
                icono: 'trending-up'
            });
        }

        res.json({
            scoreSalud: {
                total: totalScore,
                nivel: nivelScore,
                label: labelScore,
                color: colorScore,
                pilares: {
                    ahorro: { puntos: ptsAhorro, max: 30, pct: Math.round((ptsAhorro / 30) * 100) },
                    fondo: { puntos: ptsFondo, max: 30, pct: Math.round((ptsFondo / 30) * 100) },
                    deuda: { puntos: ptsDeuda, max: 25, pct: Math.round((ptsDeuda / 25) * 100) },
                    inversion: { puntos: ptsInversion, max: 15, pct: Math.round((ptsInversion / 15) * 100) }
                },
                tips: tipsScore
            },
            regla503020: {
                baseCalculo,
                ingresosMes,
                necesidades: { monto: necesidadesMonto, pct: pctNecesidades, idealPct: 50 },
                deseos: { monto: deseosMonto, pct: pctDeseos, idealPct: 30 },
                ahorro: { monto: montoAhorroEstimado, pct: pctAhorro, idealPct: 20 },
                estado: pctNecesidades <= 50 && pctDeseos <= 30 ? 'saludable' : (pctNecesidades > 65 ? 'ajustado' : 'atencion')
            },
            fondoEmergencia: {
                saldoLiquidoActual: saldoTotal,
                costoVidaMensual,
                mesesCubiertos: Number(mesesFondoCubiertos.toFixed(1)),
                meta3Meses: metaFondoMinimo,
                meta6Meses: metaFondoOptimo,
                progreso3MesesPct: Math.min(100, Math.round((saldoTotal / (metaFondoMinimo || 1)) * 100)),
                nivel: mesesFondoCubiertos >= 6 ? 'Excelente' : (mesesFondoCubiertos >= 3 ? 'Aceptable' : (mesesFondoCubiertos >= 1 ? 'Vulnerable' : 'Crítico'))
            },
            metodosDeuda: {
                totalDeudaPendiente,
                cantidadDeudas: deudasPendientes.length,
                todasDeudas: deudasPendientes,
                estrategias: estrategiasCatalogo,
                bolaDeNieve: bolaDeNieve.slice(0, 5),
                avalancha: avalancha.slice(0, 5),
                flujoCaja: flujoCaja.slice(0, 5),
                tsunami: tsunami.slice(0, 5),
                proximoObjetivoBolaNieve: bolaDeNieve[0] || null
            },
            totalInversiones
        });
    } catch (error) {
        console.error('Error al generar diagnóstico educativo:', error);
        res.status(500).json({ error: 'Error al calcular diagnóstico financiero' });
    }
});

// ==========================================
// 7. METAS DE AHORRO ("CAJITAS / POCKETS")
// ==========================================

router.get('/metas', (req, res) => {
    try {
        const userId = req.user.id;
        const metas = db.prepare(`
            SELECT m.*, c.nombre as cuenta_nombre, c.saldo as cuenta_saldo
            FROM metas_ahorro m
            LEFT JOIN cuentas_bancarias c ON m.cuenta_id = c.id
            WHERE m.usuario_id = ?
            ORDER BY m.creado_en DESC
        `).all(userId);

        const calculadas = metas.map(m => {
            const progreso = m.monto_objetivo > 0 ? Math.min(100, Math.round((m.monto_actual / m.monto_objetivo) * 100)) : 0;
            return {
                ...m,
                progreso,
                completada: m.monto_actual >= m.monto_objetivo
            };
        });

        res.json(calculadas);
    } catch (error) {
        console.error('Error al listar metas:', error);
        res.status(500).json({ error: 'Error al obtener metas de ahorro' });
    }
});

router.post('/metas', (req, res) => {
    try {
        const userId = req.user.id;
        const { nombre, icono, monto_objetivo, monto_actual, fecha_limite, cuenta_id, color } = req.body;

        if (!nombre || !monto_objetivo || Number(monto_objetivo) <= 0) {
            return res.status(400).json({ error: 'Nombre y monto objetivo válido son requeridos' });
        }

        const info = db.prepare(`
            INSERT INTO metas_ahorro (usuario_id, nombre, icono, monto_objetivo, monto_actual, fecha_limite, cuenta_id, color)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            nombre.trim(),
            icono || 'target',
            Number(monto_objetivo),
            Number(monto_actual) || 0,
            fecha_limite || null,
            cuenta_id ? Number(cuenta_id) : null,
            color || 'emerald'
        );

        res.status(201).json({ id: info.lastInsertRowid, message: 'Meta de ahorro creada con éxito' });
    } catch (error) {
        console.error('Error al crear meta:', error);
        res.status(500).json({ error: 'Error al registrar meta de ahorro' });
    }
});

router.post('/metas/:id/aportar', (req, res) => {
    try {
        const userId = req.user.id;
        const metaId = req.params.id;
        const { monto_aporte, monto: montoDirecto, cuenta_id } = req.body;

        const monto = Number(monto_aporte || montoDirecto);
        if (!monto || monto <= 0) {
            return res.status(400).json({ error: 'Monto de aporte inválido' });
        }

        const meta = db.prepare(`SELECT * FROM metas_ahorro WHERE id = ? AND usuario_id = ?`).get(metaId, userId);
        if (!meta) {
            return res.status(404).json({ error: 'Meta no encontrada' });
        }

        const trans = db.transaction(() => {
            const cId = cuenta_id || meta.cuenta_id;
            if (cId) {
                const cuenta = db.prepare(`SELECT * FROM cuentas_bancarias WHERE id = ? AND usuario_id = ?`).get(cId, userId);
                if (!cuenta) throw new Error('Cuenta bancaria no encontrada');
                if (cuenta.saldo < monto) throw new Error(`Saldo insuficiente en ${cuenta.nombre} (disponible: $${cuenta.saldo})`);

                db.prepare(`UPDATE cuentas_bancarias SET saldo = saldo - ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ?`).run(monto, cId, userId);
            }

            db.prepare(`UPDATE metas_ahorro SET monto_actual = monto_actual + ? WHERE id = ? AND usuario_id = ?`).run(monto, metaId, userId);
        });

        trans();

        const updated = db.prepare(`SELECT * FROM metas_ahorro WHERE id = ? AND usuario_id = ?`).get(metaId, userId);
        res.json({ message: 'Aporte registrado con éxito', meta: updated });
    } catch (error) {
        console.error('Error al aportar a meta:', error);
        res.status(400).json({ error: error.message || 'Error al procesar aporte a la meta' });
    }
});

router.delete('/metas/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const metaId = req.params.id;
        db.prepare(`DELETE FROM metas_ahorro WHERE id = ? AND usuario_id = ?`).run(metaId, userId);
        res.json({ message: 'Meta eliminada con éxito' });
    } catch (error) {
        console.error('Error al eliminar meta:', error);
        res.status(500).json({ error: 'Error al eliminar meta de ahorro' });
    }
});

// ==========================================
// 8. PRESUPUESTOS MÁXIMOS POR CATEGORÍA
// ==========================================

router.get('/presupuestos', (req, res) => {
    try {
        const userId = req.user.id;
        const currentMonth = req.query.mes || new Date().toISOString().slice(0, 7);

        const presupuestos = db.prepare(`
            SELECT * FROM presupuestos
            WHERE usuario_id = ? AND mes = ?
        `).all(userId, currentMonth);

        const gastos = db.prepare(`
            SELECT categoria, SUM(monto) as total
            FROM gastos
            WHERE usuario_id = ?
            GROUP BY categoria
        `).all(userId);

        const gastosPorCat = {};
        gastos.forEach(g => {
            gastosPorCat[g.categoria] = g.total;
        });

        const categoriasDefecto = ['operativo', 'credito', 'impuesto'];
        const mapaPresupuestos = {};
        presupuestos.forEach(p => {
            mapaPresupuestos[p.categoria] = p;
        });

        const resultado = categoriasDefecto.map(cat => {
            const pres = mapaPresupuestos[cat] || null;
            const limite = pres ? pres.monto_limite : 0;
            const gastado = gastosPorCat[cat] || 0;
            const restante = Math.max(0, limite - gastado);
            const porcentaje = limite > 0 ? Math.round((gastado / limite) * 100) : 0;

            let estado = 'sin_limite';
            if (limite > 0) {
                if (porcentaje >= 100) estado = 'excedido';
                else if (porcentaje >= 75) estado = 'alerta';
                else estado = 'optimo';
            }

            return {
                id: pres ? pres.id : null,
                categoria: cat,
                mes: currentMonth,
                limite,
                gastado,
                restante,
                porcentaje,
                estado
            };
        });

        res.json({
            mes: currentMonth,
            presupuestos: resultado
        });
    } catch (error) {
        console.error('Error al obtener presupuestos:', error);
        res.status(500).json({ error: 'Error al consultar presupuestos' });
    }
});

router.post('/presupuestos', (req, res) => {
    try {
        const userId = req.user.id;
        const { categoria, monto_limite, mes } = req.body;

        if (!categoria || !monto_limite || Number(monto_limite) <= 0) {
            return res.status(400).json({ error: 'Categoría y monto límite válidos son requeridos' });
        }

        const targetMes = mes || new Date().toISOString().slice(0, 7);

        db.prepare(`
            INSERT INTO presupuestos (usuario_id, categoria, monto_limite, mes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(usuario_id, categoria, mes) 
            DO UPDATE SET monto_limite = excluded.monto_limite
        `).run(userId, categoria, Number(monto_limite), targetMes);

        res.json({ message: 'Presupuesto configurado con éxito' });
    } catch (error) {
        console.error('Error al guardar presupuesto:', error);
        res.status(500).json({ error: 'Error al guardar presupuesto' });
    }
});

router.delete('/presupuestos/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const presId = req.params.id;
        db.prepare(`DELETE FROM presupuestos WHERE id = ? AND usuario_id = ?`).run(presId, userId);
        res.json({ message: 'Presupuesto eliminado con éxito' });
    } catch (error) {
        console.error('Error al eliminar presupuesto:', error);
        res.status(500).json({ error: 'Error al eliminar presupuesto' });
    }
});

// ==========================================
// 9. MÉTRICA NEGOCIOS & FREELANCERS
// ==========================================

// Escalas vigentes de Monotributo Argentina (AFIP / ARCA) - Vigencia desde 01/08/2026
const ESCALAS_MONOTRIBUTO = {
    A: 12009410.45,
    B: 17595182.74,
    C: 24670494.31,
    D: 30628651.43,
    E: 36028231.33,
    F: 45151659.41,
    G: 53995798.87,
    H: 81924660.37,
    I: 91699761.90,
    J: 105012519.20,
    K: 126610638.75
};

/**
 * Middleware para validar acceso a módulos según Free Trial (15 días), Plan contratado o Rol Administrador
 */
function verificarAccesoPlan(modulo) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) return res.status(401).json({ error: 'No autorizado' });

        // Administrador: acceso total siempre
        if (user.rol === 'admin' || user.plan_suscripcion === 'admin') {
            return next();
        }

        // Free Trial activo (primeros 15 días): acceso total a todo
        if (user.trial && user.trial.activo) {
            return next();
        }

        // Si el trial expiró, validar el plan contratado
        const plan = user.plan_suscripcion || 'free';
        if (modulo === 'negocio' && (plan === 'pro_negocios' || plan === 'contador_partner')) {
            return next();
        }
        if (modulo === 'contador' && plan === 'contador_partner') {
            return next();
        }
        if (modulo === 'ia' && plan !== 'free') {
            return next();
        }

        return res.status(403).json({
            error: 'Tu período de prueba de 15 días ha finalizado. Suscríbete a un plan para continuar.',
            codigo: 'TRIAL_EXPIRADO',
            moduloRequerido: modulo
        });
    };
}

// Proteger rutas de Negocios
router.use('/negocio', verificarAccesoPlan('negocio'));

// Resumen General del Negocio
router.get('/negocio/resumen', (req, res) => {

    try {
        const userId = req.user.id;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const hoy = new Date().toISOString().slice(0, 10);

        // Facturación cobrada en el mes actual (pesos y dólares)
        const cobrosMes = db.prepare(`
            SELECT moneda, SUM(monto) as total
            FROM facturas_clientes
            WHERE usuario_id = ? AND estado = 'cobrado' AND strftime('%Y-%m', fecha_cobro) = ?
            GROUP BY moneda
        `).all(userId, currentMonth);

        let facturadoMesARS = 0;
        let facturadoMesUSD = 0;
        cobrosMes.forEach(c => {
            if (c.moneda === 'USD') facturadoMesUSD += c.total;
            else facturadoMesARS += c.total;
        });

        // Cuentas por cobrar (Facturas pendientes)
        const pendientes = db.prepare(`
            SELECT moneda, SUM(monto) as total, COUNT(id) as count
            FROM facturas_clientes
            WHERE usuario_id = ? AND estado = 'pendiente'
            GROUP BY moneda
        `).all(userId);

        let porCobrarARS = 0;
        let porCobrarUSD = 0;
        let facturasPendientesCount = 0;
        pendientes.forEach(p => {
            if (p.moneda === 'USD') porCobrarUSD += p.total;
            else porCobrarARS += p.total;
            facturasPendientesCount += p.count;
        });

        // Facturas vencidas impagas
        const vencidasCount = db.prepare(`
            SELECT COUNT(id) as count
            FROM facturas_clientes
            WHERE usuario_id = ? AND estado = 'pendiente' AND fecha_vencimiento < ?
        `).get(userId, hoy).count;

        // Proyectos activos
        const proyectosActivos = db.prepare(`
            SELECT COUNT(id) as count
            FROM proyectos_negocio
            WHERE usuario_id = ? AND estado = 'en_progreso'
        `).get(userId).count;

        // Total clientes
        const clientesCount = db.prepare(`
            SELECT COUNT(id) as count
            FROM clientes
            WHERE usuario_id = ?
        `).get(userId).count;

        // Costos operativos del negocio en el mes actual (gastos de categoría operativo)
        const costosMes = db.prepare(`
            SELECT SUM(monto) as total
            FROM gastos
            WHERE usuario_id = ? AND categoria = 'operativo'
        `).get(userId).total || 0;

        // Monotributo: Facturación total cobrada últimos 12 meses
        const fechaHace12Meses = new Date();
        fechaHace12Meses.setFullYear(fechaHace12Meses.getFullYear() - 1);
        const str12Meses = fechaHace12Meses.toISOString().slice(0, 10);

        const facturacion12Meses = db.prepare(`
            SELECT SUM(monto) as total
            FROM facturas_clientes
            WHERE usuario_id = ? AND estado = 'cobrado' AND fecha_cobro >= ?
        `).get(userId, str12Meses).total || 0;

        // Configuración de monotributo del usuario
        let config = db.prepare(`SELECT * FROM configuracion_negocio WHERE usuario_id = ?`).get(userId);
        if (!config) {
            config = {
                categoria_monotributo: 'E',
                tipo_actividad: 'servicios',
                limite_anual: ESCALAS_MONOTRIBUTO['E'], // $36.028.231,33
                sueldo_dueno_objetivo: 1200000
            };
        }

        const topeCategoria = ESCALAS_MONOTRIBUTO[config.categoria_monotributo] || ESCALAS_MONOTRIBUTO['E'];

        const porcentajeMonotributo = topeCategoria > 0 ? Math.min(100, Math.round((facturacion12Meses / topeCategoria) * 100)) : 0;

        // Margen y Ganancia neta estimada
        const gananciaNetaEstimadaARS = Math.max(0, facturadoMesARS - costosMes);
        const margenNetoPorcentaje = facturadoMesARS > 0 ? Math.round((gananciaNetaEstimadaARS / facturadoMesARS) * 100) : 0;

        res.json({
            facturadoMesARS,
            facturadoMesUSD,
            porCobrarARS,
            porCobrarUSD,
            facturasPendientesCount,
            vencidasCount,
            proyectosActivos,
            clientesCount,
            costosOperativosMes: costosMes,
            gananciaNetaEstimadaARS,
            margenNetoPorcentaje,
            monotributo: {
                categoria: config.categoria_monotributo,
                tipo_actividad: config.tipo_actividad,
                facturacion12Meses,
                topeCategoria,
                porcentajeConsumido: porcentajeMonotributo,
                sueldoDuenoObjetivo: config.sueldo_dueno_objetivo || 0
            }
        });
    } catch (error) {
        console.error('Error al obtener resumen de negocio:', error);
        res.status(500).json({ error: 'Error al consultar resumen comercial' });
    }
});

// CLIENTES
router.get('/negocio/clientes', (req, res) => {
    try {
        const userId = req.user.id;
        const clientes = db.prepare(`
            SELECT c.*,
                   COUNT(f.id) as total_facturas,
                   COALESCE(SUM(CASE WHEN f.estado = 'pendiente' THEN f.monto ELSE 0 END), 0) as saldo_pendiente
            FROM clientes c
            LEFT JOIN facturas_clientes f ON f.cliente_id = c.id
            WHERE c.usuario_id = ?
            GROUP BY c.id
            ORDER BY c.creado_en DESC
        `).all(userId);
        res.json(clientes);
    } catch (error) {
        console.error('Error al obtener clientes:', error);
        res.status(500).json({ error: 'Error al consultar clientes' });
    }
});

router.post('/negocio/clientes', (req, res) => {
    try {
        const userId = req.user.id;
        const { nombre, empresa, email, telefono, cuit, condicion_fiscal, notas } = req.body;
        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'El nombre del cliente o contacto es requerido' });
        }

        const stmt = db.prepare(`
            INSERT INTO clientes (usuario_id, nombre, empresa, email, telefono, cuit, condicion_fiscal, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
            userId,
            nombre.trim(),
            empresa ? empresa.trim() : null,
            email ? email.trim() : null,
            telefono ? telefono.trim() : null,
            cuit ? cuit.trim() : null,
            condicion_fiscal || 'Consumidor Final',
            notas || null
        );

        const nuevoCliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json(nuevoCliente);
    } catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ error: 'Error al registrar cliente' });
    }
});

router.delete('/negocio/clientes/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const clienteId = req.params.id;
        const info = db.prepare('DELETE FROM clientes WHERE id = ? AND usuario_id = ?').run(clienteId, userId);
        if (info.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json({ message: 'Cliente eliminado con éxito' });
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

// FACTURAS Y CUENTAS POR COBRAR
router.get('/negocio/facturas', (req, res) => {
    try {
        const userId = req.user.id;
        const estadoFiltro = req.query.estado;

        let query = `
            SELECT f.*, c.nombre as cliente_nombre, c.empresa as cliente_empresa
            FROM facturas_clientes f
            LEFT JOIN clientes c ON f.cliente_id = c.id
            WHERE f.usuario_id = ?
        `;
        const params = [userId];

        if (estadoFiltro) {
            query += ` AND f.estado = ?`;
            params.push(estadoFiltro);
        }

        query += ` ORDER BY f.fecha_emision DESC`;
        const facturas = db.prepare(query).all(...params);
        res.json(facturas);
    } catch (error) {
        console.error('Error al obtener facturas:', error);
        res.status(500).json({ error: 'Error al consultar facturas' });
    }
});

router.post('/negocio/facturas', (req, res) => {
    try {
        const userId = req.user.id;
        const { cliente_id, numero_factura, descripcion, monto, moneda = 'ARS', fecha_emision, fecha_vencimiento, estado = 'pendiente', detalles } = req.body;

        if (!descripcion || !monto || Number(monto) <= 0) {
            return res.status(400).json({ error: 'Descripción y monto válido son requeridos' });
        }

        const hoy = new Date().toISOString().slice(0, 10);
        const stmt = db.prepare(`
            INSERT INTO facturas_clientes 
            (usuario_id, cliente_id, numero_factura, descripcion, monto, moneda, fecha_emision, fecha_vencimiento, estado, detalles)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(
            userId,
            cliente_id ? parseInt(cliente_id, 10) : null,
            numero_factura ? numero_factura.trim() : `FC-${Date.now().toString().slice(-6)}`,
            descripcion.trim(),
            Number(monto),
            moneda,
            fecha_emision || hoy,
            fecha_vencimiento || null,
            estado,
            detalles || null
        );

        const nueva = db.prepare(`
            SELECT f.*, c.nombre as cliente_nombre, c.empresa as cliente_empresa
            FROM facturas_clientes f
            LEFT JOIN clientes c ON f.cliente_id = c.id
            WHERE f.id = ?
        `).get(info.lastInsertRowid);

        res.status(201).json(nueva);
    } catch (error) {
        console.error('Error al crear factura:', error);
        res.status(500).json({ error: 'Error al registrar factura comercial' });
    }
});

router.put('/negocio/facturas/:id/cobrar', (req, res) => {
    try {
        const userId = req.user.id;
        const facturaId = req.params.id;
        const { cuenta_id } = req.body;
        const hoy = new Date().toISOString().slice(0, 10);

        const factura = db.prepare('SELECT * FROM facturas_clientes WHERE id = ? AND usuario_id = ?').get(facturaId, userId);
        if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

        const tx = db.transaction(() => {
            // Marcar factura como cobrada
            db.prepare(`
                UPDATE facturas_clientes
                SET estado = 'cobrado', fecha_cobro = ?
                WHERE id = ? AND usuario_id = ?
            `).run(hoy, facturaId, userId);

            // Si el usuario eligió depositar el cobro en una cuenta bancaria existente
            if (cuenta_id) {
                db.prepare(`
                    UPDATE cuentas_bancarias
                    SET saldo = saldo + ?, actualizado_en = CURRENT_TIMESTAMP
                    WHERE id = ? AND usuario_id = ?
                `).run(factura.monto, cuenta_id, userId);
            }
        });

        tx();

        const actualizada = db.prepare(`
            SELECT f.*, c.nombre as cliente_nombre, c.empresa as cliente_empresa
            FROM facturas_clientes f
            LEFT JOIN clientes c ON f.cliente_id = c.id
            WHERE f.id = ?
        `).get(facturaId);

        res.json({ message: 'Cobro registrado exitosamente', factura: actualizada });
    } catch (error) {
        console.error('Error al marcar factura cobrada:', error);
        res.status(500).json({ error: 'Error al registrar cobro de factura' });
    }
});

router.delete('/negocio/facturas/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const facturaId = req.params.id;
        const info = db.prepare('DELETE FROM facturas_clientes WHERE id = ? AND usuario_id = ?').run(facturaId, userId);
        if (info.changes === 0) return res.status(404).json({ error: 'Factura no encontrada' });
        res.json({ message: 'Factura eliminada con éxito' });
    } catch (error) {
        console.error('Error al eliminar factura:', error);
        res.status(500).json({ error: 'Error al eliminar factura' });
    }
});

// PROYECTOS Y RENTABILIDAD
router.get('/negocio/proyectos', (req, res) => {
    try {
        const userId = req.user.id;
        const proyectos = db.prepare(`
            SELECT p.*, c.nombre as cliente_nombre, c.empresa as cliente_empresa
            FROM proyectos_negocio p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.usuario_id = ?
            ORDER BY p.creado_en DESC
        `).all(userId);
        res.json(proyectos);
    } catch (error) {
        console.error('Error al obtener proyectos:', error);
        res.status(500).json({ error: 'Error al consultar proyectos' });
    }
});

router.post('/negocio/proyectos', (req, res) => {
    try {
        const userId = req.user.id;
        const { cliente_id, nombre, descripcion, monto_pactado, moneda = 'ARS', costos_estimados = 0, estado = 'en_progreso', fecha_entrega } = req.body;

        if (!nombre || !monto_pactado || Number(monto_pactado) <= 0) {
            return res.status(400).json({ error: 'Nombre del proyecto y monto pactado son requeridos' });
        }

        const stmt = db.prepare(`
            INSERT INTO proyectos_negocio 
            (usuario_id, cliente_id, nombre, descripcion, monto_pactado, moneda, costos_estimados, estado, fecha_entrega)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(
            userId,
            cliente_id ? parseInt(cliente_id, 10) : null,
            nombre.trim(),
            descripcion || null,
            Number(monto_pactado),
            moneda,
            Number(costos_estimados) || 0,
            estado,
            fecha_entrega || null
        );

        const nuevo = db.prepare(`
            SELECT p.*, c.nombre as cliente_nombre, c.empresa as cliente_empresa
            FROM proyectos_negocio p
            LEFT JOIN clientes c ON p.cliente_id = c.id
            WHERE p.id = ?
        `).get(info.lastInsertRowid);

        res.status(201).json(nuevo);
    } catch (error) {
        console.error('Error al crear proyecto:', error);
        res.status(500).json({ error: 'Error al registrar proyecto' });
    }
});

router.delete('/negocio/proyectos/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const proyectoId = req.params.id;
        const info = db.prepare('DELETE FROM proyectos_negocio WHERE id = ? AND usuario_id = ?').run(proyectoId, userId);
        if (info.changes === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
        res.json({ message: 'Proyecto eliminado con éxito' });
    } catch (error) {
        console.error('Error al eliminar proyecto:', error);
        res.status(500).json({ error: 'Error al eliminar proyecto' });
    }
});

// CONFIGURACIÓN DE MONOTRIBUTO
router.get('/negocio/monotributo', (req, res) => {
    try {
        const userId = req.user.id;
        let config = db.prepare('SELECT * FROM configuracion_negocio WHERE usuario_id = ?').get(userId);
        if (!config) {
            config = {
                categoria_monotributo: 'E',
                tipo_actividad: 'servicios',
                limite_anual: ESCALAS_MONOTRIBUTO['E'],
                sueldo_dueno_objetivo: 1200000
            };
        }
        // Monotributo: Facturación total cobrada últimos 12 meses
        const fechaHace12Meses = new Date();
        fechaHace12Meses.setFullYear(fechaHace12Meses.getFullYear() - 1);
        const str12Meses = fechaHace12Meses.toISOString().slice(0, 10);

        const facturado12Meses = db.prepare(`
            SELECT SUM(monto) as total
            FROM facturas_clientes
            WHERE usuario_id = ? AND estado = 'cobrado' AND fecha_cobro >= ?
        `).get(userId, str12Meses).total || 0;

        const limiteAnual = ESCALAS_MONOTRIBUTO[config.categoria_monotributo] || ESCALAS_MONOTRIBUTO['E'];
        const porcentajeConsumido = limiteAnual > 0 ? Math.min(100, Math.round((facturado12Meses / limiteAnual) * 100)) : 0;
        const margenRestante = Math.max(0, limiteAnual - facturado12Meses);


        res.json({
            config,
            escalas: ESCALAS_MONOTRIBUTO,
            facturado12Meses,
            limiteAnual,
            porcentajeConsumido,
            margenRestante
        });
    } catch (error) {
        console.error('Error al consultar configuración de monotributo:', error);
        res.status(500).json({ error: 'Error al consultar monotributo' });
    }
});

router.post('/negocio/monotributo', (req, res) => {
    try {
        const userId = req.user.id;
        const { categoria_monotributo = 'E', tipo_actividad = 'servicios', sueldo_dueno_objetivo = 0 } = req.body;
        const cat = categoria_monotributo.toUpperCase();
        const limite = ESCALAS_MONOTRIBUTO[cat] || ESCALAS_MONOTRIBUTO['E'];

        db.prepare(`
            INSERT INTO configuracion_negocio (usuario_id, categoria_monotributo, tipo_actividad, limite_anual, sueldo_dueno_objetivo, actualizado_en)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(usuario_id) DO UPDATE SET
                categoria_monotributo = excluded.categoria_monotributo,
                tipo_actividad = excluded.tipo_actividad,
                limite_anual = excluded.limite_anual,
                sueldo_dueno_objetivo = excluded.sueldo_dueno_objetivo,
                actualizado_en = CURRENT_TIMESTAMP
        `).run(userId, cat, tipo_actividad, limite, Number(sueldo_dueno_objetivo));

        res.json({ message: 'Configuración fiscal actualizada', categoria: cat, limite });
    } catch (error) {
        console.error('Error al guardar configuración de monotributo:', error);
        res.status(500).json({ error: 'Error al actualizar monotributo' });
    }
});

// ==========================================
// SUSCRIPCIÓN & UPGRADE DE PLAN
// ==========================================

router.post('/subscription/upgrade', (req, res) => {
    try {
        const userId = req.user.id;
        const { plan = 'pro_personal' } = req.body;
        const planesValidos = ['free', 'pro_personal', 'pro_negocios', 'contador_partner'];
        if (!planesValidos.includes(plan)) {
            return res.status(400).json({ error: 'Plan inválido' });
        }

        db.prepare('UPDATE usuarios SET plan_suscripcion = ? WHERE id = ?').run(plan, userId);
        const userActualizado = db.prepare('SELECT id, email, nombre, avatar_url, plan_suscripcion FROM usuarios WHERE id = ?').get(userId);

        res.json({
            ok: true,
            mensaje: `¡Plan ${plan.toUpperCase().replace('_', ' ')} activado con éxito!`,
            user: userActualizado
        });
    } catch (error) {
        console.error('Error al actualizar suscripción:', error);
        res.status(500).json({ error: 'Error al procesar suscripción' });
    }
});

// ==========================================
// SECCIÓN 2: MÉTRICA CONTADOR PARTNER B2B (CONDICIÓN 2 TERM SHEET)
// ==========================================

router.use('/contador', verificarAccesoPlan('contador'));

router.get('/contador/resumen', (req, res) => {

    try {
        const userId = req.user.id;
        const clientes = db.prepare(`
            SELECT * FROM contador_clientes 
            WHERE contador_usuario_id = ?
            ORDER BY facturacion_acumulada_12m DESC
        `).all(userId);

        let totalClientes = clientes.length;
        let facturacionGlobal12M = 0;
        let clientesCriticos = 0;
        let clientesPrecaucion = 0;
        let clientesSeguros = 0;
        let clientesRiesgoExclusion = 0;

        clientes.forEach(c => {
            const fact = Number(c.facturacion_acumulada_12m) || 0;
            facturacionGlobal12M += fact;
            const cat = (c.categoria_monotributo || 'E').toUpperCase();
            const tope = ESCALAS_MONOTRIBUTO[cat] || ESCALAS_MONOTRIBUTO['E'];
            const pct = tope > 0 ? (fact / tope) * 100 : 0;

            if (pct >= 90) {
                clientesCriticos++;
                if (cat === 'K') {
                    clientesRiesgoExclusion++;
                }
            } else if (pct >= 70) {
                clientesPrecaucion++;
            } else {
                clientesSeguros++;
            }
        });

        res.json({
            totalClientes,
            facturacionGlobal12M,
            clientesCriticos,
            clientesPrecaucion,
            clientesSeguros,
            clientesRiesgoExclusion,
            hitoCumplido: totalClientes >= 15
        });
    } catch (error) {
        console.error('Error al obtener resumen de contador:', error);
        res.status(500).json({ error: 'Error al consultar resumen de estudio contable' });
    }
});

router.get('/contador/clientes', (req, res) => {
    try {
        const userId = req.user.id;
        const clientes = db.prepare(`
            SELECT * FROM contador_clientes 
            WHERE contador_usuario_id = ?
            ORDER BY facturacion_acumulada_12m DESC
        `).all(userId);

        const listadoConMetricas = clientes.map(c => {
            const cat = (c.categoria_monotributo || 'E').toUpperCase();
            const tope = ESCALAS_MONOTRIBUTO[cat] || ESCALAS_MONOTRIBUTO['E'];
            const fact = Number(c.facturacion_acumulada_12m) || 0;
            const pct = tope > 0 ? Math.min(100, Math.round((fact / tope) * 100)) : 0;
            const restante = Math.max(0, tope - fact);

            let estadoAlerta = 'seguro';
            let proyeccion = 'Mantiene Categoría';

            if (pct >= 90) {
                estadoAlerta = 'critico';
                if (cat === 'K') {
                    proyeccion = '¡Riesgo Exclusión al Régimen General!';
                } else {
                    proyeccion = 'Sube de Categoría en Recategorización';
                }
            } else if (pct >= 70) {
                estadoAlerta = 'precaucion';
                proyeccion = 'Zona de Alerta Preventiva';
            } else if (pct < 35 && cat !== 'A') {
                proyeccion = 'Posible Baja de Categoría';
            }

            return {
                ...c,
                topeCategoria: tope,
                porcentajeConsumido: pct,
                margenRestante: restante,
                estadoAlerta,
                proyeccion
            };
        });

        res.json({ clientes: listadoConMetricas, total: listadoConMetricas.length });
    } catch (error) {
        console.error('Error al listar clientes de contador:', error);
        res.status(500).json({ error: 'Error al consultar clientes del estudio' });
    }
});

router.post('/contador/clientes', (req, res) => {
    try {
        const userId = req.user.id;
        const {
            nombre_titular,
            cuit,
            categoria_monotributo = 'E',
            tipo_actividad = 'servicios',
            facturacion_acumulada_12m = 0,
            email_contacto = '',
            telefono = '',
            notas = ''
        } = req.body;

        if (!nombre_titular || !cuit) {
            return res.status(400).json({ error: 'Nombre del titular y CUIT son requeridos' });
        }

        const cat = categoria_monotributo.toUpperCase();
        const info = db.prepare(`
            INSERT INTO contador_clientes 
            (contador_usuario_id, nombre_titular, cuit, categoria_monotributo, tipo_actividad, facturacion_acumulada_12m, email_contacto, telefono, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            nombre_titular.trim(),
            cuit.trim(),
            cat,
            tipo_actividad,
            Number(facturacion_acumulada_12m) || 0,
            email_contacto.trim(),
            telefono.trim(),
            notas.trim()
        );

        const nuevoCliente = db.prepare('SELECT * FROM contador_clientes WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json({ ok: true, cliente: nuevoCliente });
    } catch (error) {
        console.error('Error al agregar cliente de contador:', error);
        res.status(500).json({ error: 'Error al registrar cliente tributario' });
    }
});

router.delete('/contador/clientes/:id', (req, res) => {
    try {
        const userId = req.user.id;
        const clienteId = req.params.id;

        const info = db.prepare('DELETE FROM contador_clientes WHERE id = ? AND contador_usuario_id = ?').run(clienteId, userId);
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado o no pertenece a este estudio' });
        }

        res.json({ ok: true, message: 'Cliente eliminado del panel del estudio' });
    } catch (error) {
        console.error('Error al eliminar cliente de contador:', error);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

router.get('/contador/exportar', (req, res) => {
    try {
        const userId = req.user.id;
        const clientes = db.prepare(`
            SELECT * FROM contador_clientes 
            WHERE contador_usuario_id = ?
            ORDER BY facturacion_acumulada_12m DESC
        `).all(userId);

        let csv = 'Titular,CUIT,Categoria Monotributo,Actividad,Facturacion 12 Meses (ARS),Tope Categoria (ARS),% Consumido,Margen Libre (ARS),Estado Alerta,Email,Telefono,Notas\n';

        clientes.forEach(c => {
            const cat = (c.categoria_monotributo || 'E').toUpperCase();
            const tope = ESCALAS_MONOTRIBUTO[cat] || ESCALAS_MONOTRIBUTO['E'];
            const fact = Number(c.facturacion_acumulada_12m) || 0;
            const pct = tope > 0 ? Math.min(100, Math.round((fact / tope) * 100)) : 0;
            const restante = Math.max(0, tope - fact);
            const alerta = pct >= 90 ? (cat === 'K' ? 'CRITICO - RIESGO EXCLUSION' : 'CRITICO - SUBE CATEGORIA') : (pct >= 70 ? 'PRECAUCION' : 'SEGURO');

            const row = [
                `"${(c.nombre_titular || '').replace(/"/g, '""')}"`,
                `"${c.cuit || ''}"`,
                `"Cat. ${cat}"`,
                `"${c.tipo_actividad === 'bienes' ? 'Venta de Bienes' : 'Servicios'}"`,
                fact,
                tope,
                `${pct}%`,
                restante,
                `"${alerta}"`,
                `"${c.email_contacto || ''}"`,
                `"${c.telefono || ''}"`,
                `"${(c.notas || '').replace(/"/g, '""')}"`
            ];
            csv += row.join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="metrica_reporte_monotributo_estudio.csv"');
        res.send(csv);
    } catch (error) {
        console.error('Error exportando reporte de contador:', error);
        res.status(500).json({ error: 'Error al exportar reporte contable' });
    }
});

router.post('/contador/invitar', (req, res) => {
    try {
        const { email, nombre_titular } = req.body;
        const code = Math.random().toString(36).substring(2, 9).toUpperCase();
        const inviteLink = `https://metrica.ar/join?partner=estudio_demo&code=${code}&email=${encodeURIComponent(email || '')}`;

        res.json({
            ok: true,
            code,
            inviteLink,
            mensaje: `Enlace de invitación generado para ${nombre_titular || 'cliente'}. Permite al usuario conectar sus comprobantes al estudio contable de forma automática.`
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al generar invitación' });
    }
});

module.exports = router;

