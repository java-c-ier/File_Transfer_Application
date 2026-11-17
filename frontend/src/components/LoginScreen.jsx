import { useState, useRef, useEffect } from 'react';
import { requestOtp, verifyOtp, fetchRememberedDevice, loginWithDevice, forgetDevice } from '../api';
import { addRecentEmail, hasDeviceHint, setDeviceHint } from '../loginMemory';
import EmailSuggestInput from './EmailSuggestInput';
import './LoginScreen.css';

function initials(nameOrEmail) {
  const parts = nameOrEmail.split('@')[0].split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export default function LoginScreen({ onLogin }) {
  // 'checking' → 'remembered' | 'identifier' → 'otp'
  const [step, setStep]             = useState(() => (hasDeviceHint() ? 'checking' : 'identifier'));
  const [identifier, setIdentifier] = useState('');
  const [otpDigits, setOtpDigits]   = useState(['', '', '', '']);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [remembered, setRemembered] = useState(null);
  const [error, setError]           = useState('');
  const [info, setInfo]             = useState('');
  const [loading, setLoading]       = useState(false);
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!hasDeviceHint()) return;
    let active = true;
    fetchRememberedDevice()
      .then(res => {
        if (!active) return;
        if (res.remembered) {
          setRemembered(res);
          setStep('remembered');
        } else {
          setDeviceHint(false);
          setStep('identifier');
        }
      })
      .catch(() => { if (active) setStep('identifier'); });
    return () => { active = false; };
  }, []);

  const handleDeviceLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loginWithDevice();
      if (result.success) {
        addRecentEmail(result.email);
        onLogin(result);
        return;
      }
      setDeviceHint(false);
      setRemembered(null);
      setIdentifier(remembered?.email || '');
      setStep('identifier');
      setError(result.error);
    } catch {
      setError('Connection error');
    }
    setLoading(false);
  };

  const handleForgetDevice = async () => {
    setLoading(true);
    try { await forgetDevice(); } catch { /* cookie cleared server-side when reachable */ }
    setDeviceHint(false);
    setRemembered(null);
    setError('');
    setStep('identifier');
    setLoading(false);
  };

  const useDifferentAccount = () => {
    setError('');
    setStep('identifier');
  };

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await requestOtp(identifier.trim());
      if (res.error) {
        setError(res.error);
      } else {
        setInfo('OTP sent — check your email. It expires in 5 minutes.');
        setStep('otp');
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
      }
    } catch {
      setError('Connection error');
    }
    setLoading(false);
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await verifyOtp(identifier.trim(), otpDigits.join(''), rememberDevice);
      if (result.success) {
        addRecentEmail(result.email);
        if (rememberDevice) setDeviceHint(true);
        onLogin(result);
      } else {
        setError(result.error);
        setOtpDigits(['', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
      }
    } catch {
      setError('Connection error');
    }
    setLoading(false);
  };

  const handleDigitChange = (i, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otpDigits];
    next[i] = digit;
    setOtpDigits(next);
    setError('');
    if (digit && i < 3) inputRefs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (otpDigits[i]) {
        const next = [...otpDigits];
        next[i] = '';
        setOtpDigits(next);
      } else if (i > 0) {
        inputRefs.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      inputRefs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < 3) {
      inputRefs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    const next = ['', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtpDigits(next);
    setError('');
    inputRefs.current[Math.min(pasted.length, 3)]?.focus();
  };

  const goBack = () => {
    setStep('identifier');
    setOtpDigits(['', '', '', '']);
    setError('');
    setInfo('');
  };

  const otpFilled = otpDigits.every(d => d !== '');
  const rememberedName = remembered
    ? [remembered.firstName, remembered.lastName].filter(Boolean).join(' ')
    : '';

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="logo-icon-img" />
        </div>
        <h1>File Transfer</h1>

        {step === 'checking' && (
          <p className="login-subtitle">
            <span className="material-icons-round spin" style={{ fontSize: '18px', verticalAlign: 'middle' }}>sync</span>
          </p>
        )}

        {step === 'remembered' && remembered && (
          <>
            <p className="login-subtitle">
              Welcome back{remembered.firstName ? `, ${remembered.firstName}` : ''}
            </p>
            <button
              type="button"
              className="remembered-account"
              onClick={handleDeviceLogin}
              disabled={loading}
              aria-label={`Continue as ${rememberedName || remembered.email}`}
            >
              <span className="remembered-avatar" aria-hidden="true">
                {initials(rememberedName || remembered.email)}
              </span>
              <span className="remembered-text">
                <span className="remembered-eyebrow">Continue as</span>
                <span className="remembered-name" title={rememberedName || remembered.email}>
                  {rememberedName || remembered.email}
                </span>
                {rememberedName && (
                  <span className="remembered-email" title={remembered.email}>{remembered.email}</span>
                )}
              </span>
              <span className="remembered-go" aria-hidden="true">
                <span className={`material-icons-round${loading ? ' spin' : ''}`}>
                  {loading ? 'sync' : 'arrow_forward'}
                </span>
              </span>
            </button>
            <p className="remembered-trust">
              <span className="material-icons-round" aria-hidden="true">verified_user</span>
              Remembered on this browser
            </p>
            {error && <p className="error-text">{error}</p>}
            <div className="remembered-actions">
              <button type="button" className="btn-link" onClick={useDifferentAccount} disabled={loading}>
                <span className="material-icons-round" aria-hidden="true">person_add</span>
                Different account
              </button>
              <button type="button" className="btn-link btn-link--danger" onClick={handleForgetDevice} disabled={loading}>
                <span className="material-icons-round" aria-hidden="true">no_accounts</span>
                Forget this device
              </button>
            </div>
          </>
        )}

        {step === 'identifier' && (
          <>
            <p className="login-subtitle">Enter your email address to receive a one-time code</p>
            <form onSubmit={handleRequestOtp}>
              <EmailSuggestInput
                value={identifier}
                onChange={(v) => { setIdentifier(v); setError(''); }}
                hasError={!!error}
              />
              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? (
                  <><span className="material-icons-round spin">sync</span>Sending OTP…</>
                ) : (
                  <><span className="material-icons-round">send</span>Send OTP</>
                )}
              </button>
              {error && <p className="error-text">{error}</p>}
            </form>
            {remembered && (
              <button type="button" className="btn-back" onClick={() => { setError(''); setStep('remembered'); }}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>arrow_back</span>
                Continue as {rememberedName || remembered.email}
              </button>
            )}
          </>
        )}

        {step === 'otp' && (
          <>
            <p className="login-subtitle">
              OTP sent to <strong>{identifier}</strong>
            </p>
            {info && <p className="info-text">{info}</p>}
            <form onSubmit={handleVerifyOtp} autoComplete="off">
              <div className={`otp-boxes${error ? ' error' : ''}`}>
                {otpDigits.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => inputRefs.current[i] = el}
                    className="otp-box"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={digit}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={handlePaste}
                    onFocus={(e) => e.target.select()}
                    autoFocus={i === 0}
                  />
                ))}
              </div>
              <label className={`remember-device${rememberDevice ? ' checked' : ''}`}>
                <input
                  type="checkbox"
                  className="remember-input"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  aria-describedby="remember-device-hint"
                />
                <span className="remember-box" aria-hidden="true">
                  <span className="material-icons-round">check</span>
                </span>
                <span className="remember-text">
                  <span className="remember-title">Remember this device</span>
                  <span className="remember-hint" id="remember-device-hint">
                    Skip the code for 30 days on this browser. Not for shared computers.
                  </span>
                </span>
                <span className="material-icons-round remember-icon" aria-hidden="true">
                  {rememberDevice ? 'verified_user' : 'devices'}
                </span>
              </label>
              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={loading || !otpFilled}
              >
                {loading ? (
                  <><span className="material-icons-round spin">sync</span>Verifying…</>
                ) : (
                  <><span className="material-icons-round">login</span>Sign In</>
                )}
              </button>
              {error && <p className="error-text">{error}</p>}
              <button type="button" className="btn-back" onClick={goBack}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>arrow_back</span>
                Use a different account
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
