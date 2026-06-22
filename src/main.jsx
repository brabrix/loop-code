import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import './index.css';

window.addEventListener('error', (e) => {
  console.error('GLOBAL ERROR:', e.message, '\n', e.error && e.error.stack);
});

// Sem StrictMode de propósito: evita registrar os listeners de IPC duas vezes.
createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <ErrorBoundary label="Carcará Code">
      <App />
    </ErrorBoundary>
  </ThemeProvider>
);

// Remove o splash do index.html assim que o React pinta o primeiro frame.
// Dois rAF garantem que a UI já está na tela antes do fade — sem "piscar" vazio.
function dismissSplash() {
  const s = document.getElementById('splash');
  const root = document.getElementById('root');
  // Só some se o React de fato montou algo. Se o mount quebrou, #root fica vazio,
  // o splash permanece e o aviso de "demorando demais" (index.html) aparece.
  if (!s || !root || root.childElementCount === 0) return;
  s.style.opacity = '0';
  setTimeout(() => s.remove(), 400);
}
requestAnimationFrame(() => requestAnimationFrame(dismissSplash));
