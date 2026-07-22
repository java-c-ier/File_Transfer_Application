import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { fetchFiles, fetchStats, createFolder, deleteItem, fetchText, saveText, logout, subscribeToChanges, previewFile, createShare } from '../api';
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
  'xlsx','xls','docx',
]);

function isPreviewable(file) {
  if (file.isDirectory) return false;
  return PREVIEWABLE.has(file.name.split('.').pop().toLowerCase());
}

function previewKind(contentType, fileName) {
  const ext = fileName ? fileName.split('.').pop().toLowerCase() : '';
  if (ext === 'xlsx' || ext === 'xls') return 'spreadsheet';
  if (ext === 'docx') return 'document';
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
  onNavigate, onDownloadFile, onDownloadZip, onDelete, onContextMenu,
  onUploadClick, onPreview, onShare,
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
          {!file.isDirectory && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={e => { e.stopPropagation(); onShare(file.path, file.name); }}
              title="Copy share link"
            >
              <span className="material-icons-round">link</span>
            </button>
          )}
          <button
            className="btn btn-ghost btn-xs"
            onClick={e => { e.stopPropagation(); onDelete(file.path, file.name); }}
            title="Delete"
          >
            <span className="material-icons-round">delete_outline</span>
          </button>
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
    return params.get('folder') || '';
  });
  const [stats, setStats]                   = useState(null);
  const [previewData, setPreviewData]       = useState(null);  // { name, url, kind, text }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dragActive, setDragActive]         = useState(false);
  const [contextMenu, setContextMenu]       = useState(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [isClosingFolder, setIsClosingFolder] = useState(false);
  const [folderName, setFolderName]         = useState('');
  const [deleteData, setDeleteData]         = useState(null);
  const [isClosingDelete, setIsClosingDelete] = useState(false);
  const [conflictData, setConflictData]     = useState(null); // { fileName, reason, resolve }
  const conflictResolverRef                 = useRef(null);
  const [shareData, setShareData]           = useState(null); // null | { loading, fileName } | { shareId, token, fileName, shareUrl }
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
      const kind = previewKind(contentType, fileName);
      if (kind === 'text') {
        const text = await blob.text();
        setPreviewData({ name: fileName, kind, text, url: null });
      } else if (kind === 'spreadsheet') {
        const xlsxMod = await import('xlsx');
        const XLSX = xlsxMod.default || xlsxMod;
        const ab = await blob.arrayBuffer();
        const wb = XLSX.read(ab);
        const sheets = {};
        wb.SheetNames.forEach(sn => {
          sheets[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
        });
        setPreviewData({ name: fileName, kind, sheets, sheetNames: wb.SheetNames, activeSheet: wb.SheetNames[0] });
      } else if (kind === 'document') {
        const mammothMod = await import('mammoth');
        const mammoth = mammothMod.default || mammothMod;
        const ab = await blob.arrayBuffer();
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer: ab });
        setPreviewData({ name: fileName, kind, html });
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
  const onConflict = useCallback((fileName, reason) => new Promise(resolve => {
    setConflictData({ fileName, reason, resolve });
  }), []);

  const handleUpload = useCallback(
    fileList => uploadFiles(fileList, currentPath, { onConflict }),
    [uploadFiles, currentPath, onConflict]
  );
  const handleDownloadFile = downloadFile;
  const handleDownloadZip  = downloadZip;

  const handleShare = useCallback(async (filePath, fileName) => {
    setShareData({ loading: true, fileName });
    try {
      const data = await createShare(filePath);
      if (data.error) { showToast(data.error, 'error'); setShareData(null); return; }
      const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}share?id=${data.shareId}`;
      navigator.clipboard.writeText(shareUrl).catch(() => {});
      setShareData({ shareId: data.shareId, token: data.token, fileName: data.fileName, shareUrl, expiresIn: data.expiresIn, filePath, tokenRefreshing: false });
      showToast('Share link copied to clipboard', 'success');
    } catch { showToast('Failed to create share link', 'error'); setShareData(null); }
  }, [showToast]);

  const handleRefreshToken = useCallback(async () => {
    if (!shareData?.filePath) return;
    setShareData(prev => ({ ...prev, tokenRefreshing: true }));
    try {
      const data = await createShare(shareData.filePath);
      if (data.error) { showToast(data.error, 'error'); setShareData(prev => ({ ...prev, tokenRefreshing: false })); return; }
      setShareData(prev => ({ ...prev, token: data.token, tokenRefreshing: false }));
      showToast('New token generated', 'success');
    } catch { showToast('Failed to refresh token', 'error'); setShareData(prev => ({ ...prev, tokenRefreshing: false })); }
  }, [shareData, showToast]);

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
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="logo-icon-sm" />
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
                onDelete={(path, name) => setDeleteData({ path, name })}
                onContextMenu={handleContextMenu}
                onUploadClick={() => fileInputRef.current?.click()}
                onPreview={handlePreview}
                onShare={handleShare}
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
          {!contextMenu.file.isDirectory && (
            <button onClick={() => { handleShare(contextMenu.file.path, contextMenu.file.name); closeContextMenu(); }}>
              <span className="material-icons-round">link</span> Copy share link
            </button>
          )}
          <button onClick={() => { setDeleteData({ path: contextMenu.file.path, name: contextMenu.file.name }); closeContextMenu(); }}>
            <span className="material-icons-round">delete</span> Delete
          </button>
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
                <button type="submit" className="btn btn-danger modal-btn">Delete</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── File conflict modal ── */}
      {conflictData && (
        <div className="modal-overlay" style={{ zIndex: 2100 }}>
          <div className="modal-content" style={{ maxWidth: '420px', width: '100%' }}>
            <h3 className="modal-title" style={{ marginBottom: '0.75rem' }}>File Already Exists</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.25rem' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{conflictData.fileName}</strong>
              {conflictData.reason === 'content'
                ? ' — a file with the same name and size exists but has different content.'
                : ' — a file with the same name already exists.'}
              <br />Overwrite it or skip this file?
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn btn-outline"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => { const r = conflictData.resolve; setConflictData(null); r('skip'); }}
              >Skip</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => { const r = conflictData.resolve; setConflictData(null); r('overwrite'); }}
              >Overwrite</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share modal ── */}
      {shareData && (
        <div className="modal-overlay" style={{ zIndex: 2200 }}>
          <div className="modal-content" style={{ maxWidth: '480px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Share File</h3>
              {!shareData.loading && (
                <button className="btn btn-ghost btn-xs" onClick={() => setShareData(null)}>
                  <span className="material-icons-round">close</span>
                </button>
              )}
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.875rem' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{shareData.fileName}</strong>
            </p>
            {shareData.loading ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-secondary)' }}>
                <span className="material-icons-round spin" style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>sync</span>
                Generating share link…
              </div>
            ) : (
              <>
                {/* Token */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem' }}>
                    One-Time Token — share separately
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
                    {/* Token display */}
                    <div style={{
                      flex: 1, padding: '0.625rem 0.875rem', borderRadius: '0.5rem',
                      background: 'var(--surface-alt, rgba(99,102,241,0.08))',
                      border: '1px solid var(--border)',
                      fontFamily: 'monospace', fontSize: '1.35rem', fontWeight: 700,
                      letterSpacing: '0.25em', color: 'var(--accent)',
                      textAlign: 'center',
                      opacity: shareData.tokenRefreshing ? 0.4 : 1,
                      transition: 'opacity 0.2s',
                    }}>
                      {shareData.token}
                    </div>
                    {/* Refresh + Copy buttons together */}
                    <div style={{ display: 'flex', flexDirection: 'row', gap: '0.25rem' }}>
                      <button
                        className="btn btn-sm btn-outline"
                        title="Generate new token"
                        disabled={shareData.tokenRefreshing}
                        onClick={handleRefreshToken}
                      >
                        <span className={`material-icons-round${shareData.tokenRefreshing ? ' spin' : ''}`} style={{ fontSize: '1.1rem' }}>refresh</span>
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        title="Copy token"
                        disabled={shareData.tokenRefreshing}
                        onClick={() => { navigator.clipboard.writeText(shareData.token); showToast('Token copied', 'success'); }}
                      >
                        <span className="material-icons-round" style={{ fontSize: '1.1rem' }}>content_copy</span>
                      </button>
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                  <span className="material-icons-round" style={{ fontSize: '0.95rem', verticalAlign: 'middle', marginRight: '0.25rem' }}>info</span>
                  Link valid for {shareData.expiresIn}. Each download needs its own token — hit refresh to generate a new one for the next recipient.
                </p>
                <div className="modal-actions">
                  <button className="btn btn-primary modal-btn" onClick={() => setShareData(null)}>Done</button>
                </div>
              </>
            )}
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

            <div style={{
              flex: 1, overflow: 'auto', display: 'flex', minHeight: 0,
              alignItems: ['spreadsheet','document'].includes(previewData?.kind) ? 'flex-start' : 'center',
              justifyContent: ['spreadsheet','document'].includes(previewData?.kind) ? 'flex-start' : 'center',
            }}>
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
              ) : previewData?.kind === 'spreadsheet' ? (
                <div className="spreadsheet-preview">
                  {previewData.sheetNames.length > 1 && (
                    <div className="sheet-tabs">
                      {previewData.sheetNames.map(sn => (
                        <button
                          key={sn}
                          className={`sheet-tab${previewData.activeSheet === sn ? ' active' : ''}`}
                          onClick={() => setPreviewData(p => ({ ...p, activeSheet: sn }))}
                        >{sn}</button>
                      ))}
                    </div>
                  )}
                  <div className="spreadsheet-table-wrap">
                    <table className="spreadsheet-table">
                      <tbody>
                        {(previewData.sheets[previewData.activeSheet] || []).map((row, r) => (
                          <tr key={r}>
                            {row.map((cell, c) => (
                              <td key={c} className={r === 0 ? 'sheet-header-cell' : ''}>{String(cell ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : previewData?.kind === 'document' ? (
                <div className="document-preview" dangerouslySetInnerHTML={{ __html: previewData.html }} />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
