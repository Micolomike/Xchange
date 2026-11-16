const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { HttpError, nowIso } = require('./utils');
const { authenticate, requireAdmin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const { ticketRoutes } = require('./routes/tickets');
const { attachmentRoutes } = require('./routes/attachments');
const { userRoutes } = require('./routes/users');
const adminRoutes = require('./routes/admin');
const statsRoutes = require('./routes/stats');

function createApp({ db, config, logger = console }) {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigins || true,
      exposedHeaders: ['Content-Disposition'],
    })
  );
  app.use(express.json({ limit: '1mb' }));

  const auth = authenticate({ db, config });

  app.get('/', (req, res) => res.send('Backend API is running'));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: nowIso() }));

  app.use('/api/auth', authRoutes({ db, config, authenticate: auth }));
  app.use('/api', attachmentRoutes({ db, config, auth }));
  app.use('/api/tickets', auth, ticketRoutes({ db, config }));
  app.use('/api/stats', auth, statsRoutes({ db, config }));
  app.use('/api/users', auth, requireAdmin, userRoutes({ db, config }));
  app.use('/api/admin', auth, requireAdmin, adminRoutes({ db, config }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Route inconnue.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: `Fichier trop volumineux (${config.maxUploadMb} Mo maximum).`,
        LIMIT_FILE_COUNT: `${config.maxFilesPerUpload} fichiers maximum par envoi.`,
        LIMIT_UNEXPECTED_FILE: 'Champ de fichier inattendu.',
      };
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: messages[err.code] || "Erreur lors de l'envoi du fichier." });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Corps de requête JSON invalide.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Requête trop volumineuse.' });
    }
    logger.error(err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return app;
}

/**
 * Garantit qu'au moins un administrateur existe :
 *  - ADMIN_USERNAME / ADMIN_PASSWORD créent ou promeuvent ce compte ;
 *  - sinon, sur une base existante sans administrateur, le plus ancien compte est promu.
 */
async function ensureAdmin(db, config, logger = console) {
  if (config.adminUsername && config.adminPassword) {
    const row = await db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [config.adminUsername]);
    if (!row) {
      await db.run(
        "INSERT INTO users (username, password, role, email, firstname, lastname, created_at) VALUES (?, ?, 'admin', '', '', '', ?)",
        [config.adminUsername, await bcrypt.hash(config.adminPassword, 10), nowIso()]
      );
      logger.info(`Compte administrateur « ${config.adminUsername} » créé.`);
    } else if (row.role !== 'admin') {
      await db.run("UPDATE users SET role = 'admin' WHERE id = ?", [row.id]);
      logger.info(`Compte « ${row.username} » promu administrateur.`);
    }
  }
  const { count } = await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
  if (count === 0) {
    const oldest = await db.get('SELECT id, username FROM users ORDER BY id ASC LIMIT 1');
    if (oldest) {
      await db.run("UPDATE users SET role = 'admin' WHERE id = ?", [oldest.id]);
      logger.info(`Aucun administrateur : « ${oldest.username} » (plus ancien compte) a été promu.`);
    }
  }
}

module.exports = { createApp, ensureAdmin };
