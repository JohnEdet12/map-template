/**
 * Light / dark theme.
 *
 * Everything visual resolves through the CSS custom properties in
 * base.css, so switching is a single attribute on <html>. With no stored
 * preference the app follows the operating system.
 */

const KEY = 'gds.theme';
export const THEMES = [
  { id: 'light', label: 'Light', icon: '☀' },
  { id: 'dark', label: 'Dark', icon: '☾' },
];

const listeners = new Set();

const systemPrefersDark = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** The stored choice, or null when following the system. */
export function storedTheme() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** What is actually on screen right now. */
export const activeTheme = () => storedTheme() ?? (systemPrefersDark() ? 'dark' : 'light');

export function setTheme(id) {
  const next = id === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  document.documentElement.setAttribute('data-theme', next);
  listeners.forEach((fn) => fn(next));
  return next;
}

export const toggleTheme = () => setTheme(activeTheme() === 'dark' ? 'light' : 'dark');

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Apply the stored theme as early as possible. Called from main.js before
 * anything renders so there is no flash of the wrong palette.
 */
export function initTheme() {
  const stored = storedTheme();
  if (stored) document.documentElement.setAttribute('data-theme', stored);

  // Track the OS while the user has not made an explicit choice.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!storedTheme()) listeners.forEach((fn) => fn(activeTheme()));
  });
  return activeTheme();
}

/** A ready-made toggle button. */
export function themeToggle({ className = 'icon-btn', withLabel = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;

  const paint = () => {
    const dark = activeTheme() === 'dark';
    btn.textContent = dark ? '☀' : '☾';
    if (withLabel) btn.textContent += dark ? '  Light' : '  Dark';
    const next = dark ? 'light' : 'dark';
    btn.title = `Switch to ${next} theme`;
    btn.setAttribute('aria-label', btn.title);
  };

  btn.addEventListener('click', () => { toggleTheme(); paint(); });
  onThemeChange(paint);
  paint();
  return btn;
}
