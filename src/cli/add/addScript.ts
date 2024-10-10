import { PurePackage } from '../../resolver/workspace';
import { parseSpecifier } from '../../resolver';
import { getDependencies } from '../../resolver/dependencies';
import { resolveRangeFromMeta } from '../../resolver/resolveScript';

export enum AddEventType {
  MODIFY = 'modify',
  GET_METADATA = 'get_metadata',
  NEXT_METADATA = 'next_metadata',
}

export type AddOptions = {
  dev?: boolean;
  peer?: boolean;
  optional?: boolean;
  tilde?: boolean;
  timeNow?: Date;
};

export type AddEvent =
  | {
      type: AddEventType.MODIFY;
      json: any;
    }
  | {
      type: AddEventType.GET_METADATA;
      name: string;
      lockTime: Date;
    }
  | {
      type: AddEventType.NEXT_METADATA;
    };

export type PackageMetadata = { name: string; metadata: any; lockTime: Date };

export const addScript = function* (
  pkg: PurePackage,
  specifierList: string[],
  opts?: AddOptions,
): Generator<AddEvent, any, PackageMetadata | any> {
  const options: AddOptions = opts || {};
  const parsedSpecifierList = new Set<{ name: string; range: string; alias: string }>();
  const pendingMetadata = new Set<string>();
  const unresolvedRanges = new Map<string, Set<string>>();
  const resolvedRanges = new Map<string, Map<string, string>>();
  const prefix = options.tilde ? `~` : `^`;
  const now = opts?.timeNow || new Date();
  const lockTime = pkg.json.lockTime ? new Date(pkg.json.lockTime) : now;

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
    parsedSpecifierList.add({ name, range, alias });
  }

  for (const { name, range } of parsedSpecifierList) {
    if (!pendingMetadata.has(name)) {
      pendingMetadata.add(name);

      yield { type: AddEventType.GET_METADATA, name, lockTime };

      let rangeList = unresolvedRanges.get(name);
      if (!rangeList) {
        rangeList = new Set<string>();
        unresolvedRanges.set(name, rangeList);
      }
      rangeList.add(range);
    }
  }

  while (unresolvedRanges.size > 0) {
    const packageMetadata = yield { type: AddEventType.NEXT_METADATA };
    if (!packageMetadata) {
      throw new Error('Unable to receive packages metadata, aborting...');
    }

    const { name, metadata, lockTime } = packageMetadata;
    const rangeList = unresolvedRanges.get(name)!;
    for (const range of rangeList) {
      const version = resolveRangeFromMeta(metadata, range, lockTime);
      if (!version) {
        if (lockTime !== now) {
          yield { type: AddEventType.GET_METADATA, name, lockTime: now };
        } else {
          const availableVersions = Object.keys(metadata.versions);
          throw new Error(
            `Unable to resolve ${name}@${range}, ${metadata.name}, available versions: ${availableVersions}`,
          );
        }
      } else {
        rangeList.delete(range);
        if (rangeList.size === 0) {
          unresolvedRanges.delete(name);
        }

        let rangeToVersion = resolvedRanges.get(name);
        if (!rangeToVersion) {
          rangeToVersion = new Map<string, string>();
          resolvedRanges.set(name, rangeToVersion);
        }
        rangeToVersion.set(range, version);
      }
    }
  }

  let isModified = false;
  const nextJson = structuredClone(pkg.json);

  if (!nextJson.lockTime) {
    nextJson.lockTime = lockTime.toISOString();
    isModified = true;
  }

  for (const { name, range, alias } of parsedSpecifierList) {
    const version = resolvedRanges.get(name)!.get(range)!;
    const targetRange = range !== '' ? range : `${prefix}${version}`;
    const depRange = alias ? `npm:${name}:${targetRange}` : targetRange;
    const dependencies = getDependencies(pkg.json, true);
    let existingRange = dependencies.regular.get(name);
    if (depRange !== existingRange) {
      const targetDependencyType = dependencies.regularType.get(name) || dependencyType;
      nextJson[targetDependencyType] = nextJson[targetDependencyType] || {};
      nextJson[targetDependencyType][alias || name] = depRange;
      isModified = true;
    }
  }

  if (isModified) {
    yield { type: AddEventType.MODIFY, json: nextJson };
  }
};
