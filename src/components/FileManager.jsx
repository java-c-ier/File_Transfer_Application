import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { fetchFiles, fetchStats, createFolder, deleteItem, renameItem, fetchText, saveText, logout, subscribeToChanges } from '../api';
import { useTransfers } from '../TransferContext';
import { formatSize, formatDate, getFileIcon, pathUrl } from '../utils';
import './FileManager.css';

// ---------------------------------------------------------------------------
// Memoised file list — only re-renders when the file array or session changes,
// NOT on every transfer-progress tick.
// ---------------------------------------------------------------------------
const FileList = memo(function FileList({
  files, sessionInfo,
  onNavigate, onDownloadFile, onDownloadZip, onRename, onDelete, onContextMenu,
  onUploadClick,
}) {
  if (files.length === 0) {
    return (
      <div className="empty-state" onClick={onUploadClick} style={{ cursor: 'pointer' }}>
        <span className="material-icons-round empty-icon">folder_open</span>
        <p>No files here. Click this area or drag files to get started!</p>
      </div>
    );
  }

  return files.map(file => {
    const iconInfo = getFileIcon(file);
    return (
      <div
        key={file.path}
        className={`file-item${file.isDirectory ? ' folder' : ''}`}
        onDoubleClick={() => file.isDirectory ? onNavigate(file.path) : onDownloadFile(file.path, file.size)}
        onContextMenu={e => onContextMenu(e, file)}
      >
        <div className="file-name">
          <span className={`material-icons-round file-icon ${iconInfo.cls}`}>{iconInfo.icon}</span>
          <span className="name-text" title={file.name}>{file.name}</span>
        </div>
        <span className="file-size">{file.isDirectory ? '—' : formatSize(file.size)}</span>
        <span className="file-date">{formatDate(file.modified)}</span>
        <div className="file-actions">
          {file.isDirectory ? (
            <button
              className="btn btn-ghost btn-xs"
              onClick={e => { e.stopPropagation(); onDownloadZip(file.path); }}
              title="Download as ZIP"
            >
              <span className="material-icons-round">folder_zip</span>
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-xs"
              onClick={e => { e.stopPropagation(); onDownloadFile(file.path, file.size); }}
              title="Download"
            >
              <span className="material-icons-round">download</span>
            </button>
          )}
          <button
            className="btn btn-ghost btn-xs"
            onClick={e => { e.stopPropagation(); onRename(file.path, file.name); }}
            title="Rename"
          >
            <span className="material-icons-round">drive_file_rename_outline</span>
          </button>
          {sessionInfo?.role === 'ADMIN' && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={e => { e.stopPropagation(); onDelete(file.path, file.name); }}
              title="Delete"
            >
              <span className="material-icons-round">delete_outline</span>
            </button>
          )}
        </div>
      </div>
    );
  });
});

// ---------------------------------------------------------------------------
// FileManager
// ---------------------------------------------------------------------------
export default function FileManager({ onNavigate, sessionInfo, onLogout, onOpenProfile, showToast }) {
  const [files, setFiles]                   = useState([]);
  // Initialise from the URL so the effect never needs to call setState synchronously
  const [currentPath, setCurrentPath]       = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('path') || '';
  });
  const [stats, setStats]                   = useState(null);
  const [dragActive, setDragActive]         = useState(false);
  const [contextMenu, setContextMenu]       = useState(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [isClosingFolder, setIsClosingFolder] = useState(false);
  const [folderName, setFolderName]         = useState('');
  const [renameData, setRenameData]         = useState(null);
  const [isClosingRename, setIsClosingRename] = useState(false);
  const [deleteData, setDeleteData]         = useState(null);
  const [isClosingDelete, setIsClosingDelete] = useState(false);
  const [activeTab, setActiveTab]           = useState(() => localStorage.getItem('activeTab') || 'files');
  const [editorContent, setEditorContent]   = useState('');
  const [editorLoading, setEditorLoading]   = useState(true);

  // Transfers live in TransferContext (above the screen switch) so they keep
  // running when the user navigates to the Admin panel or anywhere else.
  const {
    uploadFiles, downloadFile, downloadZip, completionTick,
  } = useTransfers();

  const fileInputRef   = useRef(null);
  const dragCounter    = useRef(0);
  const editorTimeout  = useRef(null);
  const lastLocalEditRef = useRef(0);   // ts of last local keystroke — guards against clobbering an active editor
  // Capture the initial path once so the init effect doesn't need currentPath in its deps
  const initialPathRef = useRef(currentPath);

  // Modal close helpers
  const closeFolderModal = () => { setIsClosingFolder(true); setTimeout(() => { setShowFolderModal(false); setIsClosingFolder(false); }, 200); };
  const closeRenameModal = () => { setIsClosingRename(true); setTimeout(() => { setRenameData(null); setIsClosingRename(false); }, 200); };
  const closeDeleteModal = () => { setIsClosingDelete(true); setTimeout(() => { setDeleteData(null); setIsClosingDelete(false); }, 200); };

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  const loadFiles = useCallback(async (path = '') => {
    try {
      const data = await fetchFiles(path);
      if (data.exists === false && path !== '') {
        // Path no longer exists — fall back to root inline to avoid self-reference
        setCurrentPath('');
        setFiles([]);
        window.history.replaceState({ path: '' }, '', pathUrl(''));
        const rootData = await fetchFiles('');
        setFiles(rootData.files || []);
        return;
      }
      setFiles(data.files || []);
      setCurrentPath(data.currentPath || '');
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') onLogout();
      else showToast('Failed to load files', 'error');
    }
  }, [showToast, onLogout]);

  const loadStats = useCallback(async () => {
    try { const data = await fetchStats(); setStats(data); } catch { /* stats are non-critical */ }
  }, []);

  // Fix: include stable callbacks in deps so popstate handler is never stale
  useEffect(() => {
    // Read the stable initial path from the ref — keeps currentPath out of deps
    // so this effect truly only runs once on mount.
    const initialPath = initialPathRef.current;
    window.history.replaceState({ path: initialPath }, '', pathUrl(initialPath));
    loadFiles(initialPath);
    loadStats();
    fetchText().then(res => { setEditorContent(res.text || ''); setEditorLoading(false); }).catch(() => setEditorLoading(false));

    const handlePopState = (e) => {
      const p = e.state?.path || '';
      setCurrentPath(p);
      loadFiles(p);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [loadFiles, loadStats]); // stable useCallback refs — safe to include

  useEffect(() => { localStorage.setItem('activeTab', activeTab); }, [activeTab]);

  // Refresh the file list whenever an upload finishes anywhere (the transfer
  // engine bumps completionTick). currentPath is read from a ref so this only
  // fires on actual completions, not on every navigation.
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  useEffect(() => {
    if (completionTick === 0) return;
    loadFiles(currentPathRef.current);
    loadStats();
  }, [completionTick, loadFiles, loadStats]);

  // Pull the latest shared note from the server, but never overwrite the box
  // while THIS user is actively typing (their local copy is the freshest). The
  // 2s window also swallows the echo of our own save, so the cursor never jumps.
  const refreshTextFromServer = useCallback(async () => {
    if (Date.now() - lastLocalEditRef.current < 2000) return;
    try {
      const res = await fetchText();
      const incoming = res.text || '';
      setEditorContent(prev => (prev === incoming ? prev : incoming));
    } catch { /* transient — next change event will retry */ }
  }, []);

  // Live cross-device sync: when ANOTHER device uploads/deletes/renames/edits the
  // note, the server pushes a "change" event. A "text" change refreshes the shared
  // note; everything else refreshes the current folder + stats. No manual refresh.
  // Bursts (multi-file uploads) are debounced into one reload.
  useEffect(() => {
    let timer = null;
    const es = subscribeToChanges((e) => {
      let reason = '';
      try { reason = JSON.parse(e.data).reason; } catch { /* keep default */ }
      if (reason === 'text') { refreshTextFromServer(); return; }
      clearTimeout(timer);
      timer = setTimeout(() => {
        loadFiles(currentPathRef.current);
        loadStats();
      }, 300);
    });
    return () => { clearTimeout(timer); es?.close(); };
  }, [loadFiles, loadStats, refreshTextFromServer]);

  const navigateTo = useCallback((path) => {
    setCurrentPath(path);
    loadFiles(path);
    window.history.pushState({ path }, '', pathUrl(path));
  }, [loadFiles]);

  const handleLogout = async () => {
    await logout();
    localStorage.removeItem('activeTab');
    onLogout();
  };

  // ------------------------------------------------------------------
  // Transfer actions — delegated to the TransferContext engine so they
  // outlive this component. Thin wrappers keep the JSX below unchanged.
  // ------------------------------------------------------------------
  const handleUpload       = useCallback(fileList => uploadFiles(fileList, currentPath), [uploadFiles, currentPath]);
  const handleDownloadFile = downloadFile;
  const handleDownloadZip  = downloadZip;

  // ------------------------------------------------------------------
  // Drag & drop
  // ------------------------------------------------------------------
  const handleDragEnter = e => { e.preventDefault(); if (activeTab !== 'files') return; dragCounter.current++; setDragActive(true); };
  const handleDragLeave = e => { e.preventDefault(); if (activeTab !== 'files') return; dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragActive(false); } };
  const handleDragOver  = e => e.preventDefault();
  const handleDrop      = e => { e.preventDefault(); if (activeTab !== 'files') return; dragCounter.current = 0; setDragActive(false); if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files); };

  // ------------------------------------------------------------------
  // Folder / rename / delete
  // ------------------------------------------------------------------
  const handleCreateFolderSubmit = async (e) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    try {
      const data = await createFolder(folderName.trim(), currentPath);
      if (data.success) { showToast(`Folder "${folderName}" created`, 'success'); loadFiles(currentPath); loadStats(); }
      else showToast(data.error || 'Failed to create folder', 'error');
    } catch { showToast('Failed to create folder', 'error'); }
    closeFolderModal();
    setFolderName('');
  };

  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (!deleteData) return;
    try {
      const data = await deleteItem(deleteData.path);
      if (data.success) { showToast(`"${deleteData.name}" deleted`, 'success'); loadFiles(currentPath); loadStats(); }
      else showToast(data.error || 'Failed to delete', 'error');
    } catch { showToast('Failed to delete', 'error'); }
    closeDeleteModal();
  };

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!renameData || !renameData.newName.trim() || renameData.newName === renameData.oldName) { closeRenameModal(); return; }
    try {
      const data = await renameItem(renameData.path, renameData.newName.trim());
      if (data.success) { showToast(`Renamed to "${renameData.newName}"`, 'success'); loadFiles(currentPath); }
      else showToast(data.error || 'Failed to rename', 'error');
    } catch { showToast('Failed to rename', 'error'); }
    closeRenameModal();
  };

  const handleContextMenu = (e, file) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 150), file });
  };
  const closeContextMenu = () => setContextMenu(null);

  // ------------------------------------------------------------------
  // Text editor
  // ------------------------------------------------------------------
  const handleEditorChange = (e) => {
    const newText = e.target.value;
    setEditorContent(newText);
    lastLocalEditRef.current = Date.now();   // mark this device as the active editor
    if (editorTimeout.current) clearTimeout(editorTimeout.current);
    editorTimeout.current = setTimeout(() => {
      saveText(newText).catch(err => showToast('Failed to save text: ' + err.message, 'error'));
    }, 800);
  };

  const breadcrumbParts = currentPath ? currentPath.split('/') : [];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div
      className="app-screen"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={closeContextMenu}
    >
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-left">
          <span className="material-icons-round logo-icon-sm">cloud_sync</span>
          <h1>File Transfer</h1>
        </div>
        <div className="header-right">
          <div className="stat-badge" title="Storage info">
            <span className="material-icons-round">storage</span>
            <span className="stat-text">{stats ? `${stats.fileCount} files · ${formatSize(stats.totalSize)}` : '--'}</span>
          </div>
          {sessionInfo?.role === 'ADMIN' && (
            <button className="btn btn-ghost" onClick={() => onNavigate('admin')} title="Admin Panel">
              <span className="material-icons-round">admin_panel_settings</span>
            </button>
          )}
          <button className="btn btn-ghost" onClick={onOpenProfile} title="Profile">
            <span className="material-icons-round">person</span>
          </button>
          <button className="btn btn-ghost" onClick={handleLogout} title="Logout">
            <span className="material-icons-round">logout</span>
          </button>
        </div>
      </header>

      {/* ── Tab navigation ── */}
      <div className="tab-navigation">
        <div className="tab-track">
          <div className={`tab-indicator${activeTab === 'editor' ? ' tab-indicator--right' : ''}`} />
          <button
            className={`tab-btn${activeTab === 'files' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            <span className="material-icons-round">folder</span>
            Files Transfer
          </button>
          <button
            className={`tab-btn${activeTab === 'editor' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            <span className="material-icons-round">edit_note</span>
            Text Editor
          </button>
        </div>
      </div>

      {activeTab === 'files' ? (
        <>
          {/* ── Toolbar ── */}
          <div className="toolbar">
            <div className="breadcrumb">
              <button className={`crumb-btn${currentPath === '' ? ' active' : ''}`} onClick={() => navigateTo('')}>
                <span className="material-icons-round">home</span>
              </button>
              {breadcrumbParts.map((part, i) => {
                const pathTo = breadcrumbParts.slice(0, i + 1).join('/');
                const isLast = i === breadcrumbParts.length - 1;
                return (
                  <span key={pathTo} style={{ display: 'contents' }}>
                    <span className="crumb-sep">›</span>
                    <button className={`crumb-btn${isLast ? ' active' : ''}`} onClick={() => navigateTo(pathTo)}>{part}</button>
                  </span>
                );
              })}
            </div>
            <div className="toolbar-actions">
              <button className="btn btn-sm btn-outline" onClick={() => { setFolderName(''); setShowFolderModal(true); }}>
                <span className="material-icons-round">create_new_folder</span>
                <span className="btn-label">New Folder</span>
              </button>
              <button className="btn btn-sm btn-accent" onClick={() => fileInputRef.current?.click()}>
                <span className="material-icons-round">upload_file</span>
                <span className="btn-label">Upload</span>
              </button>
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={e => { handleUpload(e.target.files); e.target.value = ''; }} />
            </div>
          </div>

          {dragActive && (
            <div className="drop-zone active">
              <div className="drop-zone-inner">
                <span className="material-icons-round drop-icon">cloud_upload</span>
                <h3>Drop Files Here</h3>
                <p>Release to upload to current folder</p>
              </div>
            </div>
          )}

          {/* ── File list ── */}
          <div className="file-list-container">
            <div className="file-list-header">
              <span className="col-name">Name</span>
              <span className="col-size">Size</span>
              <span className="col-date">Modified</span>
              <span className="col-actions">Actions</span>
            </div>
            <div className="file-list">
              <FileList
                files={files}
                sessionInfo={sessionInfo}
                onNavigate={navigateTo}
                onDownloadFile={handleDownloadFile}
                onDownloadZip={handleDownloadZip}
                onRename={(path, name) => setRenameData({ path, oldName: name, newName: name })}
                onDelete={(path, name) => setDeleteData({ path, name })}
                onContextMenu={handleContextMenu}
                onUploadClick={() => fileInputRef.current?.click()}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="editor-container">
          {editorLoading ? (
            <div className="editor-loading">
              <span className="material-icons-round spin">sync</span> Loading...
            </div>
          ) : (
            <textarea
              className="editor-textarea"
              value={editorContent}
              onChange={handleEditorChange}
              placeholder="Write or paste your text here to sync it automatically..."
            />
          )}
        </div>
      )}

      {/* ── Context menu ── */}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { contextMenu.file.isDirectory ? handleDownloadZip(contextMenu.file.path) : handleDownloadFile(contextMenu.file.path, contextMenu.file.size); closeContextMenu(); }}>
            <span className="material-icons-round">download</span> Download
          </button>
          <button onClick={() => { setRenameData({ path: contextMenu.file.path, oldName: contextMenu.file.name, newName: contextMenu.file.name }); closeContextMenu(); }}>
            <span className="material-icons-round">drive_file_rename_outline</span> Rename
          </button>
          {sessionInfo?.role === 'ADMIN' && (
            <button onClick={() => { setDeleteData({ path: contextMenu.file.path, name: contextMenu.file.name }); closeContextMenu(); }}>
              <span className="material-icons-round">delete</span> Delete
            </button>
          )}
        </div>
      )}

      {/* ── New Folder modal ── */}
      {showFolderModal && (
        <div className={`modal-overlay${isClosingFolder ? ' closing' : ''}`}>
          <div className="modal-content">
            <h3 className="modal-title">Create New Folder</h3>
            <form onSubmit={handleCreateFolderSubmit}>
              <div className="modal-field">
                <input
                  type="text" value={folderName} onChange={e => setFolderName(e.target.value)}
                  placeholder="Enter folder name" required className="modal-input" autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel modal-btn" onClick={() => { setFolderName(''); closeFolderModal(); }}>Cancel</button>
                <button type="submit" className="btn btn-primary modal-btn">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Rename modal ── */}
      {renameData && (
        <div className={`modal-overlay${isClosingRename ? ' closing' : ''}`}>
          <div className="modal-content">
            <h3 className="modal-title">Rename "{renameData.oldName}"</h3>
            <form onSubmit={handleRenameSubmit}>
              <div className="modal-field">
                <input
                  type="text" value={renameData.newName}
                  onChange={e => setRenameData({ ...renameData, newName: e.target.value })}
                  placeholder="New Name" required className="modal-input" autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel modal-btn" onClick={closeRenameModal}>Cancel</button>
                <button type="submit" className="btn btn-primary modal-btn">Rename</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete modal ── */}
      {deleteData && (
        <div className={`modal-overlay${isClosingDelete ? ' closing' : ''}`}>
          <div className="modal-content">
            <h3 className="modal-title">Delete Warning</h3>
            <p className="modal-body-text">
              Are you sure you want to permanently delete <strong>{deleteData.name}</strong>? This action cannot be undone.
            </p>
            <form onSubmit={handleDeleteSubmit}>
              <div className="modal-actions">
                <button type="button" className="btn-cancel modal-btn" onClick={closeDeleteModal}>Cancel</button>
                <button type="submit" className="btn btn-primary modal-btn">Delete</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
