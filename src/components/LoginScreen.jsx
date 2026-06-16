import { useState } from 'react';
import { login } from '../api';
import './LoginScreen.css';

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await login(username, password);
      if (result.success) {
        onLogin(result);
      } else {
        setError(result.error);
      }
    } catch {
      setError('Connection error');
    }

    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <span className="material-icons-round logo-icon">cloud_sync</span>
        </div>
        <h1>File Transfer</h1>
        <p className="login-subtitle">Sign in to your account</p>

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className={`input-group${error ? ' error' : ''}`}>
            <span className="material-icons-round input-icon">person</span>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              required
              autoFocus
            />
          </div>
          <div className={`input-group${error ? ' error' : ''}`}>
            <span className="material-icons-round input-icon">lock</span>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
              style={{ paddingRight: '46px' }}
            />
            <button 
              type="button" 
              onClick={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              title={showPassword ? "Hide password" : "Show password"}
            >
              <span className="material-icons-round" style={{ fontSize: '20px' }}>{showPassword ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? (
              <>
                <span className="material-icons-round spin">sync</span>
                Verifying...
              </>
            ) : (
              <>
                <span className="material-icons-round">login</span>
                Log In
              </>
            )}
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>
      </div>
    </div>
  );
}
