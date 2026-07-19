import { useState, useEffect, useCallback } from 'react';
import { fetchAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser, logout } from '../api';

export default function AdminDashboard({ onNavigate, sessionInfo, setSessionInfo, onLogout, onOpenProfile, showToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isClosingModal, setIsClosingModal] = useState(false);
  const [deleteData, setDeleteData] = useState(null);
  const [isClosingDelete, setIsClosingDelete] = useState(false);

  const closeDeleteModal = () => { setIsClosingDelete(true); setTimeout(() => { setDeleteData(null); setIsClosingDelete(false); }, 200); };

  const closeModal = () => {
    setIsClosingModal(true);
    setTimeout(() => {
      setShowModal(false);
      setIsClosingModal(false);
    }, 200);
  };
  const [editMode, setEditMode] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'USER' });

  const loadUsers = useCallback(async () => {
    try {
      const data = await fetchAdminUsers();
      setUsers(data.users || []);
    } catch {
      showToast('Failed to load users', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadUsers(); }, [loadUsers, sessionInfo.username]);

  const openModal = (user = null) => {
    setEditMode(user ? user.username : null);
    setForm({ username: user?.username || '', password: '', role: user?.role || '' });
    setShowModal(true);
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    try {
      if (editMode) {
        await updateAdminUser(editMode, form.username, form.password || null, form.role);
        if (editMode === sessionInfo.username) {
          setSessionInfo({ ...sessionInfo, username: form.username, role: form.role });
        }
        showToast(`User ${form.username} updated correctly`, 'success');
      } else {
        await createAdminUser(form.username, form.password, form.role);
        showToast(`User ${form.username} created successfully`, 'success');
      }
      setShowModal(false); loadUsers();
    } catch { showToast('Failed to save user. Check for duplicates.', 'error'); }
  };

  const handleDeleteClick = (u) => setDeleteData({ name: u });
  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (!deleteData) return;
    try { 
      await deleteAdminUser(deleteData.name); 
      showToast('User deleted successfully', 'success');
      closeDeleteModal(); 
      loadUsers(); 
    } catch { showToast('Failed to delete user', 'error'); }
  };

  return (
    <div className="app-screen">
      <header className="app-header">
        <div className="header-left">
          <button className="btn btn-ghost" onClick={() => onNavigate('files')}><span className="material-icons-round">arrow_back</span></button>
          <span className="material-icons-round logo-icon-sm">admin_panel_settings</span>
          <h1>Admin Dashboard</h1>
        </div>
        <div className="header-right">
          <strong style={{color:'var(--primary)', paddingRight:'15px'}}>{sessionInfo.username}</strong>
          <button className="btn btn-ghost" onClick={onOpenProfile}><span className="material-icons-round">person</span></button>
          <button className="btn btn-ghost" onClick={async () => { await logout(); onLogout(); }}><span className="material-icons-round">logout</span></button>
        </div>
      </header>

      <div className="admin-page" style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem' }}>
        <div className="admin-bar">
          <h2>System Users Configuration</h2>
          <button className="btn btn-primary" onClick={() => openModal()}><span className="material-icons-round">person_add</span> Add User</button>
        </div>

        {loading ? <p>Loading...</p> : (
          <div className="admin-table-card" style={{ background:'var(--card-bg)', borderRadius:'var(--radius-lg)', border:'1px solid var(--border)' }}>
            <table style={{ width:'100%', minWidth:'420px', borderCollapse:'collapse', textAlign:'left', color:'var(--text)' }}>
              <thead style={{ background:'var(--hover)', borderBottom:'1px solid var(--border)' }}>
                <tr><th style={{padding:'1rem'}}>Username</th><th style={{padding:'1rem'}}>Role</th><th style={{padding:'1rem', textAlign:'right'}}>Actions</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.username} style={{ borderBottom:'1px solid var(--border)' }}>
                    <td style={{padding:'1rem', fontWeight:500}}>{u.username}</td>
                    <td style={{padding:'1rem'}}>
                      <span style={{background: u.role==='ADMIN'?'rgba(10,132,255,0.1)':'var(--hover)', color:u.role==='ADMIN'?'var(--primary)':'var(--text-light)', padding:'0.25rem 0.5rem', borderRadius:'var(--radius-sm)', fontSize:'0.8rem', fontWeight:'bold'}}>{u.role}</span>
                    </td>
                    <td style={{padding:'1rem', textAlign:'right'}}>
                      <button className="btn btn-ghost" onClick={() => openModal(u)} title="Configure account"><span className="material-icons-round">edit</span></button>
                      {u.username !== sessionInfo.username && u.username !== 'admin' && (
                        <button className="btn btn-ghost" onClick={() => handleDeleteClick(u.username)} title="Delete Account"><span className="material-icons-round">delete</span></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className={`modal-overlay ${isClosingModal ? 'closing' : ''}`}>
          <div className="modal-content">
            <h3 style={{ marginBottom:'1rem' }}>{editMode ? 'Edit User' : 'New User'}</h3>
            <form onSubmit={handleSaveUser} autoComplete="off">
              {/* Decoy fields absorb Chrome's saved-credential autofill so the
                  admin's own password is never injected into the form below. */}
              <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
              <input type="password" name="password" autoComplete="current-password" style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
              <div style={{ marginBottom:'1rem' }}>
                <label style={{ display:'block', marginBottom:'0.5rem', fontSize:'0.9rem' }}>Username</label>
                <input type="text" value={form.username} onChange={e=>setForm({...form, username:e.target.value})} required autoComplete="off" style={{width:'100%', padding:'0.75rem', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)'}} autoFocus/>
              </div>
              {!editMode && (
                <div style={{ marginBottom:'1rem' }}>
                  <label style={{ display:'block', marginBottom:'0.5rem', fontSize:'0.9rem' }}>Password</label>
                  <input type="text" value={form.password || ''} onChange={e=>setForm({...form, password:e.target.value})} required autoComplete="off" style={{width:'100%', padding:'0.75rem', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)'}} />
                </div>
              )}
              <div style={{ marginBottom:'1.5rem' }}>
                <label style={{ display:'block', marginBottom:'0.5rem', fontSize:'0.9rem' }}>Access Tier</label>
                <select value={form.role} onChange={e=>setForm({...form, role:e.target.value})} required style={{width:'100%', padding:'0.75rem', paddingRight:'2.5rem', borderRadius:'var(--radius-sm)', backgroundColor:'var(--bg)', color:'var(--text)', border:'1px solid var(--border)', appearance:'none', backgroundImage:'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23637381%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat:'no-repeat', backgroundPosition:'right 1rem top 50%', backgroundSize:'0.65rem auto'}}>
                  <option value="" disabled>Select a role</option>
                  <option value="ADMIN">Admin</option>
                  <option value="USER">User</option>
                </select>
              </div>
              <div style={{ display:'flex', gap:'1rem', width:'100%' }}>
                <button type="button" className="btn-cancel" style={{flex:1, justifyContent:'center'}} onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{flex:1, padding:'0.75rem', justifyContent:'center'}}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteData && (
        <div className={`modal-overlay ${isClosingDelete ? 'closing' : ''}`}>
          <div className="modal-content">
            <h3 style={{ marginBottom:'1rem' }}>Delete Warning</h3>
            <p style={{ marginBottom:'1.5rem', color:'var(--text-light)', lineHeight:1.5 }}>
              Are you sure you want to permanently delete user <strong>{deleteData.name}</strong>? This action cannot be undone.
            </p>
            <form onSubmit={handleDeleteSubmit}>
              <div style={{ display:'flex', gap:'1rem', width:'100%' }}>
                <button type="button" className="btn-cancel" style={{flex:1, justifyContent:'center'}} onClick={closeDeleteModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{flex:1, padding:'0.75rem', justifyContent:'center'}}>Delete</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
