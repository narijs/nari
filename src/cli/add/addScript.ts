import semver from 'semver';

import { PurePackage } from "../../resolver/workspace";
import { parseSpecifier } from "../../resolver"
import { getDependencies } from '../../resolver/dependencies';

export enum AddEventType { MODIFY = 'modify', GET_METADATA = 'get_metadata', NEXT_METADATA = 'next_metadata' };

export type AddOptions = {
  dev?: boolean;
  peer?: boolean;
  optional?: boolean;
  tilde?: boolean;
}

export type AddEvent = {
  type: AddEventType.MODIFY;
  json: any;
} | {
  type: AddEventType.GET_METADATA;
  name: string;
} | {
  type: AddEventType.NEXT_METADATA;
};

export type PackageMetadata = { name: string, metadata: any };

export const addScript = function* (pkg: PurePackage, specifierList: string[], opts?: AddOptions): Generator<AddEvent, any, PackageMetadata | any> {
  const options: AddOptions = opts || {};
  const pendingMetadata = new Set<string>();
  const receivedMetadata = new Map<string, any>();
  const unresolvedSpecifiers = new Set<{ name: string, range: string, alias: string }>();
  const prefix = options.tilde ? `~` : `^`;

  let dependencyType = 'dependencies';
  if (options.dev) {
    dependencyType = 'devDependencies';
  } else if (options.peer) {
    dependencyType = 'peerDependencies';
  } else if (options.optional) {
    dependencyType = 'optionalDependencies';
  }

  for (const specifier of specifierList) {
    const { name, range, alias } = parseSpecifier(specifier);
    if (!pendingMetadata.has(name)) {
      pendingMetadata.add(name);
      yield { type: AddEventType.GET_METADATA, name };

      unresolvedSpecifiers.add({ name, range, alias });
    }
  }

  while (pendingMetadata.size > 0) {
    const packageMetadata = yield { type: AddEventType.NEXT_METADATA };
    if (!packageMetadata) {
      throw new Error('Unable to receive packages metadata, aborting...');
    }

    const { name, metadata } = packageMetadata;
    pendingMetadata.delete(name);
    receivedMetadata.set(name, metadata);
  }

  let isModified = false;
  const nextJson = structuredClone(pkg.json);

  for (const { name, range, alias } of unresolvedSpecifiers) {
    const metadata = receivedMetadata.get(name)!;
    const availableVersions = Object.keys(metadata.versions);
    const version = semver.maxSatisfying(availableVersions, range);
    const targetRange = range !== '' ? range : `${prefix}${version}`;
    const depRange = alias ? `npm:${name}:${targetRange}` : targetRange;
    const dependencies = getDependencies(pkg.json);
    const existingRange = dependencies.regular.get(name);
    if (depRange !== existingRange) {
      nextJson[dependencyType] = nextJson[dependencyType] || {};
      nextJson[dependencyType][alias || name] = depRange;
      isModified = true;
    }
  }

  if (isModified) {
    yield { type: AddEventType.MODIFY, json: nextJson };
  }
};