// Build a History API URL for the given location value. When the value is
// empty (root folder / default screen) the "?path=" query is dropped entirely
// so the address bar shows a clean URL instead of a dangling "?path=".
export function pathUrl(value) {
  return value ? `?folder=${encodeURIComponent(value)}` : window.location.pathname;
}

export function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';

  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function getFileIcon(file) {
  if (file.isDirectory) return { icon: 'folder', cls: 'folder-icon' };

  const ext = file.name.split('.').pop().toLowerCase();
  const map = {
    jpg: { icon: 'image', cls: 'image-icon' },
    jpeg: { icon: 'image', cls: 'image-icon' },
    png: { icon: 'image', cls: 'image-icon' },
    gif: { icon: 'image', cls: 'image-icon' },
    svg: { icon: 'image', cls: 'image-icon' },
    webp: { icon: 'image', cls: 'image-icon' },
    pdf: { icon: 'picture_as_pdf', cls: 'pdf-icon' },
    doc: { icon: 'description', cls: 'doc-icon' },
    docx: { icon: 'description', cls: 'doc-icon' },
    xls: { icon: 'table_chart', cls: 'doc-icon' },
    xlsx: { icon: 'table_chart', cls: 'doc-icon' },
    ppt: { icon: 'slideshow', cls: 'doc-icon' },
    pptx: { icon: 'slideshow', cls: 'doc-icon' },
    zip: { icon: 'folder_zip', cls: 'zip-icon' },
    rar: { icon: 'folder_zip', cls: 'zip-icon' },
    '7z': { icon: 'folder_zip', cls: 'zip-icon' },
    tar: { icon: 'folder_zip', cls: 'zip-icon' },
    gz: { icon: 'folder_zip', cls: 'zip-icon' },
    js: { icon: 'code', cls: 'code-icon' },
    jsx: { icon: 'code', cls: 'code-icon' },
    ts: { icon: 'code', cls: 'code-icon' },
    tsx: { icon: 'code', cls: 'code-icon' },
    py: { icon: 'code', cls: 'code-icon' },
    java: { icon: 'code', cls: 'code-icon' },
    html: { icon: 'code', cls: 'code-icon' },
    css: { icon: 'code', cls: 'code-icon' },
    json: { icon: 'data_object', cls: 'code-icon' },
    xml: { icon: 'code', cls: 'code-icon' },
    sql: { icon: 'storage', cls: 'code-icon' },
    txt: { icon: 'article', cls: 'file-icon-default' },
    log: { icon: 'article', cls: 'file-icon-default' },
    csv: { icon: 'table_chart', cls: 'doc-icon' },
    mp4: { icon: 'movie', cls: 'image-icon' },
    avi: { icon: 'movie', cls: 'image-icon' },
    mkv: { icon: 'movie', cls: 'image-icon' },
    mp3: { icon: 'audio_file', cls: 'image-icon' },
    wav: { icon: 'audio_file', cls: 'image-icon' },
    war: { icon: 'inventory', cls: 'zip-icon' },
    jar: { icon: 'inventory', cls: 'zip-icon' },
    exe: { icon: 'terminal', cls: 'code-icon' },
    bat: { icon: 'terminal', cls: 'code-icon' },
    sh: { icon: 'terminal', cls: 'code-icon' },
  };

  return map[ext] || { icon: 'insert_drive_file', cls: 'file-icon-default' };
}
