import { program } from 'commander';

import { add, AddOptions } from "./add";
import { install } from "./install";
import { remove } from "./remove";

import { TOOL_NAME } from '../constants';

const VERSION = '0.1.0';

export const cli = async () => {
  let exitCode;

  program
    .name(TOOL_NAME)
    .version(VERSION);

  program
    .command('add [packages...]')
    .description('installs one or more dependencies into the project')
    .option('-D, --dev', 'save package to `devDependencies`')
    .option('-P, --peer', 'save package to `peerDependencies`')
    .option('-O, --optional', 'save package to `optionalDependencies`')
    // .option('-E, --exact', 'install exact version of a package')
    .option('-T, --tilde', 'install most recent release with the same minor version')
    .action(async (specifierList: string[], options: AddOptions) => {
      exitCode = await add(specifierList, options);
    });

  program
    .command('install', { isDefault: true })
    .alias('i')
    .description('installs all the dependencies of a project')
    .option('-P, --prod', 'modules from `devDependencies` will not be installed')
    .action(async (options) => {
      exitCode = await install(options);
    });

  program
    .command('remove [packages...]')
    .alias('rm')
    .description('removes one or more dependencies from the project')
    .action(async (nameList: string[]) => {
      exitCode = await remove(nameList);
    });

  program
    .command('run')
    .description('runs a script from the package')
    .action(async () => { });

  await program.parseAsync();

  return exitCode;
};