/**
 * Runs before first paint to apply the saved theme — prevents a light flash in dark mode.
 * Also marks <html class="js"> so scroll-reveal hiding only happens when JS will un-hide it.
 */
const code = `(function(){try{var t=localStorage.getItem('bk-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.setAttribute('data-theme',t);e.classList.add('js');}catch(_){document.documentElement.classList.add('js');}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
