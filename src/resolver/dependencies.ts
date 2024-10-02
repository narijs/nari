export type Dependencies = { regular: Map<string, string>, peer: Map<string, string>, optionalNames: Set<string>, optionalPeerNames: Set<string> };

// eslint-disable-next-line no-redeclare
export const Dependencies = {
  EMPTY: { regular: new Map(), peer: new Map(), optionalNames: new Set(), optionalPeerNames: new Set() } as Dependencies
}

export const getDependencies = (packageJson: any, includeDev?: boolean): Dependencies => {
  const regular = new Map();
  const peer = new Map();
  const optionalPeerNames = new Set<string>();
  const optionalNames = new Set<string>();

  for (const [name, range] of Object.entries<string>(packageJson.dependencies || {})) {
    regular.set(name, range);
  }

  for (const [name, range] of Object.entries<string>(packageJson.optionalDependencies || {})) {
    optionalNames.add(name);
    regular.set(name, range);
  }

  if (includeDev) {
    for (const [name, range] of Object.entries<string>(packageJson.devDependencies || {})) {
      regular.set(name, range);
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

  return { regular, peer, optionalPeerNames, optionalNames };
}

