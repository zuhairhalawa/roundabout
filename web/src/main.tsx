import { render } from 'preact';
import '@fontsource-variable/overpass';
import './ui/styles.css';
import { App } from './ui/App';
import { loadRemote } from './core/remote';

// Settings fetched last time apply now; a fresh copy is fetched for the next start.
void loadRemote();

render(<App />, document.getElementById('app')!);
