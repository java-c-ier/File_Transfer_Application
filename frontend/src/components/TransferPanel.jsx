import { useState } from 'react';
import { formatSize } from '../utils';
import './TransferPanel.css';

function formatSpeed(bps) {
  if (!bps || bps < 0) return '';
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  if (bps >= 1024)        return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function formatEta(loaded, total, speed) {
  if (!speed || speed <= 0 || !total || loaded >= total) return '';
  const secs = Math.round((total - loaded) / speed);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// ---------------------------------------------------------------------------
// Individual transfer item
// ---------------------------------------------------------------------------
function TransferItem({ transfer, onPause, onResume, onCancel }) {
  const { id, type, name, status, percent, loaded, total, speed, canPauseResume } = transfer;

  const isActive     = status === 'active';
  const isPaused     = status === 'paused';
  const isFinalizing = status === 'finalizing'; // bytes sent, server writing
  const isDone       = status === 'done';
  const isError      = status === 'error';
  const inProgress   = isActive || isPaused || isFinalizing;

  // percent = -1 means size is unknown (ZIP streaming)
  const knownSize  = percent >= 0 && total > 0;
  const displayPct = knownSize ? percent : null;

  const eta = knownSize && isActive ? formatEta(loaded, total, speed) : '';

  return (
    <div className={`tp-item tp-item--${status}`}>
      {/* Header row */}
      <div className="tp-item-header">
        <span className={`material-icons-round tp-type-icon tp-type-icon--${type}`}>
          {isDone
            ? 'check_circle'
            : isError
            ? 'error_outline'
            : isFinalizing
            ? 'pending'          // hourglass-style icon while server finalizes
            : type === 'upload'
            ? 'cloud_upload'
            : 'cloud_download'}
        </span>
        <span className="tp-name" title={name}>{name}</span>
        <div className="tp-actions">
          {isActive && canPauseResume && (
            <button className="tp-btn" onClick={() => onPause(id)} title="Pause">
              <span className="material-icons-round">pause</span>
            </button>
          )}
          {isPaused && canPauseResume && (
            <button className="tp-btn tp-btn--resume" onClick={() => onResume(id)} title="Resume">
              <span className="material-icons-round">play_arrow</span>
            </button>
          )}
          {/* No pause/cancel during finalizing — server is already writing */}
          {!isFinalizing && (
            <button
              className={`tp-btn ${inProgress ? 'tp-btn--cancel' : ''}`}
              onClick={() => onCancel(id)}
              title={inProgress ? 'Cancel' : 'Dismiss'}
            >
              <span className="material-icons-round">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress row — shown while transferring or finalizing */}
      {(isActive || isPaused) && (
        <div className="tp-progress">
          <div className="tp-track">
            {displayPct !== null ? (
              <div className="tp-fill" style={{ width: `${displayPct}%` }} />
            ) : (
              <div className="tp-fill tp-fill--indeterminate" />
            )}
          </div>
          <div className="tp-stats">
            {displayPct !== null && <span className="tp-pct">{displayPct}%</span>}
            <span className="tp-bytes">
              {formatSize(loaded)}{total > 0 ? ` / ${formatSize(total)}` : ''}
            </span>
            {isPaused
              ? <span className="tp-status-text">Paused</span>
              : speed > 0 && <span className="tp-speed">{formatSpeed(speed)}</span>
            }
            {eta && <span className="tp-eta">{eta} left</span>}
          </div>
        </div>
      )}

      {/* Finalizing — indeterminate bar + explanation */}
      {isFinalizing && (
        <div className="tp-progress">
          <div className="tp-track">
            <div className="tp-fill tp-fill--indeterminate" />
          </div>
          <div className="tp-stats">
            <span className="tp-pct">100%</span>
            <span className="tp-bytes">{total > 0 ? formatSize(total) : ''}</span>
            <span className="tp-status-text tp-status-text--finalizing">Finalizing on server…</span>
          </div>
        </div>
      )}

      {isDone  && <p className="tp-done-text">Complete</p>}
      {isError && <p className="tp-error-text">Transfer failed</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export default function TransferPanel({ transfers, onPause, onResume, onCancel, onClearDone }) {
  const [collapsed, setCollapsed] = useState(false);

  if (transfers.length === 0) return null;

  const activeCount = transfers.filter(t => t.status === 'active' || t.status === 'paused' || t.status === 'finalizing').length;
  const doneCount   = transfers.filter(t => t.status === 'done' || t.status === 'error').length;

  return (
    <div className={`transfer-panel${collapsed ? ' transfer-panel--collapsed' : ''}`}>
      {/* Panel header */}
      <div className="tp-header" onClick={() => setCollapsed(c => !c)}>
        <div className="tp-header-title">
          <span className="material-icons-round" style={{ fontSize: '1.1rem' }}>swap_vert</span>
          <span>
            Transfers
            {activeCount > 0 && <span className="tp-badge">{activeCount}</span>}
          </span>
        </div>
        <div className="tp-header-controls" onClick={e => e.stopPropagation()}>
          {doneCount > 0 && (
            <button className="tp-btn" onClick={onClearDone} title="Clear completed">
              <span className="material-icons-round">done_all</span>
            </button>
          )}
          <button className="tp-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
            <span className="material-icons-round">{collapsed ? 'expand_less' : 'expand_more'}</span>
          </button>
        </div>
      </div>

      {/* Transfer list */}
      {!collapsed && (
        <div className="tp-list">
          {transfers.map(t => (
            <TransferItem
              key={t.id}
              transfer={t}
              onPause={onPause}
              onResume={onResume}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
