import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { fetchFiles, fetchStats, createFolder, deleteItem, renameItem, fetchText, saveText, logout } from '../api';
import { createUploadManager, createDownloadManager } from '../transferManager';
import { formatSize, formatDate, getFileIcon } from '../utils';
import TransferPanel from './TransferPanel';
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
        onDoubleClick={() => file.isDirectory ? onNavigate(file.path) : onDownloadFile(file.path)}
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
              onClick={e => { e.stopPropagation(); onDownloadFile(file.path); }}
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

  // Transfer panel
  const [transfers, setTransfers]           = useState([]);
  const transferManagers                    = useRef({});

  const fileInputRef   = useRef(null);
  const dragCounter    = useRef(0);
  const editorTimeout  = useRef(null);
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
        window.history.replaceState({ path: '' }, '', '?path=');
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
    window.history.replaceState({ path: initialPath }, '', `?path=${encodeURIComponent(initialPath)}`);
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

  const navigateTo = useCallback((path) => {
    setCurrentPath(path);
    loadFiles(path);
    window.history.pushState({ path }, '', `?path=${encodeURIComponent(path)}`);
  }, [loadFiles]);

  const handleLogout = async () => {
    await logout();
    localStorage.removeItem('activeTab');
    onLogout();
  };

  // ------------------------------------------------------------------
  // Transfer helpers
  // ------------------------------------------------------------------
  const updateTransfer = useCallback((id, updates) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const handlePauseTransfer  = useCallback(id => transferManagers.current[id]?.pause(),   []);
  const handleResumeTransfer = useCallback(id => transferManagers.current[id]?.resume(),  []);
  const handleCancelTransfer = useCallback(id => {
    transferManagers.current[id]?.cancel();
    setTransfers(prev => prev.filter(t => t.id !== id));
    delete transferManagers.current[id];
  }, []);
  const handleClearDoneTransfers = useCallback(() => {
    setTransfers(prev => {
      prev.filter(t => t.status === 'done' || t.status === 'error')
          .forEach(t => { delete transferManagers.current[t.id]; });
      return prev.filter(t => t.status !== 'done' && t.status !== 'error');
    });
  }, []);

  // ------------------------------------------------------------------
  // Upload
  // ------------------------------------------------------------------
  const handleUpload = useCallback((fileList) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const id    = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const label = files.length === 1 ? files[0].name : `${files.length} files`;

    const manager = createUploadManager(files, currentPath);
    transferManagers.current[id] = manager;

    setTransfers(prev => [...prev, {
      id, type: 'upload', name: label,
      status: 'active', percent: 0, loaded: 0, total: 0, speed: 0,
      canPauseResume: true,
    }]);

    manager.start(event => {
      switch (event.type) {
        case 'progress':
          updateTransfer(id, { percent: event.percent, loaded: event.loaded, total: event.total, speed: event.speed });
          break;
        case 'paused':
          updateTransfer(id, { status: 'paused', speed: 0 });
          break;
        case 'resumed':
          updateTransfer(id, { status: 'active' });
          break;
        case 'finalizing':
          // All bytes have left the browser; waiting for server to finish writing
          updateTransfer(id, { status: 'finalizing', percent: 100, speed: 0 });
          break;
        case 'complete':
          updateTransfer(id, { status: 'done', percent: 100, speed: 0 });
          showToast(`${label} uploaded`, 'success');
          loadFiles(currentPath);
          loadStats();
          setTimeout(() => { setTransfers(prev => prev.filter(t => t.id !== id)); delete transferManagers.current[id]; }, 6000);
          break;
        case 'complete-with-errors':
          updateTransfer(id, { status: 'done', percent: 100, speed: 0 });
          showToast(`Upload done with ${event.errors} error(s)`, 'error');
          loadFiles(currentPath);
          loadStats();
          setTimeout(() => { setTransfers(prev => prev.filter(t => t.id !== id)); delete transferManagers.current[id]; }, 6000);
          break;
        case 'file-error':
          showToast(`Failed: ${event.fileName}`, 'error');
          break;
        case 'error':
          updateTransfer(id, { status: 'error' });
          showToast('Upload failed: ' + event.message, 'error');
          break;
        default: break;
      }
    });
  }, [currentPath, updateTransfer, showToast, loadFiles, loadStats]);

  // ------------------------------------------------------------------
  // Download single file
  // ------------------------------------------------------------------
  const handleDownloadFile = useCallback((filePath) => {
    const id       = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fileName = filePath.split('/').pop();
    const manager  = createDownloadManager(filePath, false);
    transferManagers.current[id] = manager;

    setTransfers(prev => [...prev, {
      id, type: 'download', name: fileName,
      status: 'active', percent: 0, loaded: 0, total: 0, speed: 0,
      canPauseResume: true,
    }]);

    manager.start(event => {
      switch (event.type) {
        case 'started':
          updateTransfer(id, { total: event.total || 0 });
          break;
        case 'progress':
          updateTransfer(id, { percent: event.percent >= 0 ? event.percent : 0, loaded: event.loaded, total: event.total, speed: event.speed });
          break;
        case 'paused':
          updateTransfer(id, { status: 'paused', loaded: event.loaded, total: event.total, speed: 0 });
          break;
        case 'resumed':
          updateTransfer(id, { status: 'active' });
          break;
        case 'complete':
          updateTransfer(id, { status: 'done', percent: 100, speed: 0 });
          showToast('Download complete', 'success');
          setTimeout(() => { setTransfers(prev => prev.filter(t => t.id !== id)); delete transferManagers.current[id]; }, 6000);
          break;
        case 'cancelled':
          setTransfers(prev => prev.filter(t => t.id !== id));
          delete transferManagers.current[id];
          break;
        case 'error':
          updateTransfer(id, { status: 'error' });
          showToast('Download failed: ' + event.message, 'error');
          break;
        default: break;
      }
    });
  }, [updateTransfer, showToast]);

  // ------------------------------------------------------------------
  // Download ZIP
  // ------------------------------------------------------------------
  const handleDownloadZip = useCallback((folderPath) => {
    const id         = `dlzip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const folderName = (folderPath.split('/').pop() || 'files') + '.zip';
    const manager    = createDownloadManager(folderPath, true);
    transferManagers.current[id] = manager;

    setTransfers(prev => [...prev, {
      id, type: 'download', name: folderName,
      status: 'active', percent: -1, loaded: 0, total: 0, speed: 0,
      canPauseResume: false,
    }]);

    showToast('Preparing ZIP…', 'info');

    manager.start(event => {
      switch (event.type) {
        case 'progress':
          updateTransfer(id, { loaded: event.loaded, total: event.total, speed: event.speed, percent: event.percent >= 0 ? event.percent : -1 });
          break;
        case 'complete':
          updateTransfer(id, { status: 'done', speed: 0 });
          showToast('ZIP download complete', 'success');
          setTimeout(() => { setTransfers(prev => prev.filter(t => t.id !== id)); delete transferManagers.current[id]; }, 6000);
          break;
        case 'cancelled':
          setTransfers(prev => prev.filter(t => t.id !== id));
          delete transferManagers.current[id];
          break;
        case 'error':
          updateTransfer(id, { status: 'error' });
          showToast('ZIP download failed: ' + event.message, 'error');
          break;
        default: break;
      }
    });
  }, [updateTransfer, showToast]);

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
          <button onClick={() => { contextMenu.file.isDirectory ? handleDownloadZip(contextMenu.file.path) : handleDownloadFile(contextMenu.file.path); closeContextMenu(); }}>
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

      {/* ── Transfer panel (floating) ── */}
      <TransferPanel
        transfers={transfers}
        onPause={handlePauseTransfer}
        onResume={handleResumeTransfer}
        onCancel={handleCancelTransfer}
        onClearDone={handleClearDoneTransfers}
      />
    </div>
  );
}
