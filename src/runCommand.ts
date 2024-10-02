import child from 'child_process';
import path from 'path';

import { DOT_BIN, NODE_MODULES } from './constants';

export const runCommand = async (
  cwd: string,
  scriptName: string,
  script: any,
  args: any[],
  buffer: boolean,
): Promise<{ output: string; code: number }> => {
  if (typeof script === 'undefined') {
    console.error(`Command ${scriptName} not found`);
    return { output: '', code: 1 };
  }

  const cmd = [script, ...args].join(' ');
  const env: any = {
    NODE: process.execPath,
    INIT_CWD: process.cwd(),
    ...process.env,
  };

  env.npm_lifecycle_event = scriptName;
  env.npm_node_execpath = env.NODE;
  env.npm_execpath = env.npm_execpath || (require.main && require.main.filename);

  const pathList: string[] = [];

  const nodeModulesParts = path.resolve(cwd).split(path.sep + NODE_MODULES + path.sep);
  const currentParts: string[] = [];
  for (const part of nodeModulesParts) {
    currentParts.push(part);
    pathList.unshift(path.join(currentParts.join(path.sep + NODE_MODULES + path.sep), NODE_MODULES, DOT_BIN));
  }

  pathList.push(path.dirname(process.argv[1]));
  const envPathList: string[] = env.PATH ? env.PATH.split(path.delimiter) : [];
  for (const pathElement of envPathList) {
    pathList.push(pathElement);
  }
  env.PATH = pathList.join(path.delimiter);

  const options: any = { env, detached: false, shell: true, cwd };
  if (!buffer) {
    options.stdio = 'inherit';
  }

  let output = ``;

  const task = child.spawn(cmd, [], options);

  if (buffer) {
    task.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });

    task.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
  }

  let promise, resolve;

  promise = new Promise((r) => (resolve = r));
  task.on('exit', (code) => resolve({ output, code }));

  return await promise;
};
