import { editor } from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import 'monaco-editor/language/json/monaco.contribution.js';

const base = document.currentScript.src;
globalThis.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    const filename = label === 'json' ? 'json-worker.js' : 'editor-worker.js';
    return new Worker(new URL(filename, base));
  }
};

globalThis.createBroadlinkCommandEditor = (container, value, darkMode) => editor.create(container, {
  value,
  language: 'json',
  theme: darkMode ? 'vs-dark' : 'vs',
  ariaLabel: 'IR/RF command data (JSON)',
  automaticLayout: true,
  wordWrap: 'on',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2
});
