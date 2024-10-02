export type Dependencies = {
  regular: Map<string, string>;
  regularType: Map<string, DependencyType>;
  peer: Map<string, string>;
  optionalNames: Set<string>;
  optionalPeerNames: Set<string>;
};

export enum DependencyType {
  DEPENDENCIES = 'dependencies',
  DEV_DEPENDENCIES = 'devDependencies',
  PEER_DEPENDENCIES = 'peerDependencies',
  OPTIONAL_DEPENDENCIES = 'optionalDependencies',
}

// eslint-disable-next-line no-redeclare
export const Dependencies = {
  EMPTY: {
    regular: new Map(),
    regularType: new Map(),
    peer: new Map(),
    optionalNames: new Set(),
    optionalPeerNames: new Set(),
  } as Dependencies,
};

export const getDependencies = (packageJson: any, includeDev?: boolean): Dependencies => {
  const regular = new Map();
  const regularType = new Map();
  const peer = new Map();
  const optionalPeerNames = new Set<string>();
  const optionalNames = new Set<string>();

  for (const [name, range] of Object.entries<string>(packageJson.dependencies || {})) {
    regular.set(name, range);
    regularType.set(name, DependencyType.DEPENDENCIES);
  }

  for (const [name, range] of Object.entries<string>(packageJson.optionalDependencies || {})) {
    optionalNames.add(name);
    regular.set(name, range);
    regularType.set(name, DependencyType.OPTIONAL_DEPENDENCIES);
  }

  if (includeDev) {
    for (const [name, range] of Object.entries<string>(packageJson.devDependencies || {})) {
      regular.set(name, range);
      regularType.set(name, DependencyType.DEV_DEPENDENCIES);
    }
  }

  for (const [name, range] of Object.entries<string>(packageJson.peerDependencies || {})) {
    peer.set(name, range);
  }

  for (const [name, value] of Object.entries<any>(packageJson.peerDependenciesMeta || {})) {
    if (value.optional === true && peer.has(name)) {
      optionalPeerNames.add(name);
    }
  }

  return { regular, regularType, peer, optionalPeerNames, optionalNames };
};
