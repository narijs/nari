import semver from 'semver';

import { getDependencies } from './dependencies';
import { Graph, PackageType } from '../hoister';
import { PurePackage } from './workspace';
import { BUILD_SCRIPTS } from '../constants';

type GraphId = {
  protocol?: string;
  scope?: string;
  basename: string;
  version?: string;
  alias?: string;
  resolutions?: Set<string>;
  autoPeerNames?: Set<string>;
};

export type Package = {
  id: string;
  name: string;
  version: string;
  path?: string;
  metadata?: any;
  json: any;
  workspaces?: Set<Package>;
};

export type MetadataMap = Map<string, { version: string; metaJson: any }>;

export type ResolveOptions = {
  autoInstallPeers?: boolean;
  resolutionOptimization?: boolean;
  traceRangeUsages?: boolean;
  prod?: boolean;
  dump?: boolean;
  cpu?: string;
  os?: string;
  libc?: string | null;
  receivedMetadata?: Map<string, any>;
};

export type ResolveEvent =
  | {
      type: ResolveEventType.GET_METADATA;
      name: string;
      lockTime?: Date;
    }
  | {
      type: ResolveEventType.NEXT_METADATA;
    };

export type PackageMetadata = { name: string; metadata: any; fresh: boolean };

export const enum ResolveEventType {
  GET_METADATA = 'get_metadata',
  NEXT_METADATA = 'next_metadata',
}

export type ResolveResult = {
  graph: Graph;
  state?: ResolveState;
};

export type ResolveState = {
  resolutions: Resolutions;
  lockTime: Date;
};

export type Resolutions = Map<string, { meta: any; ranges: Map<string, string> }>;

type DeclaredPackageRanges = Map<string, Map<string, Set<string>>>;
type ResolvedPackageRanges = Map<string, Map<string, ResolvedRangeInfo>>;
type UnresolvedPackageRanges = Map<string, Set<string>>;
type RequestedMetadata = Map<string, { fresh: boolean }>;
type ReceivedMetadata = Map<string, { metadata: any; fresh: boolean }>;

type ResolvedRangeInfo = { name: string; range: string; version: string; isWorkspace?: boolean };
type WorkspaceVersions = Map<string, Set<string>>;

export const resolveStateDeserializer = (key, value) => {
  if (['resolutions', 'ranges'].indexOf(key) >= 0) {
    return new Map(value);
  } else {
    return value;
  }
};

export const resolveStateSerializer = (key, value) => {
  if (['resolutions', 'ranges'].indexOf(key) >= 0) {
    return Array.from(value.entries());
  } else if (key.startsWith('_')) {
    return undefined;
  } else {
    return value;
  }
};

const getWorkspaceName = (node: PurePackage) => (node.json.name as string) || `workspace:${node.workspacePath}`;
const getWorkspaceVersion = (node: PurePackage) => (node.json.version as string) || `0.0.0`;

const parseRange = (range: string): { version: string; alias?: string; protocol?: string } => {
  let version, alias, protocol;

  version = range;
  const protocolParts = range.split(':');

  if (protocolParts.length === 3 && protocol === 'npm') {
    alias = protocolParts[1];
    version = protocolParts[2];
  }

  if (protocolParts.length > 1) {
    protocol = protocolParts[0];
    version = protocolParts.slice(1).join(':');
  }

  return { version, alias, protocol };
};

const parsePackageName = (name: string): { scope?: string; basename: string } => {
  const idx = name.indexOf('/');
  return idx < 0 ? { basename: name } : { scope: name.substring(0, idx), basename: name.substring(idx + 1) };
};

const stringifyGraphId = (graphId: GraphId): string =>
  `${stringifyPackageId(graphId)}${graphId.alias ? '>' + graphId.alias : ''}${graphId.resolutions ? '#' + Array.from(graphId.resolutions).join(',') : ''}${graphId.autoPeerNames ? '|' + Array.from(graphId.autoPeerNames).join(',') : ''}`;
const stringifyPackageId = (graphId: GraphId): string =>
  `${graphId.protocol ? graphId.protocol + ':' : ''}${graphId.scope ? graphId.scope + '/' : ''}${graphId.basename}${graphId.version ? '@' + graphId.version : ''}`;

const assignId = ({
  pkg,
  name,
  version,
  parentDependencyNames,
  resolutionPath,
  resolutions,
  options,
}: {
  pkg: PurePackage;
  name: string;
  version: string;
  parentDependencyNames: Set<string>;
  resolutionPath: string;
  resolutions: Map<string, string>;
  options: ResolveOptions;
}): { idProps: GraphId; dependencies: Map<string, string>; peerNames: Set<string>; optionalNames: Set<string> } => {
  const rawDependencies = getDependencies(pkg.json, options.prod ? false : !!pkg.workspacePath);
  const dependencies = new Map();
  const peerNames = new Set<string>();

  const idProps: GraphId = { ...parsePackageName(name), ...parseRange(version) };

  for (const [depName, depRange] of rawDependencies.regular) {
    const { resolution, range } = getResolutionRange({
      resolutions,
      resolutionPath: getResolutionPath(depName, resolutionPath),
      depRange,
    });
    if (resolution && !pkg.workspacePath) {
      if (!idProps.resolutions) {
        idProps.resolutions = new Set();
      }
      idProps.resolutions.add(depName);
    }
    dependencies.set(depName, range);
  }

  for (const [depName, depRange] of rawDependencies.peer) {
    if (rawDependencies.optionalPeerNames.has(depName)) continue;

    if (options.autoInstallPeers) {
      if (!parentDependencyNames.has(depName)) {
        dependencies.set(depName, depRange);
        if (!pkg.workspacePath) {
          if (!idProps.autoPeerNames) {
            idProps.autoPeerNames = new Set();
          }
          idProps.autoPeerNames.add(depName);
        }
      } else {
        peerNames.add(depName);
      }
    } else {
      peerNames.add(depName);
    }
  }

  return { idProps, dependencies, peerNames, optionalNames: rawDependencies.optionalNames };
};

const getLibc = () => {
  if (process.platform === 'linux') {
    const report: any = process.report?.getReport() || ({} as any);
    if (report.header?.glibcVersionRuntime) {
      return 'glibc';
    } else if (Array.isArray(report.sharedObjects) && report.sharedObjects.some(isMusl)) {
      return 'musl';
    }
  }
  return null;
};

const isMusl = (file) => file.includes('libc.musl-') || file.includes('ld-musl-');

const isPackageJsonFieldCompatible = (actual: string | null, rules?: Array<string>) => {
  if (!rules || !actual) return true;

  let isNotAllowlist = true;
  let isBlocklist = false;

  for (const rule of rules) {
    if (rule[0] === `!`) {
      isBlocklist = true;

      if (actual === rule.slice(1)) {
        return false;
      }
    } else {
      isNotAllowlist = false;

      if (rule === actual) {
        return true;
      }
    }
  }

  // Blocklists with allowlisted items should be treated as allowlists for `os`, `cpu` and `libc` in `package.json`
  return isBlocklist && isNotAllowlist;
};

const resolveRange = function* ({
  name,
  range,
  resolvedPackageRanges,
  unresolvedPackageRanges,
  workspaceVersions,
  requestedMetadata,
  receivedMetadata,
  lockTime,
  state,
}: {
  name: string;
  range: string;
  resolvedPackageRanges: ResolvedPackageRanges;
  unresolvedPackageRanges: UnresolvedPackageRanges;
  workspaceVersions?: WorkspaceVersions;
  requestedMetadata: RequestedMetadata;
  receivedMetadata: ReceivedMetadata;
  lockTime: Date;
  state?: ResolveState;
}) {
  let resolvedRangeInfo = resolvedPackageRanges.get(name)?.get(range);
  if (!resolvedRangeInfo && workspaceVersions) {
    const versions = workspaceVersions.get(name);
    if (versions) {
      const version = semver.maxSatisfying(Array.from(versions.keys()), range);
      if (version) {
        let resolvedRanges = resolvedPackageRanges.get(name);
        if (!resolvedRanges) {
          resolvedRanges = new Map();
          resolvedPackageRanges.set(name, resolvedRanges);
        }
        resolvedRangeInfo = { name, range, version, isWorkspace: true };
        resolvedRanges.set(range, resolvedRangeInfo);
      }
    }
  }

  if (!resolvedRangeInfo && state) {
    const version = state.resolutions.get(name)?.ranges.get(range);
    if (version) {
      let resolvedRanges = resolvedPackageRanges.get(name);
      if (!resolvedRanges) {
        resolvedRanges = new Map();
        resolvedPackageRanges.set(name, resolvedRanges);
      }
      resolvedRangeInfo = { name, range, version };
      resolvedRanges.set(range, resolvedRangeInfo);
    }
  }

  const metadataEntry = receivedMetadata.get(name);
  if (!resolvedRangeInfo && metadataEntry) {
    const metadata = metadataEntry.metadata;
    const availableVersions = Object.keys(metadata.versions);
    const versionsBeforeLock: string[] = [];
    const versionsAfterLock: string[] = [];
    const times = Object.entries(metadata.time)
      .map(([version, timeStr]) => [version, new Date(timeStr as string)] as [string, Date])
      .sort((e1, e2) => e1[1].getTime() - e2[1].getTime());
    for (const [v, t] of times) {
      if (metadata.versions[v]) {
        if (t <= lockTime) {
          versionsBeforeLock.push(v);
        } else {
          versionsAfterLock.push(v);
        }
      }
    }

    let version = semver.maxSatisfying(versionsBeforeLock, range);
    if (!version) {
      for (const v of versionsAfterLock) {
        if (semver.satisfies(v, range)) {
          version = v;
          break;
        }
      }
    }

    if (!version) {
      if (metadataEntry.fresh) {
        throw new Error(
          `Unable to resolve ${name}@${range}, ${metadata.name}, available versions: ${availableVersions}`,
        );
      }
    } else {
      let resolvedRanges = resolvedPackageRanges.get(name);
      if (!resolvedRanges) {
        resolvedRanges = new Map();
        resolvedPackageRanges.set(name, resolvedRanges);
      }
      resolvedRangeInfo = { name, range, version };
      resolvedRanges.set(range, resolvedRangeInfo);
    }
  }

  if (!resolvedRangeInfo) {
    let unresolvedRanges = unresolvedPackageRanges.get(name);
    if (!unresolvedRanges) {
      unresolvedRanges = new Set();
      unresolvedPackageRanges.set(name, unresolvedRanges);

      const requestedEntry = requestedMetadata.get(name);
      if (!requestedEntry || !requestedEntry.fresh) {
        requestedMetadata.set(name, { fresh: !!requestedEntry });

        const event: ResolveEvent = { type: ResolveEventType.GET_METADATA, name };
        if (!requestedEntry) {
          event.lockTime = lockTime;
        }

        yield event;
      }
    }
    unresolvedRanges.add(range);
  }

  return resolvedRangeInfo;
};

const resolvePackage = function* ({
  pkg,
  id,
  resolutionDependencies,
  declaredPackageRanges,
  unresolvedPackageRanges,
  resolvedPackageRanges,
  workspaceVersions,
  requestedMetadata,
  receivedMetadata,
  lockTime,
  state,
  options,
}: {
  pkg: PurePackage;
  id: string;
  resolutionDependencies?: Map<string, string>;
  declaredPackageRanges: DeclaredPackageRanges;
  unresolvedPackageRanges: UnresolvedPackageRanges;
  resolvedPackageRanges: ResolvedPackageRanges;
  workspaceVersions: WorkspaceVersions;
  requestedMetadata: RequestedMetadata;
  receivedMetadata: ReceivedMetadata;
  lockTime: Date;
  state?: ResolveState;
  options: ResolveOptions;
}) {
  if (declaredPackageRanges.has(id)) return;

  const declaredRanges = new Map();
  declaredPackageRanges.set(id, declaredRanges);

  if (
    !isPackageJsonFieldCompatible(options.cpu!, pkg.json.cpu) ||
    !isPackageJsonFieldCompatible(options.os!, pkg.json.os) ||
    !isPackageJsonFieldCompatible(options.libc!, pkg.json.libc)
  ) {
    return;
  }

  const dependencies = getDependencies(pkg.json, options.prod ? false : !!pkg.workspacePath);
  const allDependencies = new Set<{ depName: string; depRange: string }>();
  for (const [depName, depRange] of dependencies.regular) {
    allDependencies.add({ depName, depRange });
  }

  if (options.autoInstallPeers) {
    for (const [depName, depRange] of dependencies.peer) {
      if (!dependencies.optionalPeerNames.has(depName)) {
        allDependencies.add({ depName, depRange });
      }
    }
  }

  if (resolutionDependencies) {
    for (const [depName, depRange] of resolutionDependencies) {
      allDependencies.add({ depName, depRange });
    }
  }

  for (const { depName, depRange } of allDependencies) {
    const { name, range } = parseSpecifier(depName, depRange);

    let ranges = declaredRanges.get(name);
    if (!ranges) {
      ranges = new Set();
      declaredRanges.set(name, ranges);
    }
    ranges.add(range);

    const resolvedRangeInfo = yield* resolveRange({
      name,
      range,
      resolvedPackageRanges,
      unresolvedPackageRanges,
      workspaceVersions,
      requestedMetadata,
      receivedMetadata,
      lockTime,
      state,
    });
    if (resolvedRangeInfo) {
      const { version, isWorkspace } = resolvedRangeInfo;

      const childId = `${name}@${version}`;

      if (!isWorkspace) {
        const pkg = { json: receivedMetadata.get(name)!.metadata.versions[version] };

        yield* resolvePackage({
          pkg,
          id: childId,
          declaredPackageRanges,
          unresolvedPackageRanges,
          resolvedPackageRanges,
          workspaceVersions,
          requestedMetadata,
          receivedMetadata,
          lockTime,
          state,
          options,
        });
      }
    }
  }
};

const resolveWorkspace = function* ({
  pkg,
  declaredPackageRanges,
  unresolvedPackageRanges,
  resolvedPackageRanges,
  workspaceVersions,
  requestedMetadata,
  receivedMetadata,
  lockTime,
  state,
  options,
}: {
  pkg: PurePackage;
  declaredPackageRanges: DeclaredPackageRanges;
  unresolvedPackageRanges: UnresolvedPackageRanges;
  resolvedPackageRanges: ResolvedPackageRanges;
  workspaceVersions: WorkspaceVersions;
  requestedMetadata: RequestedMetadata;
  receivedMetadata: ReceivedMetadata;
  lockTime: Date;
  state?: ResolveState;
  options: ResolveOptions;
}) {
  const id = `${getWorkspaceName(pkg)}@${getWorkspaceVersion(pkg)}`;
  yield* resolvePackage({
    pkg,
    id,
    resolutionDependencies: getResolutionDependencies(pkg),
    declaredPackageRanges,
    unresolvedPackageRanges,
    resolvedPackageRanges,
    workspaceVersions,
    requestedMetadata,
    receivedMetadata,
    lockTime,
    state,
    options,
  });

  if (pkg.workspaces) {
    for (const workspace of pkg.workspaces) {
      yield* resolveWorkspace({
        pkg: workspace,
        declaredPackageRanges,
        unresolvedPackageRanges,
        resolvedPackageRanges,
        workspaceVersions,
        requestedMetadata,
        receivedMetadata,
        lockTime,
        state,
        options,
      });
    }
  }
};

const createPackage = ({
  pkg,
  name,
  version,
  optional,
  parentDependencyNames,
  resolvedPackageRanges,
  receivedMetadata,
  nodeMap,
  resolutionPath,
  resolutions,
  options,
}: {
  pkg: PurePackage;
  name: string;
  version: string;
  optional: boolean;
  parentDependencyNames: Set<string>;
  resolvedPackageRanges: ResolvedPackageRanges;
  receivedMetadata: ReceivedMetadata;
  nodeMap: Map<string, Graph>;
  resolutionPath: string;
  resolutions: Map<string, string>;
  options: ResolveOptions;
}): Graph | null => {
  if (
    !pkg.workspacePath &&
    (!isPackageJsonFieldCompatible(options.cpu!, pkg.json.cpu) ||
      !isPackageJsonFieldCompatible(options.os!, pkg.json.os) ||
      !isPackageJsonFieldCompatible(options.libc!, pkg.json.libc))
  ) {
    return null;
  }

  const { idProps, dependencies, peerNames, optionalNames } = assignId({
    pkg,
    name,
    version,
    parentDependencyNames,
    resolutionPath,
    resolutions,
    options,
  });
  const graphId = stringifyGraphId(idProps);

  let node: Graph | undefined;

  if (!pkg.workspacePath) {
    node = nodeMap.get(graphId);
  }

  if (node) {
    if (!optional && node.optional) {
      delete node.optional;
    }

    return node;
  }

  node = { id: graphId };
  if (optional) {
    node.optional = true;
  }

  if (pkg.workspacePath) {
    node.workspacePath = pkg.workspacePath;
  } else {
    if (idProps.alias) {
      node.alias = idProps.alias;
    }
  }

  if (!pkg.workspacePath) {
    nodeMap.set(graphId, node);
  }

  const tarballUrl = pkg.json?.dist?.tarball;
  if (tarballUrl) {
    node.tarballUrl = tarballUrl;
  }

  const buildScripts = getBuildScripts(pkg.json);
  if (buildScripts) {
    node.buildScripts = buildScripts;
  }

  const binType = typeof pkg.json.bin;
  if (binType !== 'undefined') {
    if (binType === 'string') {
      node.bin = { [getPackageName(parseSpecifier(node.id).name)]: pkg.json.bin };
    } else {
      node.bin = pkg.json.bin;
    }
  }

  const nextParentDependencyNames = new Set(parentDependencyNames);
  for (const depName of dependencies.keys()) {
    nextParentDependencyNames.add(depName);
  }

  if (dependencies.size > 0) {
    node.dependencies = node.dependencies || [];
    for (const [depName, depRange] of dependencies) {
      const { name, range, alias } = parseSpecifier(depName, depRange);
      const resolveMap = resolvedPackageRanges.get(name);
      if (!resolveMap) {
        throw new Error(`Unable to get resolve map for ${name}`);
      }

      const resolvedRangeInfo = resolveMap.get(range);
      if (!resolvedRangeInfo) {
        throw new Error(`Not found ${name}@${range} resolution used by ${graphId}`);
      }
      const { version, isWorkspace } = resolvedRangeInfo;

      const pkg = isWorkspace
        ? { json: { name: depName, version } }
        : { json: receivedMetadata.get(name)!.metadata.versions[version] };
      const depNode = createPackage({
        pkg,
        name: depName,
        version: alias ? `npm:${alias}:${version}` : version,
        optional: optional || optionalNames.has(depName),
        parentDependencyNames: nextParentDependencyNames,
        resolvedPackageRanges,
        receivedMetadata,
        nodeMap,
        resolutions,
        resolutionPath: getResolutionPath(depName, resolutionPath),
        options,
      });
      if (depNode) {
        node.dependencies.push(depNode);
      }
    }
  }

  if (peerNames.size > 0) {
    node.peerNames = Array.from(peerNames);
  }

  return node;
};

const createWorkspace = ({
  pkg,
  parentDependencyNames,
  resolvedPackageRanges,
  receivedMetadata,
  nodeMap,
  resolutionPath,
  resolutions,
  options,
}: {
  pkg: PurePackage;
  parentDependencyNames: Set<string>;
  resolvedPackageRanges: ResolvedPackageRanges;
  receivedMetadata: ReceivedMetadata;
  nodeMap: Map<string, Graph>;
  resolutionPath: string;
  resolutions: Map<string, string>;
  options: ResolveOptions;
}): Graph => {
  const name = getWorkspaceName(pkg);
  const version = getWorkspaceVersion(pkg);
  const node = createPackage({
    pkg,
    name,
    version,
    optional: false,
    resolvedPackageRanges,
    receivedMetadata,
    nodeMap,
    parentDependencyNames,
    resolutionPath,
    resolutions,
    options,
  })!;

  if (pkg.workspaces) {
    node.workspaces = [];
    for (const workspace of pkg.workspaces) {
      node.workspaces.push(
        createWorkspace({
          pkg: workspace,
          parentDependencyNames,
          resolvedPackageRanges,
          receivedMetadata,
          nodeMap,
          resolutions,
          resolutionPath: getResolutionPath(getWorkspaceName(workspace), resolutionPath),
          options,
        }),
      );
    }
  }

  return node;
};

const getResolutionDependencies = (node: PurePackage): Map<string, string> => {
  const dependencies = new Map();

  for (const [resolutionPath, range] of Object.entries<string>(node.json.resolutions || {})) {
    const parts = resolutionPath.split('/');
    if (parts.length === 1) {
      dependencies.set(resolutionPath, range);
    } else {
      const nextToLast = parts[parts.length - 2];
      if (nextToLast.startsWith('@')) {
        dependencies.set([nextToLast, parts[parts.length - 1]].join('/'), range);
      } else {
        dependencies.set(parts[parts.length - 1], range);
      }
    }
  }
  return dependencies;
};

const getWorkspaceResolutions = (node: PurePackage): Map<string, string> => {
  const resolutions = new Map();
  for (const [resolutionPath, range] of Object.entries<string>(node.json.resolutions || {})) {
    const parts = resolutionPath.split('/');
    const packageParts: string[] = [];
    let scopePart;
    for (const part of parts) {
      if (part.startsWith('@')) {
        scopePart = part;
      } else {
        if (scopePart) {
          packageParts.push(`${scopePart}#${part}`);
        } else {
          packageParts.push(part);
        }
      }
    }
    resolutions.set(packageParts.join('/'), range);
  }

  return resolutions;
};

const readWorkspaceVersions = ({ pkg }: { pkg: PurePackage }): WorkspaceVersions => {
  const workspaceVersions: WorkspaceVersions = new Map();

  const fillWorkspaceVersion = (workspace: PurePackage) => {
    const name = getWorkspaceName(workspace);
    let versions = workspaceVersions.get(name);
    if (!versions) {
      versions = new Set();
      workspaceVersions.set(name, versions);
    }
    versions.add(getWorkspaceVersion(workspace));

    if (workspace.workspaces) {
      for (const nestedWorkspace of workspace.workspaces) {
        fillWorkspaceVersion(nestedWorkspace);
      }
    }
  };

  fillWorkspaceVersion(pkg);

  return workspaceVersions;
};

const refineGraph = (node: Graph, seen: Set<Graph> = new Set()) => {
  if (seen.has(node)) return;
  seen.add(node);

  if (node.dependencies) {
    let totalLen = node.dependencies.length;
    for (let idx = 0; idx < totalLen; idx++) {
      const dep = node.dependencies[idx];
      if (dep.id.startsWith('=')) {
        node.dependencies.splice(idx, 1);
        totalLen--;
        idx--;
      } else {
        refineGraph(dep, seen);
      }
    }

    if (totalLen === 0) {
      delete node.dependencies;
    }
  }

  if (node.workspaces) {
    for (const dep of node.workspaces) {
      refineGraph(dep, seen);
    }
  }
};

const getMetadataMapFromStateAndOptions = ({
  state,
  options,
}: {
  state?: ResolveState;
  options: ResolveOptions;
}): ReceivedMetadata => {
  const receivedMetadata = new Map();
  if (state) {
    for (const [name, { meta }] of state.resolutions) {
      receivedMetadata.set(name, { metadata: meta, fresh: false });
    }
  }

  if (options.receivedMetadata) {
    for (const [name, metadata] of options.receivedMetadata) {
      receivedMetadata.set(name, { metadata, fresh: true });
    }
  }

  return receivedMetadata;
};

export const resolveScript = function* (
  pkg: PurePackage,
  opts?: ResolveOptions,
  prevState?: ResolveState,
): Generator<ResolveEvent, ResolveResult, PackageMetadata | any> {
  const options: ResolveOptions = opts || {};
  options.cpu = options.cpu || process.arch;
  options.os = options.os || process.platform;
  options.libc = options.libc || getLibc();
  let lockTime = pkg.json.lockTime ? new Date(pkg.json.lockTime) : new Date();
  const declaredPackageRanges: DeclaredPackageRanges = new Map();
  const unresolvedPackageRanges: UnresolvedPackageRanges = new Map();
  const resolvedPackageRanges: ResolvedPackageRanges = new Map();
  const state = prevState && new Date(prevState.lockTime).getTime() === lockTime.getTime() ? prevState : undefined;
  const requestedMetadata: RequestedMetadata = new Map();
  const receivedMetadata = getMetadataMapFromStateAndOptions({ state, options });

  const workspaceVersions = readWorkspaceVersions({ pkg });
  yield* resolveWorkspace({
    pkg,
    declaredPackageRanges,
    unresolvedPackageRanges,
    resolvedPackageRanges,
    requestedMetadata,
    receivedMetadata,
    workspaceVersions,
    lockTime,
    state,
    options,
  });

  while (unresolvedPackageRanges.size !== 0) {
    const packageMetadata = yield { type: ResolveEventType.NEXT_METADATA };
    if (!packageMetadata) {
      throw new Error('Unable to receive packages metadata, aborting...');
    }
    const depName = packageMetadata.name;
    if (packageMetadata.fresh) {
      requestedMetadata.set(depName, { fresh: true });
    }

    receivedMetadata.set(depName, packageMetadata);
    const unresolvedRanges = unresolvedPackageRanges.get(depName);
    let resolvedRanges = resolvedPackageRanges.get(depName);
    if (!resolvedRanges) {
      resolvedRanges = new Map();
      resolvedPackageRanges.set(depName, resolvedRanges);
    }

    if (unresolvedRanges) {
      do {
        const unresolvedRange = unresolvedRanges.values().next().value as string;
        const resolvedRangeInfo = yield* resolveRange({
          name: depName,
          range: unresolvedRange,
          resolvedPackageRanges,
          unresolvedPackageRanges,
          requestedMetadata,
          receivedMetadata,
          lockTime,
          state,
        });
        if (resolvedRangeInfo) {
          const version = resolvedRangeInfo.version;
          resolvedRanges.set(unresolvedRange, resolvedRangeInfo);

          unresolvedRanges.delete(unresolvedRange);
          const json = packageMetadata.metadata.versions[version];
          const childId = `${depName}@${version}`;

          yield* resolvePackage({
            pkg: { json },
            id: childId,
            declaredPackageRanges,
            unresolvedPackageRanges,
            resolvedPackageRanges,
            workspaceVersions,
            requestedMetadata,
            receivedMetadata,
            lockTime,
            state,
            options,
          });
        } else {
          break;
        }
      } while (unresolvedRanges.size);

      if (unresolvedRanges.size === 0) {
        unresolvedPackageRanges.delete(depName);
      }
    }
  }

  orderResolvedRanges(resolvedPackageRanges);

  if (options.resolutionOptimization) {
    optimizeResolutions({ workspaceVersions, declaredPackageRanges, resolvedPackageRanges, options });
  }

  const nodeMap = new Map();
  const graph = createWorkspace({
    pkg,
    parentDependencyNames: new Set(),
    resolvedPackageRanges,
    receivedMetadata,
    nodeMap,
    resolutionPath: getResolutionPath(getWorkspaceName(pkg)),
    resolutions: getWorkspaceResolutions(pkg),
    options,
  });

  refineGraph(graph);

  if (options.dump) {
    console.log(print(graph));
  }

  const nextState = getState({ resolvedPackageRanges, receivedMetadata, lockTime });

  let result: ResolveResult = { graph };
  if (nextState) {
    result.state = nextState;
  }

  return result;
};

const minimizeJson = (json: any): any => {
  const result: any = {};

  for (const key of Object.keys(json)) {
    if (
      [
        'bin',
        'os',
        'cpu',
        'libc',
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'peerDependenciesMeta',
      ].indexOf(key) >= 0
    ) {
      result[key] = json[key];
    }
  }

  if (json.scripts) {
    for (const scriptName of Object.keys(json.scripts)) {
      if (BUILD_SCRIPTS.indexOf(scriptName) >= 0) {
        if (!result.scripts) {
          result.scripts = {};
        }
        result.scripts[scriptName] = json.scripts[scriptName];
      }
    }
  }

  return result;
};

const minimizeMetadata = (metadata: any, versions: Set<string>): any => {
  const result = { versions: {}, time: {} };
  for (const version of versions) {
    result.versions[version] = minimizeJson(metadata.versions[version]);
    result.time[version] = metadata.time[version];
  }

  return result;
};

const orderResolvedRanges = (resolvedPackageRanges: ResolvedPackageRanges) => {
  const originalResolveRanges = new Map(resolvedPackageRanges);
  resolvedPackageRanges.clear();

  const sortedNames = Array.from(originalResolveRanges.keys()).sort();
  for (const name of sortedNames) {
    const resolveMap = originalResolveRanges.get(name)!;
    const originalResolveMap = new Map(resolveMap);
    resolveMap.clear();

    const sortedRanges = Array.from(originalResolveMap.keys()).sort();
    for (const range of sortedRanges) {
      resolveMap.set(range, originalResolveMap.get(range)!);
    }

    resolvedPackageRanges.set(name, resolveMap);
  }
};

const getState = ({
  resolvedPackageRanges,
  receivedMetadata,
  lockTime,
}: {
  resolvedPackageRanges: ResolvedPackageRanges;
  receivedMetadata: ReceivedMetadata;
  lockTime: Date;
}): ResolveState | undefined => {
  const resolutions: Resolutions = new Map();

  for (const [name, resolveMap] of resolvedPackageRanges) {
    const ranges = new Map();
    const versions: string[] = [];
    for (const [range, { isWorkspace, version }] of resolveMap) {
      if (isWorkspace) continue;

      ranges.set(range, version);
      versions.push(version);
    }

    if (ranges.size > 0) {
      const metadataEntry = receivedMetadata.get(name);
      if (metadataEntry) {
        const meta = minimizeMetadata(metadataEntry.metadata, new Set(versions));
        resolutions.set(name, { meta, ranges });
      }
    }
  }

  return resolutions.size > 0 ? { resolutions, lockTime } : undefined;
};

const optimizeResolutions = ({
  workspaceVersions,
  declaredPackageRanges,
  resolvedPackageRanges,
  options,
}: {
  workspaceVersions: WorkspaceVersions;
  declaredPackageRanges: DeclaredPackageRanges;
  resolvedPackageRanges: ResolvedPackageRanges;
  options: ResolveOptions;
}) => {
  let shouldOptimizeAgain;

  do {
    shouldOptimizeAgain = false;

    for (const [name, resolveMap] of resolvedPackageRanges) {
      const resolveInfoSet = new Set(resolveMap.values());
      const hasNonCaret = Array.from(resolveMap.keys()).find((x) => !/^\^[0-9]+\.[0-9]+\.[0-9]+$/.test(x));

      if (resolveInfoSet.size === 1 || !hasNonCaret) {
        continue;
      }

      let versionToRanges = new Map<string, Set<string>>();
      let rangesToVersion = new Map<string, Set<string>>();
      const versionList = new Set(Array.from(resolveMap.values()).map((x) => x.version));
      for (const version of versionList) {
        const matchedRanges = new Set<string>();
        versionToRanges.set(version, matchedRanges);
        for (const [checkRange, { version: checkVersion }] of resolveMap) {
          if (version === checkVersion || semver.satisfies(version, checkRange)) {
            matchedRanges.add(checkRange);
            let matchedVersions = rangesToVersion.get(checkRange);
            if (!matchedVersions) {
              matchedVersions = new Set();
              rangesToVersion.set(checkRange, matchedVersions);
            }
            matchedVersions.add(version);
          }
        }
      }

      const unmatchedRanges = new Set(resolveMap.keys());
      const versions: string[] = [];
      while (unmatchedRanges.size > 0) {
        let bestCoverVersion: string | undefined, bestMatchedRanges: Set<string> | undefined;
        for (const [version, matchedRanges] of versionToRanges) {
          if (!bestCoverVersion || versionToRanges.get(bestCoverVersion)!.size < matchedRanges.size) {
            bestCoverVersion = version;
            bestMatchedRanges = matchedRanges;
          }
        }

        versions.push(bestCoverVersion!);
        versionToRanges.delete(bestCoverVersion!);

        for (const range of bestMatchedRanges!) {
          unmatchedRanges.delete(range);
          rangesToVersion.get(range)!.delete(bestCoverVersion!);
        }
      }

      for (const [range, rangeInfo] of resolveMap) {
        const { version: originalVersion } = rangeInfo;
        const version = semver.maxSatisfying(versions, range)!;
        if (version === originalVersion) continue;

        if (options.traceRangeUsages) {
          console.log(`rewire ${name}@${range} from ${originalVersion} to ${version}`);
        }

        shouldOptimizeAgain = true;

        rangeInfo.version = version;
      }
    }

    const usedPackageRanges = new Map<string, Set<string>>();

    const addRangeUsages = (packageId: string, seen: Set<string>) => {
      if (seen.has(packageId)) return;
      seen.add(packageId);

      const declaredRanges = declaredPackageRanges.get(packageId);
      if (!declaredRanges) {
        throw new Error(`No declared ranges for ${packageId}`);
      }

      for (const [name, ranges] of declaredRanges) {
        let usedRanges = usedPackageRanges.get(name);
        if (!usedRanges) {
          usedRanges = new Set();
          usedPackageRanges.set(name, usedRanges);
        }
        for (const range of ranges) {
          usedRanges.add(range);
          const resolveMap = resolvedPackageRanges.get(name)!;
          const { version } = resolveMap.get(range)!;
          addRangeUsages(`${name}@${version}`, seen);
        }
      }
    };

    const seen = new Set<string>();
    for (const [name, versions] of workspaceVersions) {
      for (const version of versions) {
        addRangeUsages(`${name}@${version}`, seen);
      }
    }

    for (const [name, resolveMap] of resolvedPackageRanges) {
      const usedRanges = usedPackageRanges.get(name);
      if (!usedRanges) {
        if (options.traceRangeUsages) {
          console.log(`delete all versions for package ${name}`);
        }
        resolvedPackageRanges.delete(name);
        continue;
      }

      for (const [range, rangeInfo] of resolveMap) {
        if (!usedRanges.has(range)) {
          if (options.traceRangeUsages) {
            console.log(`delete ${name}@${rangeInfo.range}`);
          }
          resolveMap.delete(range);
        }
      }
    }
  } while (shouldOptimizeAgain);
};

export const getBuildScripts = (json: any): Record<string, string> | undefined => {
  const buildScripts = {};

  for (const [scriptName, script] of Object.entries(json.scripts || {})) {
    if (BUILD_SCRIPTS.indexOf(scriptName) >= 0) {
      buildScripts[scriptName] = script;
    }
  }

  return Object.entries(buildScripts).length > 0 ? buildScripts : undefined;
};

const getPackageName = (name: string) => {
  const idx = name.indexOf('/');
  return idx < 0 ? name : name.substring(idx + 1);
};

export const parseSpecifier = (
  fullSpecifier: string,
  specifierRange?: string,
): { name: string; range: string; alias: string } => {
  let name, range;
  let ignoreIdx = fullSpecifier.indexOf('>');
  if (ignoreIdx < 0) {
    ignoreIdx = fullSpecifier.indexOf('#');
  }
  if (ignoreIdx < 0) {
    ignoreIdx = fullSpecifier.indexOf('|');
  }
  const specifier = ignoreIdx < 0 ? fullSpecifier : fullSpecifier.substring(0, ignoreIdx);

  const idx = specifier.indexOf(`@`, 1);
  if (idx < 0) {
    name = specifier;
    range = specifierRange || '';
  } else {
    name = specifier.substring(0, idx);
    range = specifier.substring(idx + 1);
    if (specifierRange) {
      throw new Error(`Unclear specification. Specifier: ${specifier}, range: ${specifierRange}`);
    }
  }

  if (!range.startsWith('npm:')) return { name, range, alias: '' };

  const realSpecifier = range.substring(4);
  const realIdx = realSpecifier.indexOf(`@`, 1);
  if (realIdx < 0) return { name: realSpecifier, range: '', alias: name };

  return { name: realSpecifier.substring(0, realIdx), range: realSpecifier.substring(realIdx + 1), alias: name };
};

const getResolutionPath = (name: string, parentResolutionPath?: string) =>
  (parentResolutionPath ? [parentResolutionPath] : []).concat(name.replaceAll('/', '#')).join('/');
const getResolutionRange = ({
  resolutions,
  resolutionPath,
  depRange,
}: {
  resolutions: Map<string, string>;
  resolutionPath: string;
  depRange: string;
}): { range: string; resolution?: string } => {
  let range = depRange;
  for (const [resolution, resolutionRange] of resolutions) {
    if (resolutionPath.endsWith(resolution)) {
      return { range: resolutionRange, resolution };
    }
  }

  return { range };
};

const print = (graph: Graph): string => {
  const seen = new Map();

  const printDependency = (node: Graph, { depPrefix, suffix }: { depPrefix: string; suffix: string }): string => {
    let str = depPrefix;
    if (node.workspacePath) {
      str += 'workspace:';
    } else if (node.packageType === PackageType.PORTAL) {
      str += 'portal:';
    }

    str += node.id;
    if (node.wall) {
      str += '|';
      if (node.wall.length > 0) {
        str += Array.from(node.wall);
      }
    }
    str += `(${suffix})`;
    str += '\n';

    return str;
  };

  const visitDependency = (node: Graph, { prefix, depPrefix }: { prefix: string; depPrefix: string }): string => {
    const seq = seen.get(node);
    let str = printDependency(node, { depPrefix, suffix: seq ? seq + '*' : seen.size + '' });
    if (seq) return str;

    seen.set(node, seen.size);

    const deps: Graph[] = [];
    if (node.workspaces) {
      for (const dep of node.workspaces.values()) {
        deps.push(dep);
      }
    }

    if (node.dependencies) {
      for (const dep of node.dependencies) {
        deps.push(dep);
      }
    }

    for (let idx = 0; idx < deps.length; idx++) {
      const dep = deps[idx];
      const hasMoreDependencies = idx < deps.length - 1;
      str += visitDependency(dep, {
        depPrefix: prefix + (hasMoreDependencies ? `├─` : `└─`),
        prefix: prefix + (hasMoreDependencies ? `│ ` : `  `),
      });
    }

    return str;
  };

  return visitDependency(graph, { prefix: '  ', depPrefix: '' }).trim();
};
