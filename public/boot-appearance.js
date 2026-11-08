/* Presentation only: the meaningful initial HTML remains the same for every visitor. */
(() => {
  document.documentElement.dataset.boot = 'loading';
  window.setTimeout(() => {
    if (document.documentElement.dataset.boot === 'loading') {
      delete document.documentElement.dataset.boot;
      document.getElementById('boot-splash')?.remove();
    }
  }, 12000);
})();
