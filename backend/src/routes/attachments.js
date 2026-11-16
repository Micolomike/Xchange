const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { HttpError, nowIso, parseId } = require('../utils');
const { loadVisibleTicket, addEvent } = require('../tickets');

// Extensions refusées : exécutables et scripts.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.vbs', '.js', '.jar', '.sh', '.dll', '.html', '.htm', '.svg',
]);

/** Corrige les noms de fichiers non ASCII que busboy décode en latin1. */
function decodeFilename(name) {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

function sanitizeFilename(name) {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (cleaned || 'fichier').slice(0, 180);
}

function removeFiles(uploadsDir, storedNames) {
  for (const name of storedNames) {
    fs.rm(path.join(uploadsDir, path.basename(name)), { force: true }, () => {});
  }
}

function attachmentRoutes({ db, config, auth }) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (req, file, cb) => {
        const ext = path.extname(decodeFilename(file.originalname)).toLowerCase().replace(/[^a-z0-9.]/g, '');
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: config.maxFilesPerUpload },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(decodeFilename(file.originalname)).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        cb(new HttpError(400, `Type de fichier refusé (${ext}).`));
      } else {
        cb(null, true);
      }
    },
  });

  const router = express.Router();

  // Upload : on vérifie l'accès au ticket avant d'écrire quoi que ce soit sur le disque.
  router.post(
    '/tickets/:id/attachments',
    auth,
    async (req, res, next) => {
      req.ticketId = parseId(req.params.id);
      await loadVisibleTicket(db, req.user, req.ticketId);
      next();
    },
    upload.array('files', config.maxFilesPerUpload),
    async (req, res) => {
      const files = req.files || [];
      if (!files.length) throw new HttpError(400, 'Aucun fichier reçu.');
      const now = nowIso();
      const created = [];
      for (const file of files) {
        const name = sanitizeFilename(decodeFilename(file.originalname));
        const { lastID } = await db.run(
          `INSERT INTO attachments (ticket_id, uploaded_by, original_name, stored_name, mime_type, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [req.ticketId, req.user.id, name, file.filename, file.mimetype, file.size, now]
        );
        await addEvent(db, req.ticketId, req.user.id, 'attachment_added', null, name, now);
        created.push({
          id: lastID,
          name,
          mime_type: file.mimetype,
          size: file.size,
          created_at: now,
          uploaded_by: { id: req.user.id, username: req.user.username, name: req.user.name },
          canDelete: true,
        });
      }
      await db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', [now, req.ticketId]);
      res.status(201).json(created);
    }
  );

  async function loadAttachment(req) {
    const id = parseId(req.params.attachmentId, 'Pièce jointe');
    const attachment = await db.get('SELECT * FROM attachments WHERE id = ?', [id]);
    if (!attachment) throw new HttpError(404, 'Pièce jointe introuvable.');
    await loadVisibleTicket(db, req.user, attachment.ticket_id);
    return attachment;
  }

  router.get('/attachments/:attachmentId', auth, async (req, res) => {
    const attachment = await loadAttachment(req);
    const filePath = path.join(config.uploadsDir, path.basename(attachment.stored_name));
    if (!fs.existsSync(filePath)) {
      throw new HttpError(410, "Le fichier n'est plus disponible sur le serveur.");
    }
    res.download(filePath, attachment.original_name, {
      headers: { 'Content-Type': attachment.mime_type || 'application/octet-stream' },
    });
  });

  router.delete('/attachments/:attachmentId', auth, async (req, res) => {
    const attachment = await loadAttachment(req);
    if (req.user.role !== 'admin' && attachment.uploaded_by !== req.user.id) {
      throw new HttpError(403, "Seul l'auteur de l'envoi ou un administrateur peut supprimer ce fichier.");
    }
    const now = nowIso();
    await db.run('DELETE FROM attachments WHERE id = ?', [attachment.id]);
    await addEvent(db, attachment.ticket_id, req.user.id, 'attachment_removed', attachment.original_name, null, now);
    await db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', [now, attachment.ticket_id]);
    removeFiles(config.uploadsDir, [attachment.stored_name]);
    res.json({ success: true });
  });

  return router;
}

module.exports = { attachmentRoutes, removeFiles };
