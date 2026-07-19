import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser, logout } from '../api';
import './AdminDashboard.css';

function CustomSelect({ value, onChange, options }) {
  const [open, setOpen]       = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 140);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  const selected = options.find(o => o.value === value);

  return (
    <div className={`csel${open ? ' csel--open' : ''}`} ref={ref}>
      <button
        type="button"
        className="csel__trigger"
        onClick={() => open ? close() : setOpen(true)}
      >
        {selected?.dot && <span className="csel__dot" style={{ background: selected.dot }} />}
        <span className="csel__label">{selected?.label || value}</span>
        <span className="material-icons-round csel__chevron">expand_more</span>
      </button>
      {open && (
        <div className={`csel__menu${closing ? ' csel__menu--closing' : ''}`}>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`csel__option${opt.value === value ? ' csel__option--selected' : ''}`}
              onClick={() => { onChange(opt.value); close(); }}
            >
              {opt.dot && <span className="csel__dot" style={{ background: opt.dot }} />}
              <span>{opt.label}</span>
              {opt.value === value && <span className="material-icons-round csel__check">check</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


export default function AdminDashboard({ onNavigate, sessionInfo, setSessionInfo, onLogout, showToast }) {
  const [profileOpen, setProfileOpen]   = useState(false);
  const [profileClosing, setProfileClosing] = useState(false);
  const profileRef                      = useRef(null);

  const closeProfile = useCallback(() => {
    setProfileClosing(true);
    setTimeout(() => { setProfileOpen(false); setProfileClosing(false); }, 140);
  }, []);
  const [users, setUsers]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [showModal, setShowModal]       = useState(false);
  const [isClosingModal, setIsClosingModal] = useState(false);
  const [deleteData, setDeleteData]     = useState(null);
  const [isClosingDelete, setIsClosingDelete] = useState(false);
  const [editMode, setEditMode]         = useState(null); // null = create, string = username being edited

  const emptyForm = { firstName: '', lastName: '', username: '', email: '', role: 'USER', status: 'ACTIVE' };
  const [form, setForm] = useState(emptyForm);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminUsers();
      setUsers(data.users || []);
    } catch {
      showToast('Failed to load users', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) closeProfile();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen, closeProfile]);

  const openCreate = () => {
    setEditMode(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (u) => {
    setEditMode(u.username);
    setForm({
      firstName: u.firstName || '',
      lastName:  u.lastName  || '',
      username:  u.username,
      email:     u.email     || '',
      role:      u.role      || 'USER',
      status:    u.status    || 'ACTIVE',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setIsClosingModal(true);
    setTimeout(() => { setShowModal(false); setIsClosingModal(false); }, 200);
  };

  const closeDeleteModal = () => {
    setIsClosingDelete(true);
    setTimeout(() => { setDeleteData(null); setIsClosingDelete(false); }, 200);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editMode) {
        const res = await updateAdminUser(editMode, form.email, form.role, form.firstName, form.lastName, form.status);
        if (res.error) { showToast(res.error, 'error'); return; }
        if (editMode === sessionInfo.username) setSessionInfo({ ...sessionInfo, role: form.role });
        showToast(`User ${editMode} updated`, 'success');
      } else {
        const res = await createAdminUser(form.username, form.email, form.role, form.firstName, form.lastName);
        if (res.error) { showToast(res.error, 'error'); return; }
        showToast(`User ${form.username} created`, 'success');
      }
      closeModal(); loadUsers();
    } catch { showToast('Failed to save user', 'error'); }
  };

  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (!deleteData) return;
    try {
      const res = await deleteAdminUser(deleteData.name);
      if (res.error) { showToast(res.error, 'error'); return; }
      showToast('User deleted', 'success');
      closeDeleteModal(); loadUsers();
    } catch { showToast('Failed to delete user', 'error'); }
  };

  const statusBadge = (s) => {
    const active = s !== 'INACTIVE';
    return (
      <span style={{
        background: active ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
        color:      active ? 'var(--success)' : 'var(--danger)',
        padding: '0.2rem 0.55rem', borderRadius: 'var(--radius-sm)',
        fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.03em',
      }}>{active ? 'ACTIVE' : 'INACTIVE'}</span>
    );
  };

  const roleBadge = (role) => (
    <span style={{
      background: role === 'ADMIN' ? 'rgba(99,102,241,0.12)' : 'var(--hover)',
      color:      role === 'ADMIN' ? 'var(--accent)' : 'var(--text-secondary)',
      padding: '0.2rem 0.55rem', borderRadius: 'var(--radius-sm)',
      fontSize: '0.75rem', fontWeight: 700,
    }}>{role}</span>
  );

  return (
    <div className="app-screen">
      <header className="app-header">
        <div className="header-left">
          <button className="btn btn-ghost" onClick={() => onNavigate('files')}>
            <span className="material-icons-round">arrow_back</span>
          </button>
          <span className="material-icons-round logo-icon-sm">admin_panel_settings</span>
          <h1>User Management</h1>
        </div>
        <div className="header-right">
          <div className="profile-wrapper" ref={profileRef}>
            <button
              className={`profile-avatar-btn${profileOpen ? ' active' : ''}`}
              onClick={() => profileOpen ? closeProfile() : setProfileOpen(true)}
              title="Account"
            >
              <span className="profile-initials">
                {[sessionInfo?.firstName, sessionInfo?.lastName]
                  .filter(Boolean).map(n => n[0].toUpperCase()).join('') ||
                  (sessionInfo?.username?.[0]?.toUpperCase() || '?')}
              </span>
            </button>
            {profileOpen && (
              <div className={`profile-dropdown${profileClosing ? ' closing' : ''}`}>
                <div className="profile-dropdown-info">
                  <div className="profile-dropdown-name">
                    {[sessionInfo?.firstName, sessionInfo?.lastName].filter(Boolean).join(' ') || sessionInfo?.username}
                  </div>
                  <div className="profile-dropdown-email">{sessionInfo?.email || ''}</div>
                  <span className={`profile-dropdown-role${sessionInfo?.role === 'ADMIN' ? ' admin' : ''}`}>
                    {sessionInfo?.role}
                  </span>
                </div>
                <div className="profile-dropdown-divider" />
                <button className="profile-dropdown-action profile-dropdown-logout" onClick={() => { closeProfile(); setTimeout(async () => { await logout(); onLogout(); }, 140); }}>
                  <span className="material-icons-round">logout</span>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: '960px', margin: '2rem auto', padding: '0 1rem' }}>
        <div className="admin-bar">
          <h2>System Users</h2>
          <button className="btn btn-primary" onClick={openCreate}>
            <span className="material-icons-round">person_add</span> Add User
          </button>
        </div>

        {loading ? <p style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Loading...</p> : (
          <div style={{ background: 'var(--card-bg, var(--bg-card))', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '640px', borderCollapse: 'collapse', textAlign: 'left', color: 'var(--text)' }}>
              <thead style={{ borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Name</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Username</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Email</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Role</th>
                  <th style={{ padding: '0.875rem 1rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status</th>
                  <th style={{ padding: '0.875rem 1rem', textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.username} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: 500 }}>
                      {[u.firstName, u.lastName].filter(Boolean).join(' ') || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', fontFamily: 'monospace' }}>{u.username}</td>
                    <td style={{ padding: '0.875rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{u.email}</td>
                    <td style={{ padding: '0.875rem 1rem' }}>{roleBadge(u.role)}</td>
                    <td style={{ padding: '0.875rem 1rem' }}>{statusBadge(u.status)}</td>
                    <td style={{ padding: '0.875rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => openEdit(u)} title="Edit">
                        <span className="material-icons-round">edit</span>
                      </button>
                      {u.username !== sessionInfo.username && (
                        <button className="btn btn-ghost btn-xs" onClick={() => setDeleteData({ name: u.username })} title="Delete">
                          <span className="material-icons-round" style={{ color: 'var(--danger)' }}>delete_outline</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className={`modal-overlay ${isClosingModal ? 'closing' : ''}`}>
          <div className="modal-content" style={{ maxWidth: '460px', width: '100%' }}>
            <h3 style={{ marginBottom: '1.25rem' }}>{editMode ? `Edit — ${editMode}` : 'New User'}</h3>
            <form onSubmit={handleSave} autoComplete="off">

              {/* Name row */}
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>First Name</label>
                  <input type="text" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} autoComplete="off" className="admin-input" autoFocus />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Last Name</label>
                  <input type="text" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} autoComplete="off" className="admin-input" />
                </div>
              </div>

              {/* Username — editable only on create */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Username {editMode && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(cannot be changed)</span>}
                </label>
                {editMode ? (
                  <input type="text" value={form.username} readOnly className="admin-input admin-input--readonly" tabIndex={-1} />
                ) : (
                  <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required autoComplete="off" className="admin-input" />
                )}
              </div>

              {/* Email */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required autoComplete="off" className="admin-input" />
              </div>

              {/* Role + Status side by side */}
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Role</label>
                  <CustomSelect
                    value={form.role}
                    onChange={v => setForm({ ...form, role: v })}
                    options={[
                      { value: 'ADMIN', label: 'Admin', dot: 'var(--accent)' },
                      { value: 'USER',  label: 'User',  dot: 'var(--text-muted)' },
                    ]}
                  />
                </div>
                {editMode && (
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status</label>
                    <CustomSelect
                      value={form.status}
                      onChange={v => setForm({ ...form, status: v })}
                      options={[
                        { value: 'ACTIVE',   label: 'Active',   dot: '#10b981' },
                        { value: 'INACTIVE', label: 'Inactive', dot: 'var(--danger)' },
                      ]}
                    />
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" className="btn-cancel" style={{ flex: 1, justifyContent: 'center' }} onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  {editMode ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteData && (
        <div className={`modal-overlay ${isClosingDelete ? 'closing' : ''}`}>
          <div className="modal-content" style={{ maxWidth: '380px', width: '100%' }}>
            <h3 style={{ marginBottom: '1rem' }}>Delete User</h3>
            <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Permanently delete <strong style={{ color: 'var(--text)' }}>{deleteData.name}</strong>? This cannot be undone.
            </p>
            <form onSubmit={handleDeleteSubmit}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" className="btn-cancel" style={{ flex: 1, justifyContent: 'center' }} onClick={closeDeleteModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', background: 'var(--danger)' }}>Delete</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
