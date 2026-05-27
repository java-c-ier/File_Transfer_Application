import './Toast.css';

const ICONS = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
};

export default function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <span className="material-icons-round">{ICONS[toast.type]}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
