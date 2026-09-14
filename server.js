const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { initDB } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar DB
try {
    initDB();
} catch (error) {
    console.error('Failed to initialize database:', error);
}

// Rutas
app.use('/api/auth', require('./routes/auth').router);
app.use('/api', require('./routes/api'));
app.use('/api/agente', require('./routes/agente'));
app.use('/api/mercadopago', require('./routes/mercadopago'));

app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Metrica V1 API is running' });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
