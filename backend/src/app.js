const fs = require('fs');
const path = require('path');
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
const backupRoutes = require('./routes/backup');
const { groupRoutes } = require('./routes/groups');
const { catalogRoutes, catalogAdminRoutes } = require('./routes/catalog');
const { settingsPublicRoutes, settingsAdminRoutes } = require('./routes/settings');
const { legalPublicRoutes, rgpdAdminRoutes } = require('./routes/rgpd');
const { assistantRoutes, assistantAdminRoutes } = require('./routes/assistant');
const { chatRoutes, chatAdminRoutes } = require('./routes/chat');
const { analyticsRoutes, analyticsAdminRoutes } = require('./routes/analytics');
const { createHub } = require('./chat');
const { createMailer } = require('./mailer');
const { createNotifier } = require('./notifications');

function createApp({ db, config, logger = console }) {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          // La première connexion se fait en http://localhost : pas de passage forcé en HTTPS.
          upgradeInsecureRequests: null,
          imgSrc: ["'self'", 'data:', 'blob:'],
        },
      },
    })
  );
  app.use(
    cors({
      origin: config.corsOrigins || true,
      exposedHeaders: ['Content-Disposition'],
    })
  );
  app.use(express.json({ limit: '1mb' }));

  const auth = authenticate({ db, config });
  const mailer = createMailer({ db, config, logger });
  const notifier = createNotifier({ db, config, mailer, logger });
  app.locals.mailer = mailer;
  app.locals.notifier = notifier;
  const hub = createHub({ logger });
  app.locals.chatHub = hub;

  // Tableaux de bord en direct : après chaque modification de demande, un simple signal (sans contenu)
  // est envoyé aux navigateurs connectés, qui recalculent leurs blocs avec leurs propres droits.
  let pingTimer = null;
  app.use(['/api/tickets', '/api/catalog', '/api/admin/trash', '/api/attachments'], (req, res, next) => {
    if (req.method !== 'GET') {
      res.on('finish', () => {
        if (res.statusCode >= 400 || pingTimer) return;
        pingTimer = setTimeout(() => {
          pingTimer = null;
          hub.send(hub.connected(), 'tickets', { at: new Date().toISOString() });
        }, 1000);
        pingTimer.unref?.();
      });
    }
    next();
  });

  const indexHtml = path.join(config.frontendDir, 'index.html');
  const serveFrontend = config.serveFrontend && fs.existsSync(indexHtml);
  if (config.serveFrontend && !serveFrontend) {
    logger.warn(`SERVE_FRONTEND est activé mais ${indexHtml} est introuvable : compilez le frontend.`);
  }
  if (!serveFrontend) app.get('/', (req, res) => res.send('Backend API is running'));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: nowIso() }));

  app.use('/api/settings', settingsPublicRoutes({ db, config }));
  app.use('/api/legal', legalPublicRoutes({ db }));
  app.use('/api/auth', authRoutes({ db, config, authenticate: auth, notifier }));
  app.use('/api', attachmentRoutes({ db, config, auth }));
  app.use('/api/tickets', auth, ticketRoutes({ db, config, notifier }));
  app.use('/api/stats', auth, statsRoutes({ db, config }));
  app.use('/api/users', auth, requireAdmin, userRoutes({ db, config }));
  app.use('/api/groups', auth, groupRoutes({ db, config, requireAdmin, notifier }));
  app.use('/api/catalog', auth, catalogRoutes({ db, config, notifier }));
  app.use('/api/admin/catalog', auth, requireAdmin, catalogAdminRoutes({ db, config }));
  app.use('/api/admin/settings', auth, requireAdmin, settingsAdminRoutes({ db, config, mailer, notifier }));
  app.use('/api/admin/rgpd', auth, requireAdmin, rgpdAdminRoutes({ db, config, notifier }));
  // Guide de l'administrateur (PDF généré depuis docs/admin/guide.html, réservé aux administrateurs).
  app.get('/api/admin/guide.pdf', auth, requireAdmin, (req, res) => {
    const file = path.join(__dirname, '..', 'docs', 'guide-administrateur.pdf');
    if (!fs.existsSync(file)) throw new HttpError(404, 'Le guide n’est pas disponible sur ce serveur.');
    res.set('Cache-Control', 'no-store');
    res.download(file, 'Xchange-guide-administrateur.pdf');
  });
  app.use('/api/assistant', auth, assistantRoutes({ db }));
  app.use('/api/admin/assistant', auth, requireAdmin, assistantAdminRoutes({ db }));
  app.use('/api/chat', auth, chatRoutes({ db, hub, notifier }));
  app.use('/api/analytics', auth, analyticsRoutes({ db, mailer }));
  app.use('/api/admin/analytics', auth, requireAdmin, analyticsAdminRoutes({ db }));
  app.use('/api/admin/chat', auth, requireAdmin, chatAdminRoutes({ db, hub }));
  app.use('/api/admin/backup', auth, requireAdmin, backupRoutes({ db, config }));
  app.use('/api/admin', auth, requireAdmin, adminRoutes({ db, config }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Route inconnue.' });
  });

  if (serveFrontend) {
    // Fichiers compilés : les noms contiennent une empreinte, ils peuvent être gardés en cache.
    app.use(
      express.static(config.frontendDir, {
        index: false,
        setHeaders: (res, file) => {
          const immutable = file.includes(`${path.sep}assets${path.sep}`);
          res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      })
    );
    // Toute autre adresse (/tickets/12, /admin…) renvoie l'application, qui gère ses routes.
    app.get(/^\/(?!api\/).*/, (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

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
