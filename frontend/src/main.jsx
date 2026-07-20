import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

function loadRuntimeConfig() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}assets/config.js`;
    script.onload = resolve;
    script.onerror = resolve; // don't block rendering if config.js is absent
    document.head.appendChild(script);
  });
}

loadRuntimeConfig().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
