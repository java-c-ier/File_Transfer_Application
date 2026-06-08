require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const fsp        = require('fs/promises');
const os         = require('os');
const archiver   = require('archiver');
const crypto     = require('crypto');
const bcrypt     = require('bcrypt');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');
const { pipeline } = require('stream/promises');

const app        = express();
// Trust the first proxy hop (Apache) so express-rate-limit reads the real
// client IP from X-Forwarded-For instead of the loopback address.
app.set('trust proxy', 1);
const PORT       = process.env.PORT || 3001;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const MAX_FILE_SIZE   = parseInt(process.env.MAX_FILE_SIZE_MB || '500') * 1024 * 1024;
const BCRYPT_ROUNDS   = 12;
// Session TTL: 8 hours
const SESSION_TTL_MS  = 8 * 60 * 60 * 1000;

// Temp directory for chunk uploads
const CHUNKS_TMP_DIR = path.join(os.tmpdir(), 'fta-chunks');
fs.mkdirSync(CHUNKS_TMP_DIR, { recursive: true });

// Clean up orphaned meta dirs (and their staging files) older than 24 hours on startup
try {
  const dirs   = fs.readdirSync(CHUNKS_TMP_DIR);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const dir of dirs) {
    try {
      const p = path.join(CHUNKS_TMP_DIR, dir);
      if (fs.statSync(p).mtimeMs < cutoff) {
        // Remove the associated staging file if we can find it
        try {
          const meta     = JSON.parse(fs.readFileSync(path.join(p, 'meta.json'), 'utf8'));
          const destBase = safePath(UPLOAD_DIR, meta.sanitizedSubfolder || '');
          if (destBase) {
            const stagingPath = path.join(destBase, meta.sanitizedFileName) + '.uploading';
            if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
          }
        } catch { /* meta unreadable — skip staging cleanup */ }
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch { /* continue with next dir */ }
  }
} catch { /* CHUNKS_TMP_DIR may not exist yet */ }

// ---------------------------------------------------------------------------
// Data & User Management
// ---------------------------------------------------------------------------
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });

if (!fs.existsSync(USERS_FILE)) {
  const defaultAdminPassword = ACCESS_PASSWORD || 'admin';
  fs.writeFileSync(USERS_FILE, JSON.stringify({
    ADMIN: [{ username: 'admin', password: defaultAdminPassword, role: 'ADMIN' }],
    USER: []
  }, null, 2));
}

// In-memory users cache — avoids a disk read on every authenticated request
let usersCache = null;

function getUsers() {
  if (!usersCache) {
    usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  }
  return usersCache;
}

function saveUsers(users) {
  usersCache = users;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ---------------------------------------------------------------------------
// Password helpers
// ---------------------------------------------------------------------------

/** Hash a plaintext password with bcrypt. */
async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored value.
 * Handles migration: if the stored value is NOT a bcrypt hash it is a legacy
 * SHA-256 hex string; compare directly and, on match, re-hash with bcrypt.
 */
async function verifyPassword(plain, stored) {
  if (!stored) {
    // No password set — allow any non-empty value and set it
    return true;
  }
  if (stored.startsWith('$2b$') || stored.startsWith('$2a$')) {
    // Modern bcrypt hash
    return bcrypt.compare(plain, stored);
  }
  // Legacy: stored value is the raw SHA-256 hex that the old client sent.
  // The new client no longer hashes on the frontend, but old passwords may
  // still be plain-SHA256. Accept both the raw plaintext AND the SHA-256 form.
  const sha256 = crypto.createHash('sha256').update(plain).digest('hex');
  return stored === plain || stored === sha256;
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------
const sessions = new Map();
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Persist the session store to disk so a backend restart (deploy, crash,
 * systemd reload) does NOT log everyone out. Written atomically via a temp
 * file + rename so a crash mid-write can't corrupt the file.
 */
function saveSessions() {
  try {
    const arr = [];
    for (const [token, s] of sessions.entries()) arr.push({ token, ...s });
    const tmp = SESSIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr));
    fs.renameSync(tmp, SESSIONS_FILE);
  } catch (err) {
    console.error('Failed to persist sessions:', err.message);
  }
}

/** Restore sessions on startup, dropping any that already expired. */
function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const arr = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    for (const { token, username, role, expiresAt } of arr) {
      if (token && expiresAt > now) sessions.set(token, { username, role, expiresAt });
    }
    console.log(`Restored ${sessions.size} active session(s) from disk.`);
  } catch (err) {
    console.error('Failed to load sessions:', err.message);
  }
}
loadSessions();

/** Purge expired sessions periodically (every 30 minutes). */
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) { sessions.delete(token); removed++; }
  }
  if (removed) saveSessions();
}, 30 * 60 * 1000);

// ---------------------------------------------------------------------------
// Stats cache
// ---------------------------------------------------------------------------
let statsCache   = null;
let statsCacheAt = 0;
const STATS_TTL  = 30_000; // 30 s

function invalidateStats() {
  statsCacheAt = 0;
}

// ---------------------------------------------------------------------------
// Path safety helper
// ---------------------------------------------------------------------------

/**
 * Resolve a user-supplied relative path safely within a base directory.
 * Returns null if the resolved path escapes the base.
 */
function safePath(base, relative) {
  const root     = path.resolve(base);
  const resolved = path.resolve(base, relative.replace(/^[/\\]+/, ''));
  // Compare with a trailing separator so a sibling dir like `<root>-evil`
  // (which shares the `<root>` prefix) cannot pass the containment check.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Compress JSON/text responses; skip already-compressed binary formats
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    const ct = res.getHeader('Content-Type') || '';
    // Never compress Server-Sent Events — compression buffers chunks and the
    // stream would never flush to the client.
    if (/zip|gzip|jpeg|jpg|png|gif|mp4|mkv|webm|pdf|rar|7z|octet-stream|event-stream/.test(ct)) return false;
    return compression.filter(req, res);
  }
}));

// Limit JSON body size to prevent large-payload DoS
app.use(express.json({ limit: '64kb' }));

// ---------------------------------------------------------------------------
// Base-path normalisation
// ---------------------------------------------------------------------------
// The production Vite build uses base = '/file-transfer/', so every browser
// request arrives prefixed: /file-transfer/api/files, /file-transfer/assets/…
// Stripping the prefix once here keeps all route handlers path-agnostic and
// avoids duplicating every route under two paths.
app.use((req, res, next) => {
  if (
    req.url === '/file-transfer' ||
    req.url.startsWith('/file-transfer/') ||
    req.url.startsWith('/file-transfer?')
  ) {
    req.url = req.url.slice('/file-transfer'.length) || '/';
  }
  next();
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist'), {
    setHeaders: (res, filePath) => {
      // Vite emits content-hashed asset filenames → safe to cache forever.
      // Everything else (index.html) stays revalidated so deploys are seen.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
}

// ---------------------------------------------------------------------------
// Authentication middleware
// ---------------------------------------------------------------------------
function authenticate(req, res, next) {
  // Header is primary. The SSE endpoint (/api/events) uses EventSource, which
  // cannot set custom headers, so it falls back to a ?token= query param.
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  req.user = session;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'ADMIN') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// ---------------------------------------------------------------------------
// Server-Sent Events — live directory updates across devices
// ---------------------------------------------------------------------------
// Each open browser holds one GET /api/events stream. Whenever the upload tree
// changes (upload finalised, folder created, file deleted/renamed) the server
// pushes a "change" event and every connected client refetches its current
// folder — so an upload on a laptop appears on a phone within ~1s, no manual
// refresh needed.
const sseClients = new Set();

function broadcastChange(reason) {
  const payload = `event: change\ndata: ${JSON.stringify({ reason })}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* removed on its own 'close' */ }
  }
}

app.get('/api/events', authenticate, (req, res) => {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering':  'no',   // tell proxies not to buffer the stream
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');   // EventSource auto-reconnects after 5s if dropped
  res.write(': connected\n\n');   // open the stream immediately

  sseClients.add(res);

  // Heartbeat keeps the connection alive through idle proxy/firewall timeouts.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Rate limiter for auth endpoints
// ---------------------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,                      // max 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

// ---------------------------------------------------------------------------
// Multer: regular (legacy) upload
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subfolder = req.headers['x-upload-path'] || '';
    const dest = safePath(UPLOAD_DIR, subfolder);
    if (!dest) return cb(new Error('Invalid upload path'));
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // Strip any directory components / traversal so the file cannot escape `dest`
    const safeName = path.basename(decoded).replace(/\.\./g, '');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// Multer: chunk upload — memory storage avoids the temp-file round-trip
// (disk path: write chunk → read chunk → write to staging = 3× I/O per chunk;
//  memory path: receive chunk in RAM → write to staging = 1× I/O per chunk)
const CHUNK_MEMORY_LIMIT = 25 * 1024 * 1024;  // 10 % headroom over max 20 MB chunk
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHUNK_MEMORY_LIMIT },
});

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const users = getUsers();
  if (!users.ADMIN) users.ADMIN = [];
  if (!users.USER)  users.USER  = [];

  let userObj = null, role = '';
  const adminMatch = users.ADMIN.find(u => u.username === username);
  if (adminMatch) { userObj = adminMatch; role = 'ADMIN'; }
  else {
    const userMatch = users.USER.find(u => u.username === username);
    if (userMatch) { userObj = userMatch; role = 'USER'; }
  }

  if (!userObj) return res.status(401).json({ error: 'Invalid username or password' });

  // A blank password is NOT a "claim me" invitation. Previously the first
  // caller to guess the username could set the password and take the account
  // over. Accounts must have a password assigned by an admin at creation time;
  // reject login until one exists.
  if (!userObj.password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const ok = await verifyPassword(password, userObj.password);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

  // Migrate legacy plain/SHA-256 passwords to bcrypt on first successful login
  if (!userObj.password.startsWith('$2b$') && !userObj.password.startsWith('$2a$')) {
    userObj.password = await hashPassword(password);
    saveUsers(users);
  }

  const finalRole = userObj.role || role;
  const token = generateToken();
  sessions.set(token, { username: userObj.username, role: finalRole, expiresAt: Date.now() + SESSION_TTL_MS });
  saveSessions();
  return res.json({ success: true, token, role: finalRole, username: userObj.username });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) { sessions.delete(token); saveSessions(); }
  res.json({ success: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------
app.put('/api/user/profile', authenticate, async (req, res) => {
  const { newUsername, oldPassword, newPassword } = req.body;
  const currentUsername = req.user.username;
  const targetRole      = req.user.role;
  const users = getUsers();
  if (!users.ADMIN) users.ADMIN = [];
  if (!users.USER)  users.USER  = [];

  const allUsers = [...users.ADMIN, ...users.USER];
  const userRef  = (targetRole === 'ADMIN' ? users.ADMIN : users.USER).find(u => u.username === currentUsername);
  if (!userRef) return res.status(404).json({ error: 'User not found' });

  let targetUsername = currentUsername;
  if (newUsername && newUsername.trim() !== currentUsername) {
    targetUsername = newUsername.trim();
    if (allUsers.some(u => u.username === targetUsername)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    userRef.username = targetUsername;
  }

  if (newPassword) {
    const ok = await verifyPassword(oldPassword, userRef.password);
    if (!ok) return res.status(401).json({ error: 'Incorrect current password' });
    userRef.password = await hashPassword(newPassword);
  }

  saveUsers(users);
  if (targetUsername !== currentUsername) {
    const token = req.headers['x-auth-token'];
    sessions.set(token, { username: targetUsername, role: targetRole, expiresAt: Date.now() + SESSION_TTL_MS });
    saveSessions();
  }
  res.json({ success: true, username: targetUsername });
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------
app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
  const users = getUsers();
  res.json({ users: [
    ...(users.ADMIN || []).map(u => ({ username: u.username, role: 'ADMIN' })),
    ...(users.USER  || []).map(u => ({ username: u.username, role: 'USER'  })),
  ]});
});

app.post('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  const users = getUsers();
  if (!users.ADMIN) users.ADMIN = [];
  if (!users.USER)  users.USER  = [];
  if (!username) return res.status(400).json({ error: 'Missing requirements' });

  const cleanUsername = username.trim();
  if (!password || password.trim() === '') {
    return res.status(400).json({ error: 'Password is required' });
  }
  const allUsers = [...users.ADMIN, ...users.USER];
  if (allUsers.some(u => u.username === cleanUsername)) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const assignRole   = role === 'ADMIN' ? 'ADMIN' : 'USER';
  const hashedPwd    = await hashPassword(password);
  users[assignRole].push({ username: cleanUsername, password: hashedPwd, role: assignRole });
  saveUsers(users);
  res.json({ success: true, username: cleanUsername });
});

app.put('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  const { oldUsername, newUsername, newPassword, role } = req.body;
  const users = getUsers();
  if (!users.ADMIN) users.ADMIN = [];
  if (!users.USER)  users.USER  = [];

  let currentGroup = '';
  let userIndex = users.ADMIN.findIndex(u => u.username === oldUsername);
  if (userIndex !== -1) currentGroup = 'ADMIN';
  else {
    userIndex = users.USER.findIndex(u => u.username === oldUsername);
    if (userIndex !== -1) currentGroup = 'USER';
  }
  if (!currentGroup) return res.status(404).json({ error: 'User not found' });

  const targetUsername = newUsername !== undefined ? newUsername.trim() : oldUsername;
  const allUsers = [...users.ADMIN, ...users.USER];
  if (targetUsername !== oldUsername && allUsers.some(u => u.username === targetUsername)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const userObj    = users[currentGroup][userIndex];
  userObj.username = targetUsername;
  if (newPassword)          userObj.password = await hashPassword(newPassword);
  const targetRole = role !== undefined ? role : currentGroup;
  userObj.role     = targetRole;

  if (targetRole !== currentGroup) {
    users[currentGroup].splice(userIndex, 1);
    users[targetRole === 'ADMIN' ? 'ADMIN' : 'USER'].push(userObj);
  }
  saveUsers(users);

  for (const [token, session] of sessions.entries()) {
    if (session.username === oldUsername) {
      sessions.set(token, { username: targetUsername, role: targetRole, expiresAt: session.expiresAt });
    }
  }
  saveSessions();
  res.json({ success: true });
});

app.delete('/api/admin/users', authenticate, requireAdmin, (req, res) => {
  const { username } = req.query;
  const users = getUsers();
  if (!users.ADMIN) users.ADMIN = [];
  if (!users.USER)  users.USER  = [];
  if (username === req.user.username) return res.status(400).json({ error: 'Cannot delete yourself' });

  let found = false;
  const adminIndex = users.ADMIN.findIndex(u => u.username === username);
  if (adminIndex !== -1) {
    if (users.ADMIN.length <= 1) return res.status(403).json({ error: 'Cannot delete the final root admin' });
    users.ADMIN.splice(adminIndex, 1);
    found = true;
  } else {
    const userIndex = users.USER.findIndex(u => u.username === username);
    if (userIndex !== -1) { users.USER.splice(userIndex, 1); found = true; }
  }
  if (!found) return res.status(404).json({ error: 'User not found' });
  saveUsers(users);
  for (const [token, session] of sessions.entries()) {
    if (session.username === username) sessions.delete(token);
  }
  saveSessions();
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// File listing (async I/O, non-blocking)
// ---------------------------------------------------------------------------
app.get('/api/files', authenticate, async (req, res) => {
  const subPath    = req.query.path || '';
  const targetDir  = safePath(UPLOAD_DIR, subPath);
  if (!targetDir) return res.status(400).json({ error: 'Invalid path' });

  const sanitized = path.relative(UPLOAD_DIR, targetDir);

  try {
    await fsp.access(targetDir);
  } catch {
    return res.json({ files: [], currentPath: sanitized, exists: false });
  }

  try {
    const entries = await fsp.readdir(targetDir, { withFileTypes: true });
    // Hide dotfiles, the shared text note, and ".uploading" staging files —
    // the latter are partial/in-flight uploads that must never show as real files.
    const visible  = entries.filter(e =>
      !e.name.startsWith('.') && e.name !== 'text.txt' && !e.name.endsWith('.uploading')
    );

    const files = await Promise.all(visible.map(async entry => {
      const fullPath = path.join(targetDir, entry.name);
      const stat     = await fsp.stat(fullPath);
      return {
        name:        entry.name,
        isDirectory: entry.isDirectory(),
        size:        entry.isDirectory() ? null : stat.size,
        modified:    stat.mtime,
        path:        sanitized ? `${sanitized}/${entry.name}` : entry.name,
      };
    }));

    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ files, currentPath: sanitized });
  } catch {
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// ---------------------------------------------------------------------------
// Legacy bulk upload (kept for compatibility)
// ---------------------------------------------------------------------------
app.post('/api/upload', authenticate, upload.array('files', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  invalidateStats();
  broadcastChange('upload');
  const uploaded = req.files.map(f => ({ name: f.filename, size: f.size }));
  res.json({ success: true, files: uploaded });
});

// ---------------------------------------------------------------------------
// Chunked upload — streaming raw binary, direct byte-offset write
// ---------------------------------------------------------------------------
// Each chunk is sent as application/octet-stream with metadata in headers.
// The request body is piped directly to the staging file at the correct byte
// offset via a Writable stream — no multipart parsing, no in-memory buffer.
//
// Data path:  network → kernel socket buffer → Node Writable → disk
// (Previously: network → multer memory buffer → Node write → disk)
//
// Resume tracking: meta.json in CHUNKS_TMP_DIR records received chunk indices.
// The staging file lives next to the final destination and is atomically
// renamed when the last chunk completes.
// ---------------------------------------------------------------------------
app.post('/api/upload-chunk', authenticate, async (req, res) => {
  let chunkFd = null;
  try {
    // Metadata arrives in headers — no multipart body to parse
    const uploadId    = req.headers['x-upload-id'];
    const chunkIndex  = req.headers['x-chunk-index'];
    const totalChunks = req.headers['x-total-chunks'];
    const fileName    = req.headers['x-file-name'];
    const byteOffset  = req.headers['x-byte-offset'];
    const fileSize    = req.headers['x-file-size'];

    if (!uploadId || chunkIndex === undefined || !totalChunks || !fileName || byteOffset === undefined) {
      return res.status(400).json({ error: 'Missing required headers' });
    }

    const subfolder = req.headers['x-upload-path'] || '';
    const destBase  = safePath(UPLOAD_DIR, subfolder);
    if (!destBase) return res.status(400).json({ error: 'Invalid upload path' });

    const sanitizedFileName = path.basename(decodeURIComponent(fileName)).replace(/\.\./g, '');
    const totalChunksNum    = parseInt(totalChunks, 10);
    const chunkIndexNum     = parseInt(chunkIndex, 10);
    const byteOffsetNum     = parseInt(byteOffset, 10);
    const fileSizeNum       = parseInt(fileSize, 10) || 0;

    if (isNaN(totalChunksNum) || isNaN(chunkIndexNum) || isNaN(byteOffsetNum) ||
        chunkIndexNum < 0 || chunkIndexNum >= totalChunksNum ||
        totalChunksNum > 10000 || byteOffsetNum < 0) {
      return res.status(400).json({ error: 'Invalid chunk parameters' });
    }

    // Enforce the configured maximum file size (prevents disk-fill DoS)
    if (fileSizeNum > MAX_FILE_SIZE || byteOffsetNum > MAX_FILE_SIZE) {
      return res.status(413).json({ error: 'File exceeds maximum allowed size' });
    }

    const safeUploadId = uploadId.replace(/[^a-zA-Z0-9\-_]/g, '');
    const metaDir      = path.join(CHUNKS_TMP_DIR, safeUploadId);
    const metaPath     = path.join(metaDir, 'meta.json');
    await fsp.mkdir(metaDir, { recursive: true });
    await fsp.mkdir(destBase, { recursive: true });

    const finalPath   = path.join(destBase, sanitizedFileName);
    const stagingPath = finalPath + '.uploading';

    // ── Create sparse staging file on first chunk ──
    try {
      await fsp.access(stagingPath);
    } catch {
      const createFd = await fsp.open(stagingPath, 'w');
      if (fileSizeNum > 0 && fileSizeNum <= MAX_FILE_SIZE) {
        await createFd.truncate(fileSizeNum);
      }
      await createFd.close();
    }

    // ── Stream request body directly to disk at byte offset ──
    // createWriteStream with `start` is the most efficient path: Node.js
    // uses its built-in 64 kB write buffer and issues large sequential
    // pwrite() calls rather than one syscall per TCP packet.
    const diskWriter = fs.createWriteStream(stagingPath, {
      flags: 'r+',
      start: byteOffsetNum,
      highWaterMark: 4 * 1024 * 1024,   // 4 MB write buffer → fewer syscalls
    });
    await pipeline(req, diskWriter);

    // ── Update resume metadata ──
    let meta = {
      sanitizedSubfolder: path.relative(UPLOAD_DIR, destBase),
      sanitizedFileName,
      totalChunks: totalChunksNum,
      received: [],
    };
    try { meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')); } catch { /* new upload */ }
    if (!meta.received.includes(chunkIndexNum)) meta.received.push(chunkIndexNum);
    await fsp.writeFile(metaPath, JSON.stringify(meta));

    const isComplete = meta.received.length === totalChunksNum;

    if (isComplete) {
      await fsp.rename(stagingPath, finalPath);
      await fsp.rm(metaDir, { recursive: true, force: true });
      invalidateStats();
      broadcastChange('upload');
      const { size } = await fsp.stat(finalPath);
      return res.json({ done: true, name: sanitizedFileName, size });
    }

    res.json({ done: false, received: meta.received.length, total: totalChunksNum });
  } catch (err) {
    console.error('Chunk upload error:', err);
    if (chunkFd) { try { await chunkFd.close(); } catch { /* best-effort */ } }
    if (req.file?.path) { try { await fsp.unlink(req.file.path); } catch { /* best-effort */ } }
    res.status(500).json({ error: err.message });
  }
});

// Returns which chunk indices have already been written (for cross-session resume)
app.get('/api/upload-chunk/status', authenticate, async (req, res) => {
  const { uploadId } = req.query;
  if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });

  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9\-_]/g, '');
  const metaPath = path.join(CHUNKS_TMP_DIR, safeUploadId, 'meta.json');

  try {
    const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
    const received = Array.isArray(meta.received)
      ? [...meta.received].sort((a, b) => a - b)
      : [];
    return res.json({ received });
  } catch {
    return res.json({ received: [] });
  }
});

// ---------------------------------------------------------------------------
// Streaming upload — single XHR per file, direct byte-offset write
// ---------------------------------------------------------------------------
// The client sends the entire file (or remaining bytes on resume) as one
// application/octet-stream POST.  Metadata is in request headers.
// Node pipes the body straight to disk; no buffering in application memory.
//
// Why this is faster than chunking:
//   • One TCP connection per file → TCP slow-start fires once, not N times
//   • No inter-chunk round-trip idle time
//   • With ProxyRequestBuffering Off, Apache forwards bytes as they arrive
//     instead of buffering the full body before forwarding
//
// Pause/resume flow:
//   client aborts XHR  →  pipeline rejects (ECONNRESET / premature close)
//   server exits handler silently (staging file has partial data)
//   client queries /api/upload-stream/status → bytesReceived = staging file size
//   client sends new XHR with X-Byte-Offset = bytesReceived
// ---------------------------------------------------------------------------
app.post('/api/upload-stream', authenticate, async (req, res) => {
  try {
    const fileName   = req.headers['x-file-name'];
    const fileSize   = req.headers['x-file-size'];
    const byteOffset = req.headers['x-byte-offset'];

    if (!fileName) return res.status(400).json({ error: 'Missing x-file-name header' });

    const subfolder = req.headers['x-upload-path'] || '';
    const destBase  = safePath(UPLOAD_DIR, subfolder);
    if (!destBase) return res.status(400).json({ error: 'Invalid upload path' });

    const sanitizedFileName = path.basename(decodeURIComponent(fileName)).replace(/\.\./g, '');
    const byteOffsetNum     = parseInt(byteOffset || '0', 10);
    const fileSizeNum       = parseInt(fileSize  || '0', 10);

    if (isNaN(byteOffsetNum) || byteOffsetNum < 0) {
      return res.status(400).json({ error: 'Invalid byte offset' });
    }

    // Enforce the configured maximum file size. The legacy multer route checks
    // this via limits.fileSize; the raw streaming route must too, otherwise a
    // client can pipe unbounded bytes to disk and fill the volume (DoS).
    if (fileSizeNum > MAX_FILE_SIZE || byteOffsetNum > MAX_FILE_SIZE) {
      return res.status(413).json({ error: 'File exceeds maximum allowed size' });
    }

    await fsp.mkdir(destBase, { recursive: true });

    const finalPath   = path.join(destBase, sanitizedFileName);
    const stagingPath = finalPath + '.uploading';

    // Open staging file: fresh create at offset 0, or re-open for in-place resume
    const writeStream = fs.createWriteStream(stagingPath, {
      flags: byteOffsetNum === 0 ? 'w' : 'r+',
      start: byteOffsetNum,
      highWaterMark: 4 * 1024 * 1024,   // 4 MB write buffer → fewer syscalls
    });

    // Hard guard against a client that lies about / omits Content-Length
    // (e.g. chunked transfer-encoding): abort the moment the running total
    // would exceed the cap, so the staging file can't grow without bound.
    let bytesWritten = byteOffsetNum;
    req.on('data', chunk => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_FILE_SIZE) req.destroy(new Error('File exceeds maximum allowed size'));
    });

    // Pipe request body straight to disk — catch client disconnects gracefully
    try {
      await pipeline(req, writeStream);
    } catch (pipeErr) {
      // Client aborted (pause) or connection reset — staging file has partial data.
      // The connection is gone so we cannot send a response; the client will call
      // /api/upload-stream/status to discover the resume offset.
      if (
        req.destroyed ||
        pipeErr.code === 'ECONNRESET'  ||
        pipeErr.code === 'ECONNABORTED' ||
        pipeErr.code === 'ERR_STREAM_PREMATURE_CLOSE'
      ) {
        return; // nothing to send — connection is dead
      }
      throw pipeErr; // real I/O error — let outer catch handle it
    }

    // Full body received — check whether this slice completes the file
    let bytesReceived = 0;
    try {
      const { size } = await fsp.stat(stagingPath);
      bytesReceived = size;
    } catch { /* staging file may have just been renamed by a concurrent request */ }

    // Handle zero-byte files: offset 0 + empty body → complete immediately
    const isComplete = fileSizeNum === 0
      ? (byteOffsetNum === 0)
      : (bytesReceived >= fileSizeNum);

    if (isComplete) {
      await fsp.rename(stagingPath, finalPath);
      invalidateStats();
      broadcastChange('upload');
      let finalSize = fileSizeNum;
      try { finalSize = (await fsp.stat(finalPath)).size; } catch { /* best-effort */ }
      return res.json({ done: true, name: sanitizedFileName, size: finalSize });
    }

    res.json({ done: false, bytesReceived });
  } catch (err) {
    console.error('Stream upload error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Returns bytes already written to the staging file — used as resume offset
app.get('/api/upload-stream/status', authenticate, async (req, res) => {
  const fileName  = req.query.fileName;
  const subfolder = req.query.path || '';

  if (!fileName) return res.status(400).json({ error: 'Missing fileName' });

  const destBase = safePath(UPLOAD_DIR, subfolder);
  if (!destBase) return res.status(400).json({ error: 'Invalid path' });

  const sanitizedFileName = path.basename(decodeURIComponent(fileName)).replace(/\.\./g, '');
  const stagingPath = path.join(destBase, sanitizedFileName) + '.uploading';

  try {
    const { size } = await fsp.stat(stagingPath);
    res.json({ bytesReceived: size });
  } catch {
    // No staging file → no partial data → resume from byte 0
    res.json({ bytesReceived: 0 });
  }
});

// Cancel / cleanup: removes meta dir AND the staging file if still present
app.delete('/api/upload-chunk', authenticate, async (req, res) => {
  const { uploadId } = req.query;
  if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });

  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9\-_]/g, '');
  const metaDir  = path.join(CHUNKS_TMP_DIR, safeUploadId);
  const metaPath = path.join(metaDir, 'meta.json');

  try {
    // Best-effort: remove the staging file using info from meta.json
    try {
      const meta     = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
      const destBase = safePath(UPLOAD_DIR, meta.sanitizedSubfolder || '');
      if (destBase) {
        const stagingPath = path.join(destBase, meta.sanitizedFileName) + '.uploading';
        await fsp.unlink(stagingPath).catch(() => { /* may not exist */ });
      }
    } catch { /* meta not found or invalid — that's fine */ }

    await fsp.rm(metaDir, { recursive: true, force: true }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Download with Range / resume support
// ---------------------------------------------------------------------------
app.get('/api/download', authenticate, (req, res) => {
  const filePath = req.query.path || '';
  const fullPath = safePath(UPLOAD_DIR, filePath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat     = fs.statSync(fullPath);
  const fileSize = stat.size;
  const fileName = path.basename(fullPath);
  const encoded  = encodeURIComponent(fileName);
  const range    = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).json({ error: 'Range Not Satisfiable' });
    }

    res.writeHead(206, {
      'Content-Range':       `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':       'bytes',
      'Content-Length':      end - start + 1,
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
    });
    fs.createReadStream(fullPath, { start, end, highWaterMark: 1024 * 1024 }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length':      fileSize,
      'Accept-Ranges':       'bytes',
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
    });
    fs.createReadStream(fullPath, { highWaterMark: 1024 * 1024 }).pipe(res);
  }
});

// ---------------------------------------------------------------------------
// ZIP download (level 1 = fast; streaming, no blob buffering)
// ---------------------------------------------------------------------------
app.get('/api/download-zip', authenticate, (req, res) => {
  const folderPath = req.query.path || '';
  const fullPath   = safePath(UPLOAD_DIR, folderPath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  const folderName = path.basename(fullPath) || 'files';
  const encoded    = encodeURIComponent(folderName);
  res.setHeader('Content-Type',        'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}.zip`);
  res.setHeader('Transfer-Encoding',   'chunked');

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  archive.pipe(res);
  archive.directory(fullPath, folderName);
  archive.finalize();
});

// ---------------------------------------------------------------------------
// Folder operations
// ---------------------------------------------------------------------------
app.post('/api/folder', authenticate, (req, res) => {
  const { name, parentPath } = req.body;
  if (!name) return res.status(400).json({ error: 'Folder name required' });

  const sanitizedName = name.replace(/\.\./g, '').replace(/[/\\]/g, '');
  const parentFull    = safePath(UPLOAD_DIR, parentPath || '');
  if (!parentFull) return res.status(400).json({ error: 'Invalid path' });

  const fullPath = path.join(parentFull, sanitizedName);
  // Ensure the new folder also stays within UPLOAD_DIR
  const uploadRoot = path.resolve(UPLOAD_DIR);
  if (fullPath !== uploadRoot && !fullPath.startsWith(uploadRoot + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (fs.existsSync(fullPath)) return res.status(409).json({ error: 'Folder already exists' });
  fs.mkdirSync(fullPath, { recursive: true });
  invalidateStats();
  broadcastChange('folder');
  res.json({ success: true, path: path.relative(UPLOAD_DIR, fullPath) });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
app.delete('/api/files', authenticate, (req, res) => {
  const filePath = req.query.path || '';
  const fullPath = safePath(UPLOAD_DIR, filePath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  if (fullPath === path.resolve(UPLOAD_DIR)) {
    return res.status(403).json({ error: 'Cannot delete root' });
  }
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  try {
    if (fs.statSync(fullPath).isDirectory()) fs.rmSync(fullPath, { recursive: true, force: true });
    else fs.unlinkSync(fullPath);
    invalidateStats();
    broadcastChange('delete');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------
app.put('/api/files', authenticate, (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) return res.status(400).json({ error: 'Missing parameters' });

  const fullOldPath = safePath(UPLOAD_DIR, oldPath);
  if (!fullOldPath) return res.status(400).json({ error: 'Invalid path' });

  const sanitizedNew = newName.replace(/\.\./g, '').replace(/[/\\]/g, '');
  const fullNewPath  = path.join(path.dirname(fullOldPath), sanitizedNew);
  const uploadRoot   = path.resolve(UPLOAD_DIR);
  if (fullNewPath !== uploadRoot && !fullNewPath.startsWith(uploadRoot + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (!fs.existsSync(fullOldPath)) return res.status(404).json({ error: 'File not found' });
  try {
    fs.renameSync(fullOldPath, fullNewPath);
    invalidateStats();
    broadcastChange('rename');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to rename' });
  }
});

// ---------------------------------------------------------------------------
// Text note
// ---------------------------------------------------------------------------
app.get('/api/text', authenticate, (req, res) => {
  const textPath = path.join(UPLOAD_DIR, 'text.txt');
  res.json({ text: fs.existsSync(textPath) ? fs.readFileSync(textPath, 'utf8') : '' });
});

app.post('/api/text', authenticate, (req, res) => {
  fs.writeFileSync(path.join(UPLOAD_DIR, 'text.txt'), req.body.text || '');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Stats (async, cached)
// ---------------------------------------------------------------------------
async function getDirStats(dir) {
  let size = 0, count = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async item => {
      if (item.name.startsWith('.') || (dir === UPLOAD_DIR && item.name === 'text.txt')) return;
      const fp = path.join(dir, item.name);
      if (item.isDirectory()) {
        const sub = await getDirStats(fp);
        size  += sub.size;
        count += sub.count;
      } else {
        try {
          const s = await fsp.stat(fp);
          size  += s.size;
          count += 1;
        } catch {}
      }
    }));
  } catch {}
  return { size, count };
}

app.get('/api/stats', authenticate, async (req, res) => {
  const now = Date.now();
  if (statsCache && now - statsCacheAt < STATS_TTL) {
    return res.json(statsCache);
  }
  try {
    const { size, count } = await getDirStats(UPLOAD_DIR);
    statsCache   = { totalSize: size, fileCount: count, maxUploadSize: MAX_FILE_SIZE };
    statsCacheAt = now;
    res.json(statsCache);
  } catch {
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

// ---------------------------------------------------------------------------
// Catch-all for React routing in production
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 File Transfer App running on http://0.0.0.0:${PORT}`);
  console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
  console.log(`🔒 Password protection: ${ACCESS_PASSWORD ? 'ENABLED' : 'DISABLED'}`);
  console.log(`📦 Max file size: ${MAX_FILE_SIZE / 1024 / 1024}MB\n`);
});

// Keep-alive tuning — prevents silent drops behind load balancers (e.g. AWS ALB, nginx)
server.keepAliveTimeout = 65_000;  // > typical LB idle timeout of 60 s
server.headersTimeout   = 66_000;  // must be > keepAliveTimeout
server.timeout          = 0;       // disable global socket timeout for large transfers

// Disable Nagle's algorithm — removes the up-to-40 ms packet-coalescing delay,
// improving throughput on the raw streaming upload/download paths.
server.on('connection', socket => socket.setNoDelay(true));
