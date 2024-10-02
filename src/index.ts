import { cli } from './cli';
import { promises as fs } from 'fs';
import { runCommand } from './runCommand';

const commands = ['add', 'i', 'install', 'remove', 'pack', 'publish'];

(async () => {
  let exitCode;
  const isOptionSupplied =
    (process.argv.length > 2 && process.argv[2].startsWith('-')) ||
    (process.argv.length > 3 && process.argv[3].startsWith('-'));
  if (!isOptionSupplied && process.argv.length > 2 && commands.indexOf(process.argv[2]) < 0) {
    const packageJson = JSON.parse(await fs.readFile('./package.json', 'utf-8'));
    const scriptNameIndex = process.argv[2] === 'run' ? 3 : 2;
    const scriptName = process.argv[scriptNameIndex];
    const script = (packageJson.scripts || {})[scriptName];
    exitCode = (await runCommand(process.cwd(), scriptName, script, process.argv.slice(scriptNameIndex + 1), false))
      .code;
  } else {
    exitCode = await cli();
  }
  process.exit(exitCode);
})();
