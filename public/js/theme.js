/**
 * Gapless Shared Theme Switcher (Light / Dark) & Vector SVG Icon Library
 * Persists user preference in localStorage ('gapless_theme') across all portals.
 */
(function () {
  const STORAGE_KEY = 'gapless_theme';

  const SVG_ICONS = {
    sun: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
    moon: `<svg class="icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
  };

  function getSavedTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  function applyTheme(theme) {
    const clean = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', clean);
    localStorage.setItem(STORAGE_KEY, clean);

    const toggleBtns = document.querySelectorAll('[data-theme-toggle]');
    toggleBtns.forEach((btn) => {
      btn.innerHTML = clean === 'dark' ? SVG_ICONS.sun : SVG_ICONS.moon;
      btn.title = clean === 'dark' ? 'التبديل إلى الوضع النهاري (Light Mode)' : 'التبديل إلى الوضع الليلي (Dark Mode)';
    });
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || getSavedTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Apply immediately before paint
  applyTheme(getSavedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getSavedTheme());
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-toggle]');
      if (btn) {
        toggleTheme();
      }
    });
  });

  window.GaplessTheme = {
    applyTheme,
    toggleTheme,
    getSavedTheme
  };
})();
