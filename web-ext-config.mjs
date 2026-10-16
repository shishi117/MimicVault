// web-ext 設定（ESM）。lint / run / build 共通。
// .cjs + module.exports は cjs-module-lexer が "module.exports" を名前付き
// エクスポートと誤検出して web-ext が壊れるため、.mjs + export default を使う。
export default {
  sourceDir: '.',
  artifactsDir: 'web-ext-artifacts',

  // XPI に含めないもの。特に companion/（mimic-vault.exe が約98MB）を必ず除外する。
  ignoreFiles: [
    '**/*.test.js',
    'companion/**',
    'deploy/**',
    'web-ext-artifacts/**',
    'node_modules/**',
    '.git/**',
    '.claude/**',
    '.devcontainer/**',
    'package.json',
    'package-lock.json',
    'web-ext-config.mjs',
    'scripts/**',
    '*.md',
  ],

  run: {
    // 開発起動時、プライベートウィンドウでも拡張を有効にする（webRequest 検出のため）。
    // ESR / Developer Edition を使う場合は CLI で: npm run run -- --firefox=deved
    pref: ['extensions.allowPrivateBrowsingByDefault=true'],
  },
};
