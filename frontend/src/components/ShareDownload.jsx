import { useState, useEffect, useRef } from 'react';
import { fetchShareInfo, downloadShare } from '../api';

const TOKEN_LEN = 6;

function OtpInput({ value, onChange, hasError, disabled }) {
  const chars  = value.split('');
  const inputs = useRef([]);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  const focusAt = (i) => {
    const el = inputs.current[i];
    if (el) { el.focus(); el.select(); }
  };

  // First unfilled position — this is the only box that can receive focus
  const firstEmpty = chars.findIndex((c, idx) => !c || idx >= chars.length) === -1
    ? chars.length
    : chars.findIndex((c) => !c);
  const activeIdx = Math.min(firstEmpty === -1 ? TOKEN_LEN - 1 : firstEmpty, TOKEN_LEN - 1);

  const handleFocus = (i) => {
    // Redirect focus to first empty box if user clicks ahead
    const target = Math.min(firstEmpty < 0 ? TOKEN_LEN - 1 : firstEmpty, TOKEN_LEN - 1);
    if (i !== target) { focusAt(target); return; }
    setFocusedIdx(target);
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (chars[i]) {
        const next = [...chars]; next[i] = ''; onChange(next.join(''));
      } else if (i > 0) {
        const next = [...chars]; next[i - 1] = ''; onChange(next.join(''));
        focusAt(i - 1);
      }
    }
    // Arrow keys disabled — sequential only
  };

  const handleChange = (i, e) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw) return;
    const next = [...chars];
    next[i] = raw[0]; // only one char per box
    onChange(next.join('').slice(0, TOKEN_LEN));
    if (i < TOKEN_LEN - 1) setTimeout(() => focusAt(i + 1), 0);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TOKEN_LEN);
    const next = pasted.split('').slice(0, TOKEN_LEN);
    onChange(next.join(''));
    setTimeout(() => focusAt(Math.min(pasted.length, TOKEN_LEN - 1)), 0);
  };

  return (
    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
      {Array.from({ length: TOKEN_LEN }).map((_, i) => (
        <input
          key={i}
          ref={el => inputs.current[i] = el}
          type="text"
          inputMode="text"
          maxLength={1}
          value={chars[i] || ''}
          autoFocus={i === 0}
          disabled={disabled}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKeyDown(i, e)}
          onFocus={() => handleFocus(i)}
          onBlur={() => setFocusedIdx(-1)}
          onPaste={handlePaste}
          readOnly={i !== activeIdx}
          tabIndex={i === activeIdx ? 0 : -1}
          style={{
            width: '3rem', height: '3.5rem',
            textAlign: 'center',
            fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 700,
            textTransform: 'uppercase',
            borderRadius: '0.5rem',
            border: `2px solid ${
              hasError && chars[i] !== undefined ? 'var(--error, #ef4444)' :
              focusedIdx === i                   ? 'var(--accent)'         :
              chars[i]                           ? 'var(--accent)'         :
                                                   'var(--border)'
            }`,
            background: focusedIdx === i
              ? 'var(--accent-subtle, rgba(99,102,241,0.12))'
              : chars[i]
                ? 'var(--accent-subtle, rgba(99,102,241,0.08))'
                : 'var(--surface)',
            color: 'var(--text-primary)',
            outline: 'none',
            boxShadow: focusedIdx === i && !hasError
              ? '0 0 0 3px rgba(99,102,241,0.25)'
              : 'none',
            cursor: i !== activeIdx && !chars[i] ? 'not-allowed' : 'text',
            opacity: i > activeIdx ? 0.45 : 1,
            transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s, opacity 0.15s',
            caretColor: 'transparent',
          }}
        />
      ))}
    </div>
  );
}

export default function ShareDownload({ showToast }) {
  const id = new URLSearchParams(window.location.search).get('id');

  const [info, setInfo]           = useState(null);
  const [infoError, setInfoError] = useState(null);
  const [token, setToken]         = useState('');
  const [downloading, setDownloading] = useState(false);
  const [done, setDone]           = useState(false);
  const [dlError, setDlError]     = useState(null);

  useEffect(() => {
    if (!id) { setInfoError('Incomplete share link — make sure you copied the full URL including the ?id= part.'); return; }
    fetchShareInfo(id).then(({ ok, status, data }) => {
      if (!ok) setInfoError(data.error || (status === 410 ? 'This link has expired.' : 'Share not found.'));
      else setInfo(data);
    }).catch(() => setInfoError('Could not load share info.'));
  }, [id]);

  const handleDownload = async (e) => {
    e.preventDefault();
    const full = token.replace(/\s/g, '');
    if (full.length < TOKEN_LEN) return;
    setDlError(null);
    setDownloading(true);
    try {
      const { ok, status, res } = await downloadShare(id, full);
      if (!ok) {
        const err = await res.json().catch(() => ({}));
        setDlError(err.error || (status === 401 ? 'Invalid token.' : status === 410 ? 'This link has expired.' : 'Download failed.'));
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = info?.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDone(true);
    } catch {
      setDlError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const resetForm = () => { setDone(false); setToken(''); setDlError(null); };
  const tokenFull = token.replace(/\s/g, '').length === TOKEN_LEN;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '1.5rem',
    }}>
      <div style={{
        width: '100%', maxWidth: '420px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '1rem',
        padding: '2rem',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <span className="material-icons-round" style={{ fontSize: '2rem', color: 'var(--accent)' }}>cloud_download</span>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Secure File Download</h1>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Enter the one-time token to download</p>
          </div>
        </div>

        {infoError ? (
          <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--error, #ef4444)' }}>
            <span className="material-icons-round" style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem' }}>link_off</span>
            {infoError}
          </div>
        ) : !info ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)' }}>
            <span className="material-icons-round spin" style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>sync</span>
            Loading…
          </div>
        ) : done ? (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <span className="material-icons-round" style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem', color: 'var(--success, #22c55e)' }}>check_circle</span>
            <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '0.5rem' }}>
              <strong>{info.fileName}</strong> downloaded.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              That token has been used. Need another copy? Ask the sender for a new token.
            </p>
            <button
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={resetForm}
            >
              Enter another token
            </button>
          </div>
        ) : (
          <form onSubmit={handleDownload}>
            {/* File name */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.375rem' }}>
                File
              </label>
              <div style={{
                padding: '0.6rem 0.875rem', borderRadius: '0.5rem',
                background: 'var(--surface-alt, rgba(0,0,0,0.06))',
                border: '1px solid var(--border)',
                fontSize: '0.9rem', color: 'var(--text-primary)',
                fontWeight: 500, wordBreak: 'break-all',
              }}>
                <span className="material-icons-round" style={{ fontSize: '1rem', verticalAlign: 'middle', marginRight: '0.4rem', color: 'var(--accent)' }}>insert_drive_file</span>
                {info.fileName}
              </div>
            </div>

            {/* OTP boxes */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.75rem', textAlign: 'center' }}>
                One-Time Token
              </label>
              <OtpInput
                value={token}
                onChange={v => { setToken(v); setDlError(null); }}
                hasError={!!dlError}
                disabled={downloading}
              />
              {dlError && (
                <p style={{ margin: '0.625rem 0 0', fontSize: '0.82rem', color: 'var(--error, #ef4444)', textAlign: 'center' }}>{dlError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={downloading || !tokenFull}
              style={{
                width: '100%', padding: '0.75rem', borderRadius: '0.5rem',
                background: 'var(--accent)', color: '#fff', border: 'none',
                fontSize: '0.95rem', fontWeight: 600,
                cursor: (downloading || !tokenFull) ? 'not-allowed' : 'pointer',
                opacity: (downloading || !tokenFull) ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                transition: 'opacity 0.15s',
              }}
            >
              {downloading ? (
                <><span className="material-icons-round spin" style={{ fontSize: '1.1rem' }}>sync</span>Downloading…</>
              ) : (
                <><span className="material-icons-round" style={{ fontSize: '1.1rem' }}>download</span>Download</>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
