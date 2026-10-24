import { render } from 'preact';
import { Editor } from './Editor.js';
import '../style.css';
import './style.css';

// Test builds expose the entry for browser fixtures; production never includes this page.
if (import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === '1') {
  render(<Editor />, document.getElementById('editor')!);
}
