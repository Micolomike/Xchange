const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

// Configure session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'xchange_secret',
    resave: false,
    saveUninitialized: true
  })
);

const db = new sqlite3.Database('../database/tickets.db');

// 💾 Chemin vers le fichier log JSON
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
      res.status(201).json({ id: this.lastID });
    }
  );
});

// ✅ PUT update ticket
app.put('/api/tickets/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, priority, category, due_date } = req.body;

  db.run(
    `UPDATE tickets
     SET title = ?, description = ?, priority = ?, category = ?, due_date = ?
     WHERE id = ?`,
    [title, description, priority, category || '', due_date || '', id],
    function (err) {
      if (err) return res.status(500).json({ error: err });
      if (this.changes === 0) return res.status(404).json({ error: 'Ticket not found' });
      res.json({ success: true });
    }
  );
});

// ✅ DELETE remove ticket and log deleted data
app.delete('/api/tickets/:id', (req, res) => {
  const { id } = req.params;

  // Fetch the ticket details before deleting
  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err });
    if (!row) return res.status(404).json({ error: 'Ticket not found' });

    // Delete the ticket from DB
    db.run('DELETE FROM tickets WHERE id = ?', [id], function (err) {
      if (err) return res.status(500).json({ error: err });

      // Load existing logs
      let logsData = JSON.parse(fs.readFileSync(deletedLogPath, 'utf8'));

      // Append deleted ticket data with timestamp
      logsData.push({
        ...row,
        deleted_at: new Date().toISOString()
      });

      // Save updated logs
      fs.writeFileSync(deletedLogPath, JSON.stringify(logsData, null, 2));

      res.json({ success: true });
    });
  });
});

// ================= USER SECTION =================

// ✅ POST create user
const bcrypt = require('bcrypt');
app.post('/api/users', async (req, res) => {
  const { username, password, email, firstname, lastname } = req.body;

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password, email, firstname, lastname)
       VALUES (?, ?, ?, ?, ?)`,
      [username, hash, email || '', firstname || '', lastname || ''],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: err });
        }
        res.status(201).json({ id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ✅ POST login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: err });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    // Save user ID in session
    req.session.userId = user.id;
    res.json({ success: true, id: user.id, username: user.username });
  });
});

// ✅ POST logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ success: true });
  });
});

// ✅ POST register (alias for creating a user)
app.post('/api/register', async (req, res) => {
  const { username, password, email, firstname, lastname } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password, email, firstname, lastname)
       VALUES (?, ?, ?, ?, ?)`,
      [username, hash, email || '', firstname || '', lastname || ''],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: err });
        }
        res.status(201).json({ id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ✅ GET all users (admin only)
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    res.json(rows);
  });
});

// ✅ GET user by ID (admin only)
app.get('/api/users/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err });
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json(row);
  });
});

// ✅ PUT update user (admin only)
app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, email, firstname, lastname } = req.body;

  try {
    let hash = null;
    if (password) {
      hash = await bcrypt.hash(password, 10);
    }

    db.run(
      `UPDATE users SET
       username = COALESCE(?, username),
       password = COALESCE(?, password),
       email = COALESCE(?, email),
       firstname = COALESCE(?, firstname),
       lastname = COALESCE(?, lastname)
       WHERE id = ?`,
      [username, hash, email, firstname, lastname, id],
      function (err) {
        if (err) return res.status(500).json({ error: err });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// ✅ DELETE remove user (admin only)
app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err });
    if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  });
});

// ✅ GET all deleted logs (admin only)
app.get('/api/admin/deleted-logs', (req, res) => {
  const logsData = JSON.parse(fs.readFileSync(deletedLogPath, 'utf8'));
  res.json(logsData);
});

// ✅ DELETE a log entry by index (admin only)
app.delete('/api/admin/deleted-logs/:index', (req, res) => {
  const index = parseInt(req.params.index);
  let logsData = JSON.parse(fs.readFileSync(deletedLogPath, 'utf8'));

  if (isNaN(index) || index < 0 || index >= logsData.length) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  logsData.splice(index, 1);
  fs.writeFileSync(deletedLogPath, JSON.stringify(logsData, null, 2));

  res.json({ success: true });
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
      console.error('❌ Erreur SQL :', err);
      return res.status(500).json({ error: 'Erreur lors de la suppression.' });
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
        console.error('❌ Erreur SQL :', err);
        return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
      }

      console.log(`✏️ ${table} → ligne ID ${id} mise à jour.`);
      res.json({ success: true });
    }
  );
});
// Default route
app.get('/', (req, res) => {
  res.send('Backend API is running');
});

app.listen(port, () => {
  console.log(`🎧 Backend running on http://localhost:${port}`);
});
