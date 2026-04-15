import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

function formatRuntimeError(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  return String(value);
}

function renderFatalScreen(message: string) {
  const container = document.getElementById('root');
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="fatal-screen">
      <div class="fatal-screen__card">
        <div class="fatal-screen__eyebrow">Application Error</div>
        <h1 class="fatal-screen__title">D365FO ER Visualizer failed to start</h1>
        <p class="fatal-screen__text">
          The application loaded, but the client runtime crashed before the UI could render.
        </p>
        <pre class="fatal-screen__details">${message.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))}</pre>
      </div>
    </div>
  `;
}

window.addEventListener('error', event => {
  renderFatalScreen(formatRuntimeError(event.error ?? event.message));
});

window.addEventListener('unhandledrejection', event => {
  renderFatalScreen(formatRuntimeError(event.reason));
});

async function bootstrap() {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Missing #root element in index.html');
  }

  const { App } = await import('./components/App');
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap().catch(error => {
  renderFatalScreen(formatRuntimeError(error));
});
