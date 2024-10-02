import { CheckType, hoist } from '../../hoister';
import { ensureCacheDirExists } from '../../cache';
import { resolve } from '../../resolver';
import { write } from '../../installer';
import { ResolveOptions } from '../../resolver/resolver';
import { TOOL_NAME, VERSION } from '../../constants';

export const install = async (options?: ResolveOptions): Promise<number> => {
  if (!options?.skipBanner) {
    console.log(`${TOOL_NAME} install ${VERSION}`);
  }

  const resolveStart = Date.now();
  await ensureCacheDirExists();
  const graph = await resolve(options);
  const resolveEnd = Date.now();
  const resolveTime = (resolveEnd - resolveStart) / 1000.0;
  console.log(`Resolution done in ${resolveTime}s`);
  const hoistedGraph = hoist(graph, { check: CheckType.FINAL });

  const installStart = Date.now();
  await write(hoistedGraph);
  const installEnd = Date.now();
  const installTime = (installEnd - installStart) / 1000.0;
  console.log(`Installing done in ${installTime}s`);

  const totalTime = (installEnd - resolveStart) / 1000.0;

  console.log(`Total time: ${totalTime}s `);

  return 0;
};
