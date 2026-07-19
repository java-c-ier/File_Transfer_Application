import { useState } from 'react';
import { updateProfile } from '../api';

export default function UserProfile({ onClose, sessionInfo, setSessionInfo, showToast }) {
  const [username,  setUsername]  = useState(sessionInfo.username);
  const [email,     setEmail]     = useState(sessionInfo.email     || '');
  const [firstName, setFirstName] = useState(sessionInfo.firstName || '');
  const [lastName,  setLastName]  = useState(sessionInfo.lastName  || '');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const res = await updateProfile(username, email, firstName, lastName);
      if (res.success) {
        showToast('Profile updated successfully', 'success');
        setSessionInfo({ ...sessionInfo, username: res.username, email: res.email, firstName: res.firstName, lastName: res.lastName });
        handleClose();
      } else {
        showToast(res.error || 'Failed to update', 'error');
      }
    } catch {
      showToast('Connection error', 'error');
    }
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`}>
      <div className="modal-content" style={{ maxWidth: '400px', width: '100%', position: 'relative' }}>
        <h2 style={{ marginBottom: '2rem' }}>My Profile</h2>
        <form onSubmit={handleSave} autoComplete="off">
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                autoComplete="off"
                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                autoComplete="off"
                style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="off"
              style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="off"
              style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
            <button type="button" className="btn-cancel" style={{ flex: 1, justifyContent: 'center' }} onClick={handleClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1, padding: '0.75rem', justifyContent: 'center' }}>Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
