import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

const output = 'homebridge-ui/public/editor';
const monaco = 'node_modules/monaco-editor';

await build({
  entryPoints: {
    'command-editor': 'homebridge-ui/command-editor.mjs',
    'editor-worker': monaco + '/esm/vs/editor/editor.worker.js',
    'json-worker': monaco + '/esm/vs/language/json/json.worker.js'
  },
  outdir: output,
  bundle: true,
  minify: true,
  loader: { '.ttf': 'file' }
});

await Promise.all(['LICENSE', 'ThirdPartyNotices.txt'].map(file =>
  copyFile(monaco + '/' + file, output + '/' + file)
));
