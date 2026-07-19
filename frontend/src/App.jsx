import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { isAuthenticated, fetchMe, clearToken } from './api';
import { pathUrl } from './utils';
import LoginScreen from './components/LoginScreen';
import FileManager from './components/FileManager';
import UserProfile from './components/UserProfile';
import Toast from './components/Toast';
import { TransferProvider } from './TransferContext';

// Lazy-load AdminDashboard — only admin users ever see it
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

export default function App() {
  const [sessionInfo, setSessionInfo] = useState(null); // { username, role }
  const [loading, setLoading]         = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [toasts, setToasts]           = useState([]);
  const toastId = useRef(0);

  // Centralised toast — passed down to every screen so there's only one <Toast>
  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const [currentScreen, setCurrentScreenState] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('path') || localStorage.getItem('currentScreen') || 'files';
  });

  const setCurrentScreen = useCallback((screen) => {
    localStorage.setItem('currentScreen', screen);
    setCurrentScreenState(screen);
    // 'files' is the default screen → clean URL; other screens keep ?path=<screen>
    window.history.pushState({ screen }, '', pathUrl(screen === 'files' ? '' : screen));
  }, []);

  useEffect(() => {
    const handlePopState = (event) => {
      const params     = new URLSearchParams(window.location.search);
      const nextScreen = (event.state?.screen) || params.get('path') || 'files';
      setCurrentScreenState(nextScreen);
      localStorage.setItem('currentScreen', nextScreen);
    };

    window.addEventListener('popstate', handlePopState);
    if (!window.history.state) {
      window.history.replaceState({ screen: currentScreen }, '', pathUrl(currentScreen === 'files' ? '' : currentScreen));
    }
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentScreen]);

  useEffect(() => {
    if (isAuthenticated()) {
      fetchMe()
        .then(res => {
          if (res.success && res.user) setSessionInfo(res.user);
          else clearToken();
        })
        .catch(() => clearToken())
        .finally(() => setLoading(false));
    } else {
      // Defer to next microtask to avoid synchronous setState inside effect body
      Promise.resolve().then(() => setLoading(false));
    }
  }, []);

  const handleLogin = useCallback((user) => {
    setSessionInfo({ username: user.username, role: user.role });
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
            onNavigate={setCurrentScreen}
            sessionInfo={sessionInfo}
            setSessionInfo={setSessionInfo}
            onLogout={handleLogout}
            onOpenProfile={() => setShowProfile(true)}
            showToast={showToast}
          />
        </Suspense>
      );
    }
    return (
      <FileManager
        onNavigate={setCurrentScreen}
        sessionInfo={sessionInfo}
        onLogout={handleLogout}
        onOpenProfile={() => setShowProfile(true)}
        showToast={showToast}
      />
    );
  };

  return (
    // TransferProvider sits ABOVE the screen switch so uploads/downloads keep
    // running when the user moves between Files, Admin, the profile modal, etc.
    <TransferProvider showToast={showToast}>
      {renderScreen()}
      {showProfile && (
        <UserProfile
          onClose={() => setShowProfile(false)}
          sessionInfo={sessionInfo}
          setSessionInfo={setSessionInfo}
          showToast={showToast}
        />
      )}
      {/* Single global Toast stack — no duplicate toast instances */}
      <Toast toasts={toasts} />
    </TransferProvider>
  );
}
