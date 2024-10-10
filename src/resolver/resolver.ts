import { promises as fs } from 'fs';
import path from 'path';
import detectIndent from 'detect-indent';

import { readWorkspaceTree } from './workspace';
import {
  PackageMetadata,
  ResolveEventType,
  resolveScript,
  resolveStateDeserializer,
  resolveStateSerializer,
} from './resolveScript';
import { getCachedMetadata, downloadMetadata } from './registry';
import { NODE_MODULES } from '../constants';
import { cachedCreateDir } from '../cache';

export type ResolveOptions = {
  metadata?: Map<string, any>;
  prod?: boolean;
  skipBanner?: boolean;
  verbose?: boolean;
};

export const RESOLVE_STATE_FILE = '.resolve-state.json';
const RESOLVE_STATE_PATH = path.join(NODE_MODULES, RESOLVE_STATE_FILE);
const RESOLVE_STATE_VERSION = '1';

export const getMetadata = async ({ name, lockTime }: { name: string; lockTime: Date }) => {
  let fresh: boolean;
  const cachedMetadata = await getCachedMetadata(name);
  let metadata;
  if (lockTime && cachedMetadata && cachedMetadata.cacheMeta.date >= lockTime) {
    fresh = false;
    metadata = cachedMetadata.metaJson;
  } else {
    fresh = true;
    metadata = await downloadMetadata(name, cachedMetadata);
  }

  return { name, metadata, fresh, lockTime };
};

export const resolve = async (opts?: ResolveOptions) => {
  const options = opts || {};
  const packageJsonPath = 'package.json';
  const text = await fs.readFile(packageJsonPath, 'utf8');
  const indent = detectIndent(text).indent || '  ';
  const json = JSON.parse(text);
  const pkg = await readWorkspaceTree({ json, relativePath: '.' });

  let prevState;
  let prevStateText;
  try {
    prevStateText = await fs.readFile(RESOLVE_STATE_PATH, 'utf8');
    prevState = JSON.parse(prevStateText, resolveStateDeserializer);
  } catch {
    // empty
  }

  const script = resolveScript(
    pkg,
    {
      autoInstallPeers: true,
      resolutionOptimization: true,
      receivedMetadata: options.metadata,
      prod: options.prod,
      verbose: options.verbose,
    },
    prevState,
  );

  const promises = new Map<string, Promise<PackageMetadata>>();
  try {
    let next;
    let nextArg: PackageMetadata | undefined;
    do {
      next = script.next(nextArg);
      nextArg = undefined;

      if (next.done) break;

      const step = next.value;
      if (step.type === ResolveEventType.GET_METADATA) {
        const { name, lockTime } = step;
        promises.set(name, getMetadata({ name, lockTime }));
      } else if (step.type === ResolveEventType.NEXT_METADATA) {
        const resolvedPromise = await Promise.race(promises.values());
        promises.delete(resolvedPromise.name);
        nextArg = resolvedPromise;
      }
    } while (!next.done);

    const resolveState = next.value.state;
    if (resolveState) {
      resolveState.version = RESOLVE_STATE_VERSION;

      await cachedCreateDir(NODE_MODULES);

      const newStateText = JSON.stringify(resolveState, resolveStateSerializer, 0);
      if (newStateText !== prevStateText) {
        if (prevStateText) console.log('resolve state changed');
        if (prevStateText) {
          await fs.writeFile(RESOLVE_STATE_PATH + '.old', JSON.stringify(JSON.parse(prevStateText), null, 2));
          await fs.writeFile(RESOLVE_STATE_PATH + '.new', JSON.stringify(JSON.parse(newStateText), null, 2));
        }
        await fs.writeFile(RESOLVE_STATE_PATH, newStateText);
      }

      const newText = JSON.stringify({ ...json, lockTime: next.value.state.lockTime.toISOString() }, undefined, indent);
      if (newText !== text) {
        console.log('package.json changed');
        await fs.writeFile(packageJsonPath, newText);
      }
    } else {
      console.log('deleted resolve state');
      await fs.rm(RESOLVE_STATE_PATH, { force: true });
    }

    return next.value.graph;
  } finally {
    await Promise.all(promises.values());
  }
};
