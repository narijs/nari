import { promises as fs } from 'fs';
import detectIndent from 'detect-indent';

import { ensureCacheDirExists } from '../../cache';
import { getMetadata } from '../../resolver/resolver';
import { addScript, PackageMetadata, AddEventType, AddOptions } from './addScript';
import { install } from '../install';
export { AddOptions } from './addScript';
import { TOOL_NAME, VERSION } from '../../constants';

export const add = async (specifierList: string[], options: AddOptions): Promise<number> => {
  console.log(`${TOOL_NAME} add ${VERSION}`);
  await ensureCacheDirExists();
  const packageJsonPath = 'package.json';
  const text = await fs.readFile(packageJsonPath, 'utf8');
  const indent = detectIndent(text).indent || '  ';
  const json = JSON.parse(text);

  const script = addScript({ json }, specifierList, options);

  const promises = new Map<string, Promise<PackageMetadata>>();
  const metadata = new Map<string, any>();

  let isModified = false;
  let next;
  try {
    let nextArg: PackageMetadata | undefined;
    do {
      next = script.next(nextArg);
      nextArg = undefined;

      if (next.done) break;

      const step = next.value;
      if (step.type === AddEventType.GET_METADATA) {
        const { name, lockTime } = step;
        promises.set(name + ' ' + lockTime, getMetadata({ name, lockTime }));
      } else if (step.type === AddEventType.NEXT_METADATA) {
        const resolvedPromise = await Promise.race(promises.values());
        promises.delete(resolvedPromise.name + ' ' + resolvedPromise.lockTime);
        nextArg = resolvedPromise;
        metadata.set(resolvedPromise.name, resolvedPromise.metadata);
      } else if (step.type === AddEventType.MODIFY) {
        const newText = JSON.stringify(step.json, undefined, indent);
        if (newText !== text) {
          console.log('package.json changed');
          isModified = true;
          await fs.writeFile(packageJsonPath, newText);
        }
      }
    } while (!next.done);
  } finally {
    await Promise.all(promises.values());
  }

  if (isModified) {
    return await install({ metadata, skipBanner: true });
  } else {
    return 0;
  }
};
