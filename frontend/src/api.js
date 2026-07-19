const API_BASE = import.meta.env.PROD ? '/file-transfer' : '';

let authToken = localStorage.getItem('authToken') || '';

export function getToken() {
  return authToken;
}

export function setToken(token) {
  authToken = token;
  localStorage.setItem('authToken', token);
}

export function clearToken() {
  authToken = '';
  localStorage.removeItem('authToken');
}

export function isAuthenticated() {
  return !!authToken;
}

function headers() {
  return { 'X-Auth-Token': authToken };
}

// ---------------------------------------------------------------------------
// Client-side password encryption (defense-in-depth)
// ---------------------------------------------------------------------------
// Encrypt password fields with the server's public key BEFORE sending, so the
// plaintext never appears in DevTools, browser history, or client logs. TLS
// still secures transport; this just keeps cleartext secrets off the client.
async function fetchLoginKey() {
  const res = await fetch(`${API_BASE}/api/auth/pubkey`);
  if (!res.ok) throw new Error('pubkey fetch failed');
  const { key } = await res.json();
  const der = Uint8Array.from(atob(key), c => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', der.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
}

// Returns a copy of `payload` with the named fields RSA-encrypted (base64) and
// `encrypted: true` set. Falls back to the plaintext payload if Web Crypto is
// unavailable (non-secure context) — the server accepts plaintext when the
// flag is absent, so login never breaks.
async function encryptFields(payload, fields) {
  try {
    if (!window.crypto?.subtle) return payload;
    const key = await fetchLoginKey();
    const enc = new TextEncoder();
    const out = { ...payload, encrypted: true };
    for (const f of fields) {
      if (out[f] == null || out[f] === '') continue;
      const ct = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, enc.encode(out[f]));
      out[f] = btoa(String.fromCharCode(...new Uint8Array(ct)));
    }
    return out;
  } catch {
    return payload; // graceful fallback to plaintext-over-TLS
  }
}

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events)
// ---------------------------------------------------------------------------
// Opens an EventSource to /api/events and calls onChange() whenever the server
// pushes a "change" event (an upload/delete/rename/folder from ANY device).
// EventSource can't send custom headers, so the auth token rides as a query
// param. Returns the EventSource so the caller can .close() on unmount; it
// auto-reconnects on transient drops.
export function subscribeToChanges(onChange) {
  if (!authToken) return null;
  const es = new EventSource(`${API_BASE}/api/events?token=${encodeURIComponent(authToken)}`);
  es.addEventListener('change', onChange);
  return es;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function login(username, password) {
  // Password is RSA-encrypted client-side so it never appears as plaintext in
  // DevTools/history; the server decrypts and bcrypt-verifies as usual.
  const body = await encryptFields({ username, password }, ['password']);
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.success) {
    setToken(data.token);
    return { success: true, role: data.role, username: data.username };
  }
  return { success: false, error: data.error || 'Invalid username or password' };
}

export async function fetchMe() {
  if (!isAuthenticated()) throw new Error('No token');
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: headers() });
  if (res.status === 401) throw new Error('Unauthorized');
  return res.json();
}

export async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: headers() });
  clearToken();
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function updateProfile(newUsername, oldPassword, newPassword) {
  let payload = { newUsername };
  if (newPassword) {
    payload.oldPassword = oldPassword;
    payload.newPassword = newPassword;
    payload = await encryptFields(payload, ['oldPassword', 'newPassword']);
  }
  const res = await fetch(`${API_BASE}/api/user/profile`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Admin users
// ---------------------------------------------------------------------------

export async function fetchAdminUsers() {
  const res = await fetch(`${API_BASE}/api/admin/users`, { headers: headers() });
  return res.json();
}

export async function createAdminUser(username, password, role) {
  const body = await encryptFields({ username, password, role }, ['password']);
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function updateAdminUser(oldUsername, newUsername, newPassword, role) {
  let payload = { oldUsername, newUsername, role };
  if (newPassword) {
    payload.newPassword = newPassword;
    payload = await encryptFields(payload, ['newPassword']);
  }

  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteAdminUser(username) {
  const res = await fetch(
    `${API_BASE}/api/admin/users?username=${encodeURIComponent(username)}`,
    { method: 'DELETE', headers: headers() }
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function fetchFiles(path = '') {
  const res = await fetch(`${API_BASE}/api/files?path=${encodeURIComponent(path)}`, {
    headers: headers(),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`, { headers: headers() });
  return res.json();
}

export async function createFolder(name, parentPath) {
  const res = await fetch(`${API_BASE}/api/folder`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentPath }),
  });
  return res.json();
}

export async function deleteItem(filePath) {
  const res = await fetch(
    `${API_BASE}/api/files?path=${encodeURIComponent(filePath)}`,
    { method: 'DELETE', headers: headers() }
  );
  return res.json();
}

export async function renameItem(oldPath, newName) {
  const res = await fetch(`${API_BASE}/api/files`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newName }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Text note
// ---------------------------------------------------------------------------

export async function fetchText() {
  const res = await fetch(`${API_BASE}/api/text`, { headers: headers() });
  return res.json();
}

export async function saveText(text) {
  const res = await fetch(`${API_BASE}/api/text`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res.json();
}
