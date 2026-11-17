// Per-browser login conveniences kept in localStorage. Everything here is optional:
// if storage is blocked or cleared, the login screen simply falls back to the email form.

const EMAILS_KEY = 'recent_login_emails';
const DEVICE_KEY = 'device_remembered';
const MAX_EMAILS = 5;

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// Emails that signed in successfully on this browser, newest first.
// Firefox only opens its own autofill list on a second click, so the login form shows this list instead.
export function getRecentEmails() {
  try {
    const list = JSON.parse(read(EMAILS_KEY) || '[]');
    return Array.isArray(list) ? list.filter(e => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

export function addRecentEmail(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return;
  write(EMAILS_KEY, JSON.stringify([e, ...getRecentEmails().filter(x => x !== e)].slice(0, MAX_EMAILS)));
}

export function removeRecentEmail(email) {
  const list = getRecentEmails().filter(x => x !== email);
  write(EMAILS_KEY, JSON.stringify(list));
  return list;
}

// The device cookie is HttpOnly, so JS can't see it. This flag lets the login screen skip
// the "is this device remembered?" request in browsers that never ticked the box.
export function hasDeviceHint() {
  return read(DEVICE_KEY) === '1';
}

export function setDeviceHint(on) {
  if (on) write(DEVICE_KEY, '1');
  else remove(DEVICE_KEY);
}
