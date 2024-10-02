import path from 'path';
import crypto from 'crypto';

import { Graph } from '../hoister';
import { parseSpecifier } from '../resolver';
import { DOT_BIN, NODE_MODULES, BUILD_SCRIPTS } from '../constants';
import { RESOLVE_STATE_FILE } from '../resolver/resolver';

export type InstallEvent =
  | {
      type: InstallEventType.INSTALL;
      id: string;
      targetPath: string;
      skipUnpack?: boolean;

      tarballUrl: string;
      binPath?: string;
      bin?: Record<string, string>;
    }
  | {
      type: InstallEventType.BUILD;
      id: string;
      targetPath: string;
      optional?: boolean;
      isWorkspace?: boolean;

      buildScripts: Map<string, string>;
      waitPaths: string[];
    }
  | {
      type: InstallEventType.CLONE;
      id: string;
      targetPath: string;
      skipUnpack?: boolean;

      sourcePath: string;
      binPath?: string;
      bin?: Record<string, string>;
    }
  | {
      type: InstallEventType.LINK;
      id: string;
      targetPath: string;

      sourcePath: string;
    }
  | {
      type: InstallEventType.READDIR;
      targetPath: string;
    }
  | {
      type: InstallEventType.DELETE;
      targetPath: string;
      cleanOnly?: boolean;
    };

export enum InstallLink {
  DIRECTORY = 'directory',
  SYMLINK = 'symlink',
}
export type InstallState = {
  id?: string;
  buildHash?: string;
  buildFail?: string;
  isLink?: boolean;
  nodes?: Map<string, InstallState>;
};

type WorkInstallState = InstallState & {
  _cleanStatus?: CleanStatus;
  _pathKind?: PathKind;
};

export enum DirEntryType {
  FILE = 'file',
  DIRECTORY = 'directory',
  SYMLINK = 'symlink',
}
export type DirEntry = { name: string; type: DirEntryType };
export enum InstallEventType {
  DELETE = 'delete',
  READDIR = 'readdir',
  INSTALL = 'install',
  BUILD = 'build',
  CLONE = 'clone',
  LINK = 'link',
}

enum CleanStatus {
  CLEAN = 'clean',
  MISSING = 'missing',
}
enum PathKind {
  NODE_MODULES = 'node_modules',
  DOT_BIN = 'dot_bin',
  BIN_LINK = 'bin_link',
  SCOPE = 'scope',
  PACKAGE = 'package',
}

const parseName = (name: string): { scope: string | null; packageName: string } => {
  const idx = name.indexOf('/');
  return idx < 0
    ? { scope: null, packageName: name }
    : { scope: name.substring(0, idx), packageName: name.substring(idx + 1) };
};

const getTransitiveDependencies = (workNode: Graph): Graph[] => {
  const dependencies: Graph[] = [];
  const seenNodes = new Set<Graph>();

  const visitNode = (graphPath: Graph[]) => {
    let node = graphPath[graphPath.length - 1];
    node = node.workspace || node;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);

    if (node.dependencies) {
      for (const dep of node.dependencies.values()) {
        visitNode([...graphPath, dep]);
      }
    }

    dependencies.push(node);
  };

  visitNode([workNode]);

  return dependencies;
};

const traverseGraph = (
  graph: Graph,
): {
  allNodes: Set<Graph>;
  buildNodes: Set<Graph>;
  nodePathMap: Map<Graph, string>;
  installState: WorkInstallState;
} => {
  const allNodes = new Set<Graph>();
  const buildNodes = new Set<Graph>();
  const nodePathMap = new Map<Graph, string>();
  const installState: WorkInstallState = {};

  const addPathToState = (rootNode: WorkInstallState, pathKind: PathKind, ...segments: string[]): WorkInstallState => {
    let node = rootNode;
    for (const segment of segments) {
      let nextNode = node.nodes?.get(segment);
      if (!nextNode) {
        nextNode = {};
        if (!node.nodes) {
          node.nodes = new Map();
        }
        node.nodes.set(segment, nextNode);
      }

      node = nextNode;
    }

    node._pathKind = pathKind;

    return node;
  };

  const visitNode = (node: Graph, stateNode: InstallState, parentFsPath?: string) => {
    const { name } = parseSpecifier(node.id);
    const { scope, packageName } = parseName(node.alias || name);

    const fsPath = node.workspacePath || path.join(parentFsPath!, NODE_MODULES, node.alias || name);
    nodePathMap.set(node, fsPath);

    if (allNodes.has(node)) return;

    let nmNode;
    let nextStateNode = stateNode;
    if (!node.workspacePath) {
      nmNode = node.parent?.workspacePath ? stateNode : addPathToState(stateNode, PathKind.NODE_MODULES, NODE_MODULES);
      nmNode._pathKind = PathKind.NODE_MODULES;
      if (scope) {
        nextStateNode = addPathToState(addPathToState(nmNode, PathKind.SCOPE, scope), PathKind.PACKAGE, packageName);
      } else {
        nextStateNode = addPathToState(nmNode, PathKind.PACKAGE, packageName);
      }
      nextStateNode.id = node.id;
      if (node.workspace) {
        nextStateNode.isLink = true;
      }
    } else {
      const location = path.join(node.workspacePath, NODE_MODULES);
      nextStateNode = addPathToState(installState, PathKind.NODE_MODULES, location);
      nmNode = nextStateNode;
    }

    if (node.bin) {
      const binNode = addPathToState(nmNode, PathKind.DOT_BIN, DOT_BIN);

      Object.keys(node.bin).forEach((filename) => {
        addPathToState(binNode, PathKind.BIN_LINK, filename).id = node.id;
      });
    }

    allNodes.add(node);

    if (node.buildScripts) {
      buildNodes.add(node);
    }

    for (const dep of node.dependencies || []) {
      if (dep.parent !== node) continue;
      visitNode(dep, nextStateNode, fsPath);
    }

    for (const dep of node.workspaces || []) {
      visitNode(dep, nextStateNode);
    }
  };

  visitNode(graph, installState);

  return { allNodes, buildNodes, nodePathMap, installState };
};

// Prefer build nodes with least dependencies
const getPreferredBuildNodes = (buildDependencies: Map<Graph, Graph[]>): Graph[] =>
  Array.from(buildDependencies.keys()).sort(
    (node1, node2) => buildDependencies.get(node1)!.length - buildDependencies.get(node2)!.length,
  );

export const installStateDeserializer = (key, value) => {
  if (key === 'nodes') {
    return new Map(value);
  } else {
    return value;
  }
};

export const installStateSerializer = (key, value) => {
  if (key === 'nodes') {
    return Array.from(value.entries());
  } else if (key.startsWith('_')) {
    return undefined;
  } else {
    return value;
  }
};

const getGraphPath = (node: Graph): Graph[] => {
  const graphPath: Graph[] = [];

  let currentNode: Graph | undefined = node;
  do {
    graphPath.unshift(currentNode);
    currentNode = currentNode.parent;
  } while (currentNode);

  return graphPath;
};

function* cleanNode({
  dirPath,
  stateNode,
  prevStateNode,
  existingPaths,
}: {
  dirPath: string;
  stateNode: WorkInstallState;
  prevStateNode?: InstallState;
  existingPaths: Set<string>;
}): Generator<InstallEvent, undefined, DirEntry[] | undefined> {
  if (stateNode._cleanStatus) return;

  if (dirPath !== NODE_MODULES && (!stateNode.nodes || !prevStateNode)) {
    yield { type: InstallEventType.DELETE, targetPath: dirPath };
    stateNode._cleanStatus = CleanStatus.MISSING;
    return;
  }

  const entries = yield { type: InstallEventType.READDIR, targetPath: dirPath };
  if (!entries) {
    stateNode._cleanStatus = CleanStatus.MISSING;
  } else {
    let canRemoveWholeDir = true;
    const pathsToRemove = new Map();
    for (const entry of entries) {
      if (dirPath === NODE_MODULES && entry.name === RESOLVE_STATE_FILE) {
        canRemoveWholeDir = false;
      }

      if (entry.name.startsWith('.') && !stateNode.nodes?.has(entry.name)) continue;

      const targetPath = path.join(dirPath, entry.name);
      const entryStateNode = stateNode.nodes?.get(entry.name);
      const prevEntryNode = prevStateNode?.nodes?.get(entry.name);
      const entryType = entryStateNode
        ? entryStateNode.isLink || stateNode._pathKind === PathKind.DOT_BIN
          ? DirEntryType.SYMLINK
          : DirEntryType.DIRECTORY
        : undefined;

      const isGoodEntry =
        entryStateNode &&
        prevEntryNode &&
        prevEntryNode.id === entryStateNode.id &&
        prevEntryNode.isLink === entryStateNode.isLink &&
        entry.type === entryType;
      const isWrongEntry =
        !entryStateNode ||
        !prevEntryNode ||
        (entryStateNode &&
          prevEntryNode &&
          (entryStateNode.id !== prevEntryNode.id ||
            entryStateNode.isLink !== prevEntryNode.isLink ||
            entry.type !== entryType));
      if (isGoodEntry) {
        canRemoveWholeDir = false;
        existingPaths.add(targetPath);
      } else if (isWrongEntry) {
        const isInnerNmExists = entryStateNode && entryStateNode.nodes?.get(NODE_MODULES);
        pathsToRemove.set(targetPath, isInnerNmExists);

        if (entryStateNode && isInnerNmExists) {
          canRemoveWholeDir = false;
        }
      }
    }

    if (canRemoveWholeDir) {
      yield { type: InstallEventType.DELETE, targetPath: dirPath };
      stateNode._cleanStatus = CleanStatus.MISSING;
    } else {
      for (const [targetPath, isInnerNmExists] of pathsToRemove) {
        if (isInnerNmExists) {
          yield { type: InstallEventType.DELETE, targetPath, cleanOnly: true };
        } else {
          yield { type: InstallEventType.DELETE, targetPath };
        }
      }
      stateNode._cleanStatus = CleanStatus.CLEAN;
    }
  }
}

function* cleanPackage({
  pkg,
  installState,
  prevState,
  existingPaths,
}: {
  pkg: Graph;
  installState: WorkInstallState;
  prevState?: InstallState;
  existingPaths: Set<string>;
}): Generator<InstallEvent, undefined, DirEntry[] | undefined> {
  const graphPath = getGraphPath(pkg);

  let stateNode = installState,
    prevNode = prevState,
    parentPath = '.';
  for (const node of graphPath) {
    if (node.workspacePath) {
      parentPath = path.join(node.workspacePath, NODE_MODULES);
      stateNode = installState.nodes!.get(parentPath)!;
      prevNode = prevState?.nodes?.get(parentPath);

      yield* cleanNode({ dirPath: parentPath, stateNode, prevStateNode: prevNode, existingPaths });
    } else {
      if (stateNode._pathKind === PathKind.NODE_MODULES) {
        yield* cleanNode({ dirPath: parentPath, stateNode, prevStateNode: prevNode, existingPaths });

        if (stateNode._cleanStatus === CleanStatus.MISSING) break;

        const { name } = parseSpecifier(node.id);
        const { scope, packageName } = parseName(node.alias || name);

        if (scope) {
          yield* cleanNode({
            dirPath: path.join(parentPath, scope),
            stateNode: stateNode.nodes!.get(scope)!,
            prevStateNode: prevNode?.nodes?.get(scope),
            existingPaths,
          });
        }

        if (node.bin) {
          yield* cleanNode({
            dirPath: path.join(parentPath, '.bin'),
            stateNode: stateNode.nodes!.get(DOT_BIN)!,
            prevStateNode: prevNode?.nodes?.get(DOT_BIN),
            existingPaths,
          });
        }

        parentPath = [parentPath]
          .concat(scope ? [scope] : [])
          .concat([packageName, NODE_MODULES])
          .join(path.sep);
        const packageStateNode = scope ? stateNode.nodes!.get(scope)! : stateNode;
        const packagePrevNode = scope ? prevNode?.nodes?.get(scope) : prevNode;
        const nextStateNode = packageStateNode.nodes!.get(packageName)!.nodes?.get(NODE_MODULES);
        if (nextStateNode) {
          stateNode = nextStateNode;
          prevNode = packagePrevNode?.nodes?.get(packageName)?.nodes?.get(NODE_MODULES);
        }
      }
    }
  }
}

const cleanState = (state: WorkInstallState): InstallState | undefined => {
  let isEmpty = !state.buildFail && !state.buildHash;
  if (isEmpty) {
    for (const node of state.nodes!.values()) {
      if (node.nodes) {
        isEmpty = false;
        break;
      }
    }
  }

  if (isEmpty) {
    return undefined;
  }

  const cloneNode = (node: WorkInstallState): InstallState => {
    const clone: any = {};
    for (const [key, val] of Object.entries(node)) {
      if (!key.startsWith('_') && key !== 'nodes') {
        clone[key] = val;
      }
    }

    if (node.nodes) {
      clone.nodes = new Map();
      for (const [subdir, child] of node.nodes) {
        clone.nodes.set(subdir, cloneNode(child));
      }
    }

    return clone;
  };

  return cloneNode(state);
};

const getStateNode = (targetPath: string, state: InstallState | undefined): InstallState | undefined => {
  if (targetPath === '.' || !state) return state;

  const segments = targetPath.split(path.sep);
  const firstNmIndex = targetPath.indexOf(NODE_MODULES);
  if (firstNmIndex < 0) {
    throw new Error(`Assertion: unexpected target path: ${targetPath}`);
  }

  let subdir = segments.slice(0, firstNmIndex + 1).join(path.sep);
  let node = state.nodes?.get(subdir);
  for (let idx = firstNmIndex + 1; node && idx < segments.length; idx++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    node = node?.nodes?.get(segments[idx])!;
  }

  return node;
};

const getBuildHash = (deps: Graph[], nodePathMap: Map<Graph, string>) => {
  const hash = crypto.createHash('sha1');

  for (const dep of deps) {
    const targetPath = nodePathMap.get(dep)!;
    hash.update(`${targetPath}|${dep.id}`);
  }

  return hash.digest('hex');
};

export const setBuildFailures = (state: InstallState, failures: Map<string, string>) => {
  for (const [targetPath, failedBuild] of failures) {
    const stateNode = getStateNode(targetPath, state)!;
    stateNode.buildFail = failedBuild;
  }
};

export const installScript = function* (
  graph: Graph,
  prevState?: InstallState,
): Generator<InstallEvent, InstallState | undefined, DirEntry[] | undefined> {
  const { allNodes, buildNodes, nodePathMap, installState } = traverseGraph(graph);
  const buildDependencies = new Map<Graph, Graph[]>();

  for (const buildNode of buildNodes) {
    const dependencies = getTransitiveDependencies(buildNode);
    buildDependencies.set(buildNode, dependencies);

    const stateNode = getStateNode(nodePathMap.get(buildNode)!, installState)!;
    if (!stateNode) {
      throw new Error(`Unable to find state node for path: ${nodePathMap.get(buildNode)!}`);
    }
    stateNode.buildHash = getBuildHash(dependencies, nodePathMap);
  }

  const buildNodePreferenceList = getPreferredBuildNodes(buildDependencies);
  const buildNodePreferenceMap = new Map();
  for (let idx = 0; idx < buildNodePreferenceList.length; idx++) {
    buildNodePreferenceMap.set(buildNodePreferenceList[idx], idx);
  }

  const priorityMap = new Map<Graph, number>();
  let priority = 0;
  for (const buildNode of buildNodePreferenceList) {
    const dependencies = buildDependencies.get(buildNode)!;
    for (const dep of dependencies) {
      if (!priorityMap.has(dep)) {
        priorityMap.set(dep, priority);
        priority++;
      }
    }
  }

  const sortedNodeList = Array.from(allNodes).sort((node1, node2) => {
    let compareValue = (priorityMap.get(node1) ?? priority) - (priorityMap.get(node2) ?? priority);
    return compareValue === 0 ? node1.id.localeCompare(node2.id) : compareValue;
  });

  const existingPaths = new Set<string>();

  const installPaths = new Map<string, string>();
  const cloneablePaths = new Map<string, string>();
  for (const node of sortedNodeList) {
    const targetPath = nodePathMap.get(node)!;
    yield* cleanPackage({ pkg: node, installState, prevState, existingPaths });

    const isAlreadyUnpacked = existingPaths.has(targetPath);
    let bin;
    const binPath = path.join(nodePathMap.get(node.parent || node)!, NODE_MODULES, DOT_BIN);
    if (node.bin) {
      for (const [binName, relativePath] of Object.entries(node.bin)) {
        if (existingPaths.has(path.join(binPath, binName))) {
          continue;
        }
        bin = bin || {};
        bin[binName] = relativePath;
      }
    }

    if (!node.workspacePath && (!isAlreadyUnpacked || bin)) {
      const sourcePath = cloneablePaths.get(node.id);
      if (sourcePath) {
        yield {
          type: InstallEventType.CLONE,
          skipUnpack: isAlreadyUnpacked || undefined,
          sourcePath,
          targetPath,
          bin,
          id: node.id,
          binPath: bin ? binPath : undefined,
        };
      } else {
        if (node.workspace) {
          yield { type: InstallEventType.LINK, sourcePath: node.workspace.workspacePath!, targetPath, id: node.id };
        } else {
          yield {
            type: InstallEventType.INSTALL,
            skipUnpack: isAlreadyUnpacked || undefined,
            tarballUrl: node.tarballUrl!,
            targetPath,
            bin,
            id: node.id,
            binPath: bin ? binPath : undefined,
          };
        }
      }
      if (!isAlreadyUnpacked) {
        cloneablePaths.set(node.id, targetPath);
      }
      installPaths.set(node.id, targetPath);
    }

    if (node.buildScripts) {
      const stateNode = getStateNode(targetPath, installState)!;
      const prevStateNode = getStateNode(targetPath, prevState);
      if (
        stateNode &&
        (isAlreadyUnpacked || node.workspacePath) &&
        prevStateNode &&
        stateNode.buildHash === prevStateNode.buildHash &&
        !prevStateNode.buildFail
      )
        continue;
      const deps = buildDependencies.get(node)!;

      const waitPaths: string[] = [];
      for (const dep of deps) {
        if (
          existingPaths.has(nodePathMap.get(dep)!) ||
          (dep.workspacePath && (!dep.buildScripts || dep === node)) ||
          (dep.workspace && !dep.workspace.buildScripts)
        )
          continue;
        const waitPath = installPaths.get(dep.id);
        if (!waitPath) {
          throw new Error(`Dependency ${dep.id} wait path not found for parent package: ${node.id}`);
        }
        waitPaths.push(waitPath);
      }

      const buildScripts = new Map();
      const startIdx =
        prevStateNode &&
        prevStateNode.buildFail &&
        (isAlreadyUnpacked || node.workspacePath) &&
        prevStateNode.buildHash === stateNode.buildHash
          ? BUILD_SCRIPTS.indexOf(prevStateNode.buildFail)
          : 0;
      for (let idx = startIdx; idx < BUILD_SCRIPTS.length; idx++) {
        const scriptName = BUILD_SCRIPTS[idx];
        const scriptLine = node.buildScripts[scriptName];
        if (typeof scriptLine !== 'undefined') {
          buildScripts.set(scriptName, scriptLine);
        }
      }

      let event: InstallEvent = { type: InstallEventType.BUILD, waitPaths, targetPath, buildScripts, id: node.id };

      if (node.optional) {
        event.optional = true;
      }

      if (node.workspace) {
        event.isWorkspace = true;
      }

      yield event;
    }
  }

  return cleanState(installState);
};
