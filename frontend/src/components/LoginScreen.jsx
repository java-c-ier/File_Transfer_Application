import { useState, useRef } from 'react';
import { requestOtp, verifyOtp } from '../api';
import './LoginScreen.css';

export default function LoginScreen({ onLogin }) {
  const [step, setStep]             = useState('identifier');
  const [identifier, setIdentifier] = useState('');
  const [otpDigits, setOtpDigits]   = useState(['', '', '', '']);
  const [error, setError]           = useState('');
  const [info, setInfo]             = useState('');
  const [loading, setLoading]       = useState(false);
  const inputRefs = useRef([]);

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
      const result = await verifyOtp(identifier.trim(), otpDigits.join(''));
      if (result.success) {
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

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">
          <span className="material-icons-round logo-icon">cloud_sync</span>
        </div>
        <h1>File Transfer</h1>

        {step === 'identifier' ? (
          <>
            <p className="login-subtitle">Enter your email address to receive a one-time code</p>
            <form onSubmit={handleRequestOtp} autoComplete="off">
              <div className={`input-group${error ? ' error' : ''}`}>
                <span className="material-icons-round input-icon">email</span>
                <input
                  type="email"
                  placeholder="Email address"
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
                  required
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? (
                  <><span className="material-icons-round spin">sync</span>Sending OTP…</>
                ) : (
                  <><span className="material-icons-round">send</span>Send OTP</>
                )}
              </button>
              {error && <p className="error-text">{error}</p>}
            </form>
          </>
        ) : (
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
              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={loading || !otpFilled}
                style={{ marginTop: '24px' }}
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
