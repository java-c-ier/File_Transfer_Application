/**
 * Transfer Manager
 *
 * Uploads  — single streaming XHR per file (no chunking), 4-file parallel,
 *             pause/resume (abort XHR + query server offset), cross-session resume.
 * Downloads — streamed directly to disk via File System Access API (Chrome 86+);
 *             falls back to memory buffer on unsupported browsers.
 *             Regular files support pause/resume via HTTP Range headers.
 *             ZIP downloads stream without buffering (no pause support).
 */


function API_BASE() {
  return window.APP_CONFIG?.appBaseUrl ||
    import.meta.env.VITE_APP_BASE_URL ||
    '';
}
const UPLOAD_CONCURRENCY = 4;   // files uploading in parallel
const STREAM_MAX_RETRIES = 3;   // retry attempts on network error

async function sha256(file) {
  const buf  = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkFile(name, size, path, hash) {
  const params = new URLSearchParams({ name, size, path: path || '' });
  if (hash) params.set('hash', hash);
  const r = await fetch(`${API_BASE()}/api/files/check?${params}`, { credentials: 'include' });
  if (!r.ok) return { exists: false };
  return r.json();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeSpeedTracker() {
  let lastTime   = Date.now();
  let lastBytes  = 0;
  let speed      = 0;

  return {
    update(loaded) {
      const now = Date.now();
      const dt  = now - lastTime;
      if (dt >= 600) {
        speed     = ((loaded - lastBytes) / dt) * 1000;
        lastTime  = now;
        lastBytes = loaded;
      }
      return speed;
    },
    get() { return speed; },
  };
}

// ---------------------------------------------------------------------------
// Upload Manager
// ---------------------------------------------------------------------------

/**
 * createUploadManager(files, currentPath)
 *
 * Returns { start(onEvent), pause(), resume(), cancel() }
 *
 * Events: progress | paused | resumed | complete | complete-with-errors | file-error | error
 */
export function createUploadManager(files, currentPath, { onConflict } = {}) {
  const fileArray    = Array.from(files);
  const totalSize    = fileArray.reduce((sum, f) => sum + f.size, 0);
  const fileProgress = new Array(fileArray.length).fill(0);

  let paused          = false;
  let cancelled       = false;
  let resumeResolvers = [];   // workers waiting on pause
  let onEvent         = null;
  const activeXhrs    = new Set();   // in-flight XHRs; aborted on pause/cancel
  const speedTracker  = makeSpeedTracker();

  function emit(event) { if (onEvent) onEvent(event); }

  function waitIfPaused() {
    if (!paused) return Promise.resolve();
    return new Promise(resolve => { resumeResolvers.push(resolve); });
  }

  /**
   * Query the server for how many bytes of this file it has already written
   * to the staging file.  Used both for cross-session resume at start and
   * to find the exact resume offset after an XHR is aborted mid-stream.
   */
  async function getStreamResumeOffset(file) {
    try {
      const subfolder = currentPath || '';
      const url = `${API_BASE()}/api/upload-stream/status` +
        `?fileName=${encodeURIComponent(file.name)}&path=${encodeURIComponent(subfolder)}`;
      const r = await fetch(url, { credentials: 'include' });
      if (r.ok) {
        const { bytesReceived } = await r.json();
        return typeof bytesReceived === 'number' ? bytesReceived : 0;
      }
    } catch { /* network error — start from beginning */ }
    return 0;
  }

  /**
   * Send file.slice(startByte) as a single raw application/octet-stream POST.
   * Metadata is carried in request headers — zero multipart/FormData overhead.
   * The server pipes the body directly to disk at byteOffset.
   *
   * Resolves with:
   *   { aborted: true }                     — XHR was aborted (pause / cancel)
   *   { done: true, name, size }            — file complete, renamed to final path
   *   { done: false, bytesReceived: number} — partial (shouldn't happen normally)
   *
   * Rejects on HTTP ≥ 400 or network error.
   */
  function sendSlice(file, fileIndex, startByte) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeXhrs.add(xhr);

      xhr.open('POST', `${API_BASE()}/api/upload-stream`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Upload-Path', currentPath || '');
      xhr.setRequestHeader('X-File-Name',   encodeURIComponent(file.name));
      xhr.setRequestHeader('X-File-Size',   String(file.size));
      xhr.setRequestHeader('X-Byte-Offset', String(startByte));
      xhr.setRequestHeader('Content-Type',  'application/octet-stream');

      let finalizingEmitted = false;

      // Upload progress: e.loaded is bytes sent from the slice (not the full file)
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          fileProgress[fileIndex] = startByte + e.loaded;
          const totalLoaded = fileProgress.reduce((a, b) => a + b, 0);
          emit({
            type:        'progress',
            loaded:      totalLoaded,
            total:       totalSize,
            percent:     totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 100,
            speed:       speedTracker.update(totalLoaded),
            currentFile: file.name,
          });
        }
      });

      // All bytes have left the browser — server is now writing/renaming
      xhr.upload.addEventListener('loadend', () => {
        if (!finalizingEmitted) { finalizingEmitted = true; emit({ type: 'finalizing' }); }
      }, { once: true });

      xhr.onabort = () => { activeXhrs.delete(xhr); resolve({ aborted: true }); };

      xhr.onload = () => {
        activeXhrs.delete(xhr);
        if (xhr.status < 400) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ done: true }); }
        } else {
          reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => { activeXhrs.delete(xhr); reject(new Error('Network error')); };

      // Send the entire remaining file as one continuous stream
      xhr.send(startByte === 0 ? file : file.slice(startByte));
    });
  }

  /**
   * Upload one file using a single streaming XHR per "slice".
   * On pause the XHR is aborted; the server's staging file size is then
   * queried as the ground-truth resume offset.
   * On network error the same query is made, then the upload retries.
   */
  async function uploadFile(file, fileIndex) {
    // ── Duplicate / conflict check ──────────────────────────────────────────
    try {
      const quick = await checkFile(file.name, file.size, currentPath);
      if (quick.exists) {
        if (quick.sameSize) {
          // Same name + size — need hash to distinguish exact duplicate vs different content
          emit({ type: 'hashing', fileName: file.name });
          const hash = await sha256(file);
          const deep = await checkFile(file.name, file.size, currentPath, hash);
          if (deep.duplicate) {
            // Exact same content — skip silently
            emit({ type: 'file-skipped', fileName: file.name, reason: 'duplicate' });
            fileProgress[fileIndex] = file.size;
            return true;
          }
          // Same name + size, different content
          if (onConflict) {
            const decision = await onConflict(file.name, 'content');
            if (decision === 'skip') {
              emit({ type: 'file-skipped', fileName: file.name, reason: 'skipped' });
              fileProgress[fileIndex] = file.size;
              return true;
            }
          }
        } else {
          // Same name, different size
          if (onConflict) {
            const decision = await onConflict(file.name, 'name');
            if (decision === 'skip') {
              emit({ type: 'file-skipped', fileName: file.name, reason: 'skipped' });
              fileProgress[fileIndex] = file.size;
              return true;
            }
          }
        }
      }
    } catch { /* network error during check — proceed with upload */ }
    // ── End duplicate check ─────────────────────────────────────────────────

    // Check server for bytes already written from a previous session
    let startByte = await getStreamResumeOffset(file);
    if (startByte > 0) {
      fileProgress[fileIndex] = startByte;
      const totalLoaded = fileProgress.reduce((a, b) => a + b, 0);
      emit({
        type: 'progress', loaded: totalLoaded, total: totalSize,
        percent: totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0,
        speed: 0, currentFile: file.name,
      });
    }

    // Empty file — create a zero-byte entry on the server
    if (file.size === 0) {
      await waitIfPaused();
      if (cancelled) return false;
      const result = await sendSlice(file, fileIndex, 0);
      return !cancelled && !result.aborted;
    }

    let retries = 0;

    while (startByte < file.size) {
      await waitIfPaused();
      if (cancelled) return false;

      try {
        const result = await sendSlice(file, fileIndex, startByte);

        if (result.aborted) {
          if (cancelled) return false;
          // Paused mid-stream: ask server for the exact byte boundary it received
          startByte = await getStreamResumeOffset(file);
          fileProgress[fileIndex] = startByte;
          retries = 0;
          // Loop back to waitIfPaused() — resumes when user clicks Resume
          continue;
        }

        if (result.done) {
          fileProgress[fileIndex] = file.size;
          return true;
        }

        // Partial acknowledgement (server couldn't rename yet) — shouldn't
        // happen under normal operation but handle it gracefully
        startByte = typeof result.bytesReceived === 'number'
          ? result.bytesReceived
          : startByte;
        retries = 0;

      } catch (err) {
        retries++;
        if (retries >= STREAM_MAX_RETRIES) throw err;
        // Exponential back-off before retry: 1 s, 2 s
        await new Promise(r => setTimeout(r, 1000 * retries));
        // Re-sync with server to avoid re-sending bytes it already has
        const serverOffset = await getStreamResumeOffset(file);
        startByte = serverOffset;
        fileProgress[fileIndex] = startByte;
      }
    }

    return !cancelled;
  }

  async function run() {
    emit({ type: 'progress', loaded: 0, total: totalSize, percent: 0, speed: 0, currentFile: '' });

    const queue = fileArray.map((file, index) => ({ file, index }));
    let errorCount = 0;

    async function worker() {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        try {
          const ok = await uploadFile(item.file, item.index);
          if (!ok) return; // cancelled
        } catch (err) {
          errorCount++;
          emit({ type: 'file-error', fileName: item.file.name, message: err.message });
        }
      }
    }

    const concurrency = Math.min(UPLOAD_CONCURRENCY, fileArray.length);
    await Promise.all(Array.from({ length: concurrency }, worker));

    if (cancelled) return;
    emit(errorCount === 0
      ? { type: 'complete' }
      : { type: 'complete-with-errors', errors: errorCount }
    );
  }

  return {
    start(callback) {
      onEvent = callback;
      run().catch(err => emit({ type: 'error', message: err.message }));
    },
    pause() {
      if (paused || cancelled) return;
      paused = true;
      // Abort every in-flight XHR — onabort resolves sendSlice({aborted:true})
      // uploadFile then queries the server for the exact resume offset
      for (const xhr of activeXhrs) xhr.abort();
      emit({ type: 'paused' });
    },
    resume() {
      if (!paused || cancelled) return;
      paused = false;
      // Unblock all uploadFile loops that are sitting in waitIfPaused()
      const waiting = resumeResolvers.splice(0);
      for (const resolve of waiting) resolve();
      emit({ type: 'resumed' });
    },
    cancel() {
      cancelled = true;
      paused    = false;
      for (const xhr of activeXhrs) xhr.abort();
      const waiting = resumeResolvers.splice(0);
      for (const resolve of waiting) resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Download Manager
// ---------------------------------------------------------------------------

/**
 * createDownloadManager(filePath, isZip)
 *
 * Strategy:
 *   - Small regular files (< 200 MB, size known from the listing):
 *       Buffer in memory and save via an object URL — downloads SILENTLY to
 *       the browser's default folder, no "Save As" prompt. Matches how
 *       ordinary websites behave.
 *   - Large files (>= 200 MB) and ZIPs, when window.showSaveFilePicker is
 *     available (Chrome/Edge 86+):
 *       Prompt for a save location FIRST, then stream the response body
 *       directly into the file — zero in-memory buffering.
 *       Regular files support pause/resume: the writable stays open while
 *       paused; resume uses a Range request continuing from the byte offset.
 *   - Browsers without the picker API (Firefox / Safari):
 *       Always buffer in memory and trigger a download via an object URL.
 *       For very large files this may exhaust browser memory; a warning is
 *       logged to the console.
 *
 * Returns { start(onEvent), pause(), resume(), cancel(), canPauseResume }
 *
 * Events: started | progress | paused | resumed | complete | cancelled | error
 */
export function createDownloadManager(filePath, isZip = false, knownSize = 0) {
  const baseName = filePath.split('/').pop() || 'download';
  const fileName = isZip ? `${baseName}.zip` : baseName;

  // Files smaller than this download SILENTLY to the browser's default folder
  // (blob + <a download>), exactly like an ordinary website — no "Save As"
  // prompt. Larger files (and ZIPs, whose size we can't know up front) use the
  // File System Access picker so they stream straight to disk without buffering
  // the whole file in memory. 200 MB sits comfortably within a tab's heap.
  const SMALL_FILE_THRESHOLD = 200 * 1024 * 1024;

  let bytesReceived = 0;
  let totalSize     = 0;
  let status        = 'idle'; // idle | downloading | paused | done | error | cancelled
  let abortCtrl     = null;
  let onEvent       = null;

  // For streaming-to-disk (File System Access API)
  let fsWritable    = null; // FileSystemWritableFileStream

  // For fallback (memory buffer)
  let chunks        = [];   // Uint8Array[]

  const speedTracker = makeSpeedTracker();

  function emit(event) { if (onEvent) onEvent(event); }

  // Build the fetch URL and headers for a given byte offset
  function buildRequest(offset) {
    const url = isZip
      ? `${API_BASE()}/api/download-zip?path=${encodeURIComponent(filePath)}`
      : `${API_BASE()}/api/download?path=${encodeURIComponent(filePath)}`;

    const reqHeaders = {};
    if (!isZip && offset > 0) reqHeaders['Range'] = `bytes=${offset}-`;

    abortCtrl = new AbortController();
    return { url, reqHeaders };
  }

  // Parse total size from response headers (handles both 200 and 206)
  function parseTotalSize(res, offset) {
    const cl = res.headers.get('Content-Length');
    if (cl) return parseInt(cl, 10) + offset;

    const cr = res.headers.get('Content-Range');
    if (cr) {
      const m = cr.match(/bytes \d+-\d+\/(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }

  // Stream the response body, calling onChunk for each Uint8Array value.
  // Resolves when the stream is fully consumed.
  async function streamBody(res, onChunk) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await onChunk(value);
      bytesReceived += value.length;
      emit({
        type:    'progress',
        loaded:  bytesReceived,
        total:   totalSize,
        percent: totalSize > 0 ? Math.round((bytesReceived / totalSize) * 100) : -1,
        speed:   speedTracker.update(bytesReceived),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Streaming-to-disk path (File System Access API)
  // ---------------------------------------------------------------------------

  async function startStreaming(offset) {
    status = 'downloading';
    const { url, reqHeaders } = buildRequest(offset);

    let res;
    try {
      res = await fetch(url, { headers: reqHeaders, credentials: 'include', signal: abortCtrl.signal });
    } catch (err) {
      if (err.name === 'AbortError') return;
      status = 'error';
      emit({ type: 'error', message: err.message });
      return;
    }

    if (!res.ok) {
      status = 'error';
      emit({ type: 'error', message: `Server responded ${res.status}` });
      return;
    }

    if (totalSize === 0) {
      totalSize = parseTotalSize(res, offset);
      emit({ type: 'started', total: totalSize });
    }

    try {
      await streamBody(res, async value => {
        await fsWritable.write(value);
      });
    } catch (err) {
      if (err.name === 'AbortError') return; // paused or cancelled
      status = 'error';
      try { await fsWritable.close(); } catch { /* best-effort */ }
      emit({ type: 'error', message: err.message });
      return;
    }

    // Stream fully consumed
    if (status === 'cancelled') {
      try { await fsWritable.abort(); } catch { /* best-effort */ }
      return;
    }
    // Edge-case: paused just as last byte arrived but we actually have all data
    if (status === 'paused' && totalSize > 0 && bytesReceived < totalSize) return;

    status = 'done';
    try { await fsWritable.close(); } catch { /* best-effort */ }
    emit({ type: 'complete' });
  }

  // ---------------------------------------------------------------------------
  // Buffered fallback path (Firefox / Safari)
  // ---------------------------------------------------------------------------

  async function startBuffered(offset) {
    status = 'downloading';
    const { url, reqHeaders } = buildRequest(offset);

    let res;
    try {
      res = await fetch(url, { headers: reqHeaders, credentials: 'include', signal: abortCtrl.signal });
    } catch (err) {
      if (err.name === 'AbortError') return;
      status = 'error';
      emit({ type: 'error', message: err.message });
      return;
    }

    if (!res.ok) {
      status = 'error';
      emit({ type: 'error', message: `Server responded ${res.status}` });
      return;
    }

    if (totalSize === 0) {
      totalSize = parseTotalSize(res, offset);
      emit({ type: 'started', total: totalSize });
    }

    try {
      await streamBody(res, async value => { chunks.push(value); });
    } catch (err) {
      if (err.name === 'AbortError') return;
      status = 'error';
      emit({ type: 'error', message: err.message });
      return;
    }

    if (status === 'cancelled') { chunks = []; return; }
    if (status === 'paused' && totalSize > 0 && bytesReceived < totalSize) return;

    status = 'done';
    triggerBlobSave();
  }

  function triggerBlobSave() {
    // Tag the blob as binary. Without an explicit type the blob's MIME is ""
    // and mobile Chrome content-sniffs it, guesses text/plain, and appends a
    // ".txt" to the filename (e.g. "cgi-backend.war" → "cgi-backend.war.txt").
    // application/octet-stream has no canonical extension, so the browser keeps
    // the name from the download attribute exactly as-is.
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    chunks = [];
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    emit({ type: 'complete' });
  }

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  const canUseFilePicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

  // A known, small regular file downloads silently — skip the picker entirely.
  const knownSmallFile = !isZip && knownSize > 0 && knownSize < SMALL_FILE_THRESHOLD;
  const usePicker      = canUseFilePicker && !knownSmallFile;

  return {
    /** true for regular files; false for ZIP (server regenerates it on every request) */
    canPauseResume: !isZip,

    async start(callback) {
      onEvent = callback;

      if (usePicker) {
        // Prompt for save location BEFORE the fetch so the write stays in-gesture
        try {
          const handle  = await window.showSaveFilePicker({ suggestedName: fileName });
          fsWritable    = await handle.createWritable();
        } catch (e) {
          if (e.name === 'AbortError') { emit({ type: 'cancelled' }); return; }
          // Picker API failed — fall back to buffered download
          console.warn('showSaveFilePicker unavailable, falling back to memory buffer:', e);
          startBuffered(0);
          return;
        }
        startStreaming(0);
      } else {
        // Silent download: small files, or browsers without the picker API.
        // Warn only when a genuinely large file is being forced into memory
        // because the streaming API isn't available at all.
        if (!canUseFilePicker && (isZip || knownSize > SMALL_FILE_THRESHOLD)) {
          console.warn(
            'File System Access API not supported. Large file will be buffered in memory. ' +
            'Use Chrome or Edge for streaming downloads.'
          );
        }
        startBuffered(0);
      }
    },

    pause() {
      if (status !== 'downloading' || isZip) return;
      status = 'paused';
      abortCtrl?.abort();
      emit({ type: 'paused', loaded: bytesReceived, total: totalSize });
    },

    resume() {
      if (status !== 'paused') return;
      emit({ type: 'resumed' });
      if (fsWritable) {
        startStreaming(bytesReceived);
      } else {
        startBuffered(bytesReceived);
      }
    },

    cancel() {
      status = 'cancelled';
      abortCtrl?.abort();
      chunks = [];
      emit({ type: 'cancelled' });
    },

    getStatus() { return status; },
  };
}
