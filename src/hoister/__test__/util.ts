import { Graph, HoistingOptions } from '../';
import { hoist as rawHoist } from '../';

export const hoist = (pkg: Graph, opts?: HoistingOptions) => {
  return toSimpleGraph(rawHoist(fromSimpleGraph(pkg), opts));
};

export const fromSimpleGraph = (graph: Graph) => {
  const getId = (node: Graph) => `${node.alias}>${node.id}`;

  const strictGraph: Graph = { ...graph, workspacePath: graph.workspacePath || '.' };
  const idMap = new Map<string, Graph>([[getId(graph), strictGraph]]);
  const seen = new Set<Graph>();

  const visitNode = (node: Graph) => {
    if (seen.has(node))
      return;
    seen.add(node);

    if (node.dependencies) {
      const dependencies: Graph[] = [];
      for (const dep of node.dependencies) {
        const depId = getId(dep);
        const depNode = idMap.get(depId) || { ...dep };
        dependencies.push(depNode);
        idMap.set(depId, depNode);
        visitNode(depNode);
      }
      node.dependencies = dependencies;
    }

    if (node.workspaces) {
      const workspaces: Graph[] = [];
      for (const dep of node.workspaces) {
        const depId = getId(dep);
        const depNode = idMap.get(depId) || { ...dep };
        workspaces.push(depNode);
        idMap.set(depId, depNode);
        visitNode(depNode);
      }
      node.workspaces = workspaces;
    }
  };

  visitNode(strictGraph);

  return strictGraph;
};

export const toSimpleGraph = (graph: Graph) => {
  if (!graph.workspace)
    throw new Error(`Illegal argument, expected ${graph.id} to be a strict graph`);

  const clonedNodes = new Map<Graph, Graph>();

  const cloneNode = (node: Graph): Graph => {
    let clone = clonedNodes.get(node);
    if (clone)
      return clone;

    clone = { ...node };
    clonedNodes.set(node, clone);

    delete clone.parent;
    delete clone.dependencies;
    delete clone.workspaces;
    delete clone.workspace;
    delete clone.workspacePath;

    if (node.dependencies) {
      const dependencies: Graph[] = [];
      for (const dep of node.dependencies) {
        if (dep.parent === node) {
          if (dep === node) {
            dependencies.push({ id: dep.id });
          } else {
            dependencies.push(cloneNode(dep));
          }
        }
      }

      if (dependencies.length > 0)
        clone.dependencies = dependencies;
    }

    if (node.workspaces) {
      clone.workspaces = [];
      for (const dep of node.workspaces) {
        clone.workspaces.push(cloneNode(dep));
      }
    }

    return clone;
  };

  const simpleGraph = cloneNode(graph);

  return simpleGraph;
};
