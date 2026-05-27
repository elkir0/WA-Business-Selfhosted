import { render } from 'preact';
import { App } from './App.jsx';
import { applyStoredThemeEarly } from './lib/theme.js';
import './style.css';

// Apply stored theme BEFORE rendering to prevent a flash of wrong theme.
applyStoredThemeEarly();

render(<App />, document.getElementById('app'));
