import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argumentDump = `    std::cout << "Main received args:" << std::endl;
    for (int i = 0; i < main_argc; i++) {
        std::cout << "    " << main_argv[i] << std::endl;
    }
`;

export function removeStartupArgumentDump(source) {
  if (source.split(argumentDump).length !== 2) throw new Error('Pinned browser source changed; review the startup argument logger before building.');
  return source.replace(argumentDump, '    // Game credentials are passed in argv; never print startup arguments.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceFile = path.resolve(process.argv[2] || '');
  if (!sourceFile.endsWith(path.join('sources', 'luanti', 'src', 'mainloop.cpp'))) throw new Error('Expected pinned Luanti mainloop.cpp.');
  const original = fs.readFileSync(sourceFile, 'utf8');
  fs.writeFileSync(sourceFile, removeStartupArgumentDump(original));
  console.log('Removed raw startup argument logging from the pinned browser engine source.');
}
