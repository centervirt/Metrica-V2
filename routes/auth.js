const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { db, hashPassword, verifyPassword } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'metrica-super-secret-jwt-key-2026';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

/**
 * Calcula el estado de suscripción, rol de administrador y días restantes del Free Trial
 */
function calcularEstadoUsuario(rawUser) {
    if (!rawUser) return null;
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const esAdmin = Boolean(
        (adminEmail && rawUser.email && rawUser.email.trim().toLowerCase() === adminEmail) ||
        rawUser.rol === 'admin' ||
        rawUser.plan_suscripcion === 'admin'
    );

    let plan = rawUser.plan_suscripcion || 'free';
    let rol = rawUser.rol || 'user';

    if (esAdmin) {
        plan = 'admin';
        rol = 'admin';
        // Persistir en DB si aún no estaba seteado como admin
        if (rawUser.rol !== 'admin' || rawUser.plan_suscripcion !== 'admin') {
            try {
                db.prepare('UPDATE usuarios SET rol = ?, plan_suscripcion = ? WHERE id = ?').run('admin', 'admin', rawUser.id);
            } catch (e) {
                console.warn('No se pudo actualizar rol admin en DB:', e);
            }
        }
    }

    // Cálculo del Free Trial (15 días corridos desde creado_en)
    let diasRestantesTrial = 0;
    let isTrialActivo = false;

    if (esAdmin) {
        isTrialActivo = true;
        diasRestantesTrial = 999;
    } else if (plan !== 'free') {
        // Usuario con plan de pago
        isTrialActivo = true;
        diasRestantesTrial = 0;
    } else {
        // Plan Free: calcular días transcurridos desde fecha de creación
        const fechaRegistro = rawUser.creado_en ? new Date(rawUser.creado_en) : new Date();
        const diffMs = Date.now() - fechaRegistro.getTime();
        const diasPasados = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        diasRestantesTrial = Math.max(0, 15 - diasPasados);
        isTrialActivo = diasRestantesTrial > 0;
    }

    return {
        id: rawUser.id,
        email: rawUser.email,
        nombre: rawUser.nombre,
        avatar_url: rawUser.avatar_url,
        plan_suscripcion: plan,
        rol: rol,
        creado_en: rawUser.creado_en,
        trial: {
            esAdmin,
            activo: isTrialActivo,
            diasRestantes: diasRestantesTrial,
            expirado: !isTrialActivo && plan === 'free'
        }
    };
}

/**
 * Middleware para proteger rutas y verificar el JWT
 */
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado. Token requerido' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const rawUser = db.prepare('SELECT id, email, nombre, avatar_url, plan_suscripcion, rol, creado_en FROM usuarios WHERE id = ?').get(decoded.id);
        if (!rawUser) {
            return res.status(401).json({ error: 'Usuario inexistente o dado de baja' });
        }
        req.user = calcularEstadoUsuario(rawUser);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

// Genera un token JWT para un usuario
function generarToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, nombre: user.nombre },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}


// Configuración pública de autenticación (Client ID de Google)
router.get('/config', (req, res) => {
    res.json({
        googleClientId: GOOGLE_CLIENT_ID
    });
});

// ==========================================
// 1. REGISTRO LOCAL (EMAIL / PASSWORD)
// ==========================================
router.post('/register', (req, res) => {
    try {
        const { nombre, email, password } = req.body;

        if (!nombre || !email || !password) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        const emailLimpio = email.trim().toLowerCase();
        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const usuarioExistente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailLimpio);
        if (usuarioExistente) {
            return res.status(400).json({ error: 'Ya existe una cuenta con este correo electrónico' });
        }

        const passwordHash = hashPassword(password);
        const stmt = db.prepare(`
            INSERT INTO usuarios (nombre, email, password_hash)
            VALUES (?, ?, ?)
        `);
        const info = stmt.run(nombre.trim(), emailLimpio, passwordHash);
        const rawNuevoUsuario = db.prepare('SELECT id, email, nombre, avatar_url, plan_suscripcion, rol, creado_en FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
        const userCalculado = calcularEstadoUsuario(rawNuevoUsuario);

        const token = generarToken(userCalculado);
        res.status(201).json({ token, user: userCalculado });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

// ==========================================
// 2. INICIO DE SESIÓN LOCAL
// ==========================================
router.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' });
        }

        const emailLimpio = email.trim().toLowerCase();
        const user = db.prepare('SELECT id, email, nombre, avatar_url, password_hash, plan_suscripcion, rol, creado_en FROM usuarios WHERE email = ?').get(emailLimpio);

        if (!user || !user.password_hash) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const passwordValida = verifyPassword(password, user.password_hash);
        if (!passwordValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const userCalculado = calcularEstadoUsuario(user);
        const token = generarToken(userCalculado);
        res.json({ token, user: userCalculado });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// ==========================================
// 3. INICIO DE SESIÓN CON GOOGLE (GMAIL)
// ==========================================
router.post('/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) {
            return res.status(400).json({ error: 'Token de Google requerido' });
        }

        // Validar el token contra el endpoint oficial de verificación de Google OAuth2
        const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
        if (!googleRes.ok) {
            const errData = await googleRes.json().catch(() => ({}));
            return res.status(401).json({ error: 'Token de Google inválido', details: errData });
        }

        const googleUser = await googleRes.json();
        const { sub: googleId, email, name, picture } = googleUser;

        if (!email) {
            return res.status(400).json({ error: 'La cuenta de Google no tiene un email público' });
        }

        const emailLimpio = email.toLowerCase();
        let user = db.prepare('SELECT id, email, nombre, avatar_url, plan_suscripcion, rol, creado_en FROM usuarios WHERE google_id = ? OR email = ?').get(googleId, emailLimpio);

        if (user) {
            // Actualizar avatar o google_id si faltaba
            db.prepare(`
                UPDATE usuarios 
                SET google_id = COALESCE(google_id, ?), avatar_url = COALESCE(?, avatar_url)
                WHERE id = ?
            `).run(googleId, picture || null, user.id);
            user = db.prepare('SELECT id, email, nombre, avatar_url, plan_suscripcion, rol, creado_en FROM usuarios WHERE id = ?').get(user.id);
        } else {
            // Crear usuario nuevo con Google
            const info = db.prepare(`
                INSERT INTO usuarios (nombre, email, google_id, avatar_url)
                VALUES (?, ?, ?, ?)
            `).run(name || 'Usuario Google', emailLimpio, googleId, picture || null);
            user = db.prepare('SELECT id, email, nombre, avatar_url, plan_suscripcion, rol, creado_en FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
        }

        const userCalculado = calcularEstadoUsuario(user);
        const token = generarToken(userCalculado);
        res.json({ token, user: userCalculado });
    } catch (error) {
        console.error('Error en autenticación con Google:', error);
        res.status(500).json({ error: 'Error al procesar el ingreso con Google' });
    }
});


// ==========================================
// 4. PERFIL ACTUAL (ME)
// ==========================================
router.get('/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

module.exports = {
    router,
    authMiddleware
};
