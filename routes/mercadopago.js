const express = require('express');
const router = express.Router();
const { MercadoPagoConfig, PreApproval, Preference, Payment } = require('mercadopago');
const { authMiddleware } = require('./auth');
const { db } = require('../db/database');

// Configuración de catálogo de planes
const PLANES_CONFIG = {
    pro_personal: {
        nombre: 'Métrica Pro Personal',
        usd: 3.50,
        descripcion: 'Copiloto Financiero IA, escaneo OCR y finanzas personales avanzadas.'
    },
    pro_negocios: {
        nombre: 'Métrica Negocios & Freelancers',
        usd: 10.00,
        descripcion: 'Gestión comercial, clientes, facturación y control de Monotributo.'
    },
    contador_partner: {
        nombre: 'Métrica Contador Partner',
        usd: 35.00,
        descripcion: 'Panel B2B para estudios contables, multicliente y reportes fiscales.'
    }
};

/**
 * Obtiene el tipo de cambio Dólar MEP oficial en tiempo real
 */
async function obtenerCotizacionMEP() {
    let tipoCambioMEP = 1530;
    try {
        const dolRes = await fetch('https://dolarapi.com/v1/dolares/bolsa');
        if (dolRes.ok) {
            const dolData = await dolRes.json();
            tipoCambioMEP = dolData.venta || tipoCambioMEP;
        }
    } catch (e) {
        console.warn('MercadoPago: Usando cotización MEP de resguardo');
    }
    return tipoCambioMEP;
}

/**
 * Inicializa el cliente de Mercado Pago si existe token
 */
function getMPClient() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token || token.trim() === '' || token === 'TU_MERCADOPAGO_ACCESS_TOKEN') {
        return null;
    }
    return new MercadoPagoConfig({ accessToken: token.trim() });
}

// =======================================================
// 1. CREAR CHECKOUT DE SUSCRIPCIÓN (MENSUAL O ANUAL)
// =======================================================
router.post('/crear-checkout', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { planId, periodo = 'mensual' } = req.body;

        // Validar que el plan exista
        const plan = PLANES_CONFIG[planId];
        if (!plan) {
            return res.status(400).json({ error: 'Plan seleccionado inválido' });
        }

        // Si el usuario es el Administrador de la plataforma
        if (req.user.rol === 'admin' || req.user.plan_suscripcion === 'admin') {
            return res.json({
                admin: true,
                mensaje: 'Tu cuenta tiene rol de Administrador: disfrutas de acceso ilimitado a todos los módulos sin necesidad de abonar suscripción.'
            });
        }

        const tipoCambioMEP = await obtenerCotizacionMEP();
        const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        const mpClient = getMPClient();

        // Cálculo de importes
        const esAnual = periodo === 'anual';
        const mult = esAnual ? 0.8 : 1.0; // 20% OFF en plan anual
        const meses = esAnual ? 12 : 1;
        const precioUsd = plan.usd * mult * meses;
        const precioArs = Math.round(precioUsd * tipoCambioMEP);

        // MODO PRUEBA / LOCAL (Si no hay Access Token configurado aún)
        if (!mpClient) {
            console.warn('⚠️ MP_ACCESS_TOKEN no detectado en .env. Activando plan en modo simulación de desarrollo.');
            db.prepare(`
                UPDATE usuarios 
                SET plan_suscripcion = ?, mp_estado = 'demo_authorized', mp_periodo = ?, mp_fecha_inicio = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run(planId, periodo, userId);

            const userActualizado = db.prepare('SELECT id, email, nombre, avatar_url, plan_suscripcion, rol FROM usuarios WHERE id = ?').get(userId);

            return res.json({
                modo_simulacion: true,
                mensaje: `¡Plan ${plan.nombre} (${periodo}) activado en modo prueba local! (Para cobros reales por Mercado Pago, agrega MP_ACCESS_TOKEN al .env)`,
                user: userActualizado
            });
        }

        // ===================================================
        // MODO A: DÉBITO AUTOMÁTICO RECURRENTE (MENSUAL)
        // ===================================================
        if (!esAnual) {
            const preapproval = new PreApproval(mpClient);

            const preapprovalData = {
                reason: `${plan.nombre} - Suscripción Mensual Métrica`,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: precioArs,
                    currency_id: 'ARS'
                },
                back_url: `${appUrl}/?mp_status=approved&plan=${planId}&periodo=mensual`,
                payer_email: req.user.email,
                external_reference: `${userId}:${planId}:mensual`
            };

            const response = await preapproval.create({ body: preapprovalData });

            // Guardar registro preliminar en la base de datos
            db.prepare(`
                UPDATE usuarios 
                SET mp_preapproval_id = ?, mp_estado = 'pending', mp_periodo = 'mensual' 
                WHERE id = ?
            `).run(response.id, userId);

            return res.json({
                tipo: 'recurrente_preapproval',
                init_point: response.init_point,
                preapproval_id: response.id,
                precioArs,
                tipoCambioMEP
            });
        }

        // ===================================================
        // MODO B: CHECKOUT PRO ANUAL (20% OFF)
        // ===================================================
        const preference = new Preference(mpClient);

        const preferenceData = {
            items: [
                {
                    id: planId,
                    title: `${plan.nombre} (Plan Anual - 20% OFF)`,
                    description: `Suscripción anual a Métrica para ${req.user.email}`,
                    quantity: 1,
                    currency_id: 'ARS',
                    unit_price: precioArs
                }
            ],
            payer: {
                email: req.user.email,
                name: req.user.nombre
            },
            back_urls: {
                success: `${appUrl}/?mp_status=approved&plan=${planId}&periodo=anual`,
                pending: `${appUrl}/?mp_status=pending&plan=${planId}&periodo=anual`,
                failure: `${appUrl}/?mp_status=failure&plan=${planId}`
            },
            auto_return: 'approved',
            external_reference: `${userId}:${planId}:anual`,
            notification_url: `${appUrl}/api/mercadopago/webhook`
        };

        const response = await preference.create({ body: preferenceData });

        return res.json({
            tipo: 'checkout_pro_anual',
            init_point: response.init_point || response.sandbox_init_point,
            preference_id: response.id,
            precioArs,
            tipoCambioMEP
        });

    } catch (error) {
        console.error('Error al crear checkout de Mercado Pago:', error);
        res.status(500).json({ error: error.message || 'Error al conectar con Mercado Pago' });
    }
});

// =======================================================
// 2. WEBHOOK OFICIAL DE MERCADO PAGO
// =======================================================
router.post('/webhook', async (req, res) => {
    // Responder inmediatamente a Mercado Pago con 200 OK para evitar reintentos innecesarios
    res.status(200).send('OK');

    try {
        const mpClient = getMPClient();
        if (!mpClient) return;

        const body = req.body || {};
        const query = req.query || {};

        const type = body.type || body.topic || query.type || query.topic;
        const dataId = (body.data && body.data.id) || body.id || query['data.id'] || query.id;

        console.log(`[MercadoPago Webhook] Notificación recibida: tipo=${type}, id=${dataId}`);

        if (!dataId) return;

        // 1. EVENTO DE SUSCRIPCIÓN RECURRENTE (PREAPPROVAL)
        if (type === 'subscription_preapproval' || type === 'preapproval') {
            const preapproval = new PreApproval(mpClient);
            const sub = await preapproval.get({ id: dataId });

            if (sub && sub.external_reference) {
                const [userIdStr, planId, periodo] = sub.external_reference.split(':');
                const userId = parseInt(userIdStr, 10);
                const status = sub.status; // 'authorized', 'paused', 'cancelled', 'pending'

                console.log(`[MercadoPago Webhook] Preapproval status=${status} para usuario ID=${userId}, plan=${planId}`);

                if (status === 'authorized') {
                    db.prepare(`
                        UPDATE usuarios 
                        SET plan_suscripcion = ?, mp_preapproval_id = ?, mp_estado = 'authorized', mp_periodo = ?, mp_fecha_inicio = CURRENT_TIMESTAMP 
                        WHERE id = ? AND rol != 'admin'
                    `).run(planId, dataId, periodo || 'mensual', userId);
                } else if (status === 'cancelled' || status === 'paused') {
                    db.prepare(`
                        UPDATE usuarios 
                        SET plan_suscripcion = 'free', mp_estado = ? 
                        WHERE mp_preapproval_id = ? AND rol != 'admin'
                    `).run(status, dataId);
                }
            }
        }

        // 2. EVENTO DE PAGO REALIZADO (CHECKOUT PRO ANUAL O COBRO RECURRENTE)
        if (type === 'payment' || body.action === 'payment.created' || body.action === 'payment.updated') {
            const payment = new Payment(mpClient);
            const pay = await payment.get({ id: dataId });

            if (pay && pay.status === 'approved' && pay.external_reference) {
                const [userIdStr, planId, periodo] = pay.external_reference.split(':');
                const userId = parseInt(userIdStr, 10);

                console.log(`[MercadoPago Webhook] Pago aprobado para usuario ID=${userId}, plan=${planId}, periodo=${periodo}`);

                db.prepare(`
                    UPDATE usuarios 
                    SET plan_suscripcion = ?, mp_estado = 'approved', mp_periodo = ? 
                    WHERE id = ? AND rol != 'admin'
                `).run(planId, periodo || 'anual', userId);
            }
        }

    } catch (error) {
        console.error('Error procesando Webhook de Mercado Pago:', error.message);
    }
});

// =======================================================
// 3. CONSULTAR ESTADO DE LA SUSCRIPCIÓN DEL USUARIO
// =======================================================
router.get('/mi-suscripcion', authMiddleware, (req, res) => {
    try {
        const user = db.prepare(`
            SELECT id, email, nombre, plan_suscripcion, rol, mp_preapproval_id, mp_estado, mp_periodo, mp_fecha_inicio 
            FROM usuarios 
            WHERE id = ?
        `).get(req.user.id);

        res.json({
            ok: true,
            plan: user.plan_suscripcion,
            mp_estado: user.mp_estado,
            mp_periodo: user.mp_periodo,
            mp_fecha_inicio: user.mp_fecha_inicio,
            esAdmin: user.rol === 'admin'
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al consultar suscripción' });
    }
});

module.exports = router;
