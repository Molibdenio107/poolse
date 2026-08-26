/**
 * Applies the stored theme before the first paint.
 *
 * Every root layout renders this — the marketing pages and the signed-in app
 * alike — because it is the one piece of theming that cannot be done on the
 * server without giving up static rendering. Reading the cookie here instead
 * means the landing page stays prerendered and still opens in dark mode for
 * somebody who chose dark mode, with no flash of white in between.
 *
 * `system` is resolved against the operating system, which only the browser
 * knows. Wrapped in try/catch because a blocked cookie jar should cost you the
 * preference, not the page.
 */
const SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )poolse-theme=([^;]*)/);
var p=m?decodeURIComponent(m[1]):'system';
if(p!=='light'&&p!=='dark'&&p!=='system')p='system';
var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
var e=document.documentElement;
e.classList.toggle('dark',d);
e.setAttribute('data-theme-preference',p);
}catch(e){}})();`;

export function ThemeScript(): React.ReactElement {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
