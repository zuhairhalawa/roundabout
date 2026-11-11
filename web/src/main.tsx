import { render } from 'preact';
import '@fontsource-variable/overpass';
import './ui/styles.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
