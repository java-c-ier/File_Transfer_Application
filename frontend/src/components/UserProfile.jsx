import { useState } from 'react';
import { updateProfile } from '../api';

export default function UserProfile({ onClose, sessionInfo, setSessionInfo, showToast }) {
  const [username, setUsername] = useState(sessionInfo.username);
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (password && !oldPassword) return showToast('Current password is required to set a new password.', 'error');
    if (oldPassword && !password) return showToast('Please enter new password.', 'error');
    try {
      const res = await updateProfile(username, oldPassword || null, password || null);
      if (res.success) {
        showToast('Profile updated successfully', 'success');
        setSessionInfo({ ...sessionInfo, username: res.username });
        handleClose();
      } else showToast(res.error || 'Failed to update', 'error');
    } catch { showToast('Connection error', 'error'); }
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'closing' : ''}`}>
      <div className="modal-content" style={{ maxWidth: '400px', width: '100%', position: 'relative' }}>
 
        <h2 style={{ marginBottom: '2rem' }}>My Profile</h2>
        <form onSubmit={handleSave} autoComplete="off">
          {/* Decoy fields: absorb Chrome's aggressive credential autofill so the
              real Current/New Password boxes below stay empty on open. */}
          <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
          <input type="password" name="password" autoComplete="current-password" style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Username</label>
            <input type="text" value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="off" style={{width:'100%', padding:'0.75rem', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)', background: 'var(--bg)', color:'var(--text)'}} />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
             <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-light)' }}>Current Password</label>
             <div style={{ position: 'relative' }}>
               <input type={showOldPassword ? "text" : "password"} value={oldPassword} onChange={e=>setOldPassword(e.target.value)} autoComplete="new-password" style={{width:'100%', padding:'0.75rem', paddingRight:'40px', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)', background: 'var(--bg)', color:'var(--text)'}} />
               <button type="button" onClick={() => setShowOldPassword(!showOldPassword)} style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-light)', display:'flex' }} title={showOldPassword ? "Hide password" : "Show password"}>
                 <span className="material-icons-round" style={{fontSize: '20px'}}>{showOldPassword ? 'visibility_off' : 'visibility'}</span>
               </button>
             </div>
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ color:'var(--text-light)', display:'block', marginBottom:'0.5rem' }}>New Password (blank to keep current)</label>
            <div style={{ position: 'relative' }}>
              <input type={showPassword ? "text" : "password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" style={{width:'100%', padding:'0.75rem', paddingRight:'40px', borderRadius:'var(--radius-md)', border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)'}} />
              <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-light)', display:'flex' }} title={showPassword ? "Hide password" : "Show password"}>
                <span className="material-icons-round" style={{fontSize: '20px'}}>{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
          </div>
          <div style={{ display:'flex', gap:'1rem', width:'100%' }}>
            <button type="button" className="btn-cancel" style={{flex:1, justifyContent:'center'}} onClick={handleClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{flex:1, padding:'0.75rem', justifyContent:'center'}}>Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
