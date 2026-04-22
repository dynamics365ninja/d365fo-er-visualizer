import './index.css';

function formatRuntimeError(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  return String(value);
}

/**
 * Render a minimal fallback screen ONLY when bootstrap (React mount) itself
 * fails. Runtime errors inside the component tree are caught by ErrorBoundary
 * components and do not tear down the whole UI.
 */
function renderBootstrapError(message: string) {
  const container = document.getElementById('root');
  if (!container) return;

  const root = document.createElement('div');
  root.className = 'fatal-screen';
  const card = document.createElement('div');
  card.className = 'fatal-screen__card';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'fatal-screen__eyebrow';
  eyebrow.textContent = 'Application Error';
  const title = document.createElement('h1');
  title.className = 'fatal-screen__title';
  title.textContent = 'D365FO ER Visualizer failed to start';
  const text = document.createElement('p');
  text.className = 'fatal-screen__text';
  text.textContent = 'The application loaded, but the client runtime crashed before the UI could render.';
  const pre = document.createElement('pre');
  pre.className = 'fatal-screen__details';
  pre.textContent = message;
  card.append(eyebrow, title, text, pre);
  root.appendChild(card);

  container.replaceChildren(root);
}

async function bootstrap() {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Missing #root element in index.html');
  }

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { FluentRoot } = await import('./components/FluentRoot');
  const root = createRoot(container);
  root.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(FluentRoot)
    )
  );
}

bootstrap().catch(error => {
  renderBootstrapError(formatRuntimeError(error));
});
