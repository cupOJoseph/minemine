import { build } from 'esbuild';

await build({
  entryPoints: ['client/account.jsx'],
  outfile: 'public/account/account.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'external',
  define: { 'process.env.NODE_ENV': '"production"' },
});
