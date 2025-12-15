// Antes: require('dotenv').config();
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import pool from './db.js'; // si tu db.js también es ESM
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import bcrypt from 'bcrypt';
import { send as rconSend } from './rcon-client.js';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import fssync from 'fs';
import multer from 'multer';
import archiver from 'archiver';
import 'dotenv/config';

// Para reemplazar __dirname
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

import cors from 'cors';   // si estás usando ES Modules
// o const cors = require('cors');  si usás CommonJS

app.use(cors());   // Esto permite que cualquier origen haga peticiones

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionStore = new MySQLStore({}, pool);
app.use(session({
  key: 'mc.sid',
  secret: process.env.SESSION_SECRET || 'dev_secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24*60*60*1000 }
}));

import { ConfidentialClientApplication } from '@azure/msal-node';

const msalConfig = {
  auth: {
    clientId:     process.env.MS_CLIENT_ID,
    authority:    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
    clientSecret: process.env.MS_CLIENT_SECRET
  },
  system: {
    loggerOptions: {
      logLevel: "Info"
    }
  }
};
const msalClient = new ConfidentialClientApplication(msalConfig);

// Static
app.use(express.static(path.join(__dirname, 'public')));

// --- helpers ---
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No autorizado' });
  next();
}
async function isOwnerOrAdmin(req, itemOwnerId) {
  if (!req.session.userId) return false;
  if (req.session.role === 'admin') return true;
  return req.session.userId === itemOwnerId;
}

// -------- AUTH ----------
app.post('/api/register', async (req, res) => {
  try {
    const { game_name, email, password } = req.body;
    if (!game_name || !email || !password) return res.status(400).json({ error: 'Faltan campos' });

    const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) return res.status(409).json({ error: 'Email ya registrado' });

    const password_hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (game_name, email, password_hash) VALUES (?, ?, ?)', [game_name, email, password_hash]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error servidor' });
  }
});

// --- LOGIN NORMAL ---
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (!rows.length) return res.status(401).json({ error: "Credenciales inválidas" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Credenciales inválidas" });

    req.session.userId = user.id;

    return res.json({
      ok: true,
      user: {
        id: user.id,
        game_name: user.game_name,
        email: user.email,
        role: user.role,
        is_premium: user.is_premium || 0,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error servidor" });
  }
});

// --- OBTENER DATOS DEL USUARIO ---
app.get("/api/me", async (req, res) => {
  if (!req.session.userId) return res.json({ logged: false });
  const [rows] = await pool.query(
    "SELECT id, game_name, email, role, is_premium FROM users WHERE id = ?",
    [req.session.userId]
  );
  if (!rows.length) return res.json({ logged: false });
  res.json({ logged: true, user: rows[0] });
});



app.post('/api/logout', (req, res) => {
  req.session.destroy(err => (err ? res.status(500).json({ error: 'No se pudo cerrar sesión' }) : res.json({ ok: true })));
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ logged: false });
  const [rows] = await pool.query('SELECT id, game_name, email, role, show_skin FROM users WHERE id = ?', [req.session.userId]);
  if (!rows.length) return res.json({ logged: false });
  res.json({ logged: true, user: rows[0] });
});

// --- REDIRECT MS OAUTH ---
app.get("/ms-redirect", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("No se recibió código de Microsoft");

  if (!req.session.userId) return res.send("Usuario no logueado");

  try {
    const tokenRequest = {
      code,
      scopes: ["User.Read"],
      redirectUri: process.env.MS_REDIRECT_URI,
    };
    const tokenResponse = await msalClient.acquireTokenByCode(tokenRequest);

    if (!tokenResponse || !tokenResponse.account) return res.send("Token Microsoft inválido");

    // Actualizar DB
    await pool.query("UPDATE users SET is_premium = 1 WHERE id = ?", [
      req.session.userId,
    ]);

    return res.send("Cuenta Microsoft verificada correctamente! Puedes cerrar esta ventana.");
  } catch (err) {
    console.error(err);
    return res.send("Error al verificar Microsoft");
  }
});

// -------- MOSAICS ----------
app.get('/api/mosaics', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.*, u.game_name AS owner_name 
      FROM mosaics m 
      LEFT JOIN users u ON m.owner_id = u.id
      ORDER BY m.position ASC, m.created_at DESC
    `);
    res.json(rows);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error servidor' });
  }
});

app.post('/api/mosaics', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'Solo admins pueden crear mosaicos' });

    const { title, content, img_url, public: isPublic } = req.body;
    const owner_id = req.session.userId;
    const [r] = await pool.query('INSERT INTO mosaics (title, content, img_url, owner_id, public) VALUES (?, ?, ?, ?, ?)', [title, content, img_url || null, owner_id, isPublic ? 1 : 0]);
    const [rows] = await pool.query('SELECT m.*, u.game_name AS owner_name FROM mosaics m LEFT JOIN users u ON m.owner_id=u.id WHERE m.id = ?', [r.insertId]);
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error servidor' }); }
});

app.put('/api/mosaics/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { title, content, img_url, public: isPublic } = req.body;
    const [check] = await pool.query('SELECT owner_id FROM mosaics WHERE id = ?', [id]);
    if (!check.length) return res.status(404).json({ error: 'No existe' });
    if (check[0].owner_id !== req.session.userId && req.session.role !== 'admin') return res.status(403).json({ error: 'No permitido' });
    await pool.query('UPDATE mosaics SET title=?, content=?, img_url=?, public=? WHERE id=?', [title, content, img_url, isPublic ? 1 : 0, id]);
    const [rows] = await pool.query('SELECT m.*, u.game_name AS owner_name FROM mosaics m LEFT JOIN users u ON m.owner_id=u.id WHERE m.id = ?', [id]);
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error servidor' }); }
});

app.delete('/api/mosaics/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const [check] = await pool.query('SELECT owner_id FROM mosaics WHERE id = ?', [id]);
    if (!check.length) return res.status(404).json({ error: 'No existe' });
    if (check[0].owner_id !== req.session.userId && req.session.role !== 'admin') return res.status(403).json({ error: 'No permitido' });
    await pool.query('DELETE FROM mosaics WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error servidor' }); }
});

// -------- RCON endpoints ----------
app.post('/api/rcon/command', requireAuth, async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Comando vacío' });
    const out = await rconSend(command);
    res.json({ ok: true, out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error RCON: ' + e.message });
  }
});

app.get('/api/server/status', async (req, res) => {
  try {
    const out = await rconSend('list');
    res.json({ online: true, raw: out });
  } catch (e) {
    res.json({ online: false, raw: e.message });
  }
});

// -------- FILE MANAGER ----------
const SERVER_FOLDER = process.env.SERVER_FOLDER || path.join(__dirname, 'server_files');

function safePath(p) {
  const resolved = path.resolve(SERVER_FOLDER, p || '');
  if (!resolved.startsWith(path.resolve(SERVER_FOLDER))) throw new Error('Bad path');
  return resolved;
}

app.get('/api/files/list', requireAuth, async (req, res) => {
  try {
    const dir = req.query.dir || '';
    const abs = safePath(dir);
    const items = await fs.readdir(abs, { withFileTypes: true });
    const out = await Promise.all(items.map(async it => {
      const stats = await fs.stat(path.join(abs, it.name));
      return { name: it.name, isDir: it.isDirectory(), size: stats.size, mtime: stats.mtime };
    }));
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/files/read', requireAuth, async (req, res) => {
  try {
    const file = req.query.file;
    const abs = safePath(file);
    const data = await fs.readFile(abs, 'utf8');
    res.json({ ok: true, data });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/files/write', requireAuth, async (req, res) => {
  try {
    const { file, content } = req.body;
    const abs = safePath(file);
    await fs.writeFile(abs, content, 'utf8');
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/files/delete', requireAuth, async (req, res) => {
  try {
    const { file } = req.body;
    const abs = safePath(file);
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      await fs.rm(abs, { recursive: true, force: true });
    } else {
      await fs.unlink(abs);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

const upload = multer({ dest: path.join(__dirname, 'tmp_uploads') });
app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const dir = req.body.dir || '';
    const absDir = safePath(dir);
    if (!fssync.existsSync(absDir)) await fs.mkdir(absDir, { recursive: true });
    const dest = path.join(absDir, req.file.originalname);
    await fs.rename(req.file.path, dest);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ---------- SOCKET.IO ----------
io.use((socket, next) => {
  next();
});

io.on('connection', (socket) => {
  console.log('ws connected', socket.id);

  socket.on('rcon:command', async (cmd) => {
    try {
      const out = await rconSend(cmd);
      socket.emit('rcon:output', { cmd, out });
    } catch (e) {
      socket.emit('rcon:error', { error: e.message });
    }
  });

  socket.on('disconnect', () => {});
});

// fallback route
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));

// -------- BACKUPS ----------

const BACKUPS_DIR = path.join(__dirname, 'backups');

if (!fssync.existsSync(BACKUPS_DIR)) fssync.mkdirSync(BACKUPS_DIR);

app.post('/api/backups/create', requireAuth, async (req, res) => {
  try {
    const worldPath = path.join('C:\\Users\\Noxi-PC\\Desktop\\SVALETARO', 'ALETARO Tecnico');
    if (!fssync.existsSync(worldPath)) return res.status(404).json({ error: 'No se encontró el mundo' });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipName = `backup-${timestamp}.zip`;
    const zipPath = path.join(BACKUPS_DIR, zipName);
    const output = fssync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(worldPath, false);
    await archive.finalize();

    await pool.query('INSERT INTO mosaics (title, content, img_url, owner_id, public) VALUES (?, ?, ?, ?, ?)', [
      `Backup ${timestamp}`,
      'Copia automática del mundo ALETARO Tecnico.',
      null,
      req.session.userId,
      1
    ]);

    res.json({ ok: true, file: `/backups/${zipName}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error creando backup' });
  }
});

app.get('/api/backups/list', requireAuth, async (req, res) => {
  try {
    const files = await fs.readdir(BACKUPS_DIR);
    const list = files.filter(f => f.endsWith('.zip')).map(f => ({
      name: f,
      url: `/backups/${f}`,
      date: f.replace('backup-', '').replace('.zip', '').replace(/-/g, ':')
    }));
    res.json(list);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.use('/backups', express.static(BACKUPS_DIR));

// -------- PLAYERS ----------
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

app.get('/api/players/list', requireAuth, async (req, res) => {
  try {
    // Usa RCON para obtener lista de jugadores conectados
    const out = await rconSend('list');
    const match = out.match(/There are (\d+) of a max of (\d+) players online: (.*)/i);
    let players = [];

    if (match && match[3].trim()) {
      players = match[3].split(',').map(p => p.trim()).filter(Boolean);
    }

    // Obtiene datos de skin y perfil desde Mojang API
    const playerData = await Promise.all(players.map(async name => {
      try {
        const uuidRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${name}`);
        if (!uuidRes.ok) throw new Error('No UUID');
        const uuidData = await uuidRes.json();
        const skinUrl = `https://mineskin.eu/armor/body/${name}/100.png`;

        return {
          name,
          uuid: uuidData.id,
          skin: skinUrl,
          stats: null,
          inventory: null,
          achievements: null
        };
      } catch {
        return { name, skin: null, uuid: null };
      }
    }));

    res.json(playerData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error obteniendo jugadores' });
  }
});

// -------- PLAYER DETAILS ----------
app.get('/api/players/:name/details', requireAuth, async (req, res) => {
  try {
    const playerName = req.params.name;

    // Obtiene estadísticas del jugador
    const statsRaw = await rconSend(`data get entity ${playerName}`);
    // statsRaw es algo como: {Inventory:[...], EnderItems:[...], ...}

    // Intentamos parsear JSON dentro del output de Minecraft (requiere que RCON devuelva NBT en JSON)
    let stats = null;
    let inventory = null;
    let achievements = null;

    try {
      // Extraemos el NBT de inventario y demás del output de RCON
      const nbtMatch = statsRaw.match(/\{.*\}/s);
      if (nbtMatch) {
        const nbtStr = nbtMatch[0];
        stats = nbtStr; // por ahora como string, después se puede parsear con un parser NBT si se instala
      }
    } catch (e) {
      console.error('Error parseando stats de', playerName, e);
    }

    res.json({
      name: playerName,
      stats,
      inventory,
      achievements
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener detalles del jugador' });
  }
});

// Variable global para contar uptime en segundos
let serverUptimeSeconds = 0;
let uptimeInterval;

app.get('/api/server/status', async (req, res) => {
  try {
    const rcon = req.app.locals.rcon; 
    if (!rcon || !rcon.isAuthenticated) {
      // Si el servidor está offline, reinicia contador
      serverUptimeSeconds = 0;
      clearInterval(uptimeInterval);
      return res.json({ online: false, raw: 'Servidor desconectado', players: [], cpu: 0, ram: 0, uptime: '0s' });
    }

    // Solo pedimos la lista de jugadores
    const playersRaw = await rcon.send('list');

    // Parseamos jugadores
    let players = [];
    if (playersRaw.includes(':')) {
      const parts = playersRaw.split(':')[1].trim();
      players = parts ? parts.split(',').map(p => p.trim()) : [];
    }

    // Stats de CPU y RAM
    const os = require('os');
    const cpu = os.loadavg()[0].toFixed(2);
    const ram = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(0) + 'MB';

    // Inicializamos el contador si no está corriendo
    if (!uptimeInterval) {
      uptimeInterval = setInterval(() => { serverUptimeSeconds++; }, 1000);
    }

    // Convertimos segundos a hh:mm:ss
    const hours = Math.floor(serverUptimeSeconds / 3600);
    const minutes = Math.floor((serverUptimeSeconds % 3600) / 60);
    const seconds = serverUptimeSeconds % 60;
    const uptime = `${hours}h ${minutes}m ${seconds}s`;

    res.json({
      online: true,
      raw: 'Servidor Online',
      players,
      cpu,
      ram,
      uptime
    });
  } catch (e) {
    console.error(e);
    res.json({ online: false, raw: 'Error obteniendo datos', players: [], cpu: 0, ram: 0, uptime: '0s' });
  }
});

app.get('/api/players/list', async (req, res) => {
  try {
    const status = await req.app.locals.rcon.send('list');
    let players = [];
    if (status.includes(':')) {
      const parts = status.split(':')[1].trim();
      players = parts ? parts.split(',').map(p => ({ name: p.trim(), playTime: '0h' })) : [];
    }
    res.json(players);
  } catch (e) {
    console.error(e);
    res.json([]);
  }
});

// server/logStream.js

import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8081 }); // canal de logs

const logPath = "C:\\Users\\Noxi-PC\\Desktop\\SVALETARO\\logs\\latest.log";

fs.watchFile(logPath, () => {
  const data = fs.readFileSync(logPath, "utf-8");
  const lines = data.trim().split("\n");
  const lastLines = lines.slice(-20).join("\n"); // últimas líneas
  wss.clients.forEach(c => c.send(lastLines));
});

console.log("Log stream activo en ws://localhost:8081");

// Lista de jugadores
app.get('/api/players/list', async (req, res) => {
  const players = await getAllPlayers(); // tu función que devuelve array de jugadores con stats, avatar, logros, inventario, etc.
  res.json(players);
});

// Guardar inventario
app.post('/api/players/save-inventory', async (req, res) => {
  const { player } = req.body;
  await savePlayerInventory(player); // guarda en backups o carpeta local
  res.json({ success: true });
});

// Eliminar perfil
app.post('/api/players/delete', async (req, res) => {
  const { player } = req.body;
  await deletePlayerData(player);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

