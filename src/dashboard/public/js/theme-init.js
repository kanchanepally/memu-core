/**
 * Memu — Theme init
 *
 * Load this SYNCHRONOUSLY in <head> BEFORE the body renders.
 * Prevents a theme-flash by setting data-theme on first frame.
 *
 *   <head>
 *     <script src="js/theme-init.js"></script>
 *   </head>
 */
(function () {
  try {
    var stored = localStorage.getItem('memu-theme');
    var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (systemDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
