const API_BASE = import.meta.env.PROD ? '/transfer-backend' : '';

// Auth is cookie-based (httpOnly). No token is stored in JS or localStorage.

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events)
// ---------------------------------------------------------------------------
export function subscribeToChanges(onChange) {
  const es = new EventSource(`${API_BASE}/api/events`, { withCredentials: true });
  es.addEventListener('change', onChange);
  return es;
}

// ---------------------------------------------------------------------------
// Auth — two-step OTP flow
// ---------------------------------------------------------------------------

export async function requestOtp(identifier) {
  const res = await fetch(`${API_BASE}/api/auth/login/request-otp`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  return res.json();
}

export async function verifyOtp(identifier, otp) {
  const res = await fetch(`${API_BASE}/api/auth/login/verify-otp`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, otp }),
  });
  const data = await res.json();
  if (data.success) return {
    success:   true,
    username:  data.username,
    role:      data.role,
    firstName: data.firstName || '',
    lastName:  data.lastName  || '',
    email:     data.email     || '',
  };
  return { success: false, error: data.error || 'Invalid OTP' };
}

export async function fetchMe() {
  const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  if (res.status === 401) throw new Error('Unauthorized');
  return res.json();
}

export async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function updateProfile(newUsername, newEmail, firstName, lastName) {
  const res = await fetch(`${API_BASE}/api/user/profile`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newUsername, newEmail, firstName, lastName }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Admin users
// ---------------------------------------------------------------------------

export async function fetchAdminUsers() {
  const res = await fetch(`${API_BASE}/api/admin/users`, { credentials: 'include' });
  return res.json();
}

export async function createAdminUser(username, email, role, firstName, lastName) {
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, role, firstName, lastName }),
  });
  return res.json();
}

export async function updateAdminUser(oldUsername, newEmail, role, firstName, lastName, status) {
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldUsername, newUsername: oldUsername, newEmail, role, firstName, lastName, status }),
  });
  return res.json();
}

export async function deleteAdminUser(username) {
  const res = await fetch(
    `${API_BASE}/api/admin/users?username=${encodeURIComponent(username)}`,
    { method: 'DELETE', credentials: 'include' }
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function fetchFiles(path = '', limit = 100, offset = 0) {
  const params = new URLSearchParams({ path, limit, offset });
  const res = await fetch(`${API_BASE}/api/files?${params}`, { credentials: 'include' });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  return res.json();
}

export async function previewFile(path) {
  const res = await fetch(`${API_BASE}/api/preview?path=${encodeURIComponent(path)}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
  const blob = await res.blob();
  return { blob, contentType };
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`, { credentials: 'include' });
  return res.json();
}

export async function createFolder(name, parentPath) {
  const res = await fetch(`${API_BASE}/api/folder`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentPath }),
  });
  return res.json();
}

export async function deleteItem(filePath) {
  const res = await fetch(
    `${API_BASE}/api/files?path=${encodeURIComponent(filePath)}`,
    { method: 'DELETE', credentials: 'include' }
  );
  return res.json();
}

export async function renameItem(oldPath, newName) {
  const res = await fetch(`${API_BASE}/api/files`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newName }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// File sharing (public — no auth required for info/download)
// ---------------------------------------------------------------------------

export async function createShare(filePath) {
  const res = await fetch(`${API_BASE}/api/share`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
  return res.json();
}

export async function fetchShareInfo(id) {
  const res = await fetch(`${API_BASE}/api/share/${encodeURIComponent(id)}`);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function downloadShare(id, token) {
  const res = await fetch(
    `${API_BASE}/api/share/${encodeURIComponent(id)}/download?token=${encodeURIComponent(token)}`
  );
  return { ok: res.ok, status: res.status, res };
}

// ---------------------------------------------------------------------------
// Text note
// ---------------------------------------------------------------------------

export async function fetchText() {
  const res = await fetch(`${API_BASE}/api/text`, { credentials: 'include' });
  return res.json();
}

export async function saveText(text) {
  const res = await fetch(`${API_BASE}/api/text`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res.json();
}
