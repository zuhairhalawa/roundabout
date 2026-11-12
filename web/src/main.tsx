import { render } from 'preact';
import '@fontsource-variable/overpass';
import './ui/styles.css';
import { App } from './ui/App';
import { loadRemote } from './core/remote';
import { loadPictures } from './core/pictures';

// Settings fetched last time apply now; a fresh copy is fetched for the next start.
void loadRemote();
// The word -> picture table loads in the background.
void loadPictures();

render(<App />, document.getElementById('app')!);

// Offline: a service worker keeps a copy of the app itself, so it opens with no connection
// (the on-device model then does the rest). Only in the built site, not on the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
      const ready = await navigator.serviceWorker.ready;
      // Files that loaded before the worker took control are handed to it to keep.
      const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin));
      ready.active?.postMessage({ keep: [location.origin + '/', ...urls] });
    } catch { /* no service worker: the app still works online */ }
  });
}
