import { getHoistingDecision, finalizeDependedDecisions, Hoistable, HoistingDecision } from './decision';
import { getChildren, getPriorities, getUsages, HoistingPriorities } from './priority';
import { getWorkspaceNodes, getAlternativeWorkspaceRoutes, WorkspaceUsageRoutes } from './workspace';

export type HoistingOptions = {
  trace?: boolean;
  dump?: boolean;
  check?: CheckType;
  explain?: boolean;
  showChanges?: boolean;
  preserveSymlinksSafe?: boolean;
};

export type PackageId = string;
export type PackageName = string;

export type GraphRoute = Array<{ name: PackageName; isWorkspaceDep: boolean }>;

export enum PackageType {
  PORTAL = 'PORTAL',
}

export enum CheckType {
  THOROUGH = 'THOROUGH',
  FINAL = 'FINAL',
}

export type Graph = {
  id: string;
  alias?: string;
  dependencies?: Graph[];
  workspaces?: Graph[];
  peerNames?: string[];
  packageType?: PackageType;
  wall?: string[];
  priority?: number;
  reason?: string;
  parent?: Graph;
  workspace?: Graph;
  bin?: Record<string, string>;

  workspacePath?: string;
  tarballUrl?: string;
  buildScripts?: Record<string, string>;
  optional?: boolean;
};

export type WorkGraph = {
  id: PackageId;
  hoistingPriorities: HoistingPriorities;
  dependencies?: Map<PackageName, WorkGraph>;
  lookupUsages?: Map<PackageId, Set<PackageName>>;
  lookupDependants?: Map<PackageName, Set<PackageId>>;
  workspaces?: Map<PackageName, WorkGraph>;
  peerNames?: Map<PackageName, GraphRoute | null>;
  binEntries: Map<string, PackageId>;
  ownBinEntries: Set<string>;
  packageType?: PackageType;
  queueIndex?: number;
  wall?: Set<PackageName>;
  originalNode: Graph;
  originalParent?: WorkGraph;
  newParent?: WorkGraph;
  workspace?: WorkGraph;
  priority?: number;
  reason?: string;
  lastDecisions: Map<PackageName, HoistingDecision>;
};

export const getPackageName = (pkgId: PackageId): PackageName => {
  const idx = pkgId.indexOf(`@`, 1);
  return (idx < 0 ? pkgId : pkgId.substring(0, idx)) as PackageName;
};

const getGraphPath = (graphRoute: GraphRoute, graph: WorkGraph) => {
  const graphPath = [graph];
  let node = graph;
  for (const nextDep of graphRoute) {
    if (nextDep.isWorkspaceDep) {
      node = node.workspaces!.get(nextDep.name)!;
    } else {
      node = node.dependencies!.get(nextDep.name)!;
    }
    graphPath.push(node.workspace || node);
  }
  return graphPath;
};

const cloneNode = (node: WorkGraph): WorkGraph => {
  if (node.workspace) return node;

  const clone: WorkGraph = {
    id: node.id,
    hoistingPriorities: node.hoistingPriorities,
    lastDecisions: new Map(),
    originalNode: node.originalNode,
    binEntries: new Map(node.binEntries),
    ownBinEntries: node.ownBinEntries,
  };

  if (node.packageType) {
    clone.packageType = node.packageType;
  }

  if (node.peerNames) {
    clone.peerNames = new Map(node.peerNames);
  }

  if (node.wall) {
    clone.wall = node.wall;
  }

  if (node.workspaces) {
    clone.workspaces = new Map(node.workspaces);
  }

  if (node.dependencies) {
    clone.dependencies = new Map(node.dependencies);
    const nodeName = getPackageName(node.id);
    const selfNameDep = node.dependencies.get(nodeName);
    if (selfNameDep === node) {
      clone.dependencies.set(nodeName, clone);
    }
  }

  if (node.priority) {
    clone.priority = node.priority;
  }

  return clone;
};

const getAliasedId = (pkg: Graph): PackageId => (!pkg.alias ? pkg.id : `${pkg.alias}@>${pkg.id}`);

export const fromAliasedId = (aliasedId: PackageId): { alias?: PackageName; id: PackageId } => {
  const alias = getPackageName(aliasedId);
  const idIndex = aliasedId.indexOf('@>', alias.length);
  return idIndex < 0 ? { id: aliasedId } : { alias, id: aliasedId.substring(idIndex + 2) };
};

const populateImplicitPeers = (graph: WorkGraph) => {
  const seen = new Set();

  const visitDependency = (graphPath: WorkGraph[]) => {
    const node = graphPath[graphPath.length - 1];
    const isSeen = seen.has(node);
    seen.add(node);

    if (node.peerNames && graphPath.length > 1) {
      const parent = graphPath[graphPath.length - 2];
      for (const [peerName, route] of node.peerNames) {
        if (route === null && !parent.dependencies?.has(peerName) && !parent.peerNames?.has(peerName)) {
          const route: GraphRoute = [
            {
              name: getPackageName(node.id),
              isWorkspaceDep: node.workspace === node,
            },
          ];
          for (let idx = graphPath.length - 2; idx >= 0; idx--) {
            const parent = graphPath[idx];
            if (parent.dependencies?.has(peerName)) {
              for (let j = idx + 1; j < graphPath.length - 1; j++) {
                const peerNode = graphPath[j];
                if (!peerNode.peerNames) {
                  peerNode.peerNames = new Map();
                }
                if (!peerNode.peerNames.has(peerName)) {
                  peerNode.peerNames.set(peerName, route);
                }
              }
              break;
            } else {
              route.unshift({ name: getPackageName(parent.id), isWorkspaceDep: parent.workspace === parent });
            }
          }
        }
      }
    }

    if (!isSeen) {
      if (node.workspaces) {
        for (const dep of node.workspaces.values()) {
          graphPath.push(dep);
          visitDependency(graphPath);
          graphPath.pop();
        }
      }

      if (node.dependencies) {
        for (const dep of node.dependencies.values()) {
          graphPath.push(dep);
          visitDependency(graphPath);
          graphPath.pop();
        }
      }
    }
  };

  visitDependency([graph]);
};

export const toWorkGraph = (rootPkg: Graph): WorkGraph => {
  const seen = new Map<Graph, WorkGraph>();
  const workspaceNodes = new Map<PackageId, WorkGraph>();
  const workspaceRefs = new Map<WorkGraph, WorkGraph>();
  const idMap = new Map<string, { node: Graph; parent?: Graph }>();

  const createWorkspaceNodes = (pkg: Graph) => {
    const workspace: WorkGraph = {
      id: pkg.id,
      hoistingPriorities: new Map(),
      lastDecisions: new Map(),
      originalNode: pkg,
      binEntries: new Map(),
      ownBinEntries: new Set(),
    };
    workspaceNodes.set(workspace.id, workspace);
    if (pkg.workspaces) {
      for (const dep of pkg.workspaces) {
        createWorkspaceNodes(dep);
      }
    }
  };

  createWorkspaceNodes(rootPkg);

  const convertNode = (pkg: Graph, isWorkspace: boolean, parent?: Graph): WorkGraph => {
    const aliasedId = getAliasedId(pkg);
    if (!isWorkspace) {
      const seenIdInstance = idMap.get(aliasedId);
      if (typeof seenIdInstance !== 'undefined' && seenIdInstance.node !== pkg) {
        throw new Error(
          `Package ${pkg.id}${
            pkg.alias ? ' with alias ' + pkg.alias : ''
          } has multiple instances in the graph, which is disallowed:\n1: ${JSON.stringify(
            seenIdInstance.node
          )}, parent: ${seenIdInstance.parent?.id}\n2: ${JSON.stringify(pkg)}, parent: ${parent?.id}`
        );
      }
      idMap.set(aliasedId, { node: pkg, parent });
    }

    const seenNode = seen.get(pkg);
    const newNode: WorkGraph = isWorkspace
      ? workspaceNodes.get(pkg.id)!
      : seenNode || {
          id: aliasedId,
          hoistingPriorities: new Map(),
          lastDecisions: new Map(),
          originalNode: pkg,
          binEntries: new Map(),
          ownBinEntries: new Set(),
        };
    seen.set(pkg, newNode);
    if (pkg === rootPkg) {
      newNode.workspace = newNode;
    }

    if (!seenNode) {
      if (pkg.packageType) {
        newNode.packageType = pkg.packageType;
      }

      if (pkg.peerNames) {
        newNode.peerNames = new Map();
        for (const peerName of pkg.peerNames) {
          newNode.peerNames.set(peerName, null);
        }
      }

      if (pkg.wall) {
        newNode.wall = new Set(pkg.wall);
      }

      if (pkg.priority) {
        newNode.priority = pkg.priority;
      }

      if (pkg.bin) {
        for (const scriptName of Object.keys(pkg.bin)) {
          newNode.binEntries.set(scriptName, pkg.id);
          newNode.ownBinEntries.add(scriptName);
        }
      }

      if (pkg.workspaces && pkg.workspaces.length > 0) {
        newNode.workspaces = new Map();

        for (const dep of pkg.workspaces) {
          const name = dep.alias || getPackageName(dep.id);
          const depNode = convertNode(dep, true, pkg);
          depNode.workspace = depNode;
          newNode.workspaces.set(name, depNode);
        }
      }

      if (pkg.dependencies && pkg.dependencies.length > 0) {
        newNode.dependencies = new Map();

        for (const dep of pkg.dependencies || []) {
          const name = dep.alias || getPackageName(dep.id);
          const depNode: WorkGraph = convertNode(dep, false, pkg);
          if (dep.bin) {
            for (const scriptName of Object.keys(dep.bin)) {
              newNode.binEntries.set(scriptName, dep.id);
            }
          }

          const workspace = workspaceNodes.get(dep.id);
          if (workspace) {
            let workspaceRef = workspaceRefs.get(depNode);
            if (!workspaceRef) {
              workspaceRef = {
                id: depNode.id,
                hoistingPriorities: new Map(),
                lastDecisions: new Map(),
                workspace,
                originalNode: depNode.originalNode,
                binEntries: new Map(),
                ownBinEntries: new Set(),
              };
              workspaceRefs.set(depNode, workspaceRef);
            }
            newNode.dependencies.set(name, workspaceRef);
          } else {
            newNode.dependencies.set(name, depNode);
          }
        }
      }
    }

    return newNode;
  };

  const graph = convertNode(rootPkg, true);
  graph.workspace = graph;

  const seenNodes = new Set();
  const usages = getUsages(graph);
  const fillPriorities = (node: WorkGraph) => {
    if (seenNodes.has(node)) return;
    seenNodes.add(node);

    const children = getChildren(node);
    node.hoistingPriorities = getPriorities(usages, children);

    if (node.workspaces) {
      for (const dep of node.workspaces.values()) {
        fillPriorities(dep);
      }
    }

    if (node.dependencies) {
      for (const dep of node.dependencies.values()) {
        fillPriorities(dep);
      }
    }
  };

  fillPriorities(graph);

  return graph;
};

const fromWorkGraph = (graph: WorkGraph): Graph => {
  const nodeMap = new Map<WorkGraph, Graph>();

  const cloneNode = (node: WorkGraph, parent: Graph | null): Graph => {
    let pkg = nodeMap.get(node);
    if (pkg) return pkg;

    const { alias, id } = fromAliasedId(node.id);
    pkg = { id };
    if (alias) {
      pkg.alias = alias;
    }
    nodeMap.set(node, pkg);

    if (node.packageType) {
      pkg.packageType = node.packageType;
    }

    if (node.peerNames) {
      for (const [peerName, route] of node.peerNames) {
        if (route === null) {
          if (!pkg.peerNames) {
            pkg.peerNames = [];
          }
          pkg.peerNames.push(peerName);
        }
      }
    }

    if (node.reason) {
      pkg.reason = node.reason;
    }

    if (node.wall) {
      pkg.wall = Array.from(node.wall).sort();
    }

    if (node.priority) {
      pkg.priority = node.priority;
    }

    if (node.workspaces) {
      pkg.workspaces = [];
    }

    if (node.dependencies) {
      pkg.dependencies = [];
    }

    if (parent) {
      pkg.parent = parent;
    }

    if (!node.workspace || node.workspace === node) {
      const originalNode = node.originalNode;
      if (originalNode.bin) {
        pkg.bin = originalNode.bin;
      }

      if (originalNode.buildScripts) {
        pkg.buildScripts = originalNode.buildScripts;
      }

      if (originalNode.workspacePath) {
        pkg.workspacePath = originalNode.workspacePath;
      }

      if (originalNode.tarballUrl) {
        pkg.tarballUrl = originalNode.tarballUrl;
      }

      if (originalNode.optional) {
        pkg.optional = originalNode.optional;
      }
    }

    if (node.workspaces) {
      for (const dep of node.workspaces.values()) {
        cloneNode(dep, pkg);
      }
    }

    if (node.dependencies) {
      for (const dep of node.dependencies.values()) {
        if (!dep.newParent || dep.newParent === node) {
          cloneNode(dep, pkg);
        }
      }
    }

    return pkg;
  };

  const rootPkg: Graph = cloneNode(graph, null);

  const getClonedNode = (node: WorkGraph): Graph => {
    const clonedNode = nodeMap.get(node);
    if (!clonedNode) {
      throw new Error(`Assertion: expected to have cloned node: ${node.id}`);
    }

    return clonedNode;
  };

  const visitDependency = (graphPath: WorkGraph[], pkg: Graph) => {
    let node = graphPath[graphPath.length - 1];
    if (graphPath.indexOf(node) !== graphPath.length - 1) return;

    if (node.workspaces) {
      const sortedEntries = Array.from(node.workspaces.entries()).sort((x1, x2) =>
        x1[0] === x2[0] ? 0 : x1[0] < x2[0] ? -1 : 1
      );

      pkg.workspaces = [];

      for (const [, dep] of sortedEntries) {
        const depPkg = getClonedNode(dep);
        pkg.workspaces.push(depPkg);

        graphPath.push(dep);
        visitDependency(graphPath, depPkg);
        graphPath.pop();
      }
    }

    if (node.workspace) {
      pkg.workspace = getClonedNode(node.workspace);
    }

    if (node.dependencies) {
      const sortedEntries = Array.from(node.dependencies.entries()).sort((x1, x2) =>
        x1[0] === x2[0] ? 0 : x1[0] < x2[0] ? -1 : 1
      );

      pkg.dependencies = [];
      for (const [depName, dep] of sortedEntries) {
        if (!dep.newParent || dep.newParent === node) {
          const depPkg = getClonedNode(dep);
          pkg.dependencies.push(depPkg);

          graphPath.push(dep);
          visitDependency(graphPath, depPkg);
          graphPath.pop();
        } else if (dep.originalParent === node && dep.newParent !== node) {
          let depNode = dep,
            parent = node;
          do {
            parent = depNode.newParent!;
            depNode = parent.dependencies!.get(depName)!;
          } while (depNode.newParent && depNode.newParent !== parent);

          const depPkg = getClonedNode(depNode);
          pkg.dependencies.push(depPkg);
        }
      }
    }
  };

  visitDependency([graph], rootPkg);

  return rootPkg;
};

type QueueElement = { graphPath: WorkGraph[]; depName: PackageName };
type HoistingQueue = Array<QueueElement[]>;

const hoistDependencies = (
  graphPath: WorkGraph[],
  queueIndex: number,
  depNames: Set<PackageName>,
  options: HoistingOptions,
  hoistingQueue: HoistingQueue,
  lastWorkspaceIndex: number,
  workspaceUsageRoutes: WorkspaceUsageRoutes
): boolean => {
  let wasGraphChanged = false;
  const parentPkg = graphPath[graphPath.length - 1];

  if (options.trace) {
    console.log(queueIndex === 0 ? 'visit' : 'revisit', graphPath.map((x) => x.id).join('/'), depNames);
  }

  const preliminaryDecisionMap = new Map<PackageName, HoistingDecision>();
  for (const depName of depNames) {
    let decision = getHoistingDecision(graphPath, depName, queueIndex);
    if (
      options.preserveSymlinksSafe &&
      decision.isHoistable !== Hoistable.LATER &&
      decision.newParentIndex < lastWorkspaceIndex
    ) {
      const workspaceId = fromAliasedId(graphPath[lastWorkspaceIndex].id).id;
      const alternativeGraphRoutes = workspaceUsageRoutes.get(workspaceId);
      if (alternativeGraphRoutes) {
        for (const workspaceGraphRoute of alternativeGraphRoutes) {
          const graphPathToWorkspace = getGraphPath(workspaceGraphRoute, graphPath[0]);
          const usageGraphPath = graphPathToWorkspace.concat(graphPath.slice(lastWorkspaceIndex + 1));
          const usageDecision = getHoistingDecision(usageGraphPath, depName, queueIndex);
          if (options.trace) {
            console.log(
              'alternative usage path:',
              usageGraphPath.map((x) => x.id).join('/'),
              depName,
              'decision:',
              usageDecision
            );
          }
          if (usageDecision.isHoistable === Hoistable.LATER) {
            decision = usageDecision;
            if (options.trace) {
              console.log('updated decision:', decision);
            }
            break;
          } else {
            for (let idx = usageDecision.newParentIndex; idx < usageGraphPath.length; idx++) {
              let originalIndex;
              const node = usageGraphPath[idx];
              for (originalIndex = graphPath.length - 1; originalIndex >= 0; originalIndex--) {
                if (graphPath[originalIndex].id === node.id) {
                  break;
                }
              }
              if (originalIndex >= 0) {
                if (originalIndex > decision.newParentIndex) {
                  decision.newParentIndex = originalIndex;
                  decision.reason = `dependency was not hoisted due to ${usageDecision.reason!} at alternative usage route: ${printGraphPath(
                    usageGraphPath
                  )}`;
                  if (options.trace) {
                    console.log('updated decision:', decision);
                  }
                }
                break;
              }
            }
          }
        }
      }
    }
    preliminaryDecisionMap.set(depName, decision);
  }

  const finalDecisions = finalizeDependedDecisions(graphPath, preliminaryDecisionMap, options);

  const hoistDependency = (dep: WorkGraph, depName: PackageName, newParentIndex: number) => {
    delete dep.queueIndex;
    const rootPkg = graphPath[newParentIndex];
    if (rootPkg.workspace && rootPkg.workspace !== rootPkg) {
      throw new Error(`Assertion: trying to hoist into workspace reference: ${rootPkg.id}`);
    }
    for (let idx = newParentIndex; idx < graphPath.length - 1; idx++) {
      const pkg = graphPath[idx];
      const rootPkgDep = pkg.dependencies?.get(depName);
      if (!rootPkgDep) {
        if (!pkg.dependencies) {
          pkg.dependencies = new Map();
        }
        pkg.dependencies.set(depName, dep);
      }

      if (!pkg.lookupUsages) {
        pkg.lookupUsages = new Map();
      }

      let lookupNameList = pkg.lookupUsages.get(parentPkg.id);
      if (!lookupNameList) {
        lookupNameList = new Set();
        pkg.lookupUsages.set(parentPkg.id, lookupNameList);
      }
      lookupNameList.add(depName);

      if (!pkg.lookupDependants) {
        pkg.lookupDependants = new Map();
      }

      let dependantList = pkg.lookupDependants.get(depName);
      if (!dependantList) {
        dependantList = new Set();
        pkg.lookupDependants.set(depName, dependantList);
      }
      dependantList.add(parentPkg.id);
    }
    dep.newParent = rootPkg;

    for (let idx = newParentIndex + 1; idx < graphPath.length; idx++) {
      const pkg = graphPath[idx];
      if (pkg.lookupUsages) {
        const depLookupNames = pkg.lookupUsages.get(dep.id);
        if (depLookupNames) {
          for (const name of depLookupNames) {
            const dependantList = pkg.lookupDependants!.get(name)!;
            dependantList.delete(dep.id);
            if (dependantList.size === 0) {
              pkg.lookupDependants!.delete(name);
              const pkgDep = pkg.dependencies!.get(name)!;
              // Delete "lookup" dependency, because of empty set of dependants
              if (pkgDep!.newParent && pkgDep!.newParent !== pkg) {
                if (options.trace) {
                  console.log(
                    `clearing previous lookup dependency by ${dep.id} on ${pkgDep.id} in`,
                    graphPath.slice(0, idx + 1).map((x) => x.id)
                  );
                }
                pkg.dependencies!.delete(name);
              }
            }
          }
        }
        pkg.lookupUsages.delete(dep.id);
      }
    }
  };

  if (finalDecisions.circularPackageNames.size > 0) {
    for (const depName of finalDecisions.circularPackageNames) {
      const dep = parentPkg.dependencies!.get(depName)!;
      const decision = finalDecisions.decisionMap.get(depName)!;
      if (decision.isHoistable === Hoistable.DEPENDS) {
        if (dep.newParent !== graphPath[decision.newParentIndex]) {
          if (options.showChanges) {
            console.log(`unexpected decision to hoist ${dep.id} at ${printGraphPath(graphPath)}`, decision);
          }
          hoistDependency(dep, depName, decision.newParentIndex);
          wasGraphChanged = true;
        }
      }
    }

    if (options.check === CheckType.THOROUGH) {
      const log = checkContracts(graphPath[0]);
      if (log) {
        console.log(
          `Contracts violated after hoisting ${Array.from(finalDecisions.circularPackageNames)} from ${printGraphPath(
            graphPath
          )}\n${log}${print(graphPath[0])}`
        );
      }
    }
  }

  for (const depName of finalDecisions.decisionMap.keys()) {
    const dep = parentPkg.dependencies!.get(depName)!;
    const decision = finalDecisions.decisionMap.get(depName)!;
    if (decision.isHoistable === Hoistable.YES && decision.newParentIndex !== graphPath.length - 1) {
      if (dep.newParent !== graphPath[decision.newParentIndex]) {
        if (options.showChanges) {
          console.log(
            `unexpected decision to hoist ${dep.id} at ${printGraphPath(graphPath)}${
              parentPkg.newParent ? ' previously hoisted' : ''
            }`,
            decision,
            'previous:',
            parentPkg.lastDecisions.get(depName)
          );
        }
        hoistDependency(dep, depName, decision.newParentIndex);
        wasGraphChanged = true;

        if (options.check === CheckType.THOROUGH) {
          const log = checkContracts(graphPath[0]);
          if (log) {
            throw new Error(
              `Contracts violated after hoisting ${depName} from ${printGraphPath(graphPath)}\n${log}${print(
                graphPath[0]
              )}`
            );
          }
        }
      }
    } else if (decision.isHoistable === Hoistable.LATER) {
      if (options.trace) {
        console.log(
          'queue',
          graphPath
            .map((x) => x.id)
            .concat([dep.id])
            .join('/'),
          'to index:',
          decision.queueIndex,
          'current index:',
          queueIndex
        );
      }
      dep.queueIndex = decision.queueIndex;

      hoistingQueue![decision.queueIndex].push({
        graphPath: graphPath.slice(0),
        depName,
      });
    } else {
      if (options.explain && decision.reason) {
        dep.reason = decision.reason;
      }
      delete dep.queueIndex;
    }
    parentPkg.lastDecisions.set(depName, decision);
  }

  return wasGraphChanged;
};

const hoistGraph = (graph: WorkGraph, options: HoistingOptions): boolean => {
  let wasGraphChanged = false;

  if (options.check) {
    const log = checkContracts(graph);
    if (log) {
      throw new Error(`Contracts violated on initial graph:\n${log}`);
    }
  }

  const usages = getUsages(graph);
  const children = getChildren(graph);
  const priorities = getPriorities(usages, children);

  let maxQueueIndex = 0;
  for (const priorityIds of priorities.values()) {
    maxQueueIndex = Math.max(maxQueueIndex, priorityIds.length);
  }
  const hoistingQueue: HoistingQueue = [];
  for (let idx = 0; idx < maxQueueIndex; idx++) {
    hoistingQueue.push([]);
  }
  let queueIndex = 0;

  const workspaceNodes = getWorkspaceNodes(graph);
  let workspaceUsageRoutes: WorkspaceUsageRoutes = new Map();
  if (options.preserveSymlinksSafe) {
    workspaceUsageRoutes = getAlternativeWorkspaceRoutes(graph, new Set(workspaceNodes.keys()));
    if (options.trace && workspaceUsageRoutes.size > 0) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      console.log('alternative workspace usage routes', require('util').inspect(workspaceUsageRoutes, false, null));
    }
  }

  const visitParent = (graphPath: WorkGraph[], lastWorkspaceIndex: number) => {
    const node = graphPath[graphPath.length - 1];

    if (node.dependencies) {
      for (const [depName, dep] of node.dependencies) {
        if (!dep.originalParent && dep !== graph) {
          const newDep = cloneNode(dep);
          newDep.originalParent = node;
          node.dependencies!.set(depName, newDep);
        }
      }
    }

    if (node.workspaces) {
      for (const workspaceDep of node.workspaces.values()) {
        workspaceDep.originalParent = node;
      }
    }

    if (graphPath.length > 1 && node.dependencies) {
      const dependencies = new Set<PackageName>();
      for (const [depName, dep] of node.dependencies) {
        if (!dep.newParent || dep.newParent === node) {
          dependencies.add(depName);
        }
      }

      if (dependencies.size > 0) {
        if (
          hoistDependencies(
            graphPath,
            queueIndex,
            dependencies,
            options,
            hoistingQueue,
            lastWorkspaceIndex,
            workspaceUsageRoutes
          )
        ) {
          wasGraphChanged = true;
        }
      }
    }

    if (graphPath.indexOf(node) === graphPath.length - 1) {
      if (node.workspaces) {
        for (const depWorkspace of node.workspaces.values()) {
          const depPriorities = getPriorities(usages, getChildren(depWorkspace));
          if (depPriorities.size > 0) {
            graphPath.push(depWorkspace);
            visitParent(graphPath, lastWorkspaceIndex + 1);
            graphPath.pop();
          }
        }
      }

      if (node.dependencies) {
        for (const [, dep] of node.dependencies) {
          if (dep.id !== node.id && !dep.workspace && (!dep.newParent || dep.newParent === node)) {
            const depPriorities = dep.hoistingPriorities;
            if (depPriorities.size > 0) {
              graphPath.push(dep);
              visitParent(graphPath, lastWorkspaceIndex);
              graphPath.pop();
            }
          }
        }
      }
    }
  };

  visitParent([graph], 0);

  for (queueIndex = 1; queueIndex < maxQueueIndex; queueIndex++) {
    while (hoistingQueue[queueIndex].length > 0) {
      const queueElement = hoistingQueue[queueIndex].shift()!;
      const graphPath: WorkGraph[] = [];
      let node: WorkGraph | undefined = queueElement.graphPath[queueElement.graphPath.length - 1];
      do {
        graphPath.unshift(node);
        node = node.newParent || node.originalParent;
      } while (node);

      let lastWorkspaceIndex = 0;
      for (let idx = graphPath.length - 1; idx >= 0; idx--) {
        const node = graphPath[idx];
        const realId = fromAliasedId(node.id).id;
        if (workspaceNodes.has(realId)) {
          lastWorkspaceIndex = idx;
          break;
        }
      }

      if (
        hoistDependencies(
          graphPath,
          queueIndex,
          new Set([queueElement.depName]),
          options,
          hoistingQueue,
          lastWorkspaceIndex,
          workspaceUsageRoutes
        )
      ) {
        wasGraphChanged = true;
      }
    }
  }

  if (options.check === CheckType.FINAL) {
    const log = checkContracts(graph);
    if (log) {
      throw new Error(`Contracts violated after hoisting finished:\n${log}`);
    }
  }

  return wasGraphChanged;
};

const cloneWorkGraph = (graph: WorkGraph): WorkGraph => {
  const clonedNodes = new Map<WorkGraph, WorkGraph>();

  const cloneDependency = (node: WorkGraph) => {
    if (node.workspace) return node;

    let clonedNode = clonedNodes.get(node);

    if (!clonedNode) {
      clonedNode = Object.assign({}, node);

      delete clonedNode.queueIndex;
      clonedNodes.set(node, clonedNode);

      if (node.dependencies) {
        for (const dep of node.dependencies.values()) {
          cloneDependency(dep);
        }
      }
    }

    return clonedNode;
  };

  const getClonedNode = (originalNode: WorkGraph): WorkGraph => {
    const clonedNode = clonedNodes.get(originalNode);
    if (!clonedNode) {
      throw new Error('Clone error');
    }
    return clonedNode;
  };

  const clonedGraph = cloneDependency(graph);

  for (const node of clonedNodes.values()) {
    if (node.originalParent) {
      node.originalParent = cloneDependency(node.originalParent);
    }

    if (node.newParent) {
      node.newParent = cloneDependency(node.newParent);
    }

    if (node.dependencies) {
      const newDependencies = new Map();
      for (const [depName, dep] of node.dependencies) {
        newDependencies.set(depName, getClonedNode(dep));
      }
      node.dependencies = newDependencies;
    }

    if (node.workspaces) {
      const newWorkspaces = new Map();
      for (const [depName, dep] of node.workspaces) {
        newWorkspaces.set(depName, getClonedNode(dep));
      }
      node.workspaces = newWorkspaces;
    }

    if (node.lookupUsages) {
      node.lookupUsages = new Map(node.lookupUsages);
    }

    if (node.lookupDependants) {
      const newLookupDependants = new Map();
      for (const [depName, usedBySet] of node.lookupDependants) {
        newLookupDependants.set(depName, new Set(usedBySet));
      }
      node.lookupDependants = newLookupDependants;
    }
  }

  return clonedGraph;
};

export const hoist = (pkg: Graph, opts?: HoistingOptions): Graph => {
  let graph = toWorkGraph(pkg);
  const options = opts || { trace: false };

  populateImplicitPeers(graph);

  let wasGraphChanged = true;
  do {
    wasGraphChanged = hoistGraph(graph, options);
    if (wasGraphChanged) graph = cloneWorkGraph(graph);
  } while (wasGraphChanged);

  if (options.check) {
    if (options.trace) {
      console.log('second pass');
    }

    const secondGraph = cloneWorkGraph(graph);
    let wasGraphChanged = false;
    try {
      wasGraphChanged = hoistGraph(secondGraph, { ...options, showChanges: true });
    } catch (e: any) {
      e.message = `While checking for terminal result: ${e.message}`;
      throw e;
    }
    if (wasGraphChanged) {
      throw new Error(`Hoister produced non-terminal result`);
    }
  }

  if (options.trace || options.dump) {
    console.log(`final hoisted graph:\n${print(graph)}`);
  }

  return fromWorkGraph(graph);
};

const getOriginalGrapPath = (node: WorkGraph): WorkGraph[] => {
  const graphPath: WorkGraph[] = [];

  let pkg: WorkGraph | undefined = node;
  do {
    if (pkg) {
      graphPath.unshift(pkg);
      pkg = pkg.originalParent;
    }
  } while (pkg);

  return graphPath;
};

const getLatestGrapPath = (node: WorkGraph): WorkGraph[] => {
  const graphPath: WorkGraph[] = [];

  let pkg: WorkGraph | undefined = node;
  do {
    if (pkg) {
      graphPath.unshift(pkg);
      pkg = pkg.newParent || pkg.originalParent;
    }
  } while (pkg);

  return graphPath;
};

export const printGraphPath = (graphPath: WorkGraph[]): string => graphPath.map((x) => x.id).join('/');

const checkContracts = (graph: WorkGraph): string => {
  const seen = new Set();
  const checkParent = (graphPath: WorkGraph[]): string => {
    const node = graphPath[graphPath.length - 1];
    const isSeen = seen.has(node);
    seen.add(node);

    let log = '';

    const originalDependencies = node?.originalParent?.dependencies?.get(getPackageName(node.id))?.dependencies;
    if (originalDependencies) {
      for (const [depName, originalDep] of originalDependencies) {
        let actualDep;
        for (let idx = graphPath.length - 1; idx >= 0; idx--) {
          actualDep = graphPath[idx]?.dependencies?.get(depName);
          if (actualDep) {
            break;
          }
        }

        if (actualDep?.id !== originalDep.id) {
          log += `Expected ${originalDep.id} for ${printGraphPath(graphPath.slice(0, -1))}, but found: ${printGraphPath(
            getLatestGrapPath(actualDep)
          )}`;
          if (actualDep?.newParent) {
            log += ` previously hoisted from ${printGraphPath(getOriginalGrapPath(actualDep))}`;
          }
          log += `\n`;
        }
      }
    }

    if (node.peerNames) {
      const originalGraphPath = getOriginalGrapPath(node);
      for (const peerName of node.peerNames.keys()) {
        let originalPeerDep;
        for (let idx = originalGraphPath.length - 2; idx >= 0; idx--) {
          const nodeDep = originalGraphPath[idx].dependencies?.get(peerName);
          if (nodeDep?.originalParent == originalGraphPath[idx]) {
            originalPeerDep = nodeDep;
            break;
          }
        }

        if (originalPeerDep) {
          let actualPeerDep;
          for (let idx = graphPath.length - 1; idx >= 0; idx--) {
            const nodeDep = graphPath[idx].dependencies?.get(peerName);
            if (nodeDep && (nodeDep.newParent || nodeDep.originalParent) == graphPath[idx]) {
              actualPeerDep = nodeDep;
              break;
            }
          }

          let parentPeerDep;
          for (let idx = graphPath.length - 2; idx >= 0; idx--) {
            const nodeDep = graphPath[idx].dependencies?.get(peerName);
            if (nodeDep && (nodeDep.newParent || nodeDep.originalParent) == graphPath[idx]) {
              parentPeerDep = nodeDep;
              break;
            }
          }

          if (actualPeerDep.id !== originalPeerDep.id) {
            // log += `Expected peer dependency ${originalPeerDep.id} for ${printGraphPath(graphPath)}, but found: ${actualPeerDep?.id || 'none'
            //   } at ${printGraphPath(getLatestGrapPath(actualPeerDep))}`;
            // if (actualPeerDep?.newParent) {
            //   log += ` previously hoisted from ${printGraphPath(getOriginalGrapPath(actualPeerDep))}`;
            // }
            // log += `\n`;
          } else if (actualPeerDep !== parentPeerDep) {
            log += `Expected peer dependency ${printGraphPath(getLatestGrapPath(actualPeerDep))}`;
            if (actualPeerDep?.newParent) {
              log += ` previously hoisted from ${printGraphPath(getOriginalGrapPath(actualPeerDep))}`;
            }
            log += ` for ${printGraphPath(
              graphPath
            )} to be shared with parent, but parent uses peer dependency from ${printGraphPath(
              getLatestGrapPath(parentPeerDep)
            )} instead\n`;
          }
        }
      }
    }

    if (!isSeen) {
      if (node.workspaces) {
        for (const dep of node.workspaces.values()) {
          graphPath.push(dep);
          log += checkParent(graphPath);
          graphPath.pop();
        }
      }

      if (node.dependencies) {
        for (const dep of node.dependencies.values()) {
          if ((dep.newParent || dep.originalParent) === node) {
            graphPath.push(dep);
            log += checkParent(graphPath);
            graphPath.pop();
          }
        }
      }
    }

    return log;
  };

  return checkParent([graph]);
};

const print = (graph: WorkGraph): string => {
  const printDependency = (
    graphPath: WorkGraph[],
    { prefix, depPrefix }: { prefix: string; depPrefix: string }
  ): string => {
    const node = graphPath[graphPath.length - 1];
    let str = depPrefix;
    if (node.workspace === node) {
      str += 'workspace:';
    } else if (node.packageType === PackageType.PORTAL) {
      str += 'portal:';
    }

    str += node.id;
    if (node.wall) {
      str += '|';
      if (node.wall.size > 0) {
        str += Array.from(node.wall);
      }
    }
    if (node.queueIndex) {
      str += ` queue: ${node.queueIndex}`;
    }
    if (node.reason) {
      str += ` - ${node.reason}`;
    }
    str += '\n';

    if (graphPath.indexOf(node) !== graphPath.length - 1) {
      return str;
    }

    const deps: WorkGraph[] = [];
    if (node.workspaces) {
      for (const dep of node.workspaces.values()) {
        deps.push(dep);
      }
    }

    if (node.dependencies) {
      for (const dep of node.dependencies.values()) {
        if (!dep.newParent || dep.newParent === node) {
          deps.push(dep);
        }
      }
    }
    deps.sort((d1, d2) => (d2.id < d1.id ? 1 : -1));

    for (let idx = 0; idx < deps.length; idx++) {
      const dep = deps[idx];
      graphPath.push(dep);
      const hasMoreDependencies = idx < deps.length - 1;
      str += printDependency(graphPath, {
        depPrefix: prefix + (hasMoreDependencies ? `├─` : `└─`),
        prefix: prefix + (hasMoreDependencies ? `│ ` : `  `),
      });
      graphPath.pop();
    }

    return str;
  };

  return printDependency([graph], { prefix: '  ', depPrefix: '' }).trim();
};
