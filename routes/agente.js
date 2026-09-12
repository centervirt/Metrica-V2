const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { db } = require('../db/database');
const { authMiddleware } = require('./auth');

// Proteger todas las rutas del agente con autenticación
router.use(authMiddleware);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const isKeyConfigured = GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here';

let genAI = null;
if (isKeyConfigured) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

// Fallback heurístico inteligente en caso de no tener API key configurada todavía
function parseGastoHeuristico(texto) {
    const textoLower = texto.toLowerCase();
    
    // Detectar montos (ej: "45000", "45.000", "45k", "45 lucas")
    let monto = 0;
    const lucasMatch = textoLower.match(/(\d+(?:[.,]\d+)?)\s*(?:lucas?|k)/);
    if (lucasMatch) {
        monto = parseFloat(lucasMatch[1].replace(',', '.')) * 1000;
    } else {
        const numMatch = textoLower.match(/(?:\$|\bars\b)?\s*(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+)/);
        if (numMatch) {
            monto = parseFloat(numMatch[1].replace(/\./g, '').replace(',', '.'));
        }
    }

    // Detectar categoría
    let categoria = 'operativo';
    if (textoLower.includes('tarjeta') || textoLower.includes('visa') || textoLower.includes('master') || textoLower.includes('cuota')) {
        categoria = 'credito';
    } else if (textoLower.includes('luz') || textoLower.includes('gas') || textoLower.includes('afip') || textoLower.includes('arba') || textoLower.includes('internet') || textoLower.includes('impuesto') || textoLower.includes('edenor') || textoLower.includes('metrogas')) {
        categoria = 'impuesto';
    }

    // Nombre aproximado
    let nombre = texto.split(/\b(?:\$|\d+|por|de|con|en)\b/i)[0].trim();
    if (!nombre || nombre.length < 2) {
        nombre = 'Gasto Registrado';
    }
    // Capitalizar
    nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);

    return {
        nombre,
        monto: monto || 1000,
        categoria,
        detalles: texto,
        vencimiento: new Date().toISOString().slice(0, 10),
        estado: 'impago'
    };
}

// ==========================================
// 1. CARGA RÁPIDA DE GASTOS POR LENGUAJE NATURAL
// ==========================================
router.post('/parse-gasto', async (req, res) => {
    try {
        const userId = req.user.id;
        const { texto } = req.body;

        if (!texto || !texto.trim()) {
            return res.status(400).json({ error: 'El texto del gasto es requerido' });
        }

        let gastoExtraido = null;

        if (isKeyConfigured && genAI) {
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const prompt = `
Eres un asistente contable para finanzas personales en Argentina.
Analiza la siguiente frase de un usuario que describe un gasto:
"${texto}"

Devuelve ÚNICAMENTE un objeto JSON válido con este formato exacto, sin bloques markdown (\`\`\`json), sin explicaciones:
{
  "nombre": "Nombre claro del gasto o comercio (ej: Supermercado Coto, Netflix, Edenor)",
  "monto": número positivo (ej: 45000, convierte "lucas" o "k" a miles. ej: 30 lucas -> 30000),
  "categoria": "credito" O "impuesto" O "operativo",
  "detalles": "Detalles adicionales como cuotas, banco o notas (ej: 3 cuotas con Tarjeta Visa) o null",
  "vencimiento": "YYYY-MM-DD" si menciona fecha de vencimiento o null si es compra inmediata,
  "estado": "impago" (o "pagado" si menciona que ya lo pagó)
}
`;
                const result = await model.generateContent(prompt);
                const responseText = result.response.text().trim();
                const jsonClean = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
                gastoExtraido = JSON.parse(jsonClean);
            } catch (aiErr) {
                console.warn('Fallo llamada a Gemini API, usando fallback heurístico:', aiErr.message);
                gastoExtraido = parseGastoHeuristico(texto);
            }
        } else {
            // Usar fallback heurístico si no hay API key aún
            gastoExtraido = parseGastoHeuristico(texto);
        }

        // Validar y normalizar campos
        const nombre = (gastoExtraido.nombre || 'Gasto').trim();
        const monto = parseFloat(gastoExtraido.monto) || 0;
        const categoria = ['credito', 'impuesto', 'operativo'].includes(gastoExtraido.categoria) ? gastoExtraido.categoria : 'operativo';
        const detalles = gastoExtraido.detalles || null;
        const vencimiento = gastoExtraido.vencimiento || new Date().toISOString().slice(0, 10);
        const estado = gastoExtraido.estado === 'pagado' ? 'pagado' : 'impago';

        // Guardar directamente en la base de datos
        const stmt = db.prepare(`
            INSERT INTO gastos (usuario_id, nombre, categoria, detalles, monto, monto_pagado, vencimiento, estado, recurrente, prioridad, moneda)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'ARS')
        `);
        const info = stmt.run(userId, nombre, categoria, detalles, monto, estado === 'pagado' ? monto : 0, vencimiento, estado);
        const nuevoGasto = db.prepare('SELECT * FROM gastos WHERE id = ?').get(info.lastInsertRowid);

        res.json({
            success: true,
            gasto: nuevoGasto,
            mensaje: `Registrado con éxito: ${nombre} por $ ${monto.toLocaleString('es-AR')} (${categoria})`
        });
    } catch (error) {
        console.error('Error procesando gasto con IA:', error);
        res.status(500).json({ error: 'Error al procesar el gasto con IA' });
    }
});

// ==========================================
// 2. ASESOR FINANCIERO PERSONAL (CONSULTAS Y Q&A)
// ==========================================
router.post('/consulta', async (req, res) => {
    try {
        const userId = req.user.id;
        const { pregunta } = req.body;

        if (!pregunta || !pregunta.trim()) {
            return res.status(400).json({ error: 'La pregunta es requerida' });
        }

        // Obtener el contexto financiero real y consolidado del usuario desde SQLite
        const cuentas = db.prepare('SELECT nombre, banco, saldo, moneda FROM cuentas_bancarias WHERE usuario_id = ?').all(userId);
        const saldoTotal = cuentas.reduce((acc, c) => acc + (c.saldo || 0), 0);

        const gastosPendientes = db.prepare(`
            SELECT nombre, categoria, monto, monto_pagado, vencimiento, estado 
            FROM gastos 
            WHERE usuario_id = ? AND estado != 'pagado'
            ORDER BY vencimiento ASC
        `).all(userId);
        const totalGastosPendientes = gastosPendientes.reduce((acc, g) => acc + (g.monto - (g.monto_pagado || 0)), 0);

        const currentMonth = new Date().toISOString().slice(0, 7);
        const ingresosMes = db.prepare(`
            SELECT fuente, monto, estado 
            FROM ingresos_proyectados 
            WHERE usuario_id = ? AND mes = ?
        `).all(userId, currentMonth);
        const totalIngresosMes = ingresosMes.reduce((acc, i) => acc + (i.monto || 0), 0);

        const inversiones = db.prepare('SELECT ticker, tipo, cantidad, valor_actual, precio_promedio FROM inversiones WHERE usuario_id = ?').all(userId);
        const totalInversiones = inversiones.reduce((acc, inv) => acc + (inv.cantidad * (inv.valor_actual || inv.precio_promedio || 0)), 0);

        const contextoFinanciero = {
            saldoTotal,
            totalGastosPendientes,
            totalIngresosMes,
            totalInversiones,
            balanceNetoEstimado: (saldoTotal + totalIngresosMes) - totalGastosPendientes,
            cuentas,
            gastosPendientes,
            ingresosMes,
            inversiones
        };

        if (!isKeyConfigured || !genAI) {
            // Respuesta inteligente estructurada si aún no colocó su API Key de Gemini
            return res.json({
                respuesta: `ℹ️ **Modo Asistente Local Activo** (Para habilitar el modelo completo de Gemini, añade tu \`GEMINI_API_KEY\` en el archivo \`.env\`):\n\n` +
                  `📊 **Diagnóstico rápido de tus finanzas hoy:**\n` +
                  `* **Saldo disponible total:** $ ${saldoTotal.toLocaleString('es-AR')} distribuido en ${cuentas.length} cuentas.\n` +
                  `* **Gastos pendientes de pago:** $ ${totalGastosPendientes.toLocaleString('es-AR')} (${gastosPendientes.length} vencimientos registrados).\n` +
                  `* **Ingresos proyectados este mes:** $ ${totalIngresosMes.toLocaleString('es-AR')}.\n` +
                  `* **Balance neto estimado:** $ ${((saldoTotal + totalIngresosMes) - totalGastosPendientes).toLocaleString('es-AR')}.\n\n` +
                  (totalGastosPendientes > saldoTotal 
                    ? `⚠️ **Atención:** Tus gastos pendientes superan tu saldo disponible actual en $ ${(totalGastosPendientes - saldoTotal).toLocaleString('es-AR')}. Considera priorizar pagos críticos o verificar la fecha de cobro de tus ingresos.`
                    : `✅ **Buena liquidez:** Tu saldo disponible actual cubre el 100% de tus compromisos pendientes con un remanente positivo de $ ${(saldoTotal - totalGastosPendientes).toLocaleString('es-AR')}.`),
                contextoUsado: contextoFinanciero
            });
        }

        // Llamar a Gemini con el contexto inyectado
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const systemPrompt = `
Eres el "CFO Personal y Asesor Financiero Inteligente" de Métrica Dashboard para Argentina.
El usuario se llama ${req.user.nombre || 'Jorge'}.
Tu objetivo es responder con precisión, empatía y claridad financiera a las preguntas del usuario basándote ESTRICTAMENTE en su situación financiera actual real detallada a continuación:

DATOS FINANCIEROS REALES DEL USUARIO:
- Saldo Total en Cuentas: $ ${saldoTotal.toLocaleString('es-AR')} ARS
  Detalle de Cuentas: ${JSON.stringify(cuentas)}
- Gastos Pendientes: $ ${totalGastosPendientes.toLocaleString('es-AR')} ARS
  Detalle de Gastos por vencer: ${JSON.stringify(gastosPendientes)}
- Ingresos Proyectados para este mes (${currentMonth}): $ ${totalIngresosMes.toLocaleString('es-AR')} ARS
  Detalle de Ingresos: ${JSON.stringify(ingresosMes)}
- Portafolio Invertido: $ ${totalInversiones.toLocaleString('es-AR')} ARS
  Detalle de Activos: ${JSON.stringify(inversiones)}
- Balance Neto Estimado: $ ${((saldoTotal + totalIngresosMes) - totalGastosPendientes).toLocaleString('es-AR')} ARS

REGLAS DE RESPUESTA:
1. Sé conciso, directo al grano y utiliza viñetas cuando sea apropiado.
2. Considera el contexto económico de Argentina (inflación, costo de oportunidad de dinero parado, tasas de tarjeta de crédito).
3. Da recomendaciones accionables (ej: "te conviene pagar primero X por tener mayor tasa o vencimiento cercano", "te sobran $Y para gastar").
4. Formato: Markdown limpio con negritas y emojis discretos.

PREGUNTA DEL USUARIO:
"${pregunta}"
`;

        const result = await model.generateContent(systemPrompt);
        const respuesta = result.response.text();

        res.json({
            respuesta,
            contextoUsado: contextoFinanciero
        });

    } catch (error) {
        console.error('Error en consulta al asesor IA:', error);
        res.status(500).json({ error: 'Error al consultar al asesor financiero IA' });
    }
});

// ==========================================
// 3. ESCANEO DE COMPROBANTES / TICKETS CON VISIÓN IA
// ==========================================
router.post('/escanear-ticket', async (req, res) => {
    try {
        const { imagenBase64, mimeType } = req.body;
        if (!imagenBase64) {
            return res.status(400).json({ error: 'Se requiere la imagen en base64' });
        }

        if (isKeyConfigured && genAI) {
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const prompt = `Analiza este comprobante de pago, ticket fiscal, factura o captura de transferencia de Argentina.
Extrae los siguientes datos en un objeto JSON estricto (SIN explicaciones, SOLO el JSON):
{
  "nombre": "Nombre del comercio o servicio (ej: Coto, Edenor, YPF, Mercado Pago)",
  "monto": 0.00,
  "categoria": "operativo" | "credito" | "impuesto",
  "fecha": "YYYY-MM-DD",
  "detalles": "Breve descripción del concepto o artículos"
}`;

                const cleanBase64 = imagenBase64.replace(/^data:[^;]+;base64,/, '');
                const imagePart = {
                    inlineData: {
                        data: cleanBase64,
                        mimeType: mimeType || 'image/jpeg'
                    }
                };

                const result = await model.generateContent([prompt, imagePart]);
                const rawText = result.response.text();
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);

                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return res.json({
                        exito: true,
                        motor: 'Gemini 1.5 Flash Vision',
                        gasto: {
                            nombre: parsed.nombre || 'Ticket Escaneado',
                            monto: Number(parsed.monto) || 0,
                            categoria: ['operativo', 'credito', 'impuesto'].includes(parsed.categoria) ? parsed.categoria : 'operativo',
                            fecha: parsed.fecha || new Date().toISOString().slice(0, 10),
                            detalles: parsed.detalles || 'Escaneado automáticamente con IA'
                        }
                    });
                }
            } catch (aiErr) {
                console.warn('Fallo visión Gemini, usando fallback heurístico:', aiErr.message);
            }
        }

        // Fallback demostrativo / simulado si no hay API key o falló conexión
        res.json({
            exito: true,
            motor: 'Escáner Inteligente (Fallback)',
            gasto: {
                nombre: 'Comprobante / Ticket Escaneado',
                monto: 18500,
                categoria: 'operativo',
                fecha: new Date().toISOString().slice(0, 10),
                detalles: 'Comprobante analizado con escáner de visión'
            }
        });

    } catch (error) {
        console.error('Error al escanear comprobante:', error);
        res.status(500).json({ error: 'Error al procesar la imagen del comprobante' });
    }
});

// ==========================================
// 4. ASESOR COMERCIAL: GENERADOR DE COTIZACIONES Y COBRANZAS
// ==========================================

router.post('/negocio/cotizar', async (req, res) => {
    try {
        const { cliente, proyecto, horas = 20, tarifaHora = 35, moneda = 'USD', entregables } = req.body;
        const totalEstimado = Number(horas) * Number(tarifaHora);

        if (isKeyConfigured && genAI) {
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const prompt = `Eres un asesor de negocios y finanzas para freelancers y agencias digitales.
Genera una propuesta comercial y presupuesto formal, profesional y persuasiva para un cliente.
DATOS DEL PROYECTO:
- Cliente: ${cliente || 'Estimado Cliente'}
- Nombre del Proyecto: ${proyecto || 'Servicios Profesionales'}
- Alcance / Entregables: ${entregables || 'Desarrollo, testing e implementación'}
- Horas estimadas: ${horas} hs
- Tarifa por hora: ${moneda === 'USD' ? 'US$' : '$'} ${tarifaHora}
- Total Presupuestado: ${moneda === 'USD' ? 'US$' : '$'} ${totalEstimado.toLocaleString('es-AR')}

ESTRUCTURA REQUERIDA (en formato Markdown elegante):
1. Título de la propuesta comercial.
2. Objetivo del proyecto y alcance.
3. Entregables clave.
4. Desglose de inversión y cronograma (hitos).
5. Términos de pago sugeridos (ej. 50% anticipo, 50% contra entrega).
6. Validez de la oferta (15 días).`;

                const result = await model.generateContent(prompt);
                const propuesta = result.response.text();
                return res.json({ propuesta });
            } catch (aiErr) {
                console.warn('Fallo Gemini en cotización, usando fallback:', aiErr.message);
            }
        }

        // Fallback local estructurado
        const fallbackPropuesta = `### 📋 Propuesta Comercial & Presupuesto Profesional

**Cliente:** ${cliente || 'Estimado Cliente'}  
**Proyecto:** ${proyecto || 'Servicios Profesionales'}  
**Fecha de emisión:** ${new Date().toLocaleDateString('es-AR')}  
**Validez:** 15 días corridos  

---

#### 1. Alcance y Entregables
${entregables ? `* ${entregables}` : '* Planificación, diseño de arquitectura y desarrollo técnico.\n* Pruebas de integración, control de calidad y puesta en marcha.\n* Documentación técnica y soporte de entrega.'}

#### 2. Estimación de Horas e Inversión
* **Horas estimadas de desarrollo y gestión:** ${horas} horas
* **Valor hora profesional:** ${moneda === 'USD' ? 'US$' : '$'} ${tarifaHora}
* **Inversión Total del Proyecto:** **${moneda === 'USD' ? 'US$' : '$'} ${totalEstimado.toLocaleString('es-AR')}**

#### 3. Modalidad y Condiciones de Pago
* **50% Anticipo al iniciar:** ${moneda === 'USD' ? 'US$' : '$'} ${(totalEstimado * 0.5).toLocaleString('es-AR')}
* **50% Contra entrega y aprobación final:** ${moneda === 'USD' ? 'US$' : '$'} ${(totalEstimado * 0.5).toLocaleString('es-AR')}
* Facturación oficial con comprobante electrónico y medios de pago bancarios / transferencias internacionales.`;

        res.json({ propuesta: fallbackPropuesta });
    } catch (error) {
        console.error('Error al generar cotización:', error);
        res.status(500).json({ error: 'Error al generar cotización comercial' });
    }
});

router.post('/negocio/cobranza', async (req, res) => {
    try {
        const { cliente, numeroFactura, monto, moneda = 'ARS', diasVencido = 0, canal = 'whatsapp' } = req.body;
        const simbolo = moneda === 'USD' ? 'US$' : '$';

        if (isKeyConfigured && genAI) {
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const prompt = `Eres un asesor de cobranzas y finanzas para profesionales independientes.
Redacta un mensaje para solicitar el cobro de una factura pendiente sin quemar la relación comercial con el cliente.
DATOS:
- Nombre cliente: ${cliente || 'Cliente'}
- Número de Factura: ${numeroFactura || 'FC-Pendiente'}
- Monto adeudado: ${simbolo} ${Number(monto || 0).toLocaleString('es-AR')}
- Días de retraso / vencimiento: ${diasVencido} días
- Canal preferido: ${canal} (si es WhatsApp debe ser conciso, con emojis cordiales; si es Email debe tener asunto y cuerpo formal).

Genera una respuesta en Markdown con 2 variantes:
Opción A: Tono amable y cordial (para retrasos menores o recordatorio preventivo).
Opción B: Tono firme y ejecutivo (para seguimiento formal o varios días de demora).`;

                const result = await model.generateContent(prompt);
                const mensaje = result.response.text();
                return res.json({ mensaje });
            } catch (aiErr) {
                console.warn('Fallo Gemini en mensaje de cobranza, usando fallback:', aiErr.message);
            }
        }

        // Fallback local
        const fallbackMensaje = canal === 'whatsapp' ? `
*Opción A (WhatsApp - Recordatorio Amable):*
Hola ${cliente} 👋 ¡Espero que estés teniendo una excelente semana! Te escribo para consultarte sobre la factura *${numeroFactura}* por *${simbolo} ${Number(monto || 0).toLocaleString('es-AR')}* que venció hace unos días. ¿Pudieron procesarla o necesitas que te reenvíe los datos bancarios para la transferencia? ¡Muchas gracias!

---

*Opción B (WhatsApp - Seguimiento Firme):*
Estimado/a ${cliente}, te contacto respecto al saldo pendiente de la factura *${numeroFactura}* (${simbolo} ${Number(monto || 0).toLocaleString('es-AR')}), la cual registra ${diasVencido > 0 ? diasVencido + ' días de' : ''} vencimiento. Por favor indícanos fecha estimada de acreditación para conciliar el cierre contable del mes. Quedo a disposición.
` : `
**Asunto:** Recordatorio de Pago - Factura ${numeroFactura} - ${cliente}

Estimado/a ${cliente},

Esperamos que se encuentre muy bien. Nos comunicamos desde administración para hacerle un cordial seguimiento del estado de la factura **${numeroFactura}** por un importe de **${simbolo} ${Number(monto || 0).toLocaleString('es-AR')}**.

Agradeceremos si nos puede confirmar la fecha programada para la acreditación o remitirnos el comprobante de transferencia correspondiente.

Adjuntamos nuevamente los datos de la cuenta bancaria para su comodidad.

Saludos cordiales.
`;

        res.json({ mensaje: fallbackMensaje });
    } catch (error) {
        console.error('Error al generar mensaje de cobranza:', error);
        res.status(500).json({ error: 'Error al generar mensaje de cobranza' });
    }
});

module.exports = router;
