/**
 * Memu — Theme toggle (vanilla JS, no React)
 *
 * Wires up a button with class .theme-toggle (or id #theme-toggle)
 * to switch between light/dark themes by setting data-theme on <html>.
 *
 * - First load: respects OS prefers-color-scheme
 * - User choice: persisted in localStorage as 'memu-theme'
 * - Listens for OS changes only until user makes a manual choice
 *
 * Usage:
 *   <button id="theme-toggle" class="theme-toggle" aria-label="Toggle theme">
 *     <!-- icon swaps via JS -->
 *   </button>
 *   <script src="js/theme-toggle.js"></script>
 *
 * NOTE: Load `theme-init.js` synchronously in <head> BEFORE the body
 * renders to prevent a theme-flash on first paint.
 */

(function () {
  const SUN_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const MOON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function getTheme() {
    return document.documentElement.dataset.theme || 'light';
  }

  function setTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem('memu-theme', theme); } catch (e) {}
    }
    updateButtons();
  }

  function updateButtons() {
    const isDark = getTheme() === 'dark';
    const btns = document.querySelectorAll('.theme-toggle, #theme-toggle');
    btns.forEach(btn => {
      btn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
      btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
      btn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    });
  }

  function toggle() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }

  function init() {
    updateButtons();

    // Wire up clicks
    document.addEventListener('click', e => {
      const btn = e.target.closest('.theme-toggle, #theme-toggle');
      if (btn) {
        e.preventDefault();
        toggle();
      }
    });

    // Listen for OS theme changes ONLY if user hasn't made a manual choice
    let stored;
    try { stored = localStorage.getItem('memu-theme'); } catch (e) {}
    if (!stored && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = e => setTheme(e.matches ? 'dark' : 'light', false);
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for programmatic use
  window.memuTheme = { get: getTheme, set: setTheme, toggle };
})();
