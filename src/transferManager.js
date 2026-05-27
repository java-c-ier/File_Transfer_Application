/**
 * Transfer Manager
 *
 * Uploads  — chunked, 4-file parallel, pause/resume, cross-session resume,
 *             per-chunk retry with exponential back-off.
 * Downloads — streamed directly to disk via File System Access API (Chrome 86+);
 *             falls back to memory buffer on unsupported browsers.
 *             Regular files support pause/resume via HTTP Range headers.
 *             ZIP downloads stream without buffering (no pause support).
 */

import { getToken } from './api.js';

const API_BASE         = import.meta.env.PROD ? '/file-transfer' : '';
const CHUNK_SIZE       = 10 * 1024 * 1024;  // 10 MB per chunk
const UPLOAD_CONCURRENCY = 4;                // files uploading in parallel
const CHUNK_MAX_RETRIES  = 3;               // attempts before giving up on a chunk

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
export function createUploadManager(files, currentPath) {
  const fileArray   = Array.from(files);
  const totalSize   = fileArray.reduce((sum, f) => sum + f.size, 0);
  const fileProgress = new Array(fileArray.length).fill(0);

  let paused        = false;
  let cancelled     = false;
  let resumeResolve = null;
  let onEvent       = null;
  const speedTracker = makeSpeedTracker();

  function emit(event) { if (onEvent) onEvent(event); }

  function waitIfPaused() {
    if (!paused) return Promise.resolve();
    return new Promise(resolve => { resumeResolve = resolve; });
  }

  // Upload one chunk with retry; passes byteOffset + onBytesSent through
  async function uploadChunk(file, chunkIndex, totalChunks, uploadId, chunkBlob, byteOffset, onChunkProgress, onBytesSent) {
    let lastErr;
    for (let attempt = 0; attempt < CHUNK_MAX_RETRIES; attempt++) {
      if (cancelled) return;
      try {
        return await _doUploadChunk(file, chunkIndex, totalChunks, uploadId, chunkBlob, byteOffset, onChunkProgress, onBytesSent);
      } catch (err) {
        lastErr = err;
        if (attempt < CHUNK_MAX_RETRIES - 1) {
          // Exponential back-off: 1 s, 2 s, 4 s …
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Send one chunk via XHR.
   *
   * onChunkProgress(loaded, total) — fires during the upload phase
   * onBytesSent()                  — fires once ALL bytes have left the
   *   browser (xhr.upload.loadend), BEFORE the server responds.
   *   Used on the last chunk to flip the UI to "Finalizing…" immediately
   *   while the server writes and renames the staging file.
   */
  function _doUploadChunk(file, chunkIndex, totalChunks, uploadId, chunkBlob, byteOffset, onChunkProgress, onBytesSent) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('chunk',       chunkBlob, file.name);
      form.append('uploadId',    uploadId);
      form.append('chunkIndex',  String(chunkIndex));
      form.append('totalChunks', String(totalChunks));
      form.append('fileName',    file.name);
      // Direct-write fields: server uses these to write at the correct offset
      form.append('byteOffset',  String(byteOffset));
      form.append('fileSize',    String(file.size));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/upload-chunk`);
      xhr.setRequestHeader('X-Auth-Token', getToken());
      xhr.setRequestHeader('X-Upload-Path', currentPath || '');

      if (onChunkProgress) {
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) onChunkProgress(e.loaded, e.total);
        });
      }

      // Fires when all bytes have left the browser — before server response.
      // On the last chunk this lets us show "Finalizing…" immediately.
      if (onBytesSent) {
        xhr.upload.addEventListener('loadend', onBytesSent, { once: true });
      }

      xhr.onload = () => {
        if (xhr.status < 400) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(/* empty body */{}); }
        } else {
          reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(form);
    });
  }

  /**
   * Query the server for already-received chunk indices and return the first
   * *missing* index so upload resumes at the correct contiguous boundary.
   */
  async function getResumeOffset(uploadId) {
    try {
      const r = await fetch(
        `${API_BASE}/api/upload-chunk/status?uploadId=${encodeURIComponent(uploadId)}`,
        { headers: { 'X-Auth-Token': getToken() } }
      );
      if (r.ok) {
        const { received } = await r.json();
        if (!Array.isArray(received) || received.length === 0) return 0;

        // Find the first gap in a sorted contiguous run starting at 0
        const sorted = [...received].sort((a, b) => a - b);
        let i = 0;
        while (i < sorted.length && sorted[i] === i) i++;
        return i; // first missing chunk index
      }
    } catch { /* network error — start from beginning */ }
    return 0;
  }

  async function uploadFile(file, fileIndex) {
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    // Stable uploadId: incorporates filename + size so a resume after page-refresh finds the right chunks
    const uploadId = `${btoa(encodeURIComponent(file.name)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}-${file.size}-${fileIndex}`;

    // Check server for already-received chunks (supports cross-session resume)
    let startChunk = await getResumeOffset(uploadId);
    if (startChunk > 0) {
      fileProgress[fileIndex] = Math.min(startChunk * CHUNK_SIZE, file.size);
    }

    for (let i = startChunk; i < totalChunks; i++) {
      await waitIfPaused();
      if (cancelled) return false;

      const start      = i * CHUNK_SIZE;
      const end        = Math.min(start + CHUNK_SIZE, file.size);
      const chunkBlob  = file.slice(start, end);
      const chunkStart = start;
      const isLastChunk = (i === totalChunks - 1);

      await uploadChunk(
        file, i, totalChunks, uploadId, chunkBlob,
        start, // byteOffset
        // onChunkProgress — fired as bytes travel over the network
        (chunkLoaded) => {
          fileProgress[fileIndex] = chunkStart + chunkLoaded;
          const totalLoaded = fileProgress.reduce((a, b) => a + b, 0);
          emit({
            type:        'progress',
            loaded:      totalLoaded,
            total:       totalSize,
            percent:     totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 100,
            speed:       speedTracker.update(totalLoaded),
            currentFile: file.name,
          });
        },
        // onBytesSent — fires once when the last chunk's bytes have fully
        // left the browser, before the server writes and responds.
        // Flipping to "finalizing" here gives immediate feedback.
        isLastChunk ? () => emit({ type: 'finalizing' }) : undefined,
      );

      fileProgress[fileIndex] = end;
      const totalLoaded = fileProgress.reduce((a, b) => a + b, 0);
      // Don't emit a plain progress after "finalizing" was already emitted
      if (!isLastChunk) {
        emit({
          type:        'progress',
          loaded:      totalLoaded,
          total:       totalSize,
          percent:     totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 100,
          speed:       speedTracker.update(totalLoaded),
          currentFile: file.name,
        });
      }
    }
    return true;
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
      emit({ type: 'paused' });
    },
    resume() {
      if (!paused || cancelled) return;
      paused = false;
      if (resumeResolve) { resumeResolve(); resumeResolve = null; }
      emit({ type: 'resumed' });
    },
    cancel() {
      cancelled = true;
      paused    = false;
      if (resumeResolve) { resumeResolve(); resumeResolve = null; }
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
 *   - If window.showSaveFilePicker is available (Chrome/Edge 86+):
 *       Prompt for a save location FIRST, then stream the response body
 *       directly into the file — zero in-memory buffering.
 *       Regular files support pause/resume: the writable stays open while
 *       paused; resume uses a Range request continuing from the byte offset.
 *   - Otherwise (Firefox / Safari):
 *       Buffer chunks in memory and trigger a download via an object URL.
 *       For very large files this may exhaust browser memory; a warning is
 *       logged to the console.
 *
 * Returns { start(onEvent), pause(), resume(), cancel(), canPauseResume }
 *
 * Events: started | progress | paused | resumed | complete | cancelled | error
 */
export function createDownloadManager(filePath, isZip = false) {
  const baseName = filePath.split('/').pop() || 'download';
  const fileName = isZip ? `${baseName}.zip` : baseName;

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
      ? `${API_BASE}/api/download-zip?path=${encodeURIComponent(filePath)}`
      : `${API_BASE}/api/download?path=${encodeURIComponent(filePath)}`;

    const reqHeaders = { 'X-Auth-Token': getToken() };
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
      res = await fetch(url, { headers: reqHeaders, signal: abortCtrl.signal });
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
      res = await fetch(url, { headers: reqHeaders, signal: abortCtrl.signal });
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
    const blob = new Blob(chunks);
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

  return {
    /** true for regular files; false for ZIP (server regenerates it on every request) */
    canPauseResume: !isZip,

    async start(callback) {
      onEvent = callback;

      if (canUseFilePicker) {
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
        if (totalSize > 500 * 1024 * 1024) {
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
