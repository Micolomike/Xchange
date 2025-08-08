const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 4000;

app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database('../database/tickets.db');

// 📋 Chemin vers le fichier log JSON
const deletedLogPath = path.join(__dirname, '../logs/deleted-tickets.json');

// 📁 Crée le dossier logs si besoin
const logsDir = path.dirname(deletedLogPath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// 📄 Initialise le fichier s'il n'existe pas
if (!fs.existsSync(deletedLogPath)) {
  fs.writeFileSync(deletedLogPath, '[]');
}

// DB setup
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    priority TEXT,
    category TEXT,
    due_date TEXT, 
    created_at TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    firstname TEXT,
    lastname TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ✅ GET all tickets
app.get('/api/tickets', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    res.json(rows);
  });
});

// ✅ GET one ticket
app.get('/api/tickets/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err });
    if (!row) return res.status(404).json({ error: 'Ticket not found' });
    res.json(row);
  });
});

// ✅ POST create ticket
app.post('/api/tickets', (req, res) => {
  const { title, description, priority, category, due_date } = req.body;
  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO tickets (title, description, priority, category, due_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title, description, priority, category || '', due_date || '', createdAt],
    function (err) {
      if (err) return res.status(500).json({ error: err });
      res.json({ id: this.lastID });
    }
  );
});

// ✅ DELETE + log JSON
app.delete('/api/tickets/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Ticket non trouvé' });

    db.run('DELETE FROM tickets WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).json({ error: err });

      const deletedEntry = {
        id: row.id,
        title: row.title,
        deleted_at: new Date().toISOString()
      };

      const logs = JSON.parse(fs.readFileSync(deletedLogPath, 'utf-8') || '[]');
      logs.push(deletedEntry);
      fs.writeFileSync(deletedLogPath, JSON.stringify(logs, null, 2));

      console.log(`🗑️ Ticket supprimé : ${row.title}`);
      res.json({ success: true });
    });
  });
});

// ✅ GET deleted ticket logs
app.get('/api/logs/deleted', (req, res) => {
  try {
    const logs = JSON.parse(fs.readFileSync(deletedLogPath));
    res.json(logs);
  } catch (error) {
    console.error("Erreur lors de la lecture du log :", error);
    res.status(500).json({ error: "Erreur lors de la lecture du fichier log." });
  }
});

// ✅ ADMIN - GET table structure + rows
app.get('/api/admin/table/:name', (req, res) => {
  const { name } = req.params;
  const allowedTables = ['users', 'tickets'];

  if (!allowedTables.includes(name)) {
    return res.status(400).json({ error: 'Table non autorisée' });
  }

  db.all(`SELECT * FROM ${name}`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ columns, rows });
  });
});

// ✅ ADMIN - DELETE row from table
app.delete('/api/admin/table/:table/:id', (req, res) => {
  const { table, id } = req.params;
  const allowedTables = ['users', 'tickets'];

  if (!allowedTables.includes(table)) {
    return res.status(403).json({ error: 'Table non autorisée.' });
  }

  db.run(`DELETE FROM ${table} WHERE id = ?`, [id], function (err) {
    if (err) {
      console.error("❌ Erreur SQL :", err);
      return res.status(500).json({ error: "Erreur lors de la suppression." });
    }

    console.log(`✅ ${table} → ligne ID ${id} supprimée.`);
    res.json({ success: true });
  });
});

// ✅ ADMIN - PUT (update) row in table [🔁 corrigée ici]
app.put('/api/admin/table/:table/:id', (req, res) => {
  const { table, id } = req.params;
  const allowedTables = ['users', 'tickets'];

  if (!allowedTables.includes(table)) {
    return res.status(403).json({ error: 'Table non autorisée.' });
  }

  const updates = req.body;
  const columns = Object.keys(updates);
  const values = Object.values(updates);

  if (columns.length === 0) {
    return res.status(400).json({ error: 'Aucune donnée à mettre à jour.' });
  }

  const setClause = columns.map(col => `${col} = ?`).join(', ');

  db.run(
    `UPDATE ${table} SET ${setClause} WHERE id = ?`,
    [...values, id],
    function (err) {
      if (err) {
        console.error("❌ Erreur SQL :", err);
        return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
      }

      console.log(`✏️ ${table} → ligne ID ${id} mise à jour.`);
      res.json({ success: true });
    }
  );
});

app.listen(port, () => {
  console.log(`🎧 Backend running on http://localhost:${port}`);
});
