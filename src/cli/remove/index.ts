import { promises as fs } from 'fs';
import detectIndent from 'detect-indent';

import { ensureCacheDirExists } from '../../cache';
import { install } from '../install';
import { removeScript, RemoveEventType } from './removeScript';
import { TOOL_NAME, VERSION } from '../../constants';

export const remove = async (nameList: string[]): Promise<number> => {
  console.log(`${TOOL_NAME} remove ${VERSION}`);
  await ensureCacheDirExists();
  let isModified = false;

  const packageJsonPath = 'package.json';
  const text = await fs.readFile(packageJsonPath, 'utf8');
  const indent = detectIndent(text).indent || '  ';
  const json = JSON.parse(text);

  const script = removeScript({ json }, nameList);
  let hasErrors = false;

  let next;
  do {
    next = script.next();

    if (next.done) break;

    const step = next.value;
    if (step.type === RemoveEventType.MODIFY) {
      const newText = JSON.stringify(step.json, undefined, indent);
      if (newText !== text) {
        console.log('package.json changed');
        isModified = true;
        await fs.writeFile(packageJsonPath, newText);
      }
    } else if (step.type === RemoveEventType.NOT_FOUND) {
      hasErrors = true;
      console.error(step.message);
    }
  } while (!next.done);

  if (isModified) {
    return await install({ skipBanner: true });
  } else {
    return hasErrors ? 1 : 0;
  }
};
