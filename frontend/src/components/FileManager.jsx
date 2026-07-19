import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { fetchFiles, fetchStats, createFolder, deleteItem, renameItem, fetchText, saveText, logout, subscribeToChanges, previewFile } from '../api';
import { useTransfers } from '../TransferContext';
import { formatSize, formatDate, getFileIcon, pathUrl } from '../utils';
import './FileManager.css';

const PAGE_SIZE = 100;

const PREVIEWABLE = new Set([
  'jpg','jpeg','png','gif','svg','webp',
  'mp4','webm','mov',
  'mp3','wav','ogg',
  'pdf',
  'txt','log','csv','json','xml','html','css','js','jsx','ts','tsx',
  'py','java','sh','bat','sql','md','yml','yaml','conf','properties',
]);

function isPreviewable(file) {
  if (file.isDirectory) return false;
  return PREVIEWABLE.has(file.name.split('.').pop().toLowerCase());
}

function previewKind(contentType) {
  if (!contentType) return 'unknown';
  if (contentType.startsWith('image/'))  return 'image';
  if (contentType.startsWith('video/'))  return 'video';
  if (contentType.startsWith('audio/'))  return 'audio';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')) return 'text';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Memoised file list — only re-renders when the file array or session changes,
// NOT on every transfer-progress tick.
// ---------------------------------------------------------------------------
const FileList = memo(function FileList({
  files, sessionInfo,
  onNavigate, onDownloadFile, onDownloadZip, onRename, onDelete, onContextMenu,
  onUploadClick, onPreview,
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
          {isPreviewable(file) && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={e => { e.stopPropagation(); onPreview(file.path, file.name); }}
              title="Preview"
            >
              <span className="material-icons-round">visibility</span>
            </button>
          )}
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
  const [profileOpen, setProfileOpen]       = useState(false);
  const [profileClosing, setProfileClosing] = useState(false);
  const profileRef                          = useRef(null);

  const closeProfile = useCallback(() => {
    setProfileClosing(true);
    setTimeout(() => { setProfileOpen(false); setProfileClosing(false); }, 140);
  }, []);
  const [files, setFiles]                   = useState([]);
  const [totalFiles, setTotalFiles]         = useState(0);
  const [loadingMore, setLoadingMore]       = useState(false);
  // Initialise from the URL so the effect never needs to call setState synchronously
  const [currentPath, setCurrentPath]       = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('path') || '';
  });
  const [stats, setStats]                   = useState(null);
  const [previewData, setPreviewData]       = useState(null);  // { name, url, kind, text }
  const [previewLoading, setPreviewLoading] = useState(false);
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
      const data = await fetchFiles(path, PAGE_SIZE, 0);
      if (data.exists === false && path !== '') {
        setCurrentPath('');
        setFiles([]);
        setTotalFiles(0);
        window.history.replaceState({ path: '' }, '', pathUrl(''));
        const rootData = await fetchFiles('', PAGE_SIZE, 0);
        setFiles(rootData.files || []);
        setTotalFiles(rootData.total || 0);
        return;
      }
      setFiles(data.files || []);
      setTotalFiles(data.total || 0);
      setCurrentPath(data.currentPath || '');
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') onLogout();
      else showToast('Failed to load files', 'error');
    }
  }, [showToast, onLogout]);

  const loadMoreFiles = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchFiles(currentPath, PAGE_SIZE, files.length);
      setFiles(prev => [...prev, ...(data.files || [])]);
      setTotalFiles(data.total || 0);
    } catch { showToast('Failed to load more files', 'error'); }
    finally { setLoadingMore(false); }
  }, [currentPath, files.length, loadingMore, showToast]);

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
  useEffect(() => { currentPathRef.current = currentPath; }, [currentPath]);
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

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) closeProfile();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen, closeProfile]);

  const handleLogout = async () => {
    await logout();
    localStorage.removeItem('activeTab');
    onLogout();
  };

  const handlePreview = useCallback(async (filePath, fileName) => {
    setPreviewLoading(true);
    setPreviewData({ name: fileName, loading: true });
    try {
      const { blob, contentType } = await previewFile(filePath);
      const kind = previewKind(contentType);
      if (kind === 'text') {
        const text = await blob.text();
        setPreviewData({ name: fileName, kind, text, url: null });
      } else if (kind !== 'unknown') {
        const url = URL.createObjectURL(blob);
        setPreviewData({ name: fileName, kind, url, text: null });
      } else {
        setPreviewData(null);
        showToast('File type cannot be previewed', 'error');
      }
    } catch (err) {
      setPreviewData(null);
      showToast('Preview failed: ' + err.message, 'error');
    } finally {
      setPreviewLoading(false);
    }
  }, [showToast]);

  const closePreview = useCallback(() => {
    if (previewData?.url) URL.revokeObjectURL(previewData.url);
    setPreviewData(null);
  }, [previewData]);

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
              <span className="material-icons-round">manage_accounts</span>
            </button>
          )}
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
                <button className="profile-dropdown-action profile-dropdown-logout" onClick={() => { closeProfile(); setTimeout(handleLogout, 140); }}>
                  <span className="material-icons-round">logout</span>
                  Logout
                </button>
              </div>
            )}
          </div>
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
                onPreview={handlePreview}
              />
            </div>
            {files.length < totalFiles && (
              <div style={{ textAlign: 'center', padding: '0.75rem' }}>
                <button className="btn btn-sm btn-outline" onClick={loadMoreFiles} disabled={loadingMore}>
                  {loadingMore
                    ? <><span className="material-icons-round spin" style={{ fontSize: '1rem' }}>sync</span> Loading…</>
                    : `Load more (${files.length} / ${totalFiles})`}
                </button>
              </div>
            )}
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
          {isPreviewable(contextMenu.file) && (
            <button onClick={() => { handlePreview(contextMenu.file.path, contextMenu.file.name); closeContextMenu(); }}>
              <span className="material-icons-round">visibility</span> Preview
            </button>
          )}
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

      {/* ── Preview modal ── */}
      {(previewData || previewLoading) && (
        <div className="modal-overlay" onClick={closePreview} style={{ zIndex: 300 }}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', width: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '1rem' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.5rem' }}>
              <h3 className="modal-title" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {previewData?.name || 'Loading…'}
              </h3>
              <button className="btn btn-ghost btn-xs" onClick={closePreview} style={{ flexShrink: 0 }}>
                <span className="material-icons-round">close</span>
              </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
              {previewLoading || previewData?.loading ? (
                <span className="material-icons-round spin" style={{ fontSize: '2.5rem', opacity: 0.5 }}>sync</span>
              ) : previewData?.kind === 'image' ? (
                <img src={previewData.url} alt={previewData.name} style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: '4px' }} />
              ) : previewData?.kind === 'video' ? (
                <video src={previewData.url} controls style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: '4px' }} />
              ) : previewData?.kind === 'audio' ? (
                <audio src={previewData.url} controls style={{ width: '100%' }} />
              ) : previewData?.kind === 'pdf' ? (
                <iframe src={previewData.url} title={previewData.name} style={{ width: '100%', height: '75vh', border: 'none', borderRadius: '4px' }} />
              ) : previewData?.kind === 'text' ? (
                <pre style={{
                  width: '100%', maxHeight: '75vh', overflow: 'auto', margin: 0,
                  padding: '0.75rem', borderRadius: '4px',
                  background: 'var(--surface-alt, rgba(0,0,0,0.08))',
                  fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>{previewData.text}</pre>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
