import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { fetchMe } from './api';
import LoginScreen from './components/LoginScreen';
import FileManager from './components/FileManager';
import UserProfile from './components/UserProfile';
import Toast from './components/Toast';
import { TransferProvider } from './TransferContext';

// Lazy-load AdminDashboard — only admin users ever see it
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

const BASE = import.meta.env.BASE_URL; // '/transfer/'

const screenFromUrl = () => {
  const seg = window.location.pathname
    .replace(BASE.replace(/\/$/, ''), '')
    .replace(/^\//, '');
  return seg === 'admin' ? 'admin' : 'files';
};

const screenUrl = (screen) =>
  screen === 'files' ? BASE : `${BASE.replace(/\/$/, '')}/${screen}`;

export default function App() {
  const [sessionInfo, setSessionInfo]     = useState(null);
  const [loading, setLoading]             = useState(true);
  const [showProfile, setShowProfile]     = useState(false);
  const [toasts, setToasts]               = useState([]);
  const [screenLeaving, setScreenLeaving] = useState(false);
  const toastId = useRef(0);

  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const [currentScreen, setCurrentScreenState] = useState(() => screenFromUrl());

  const setCurrentScreen = useCallback((screen) => {
    localStorage.setItem('currentScreen', screen);
    setCurrentScreenState(screen);
    window.history.pushState({ screen }, '', screenUrl(screen));
  }, []);

  const navigateTo = useCallback((screen) => {
    setScreenLeaving(true);
    setTimeout(() => {
      setCurrentScreen(screen);
      setScreenLeaving(false);
    }, 100);
  }, [setCurrentScreen]);

  useEffect(() => {
    const handlePopState = () => {
      const next = screenFromUrl();
      setScreenLeaving(true);
      setTimeout(() => {
        setCurrentScreenState(next);
        localStorage.setItem('currentScreen', next);
        setScreenLeaving(false);
      }, 100);
    };
    window.addEventListener('popstate', handlePopState);
    window.history.replaceState({ screen: currentScreen }, '', screenUrl(currentScreen));
    return () => window.removeEventListener('popstate', handlePopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchMe()
      .then(res => { if (res.success && res.user) setSessionInfo(res.user); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = useCallback((user) => {
    setSessionInfo({
      username:  user.username,
      role:      user.role,
      firstName: user.firstName || '',
      lastName:  user.lastName  || '',
      email:     user.email     || '',
    });
    setCurrentScreen('files');
  }, [setCurrentScreen]);

  const handleLogout = useCallback(() => {
    setSessionInfo(null);
    setCurrentScreen('files');
  }, [setCurrentScreen]);

  if (loading) {
    return (
      <div style={{ color: 'var(--text-primary)', padding: '2rem', textAlign: 'center' }}>
        Loading Session…
      </div>
    );
  }

  if (!sessionInfo) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const renderScreen = () => {
    if (currentScreen === 'admin' && sessionInfo.role === 'ADMIN') {
      return (
        <Suspense fallback={<div style={{ color: 'var(--text-primary)', padding: '2rem', textAlign: 'center' }}>Loading…</div>}>
          <AdminDashboard
            onNavigate={navigateTo}
            sessionInfo={sessionInfo}
            setSessionInfo={setSessionInfo}
            onLogout={handleLogout}
            showToast={showToast}
          />
        </Suspense>
      );
    }
    return (
      <FileManager
        onNavigate={navigateTo}
        sessionInfo={sessionInfo}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfile(true)}
        showToast={showToast}
      />
    );
  };

  return (
    <TransferProvider showToast={showToast}>
      <div
        key={currentScreen}
        className={
          currentScreen === 'admin'
            ? `screen-wrap${screenLeaving ? ' screen-wrap--out' : ''}`
            : screenLeaving
              ? 'screen-wrap--out'
              : ''
        }
      >
        {renderScreen()}
      </div>
      {showProfile && (
        <UserProfile
          onClose={() => setShowProfile(false)}
          sessionInfo={sessionInfo}
          setSessionInfo={setSessionInfo}
          showToast={showToast}
        />
      )}
      <Toast toasts={toasts} />
    </TransferProvider>
  );
}
