'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ROLLUP_SCOPE_DIR = path.join(ROOT_DIR, 'node_modules', '@rollup');
const WASM_NATIVE_PATH = '../wasm-node/dist/native.js';
const FALLBACK_PACKAGES = ['rollup-linux-x64-gnu', 'rollup-linux-x64-musl'];

if (!fs.existsSync(ROLLUP_SCOPE_DIR)) {
  return;
}

for (const pkg of FALLBACK_PACKAGES) {
  const pkgDir = path.join(ROLLUP_SCOPE_DIR, pkg);
  if (fs.existsSync(pkgDir)) {
    continue;
  }

  fs.mkdirSync(pkgDir, { recursive: true });

  const pkgJsonPath = path.join(pkgDir, 'package.json');
  const pkgJson = {
    name: `@rollup/${pkg}`,
    version: '0.0.0-wasm-fallback',
    private: true,
    main: 'index.js',
    exports: {
      '.': {
        require: './index.js',
        import: './index.js',
      },
    },
  };
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);

  const indexJsPath = path.join(pkgDir, 'index.js');
  const indexJs = `'use strict';\nmodule.exports = require('${WASM_NATIVE_PATH}');\n`;
  fs.writeFileSync(indexJsPath, indexJs);
}
