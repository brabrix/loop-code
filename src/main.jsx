import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import { LanguageProvider } from './lib/i18n.jsx';
import { LayoutProvider } from './lib/layoutContext.jsx';
import { ChatModeProvider } from './lib/chatModeContext.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import './index.css';

window.addEventListener('error', (e) => {
  console.error('GLOBAL ERROR:', e.message, '\n', e.error && e.error.stack);
});

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <LanguageProvider>
      <LayoutProvider>
        <ChatModeProvider>
          <ErrorBoundary label="Carcará Code">
            <App />
          </ErrorBoundary>
        </ChatModeProvider>
      </LayoutProvider>
    </LanguageProvider>
  </ThemeProvider>,
);

function dismissSplash() {
  const s = document.getElementById('splash');
  const root = document.getElementById('root');
  if (!s || !root || root.childElementCount === 0) return;
  s.style.opacity = '0';
  setTimeout(() => s.remove(), 400);
}
requestAnimationFrame(() => requestAnimationFrame(dismissSplash));
