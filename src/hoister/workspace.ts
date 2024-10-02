import { PackageId, WorkGraph, fromAliasedId, GraphRoute } from './hoist';

export type WorkspaceUsageRoutes = Map<PackageId, Set<GraphRoute>>;

export const getWorkspaceNodes = (graph: WorkGraph): Map<PackageId, WorkGraph> => {
  const workspaceNodes = new Map<PackageId, WorkGraph>();
  const visitWorkspace = (workspace: WorkGraph) => {
    workspaceNodes.set(workspace.id, workspace);
    if (workspace.workspaces) {
      for (const dep of workspace.workspaces.values()) {
        visitWorkspace(dep);
      }
    }
  };
  visitWorkspace(graph);

  return workspaceNodes;
};

export const getAlternativeWorkspaceRoutes = (graph: WorkGraph, packageIds: Set<PackageId>): WorkspaceUsageRoutes => {
  const usages = new Map();
  const seen = new Set();

  const visitDependency = (graphRoute: GraphRoute, node: WorkGraph) => {
    const isSeen = seen.has(node);
    seen.add(node);

    const realId = fromAliasedId(node.id).id;
    if (packageIds.has(realId) && graphRoute.length > 0 && !graphRoute[graphRoute.length - 1].isWorkspaceDep) {
      let workspaceRoutes = usages.get(realId);
      if (!workspaceRoutes) {
        workspaceRoutes = new Set();
        usages.set(realId, workspaceRoutes);
      }
      workspaceRoutes.add(graphRoute.slice(0));
    }

    if (!isSeen) {
      if (node.workspaces) {
        for (const [name, dep] of node.workspaces) {
          graphRoute.push({ isWorkspaceDep: true, name });
          visitDependency(graphRoute, dep);
          graphRoute.pop();
        }
      }

      if (node.dependencies) {
        for (const [name, dep] of node.dependencies) {
          graphRoute.push({ isWorkspaceDep: false, name });
          visitDependency(graphRoute, dep);
          graphRoute.pop();
        }
      }
    }
  };

  visitDependency([], graph);

  return usages;
};
