import { useState, useRef } from 'react';
import { requestOtp, verifyOtp, enrollAuthenticator, activateAuthenticator } from '../api';
import { addRecentEmail } from '../loginMemory';
import EmailSuggestInput from './EmailSuggestInput';
import './LoginScreen.css';

const EMAIL_CODE_LEN = 4;
const APP_CODE_LEN   = 6;

function CodeInput({ id, label, length, value, onChange, hasError }) {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');
  const commit = (next) => onChange(next.join('').slice(0, length));

  const handleChange = (i, raw) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = digit;
    commit(next);
    if (digit && i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        const next = [...digits];
        next[i] = '';
        commit(next);
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="code-field">
      <span className="code-label" id={`${id}-label`}>{label}</span>
      <div className={`otp-boxes${hasError ? ' error' : ''}`} role="group" aria-labelledby={`${id}-label`}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={el => refs.current[i] = el}
            className="otp-box"
            type="text"
            inputMode="numeric"
            aria-label={`Digit ${i + 1} of ${length}`}
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={2}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            autoFocus={i === 0}
          />
        ))}
      </div>
    </div>
  );
}

export default function LoginScreen({ onLogin }) {
  // 'identifier' → 'app-code' (enrolled) | 'email-code' → 'enroll' (first time)
  const [step, setStep]             = useState('identifier');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode]             = useState('');
  const [error, setError]           = useState('');
  const [info, setInfo]             = useState('');
  const [loading, setLoading]       = useState(false);

  const [ticket, setTicket]         = useState('');
  const [enrollment, setEnrollment] = useState(null); // { secret, otpauthUri }
  const [qrDataUrl, setQrDataUrl]   = useState('');
  const [secretShown, setSecretShown] = useState(false);

  const codeLength = step === 'email-code' ? EMAIL_CODE_LEN : APP_CODE_LEN;
  const codeFilled = code.length === codeLength;

  const resetToIdentifier = () => {
    setStep('identifier');
    setCode('');
    setError('');
    setInfo('');
    setTicket('');
    setEnrollment(null);
    setQrDataUrl('');
    setSecretShown(false);
  };

  const beginEnrollment = async (enrollTicket) => {
    const res = await enrollAuthenticator(enrollTicket);
    if (res.error) {
      setError(res.error);
      setStep('identifier');
      return;
    }
    setTicket(enrollTicket);
    setEnrollment(res);
    setCode('');
    setStep('enroll');
    try {
      const { default: QRCode } = await import('qrcode');
      setQrDataUrl(await QRCode.toDataURL(res.otpauthUri, { width: 208, margin: 1 }));
    } catch {
      // QR rendering failed — the setup key below it is the fallback
    }
  };

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await requestOtp(identifier.trim());
      if (res.error) {
        setError(res.error);
      } else if (res.method === 'totp') {
        setCode('');
        setStep('app-code');
      } else {
        setCode('');
        setInfo('Code sent — check your email. It expires in 5 minutes.');
        setStep('email-code');
      }
    } catch {
      setError('Connection error');
    }
    setLoading(false);
  };

  const handleSubmitCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = step === 'enroll'
        ? await activateAuthenticator(ticket, code)
        : await verifyOtp(identifier.trim(), code);

      if (result.enrollmentRequired) {
        setInfo('');
        await beginEnrollment(result.ticket);
      } else if (result.success) {
        addRecentEmail(result.email || identifier.trim());
        onLogin(result);
        return;
      } else {
        setError(result.error);
        setCode('');
      }
    } catch {
      setError('Connection error');
    }
    setLoading(false);
  };

  const copySecret = () => {
    navigator.clipboard.writeText(enrollment.secret).catch(() => {});
    setInfo('Setup key copied');
    setTimeout(() => setInfo(''), 2000);
  };

  return (
    <div className="login-screen">
      <div className={`login-card${step === 'enroll' ? ' login-card--wide' : ''}`}>
        <div className="login-logo">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="logo-icon-img" />
        </div>
        <h1>File Transfer</h1>

        {step === 'identifier' && (
          <>
            <p className="login-subtitle">Enter your email address to sign in</p>
            <form onSubmit={handleRequestCode}>
              <EmailSuggestInput
                value={identifier}
                onChange={(v) => { setIdentifier(v); setError(''); }}
                hasError={!!error}
              />
              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? (
                  <><span className="material-icons-round spin">sync</span>Checking…</>
                ) : (
                  <><span className="material-icons-round">arrow_forward</span>Continue</>
                )}
              </button>
              {error && <p className="error-text">{error}</p>}
            </form>
          </>
        )}

        {(step === 'app-code' || step === 'email-code') && (
          <>
            {step === 'email-code' && <p className="login-step">Step 1 of 2</p>}
            <p className="login-subtitle">
              {step === 'app-code'
                ? <>Enter the code from your authenticator app</>
                : <>First-time setup code sent to <strong>{identifier}</strong></>}
            </p>
            {info && <p className="info-text">{info}</p>}
            <form onSubmit={handleSubmitCode} autoComplete="off">
              <CodeInput
                id="login-code"
                label={step === 'app-code' ? '6-digit code' : `${EMAIL_CODE_LEN}-digit code from your email`}
                length={codeLength}
                value={code}
                onChange={(v) => { setCode(v); setError(''); }}
                hasError={!!error}
              />
              <button type="submit" className="btn btn-primary btn-full" disabled={loading || !codeFilled}>
                {loading ? (
                  <><span className="material-icons-round spin">sync</span>Verifying…</>
                ) : (
                  <><span className="material-icons-round">login</span>{step === 'app-code' ? 'Sign In' : 'Continue'}</>
                )}
              </button>
              {error && <p className="error-text">{error}</p>}
              <button type="button" className="btn-back" onClick={resetToIdentifier}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>arrow_back</span>
                Use a different account
              </button>
            </form>
          </>
        )}

        {step === 'enroll' && enrollment && (
          <>
            <p className="login-step">Step 2 of 2</p>
            <p className="login-subtitle">
              Install <strong>Microsoft Authenticator</strong> on your phone — any authenticator app works.
            </p>

            <form onSubmit={handleSubmitCode} autoComplete="off">
              <div className="enroll-grid">
                <section className="enroll-col">
                  <h2 className="enroll-head"><span className="enroll-num">1</span>Scan this code</h2>
                  <div className="enroll-qr">
                    {qrDataUrl
                      ? <img src={qrDataUrl} alt="Authenticator setup QR code" width={168} height={168} />
                      : <span className="material-icons-round spin">sync</span>}
                  </div>
                  <button type="button" className="btn-link enroll-secret-toggle" onClick={() => setSecretShown(s => !s)}>
                    <span className="material-icons-round" aria-hidden="true">{secretShown ? 'expand_less' : 'keyboard'}</span>
                    {secretShown ? 'Hide setup key' : "Can't scan?"}
                  </button>
                  {secretShown && (
                    <div className="enroll-secret">
                      <code>{enrollment.secret}</code>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={copySecret} aria-label="Copy setup key">
                        <span className="material-icons-round">content_copy</span>
                      </button>
                    </div>
                  )}
                </section>

                <section className="enroll-col">
                  <h2 className="enroll-head"><span className="enroll-num">2</span>Enter the code it shows</h2>
                  <CodeInput
                    id="enroll-code"
                    label="6-digit code from the app"
                    length={APP_CODE_LEN}
                    value={code}
                    onChange={(v) => { setCode(v); setError(''); }}
                    hasError={!!error}
                  />
                  <button type="submit" className="btn btn-primary btn-full" disabled={loading || !codeFilled}>
                    {loading ? (
                      <><span className="material-icons-round spin">sync</span>Verifying…</>
                    ) : (
                      <><span className="material-icons-round">verified_user</span>Finish Setup</>
                    )}
                  </button>
                  {error && <p className="error-text">{error}</p>}
                  {info && <p className="info-text">{info}</p>}
                  <p className="enroll-warning">
                    <span className="material-icons-round" aria-hidden="true">info</span>
                    From now on this app is the only way in. If you lose the phone, ask an admin to reset it.
                  </p>
                </section>
              </div>

              <button type="button" className="btn-back" onClick={resetToIdentifier}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>arrow_back</span>
                Start over
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
