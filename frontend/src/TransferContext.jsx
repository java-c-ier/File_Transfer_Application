import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { createUploadManager, createDownloadManager } from './transferManager';
import TransferPanel from './components/TransferPanel';

// ---------------------------------------------------------------------------
// Transfer engine, lifted ABOVE the screens.
//
// Uploads and downloads used to live inside <FileManager>. Navigating to the
// Admin panel (or any screen swap) unmounted FileManager and tore down every
// in-flight transfer — leaving half-written ".uploading" temp files on the
// server. Hosting the transfer state + controllers here, above the screen
// switch, means a running upload/download survives ANY navigation: Files,
// Admin, profile modal, breadcrumb, back/forward — all of it.
//
// The only thing that can still kill a transfer is closing/reloading the tab
// (the browser aborts in-flight requests). We guard that with a beforeunload
// confirmation prompt while transfers are active.
// ---------------------------------------------------------------------------

const TransferContext = createContext(null);

export function useTransfers() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfers must be used within <TransferProvider>');
  return ctx;
}

export function TransferProvider({ showToast, children }) {
  const [transfers, setTransfers]   = useState([]);
  const transferManagers            = useRef({});
  // Bumped whenever an upload finishes so the file view can refresh its list.
  const [completionTick, setCompletionTick] = useState(0);

  const updateTransfer = useCallback((id, updates) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  // ---- panel controls -------------------------------------------------------
  const pauseTransfer  = useCallback(id => transferManagers.current[id]?.pause(),  []);
  const resumeTransfer = useCallback(id => transferManagers.current[id]?.resume(), []);
  const cancelTransfer = useCallback(id => {
    transferManagers.current[id]?.cancel();
    setTransfers(prev => prev.filter(t => t.id !== id));
    delete transferManagers.current[id];
  }, []);
  const clearDoneTransfers = useCallback(() => {
    setTransfers(prev => {
      prev.filter(t => t.status === 'done' || t.status === 'error')
          .forEach(t => { delete transferManagers.current[t.id]; });
      return prev.filter(t => t.status !== 'done' && t.status !== 'error');
    });
  }, []);

  // ---- upload ---------------------------------------------------------------
  const uploadFiles = useCallback((fileList, currentPath, { onConflict } = {}) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const id    = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const label = files.length === 1 ? files[0].name : `${files.length} files`;

    const manager = createUploadManager(files, currentPath, { onConflict });
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
          updateTransfer(id, { status: 'finalizing', percent: 100, speed: 0 });
          break;
        case 'complete':
          // No success toast — the Transfers tray already shows "Complete".
          updateTransfer(id, { status: 'done', percent: 100, speed: 0 });
          setCompletionTick(n => n + 1);
          setTimeout(() => { setTransfers(prev => prev.filter(t => t.id !== id)); delete transferManagers.current[id]; }, 6000);
          break;
        case 'complete-with-errors':
          updateTransfer(id, { status: 'done', percent: 100, speed: 0 });
          showToast(`Upload done with ${event.errors} error(s)`, 'error');
          setCompletionTick(n => n + 1);
          setTimeout(() => { setTransfers(prev => prev.filter(t => t.id !== id)); delete transferManagers.current[id]; }, 6000);
          break;
        case 'hashing':
          updateTransfer(id, { status: 'hashing', name: `Checking ${event.fileName}…` });
          break;
        case 'file-skipped':
          if (event.reason === 'duplicate')
            showToast(`Skipped "${event.fileName}" — exact duplicate already exists`, 'info');
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
  }, [updateTransfer, showToast]);

  // ---- download single file -------------------------------------------------
  const downloadFile = useCallback((filePath, knownSize) => {
    const id       = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fileName = filePath.split('/').pop();
    const manager  = createDownloadManager(filePath, false, knownSize);
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
          // No success toast — the Transfers tray already shows "Complete".
          updateTransfer(id, { status: 'done', percent: 100, speed: 0 });
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

  // ---- download ZIP ---------------------------------------------------------
  const downloadZip = useCallback((folderPath) => {
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
          // No success toast — the Transfers tray already shows "Complete".
          updateTransfer(id, { status: 'done', speed: 0 });
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

  // ---- guard tab close / reload while transfers are running -----------------
  const hasActiveTransfers = transfers.some(
    t => t.status === 'active' || t.status === 'paused' || t.status === 'finalizing'
  );
  useEffect(() => {
    if (!hasActiveTransfers) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasActiveTransfers]);

  const value = {
    transfers,
    uploadFiles,
    downloadFile,
    downloadZip,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    clearDoneTransfers,
    completionTick,
    hasActiveTransfers,
  };

  return (
    <TransferContext.Provider value={value}>
      {children}
      {/* Always-on floating panel — lives above the screens, so it stays put
          and keeps running no matter which screen is shown. */}
      <TransferPanel
        transfers={transfers}
        onPause={pauseTransfer}
        onResume={resumeTransfer}
        onCancel={cancelTransfer}
        onClearDone={clearDoneTransfers}
      />
    </TransferContext.Provider>
  );
}
