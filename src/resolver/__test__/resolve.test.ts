import { PackageMetadata, ResolveEventType, ResolveResult, resolveScript } from "../resolveScript";
import { PurePackage } from "../workspace";
import { Graph } from "../../hoister";

describe('resolve script', () => {
  it('should resolve empty project', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.'
    };

    const steps = resolveScript(tree);

    expect(steps.next()).toEqual({
      value: {
        graph: { id: 'workspace:.@0.0.0', workspacePath: '.' }
      },
      done: true
    });
  });

  it('should resolve empty multi-workspace project', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
      workspaces: [{
        json: {},
        workspacePath: 'w1',
        workspaces: [{
          json: {},
          workspacePath: 'w1/w2'
        }],
      }]
    };

    const steps = resolveScript(tree);

    expect(steps.next()).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          workspaces: [{
            id: 'workspace:w1@0.0.0', workspacePath: 'w1',
            workspaces: [{
              id: 'workspace:w1/w2@0.0.0', workspacePath: 'w1/w2',
            }]
          }]
        },
      },
      done: true
    });
  });

  it('should resolve project with a couple of dependencies', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
          bar: '^1.0.0'
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree);

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'bar' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value).toEqual({ type: ResolveEventType.NEXT_METADATA })
    expect(gen.next({ name: 'bar', metadata: { versions: { '1.0.2': {} }, time: { '1.0.2': time } } } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.1' },
            { id: 'bar@1.0.2' },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.1']]) }],
            ['bar', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.2']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should resolve transitive dependencies', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0'
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree);

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'foo', metadata: {
        versions: {
          '1.0.1': {
            dependencies: {
              bar: '^1.0.3'
            }
          }
        }, time: { '1.0.1': time }
      }
    } as PackageMetadata).value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'bar' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'bar', metadata: {
        versions: {
          '1.0.5': {}
        }, time: { '1.0.5': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.1', dependencies: [{ id: 'bar@1.0.5' }] },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.1']]) }],
            ['bar', { meta: expect.any(Object), ranges: new Map([['^1.0.3', '1.0.5']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  })

  it('should fill bin entries and build scripts', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0'
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree);

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'foo', metadata: {
        versions: {
          '1.0.1': {
            bin: {
              one: './one.js',
              two: './two.js',
            },
            scripts: {
              test: '1',
              postinstall: '2',
              preinstall: '3'
            }
          }
        }, time: { '1.0.1': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.1', bin: { one: './one.js', two: './two.js' }, buildScripts: { preinstall: '3', postinstall: '2' } },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.1']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should fill peer dependencies and skip optional peer dependencies', () => {
    const tree: PurePackage = {
      json: {
        peerDependencies: {
          foo: '^1.0.0',
          bar: '^1.0.0'
        },
        peerDependenciesMeta: {
          bar: {
            optional: true
          }
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree);

    expect(gen.next({
      name: 'foo', metadata: {
        versions: {
          '1.0.1': {}
        }, time: { '1.0.1': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          peerNames: ['foo'],
        } as Graph,
      },
      done: true
    });
  });

  it('should autoinstall missing peer dependencies if requested', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0'
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree, { autoInstallPeers: true });

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'foo', metadata: {
        versions: {
          '1.0.0': {
            dependencies: {
              bar: '1.0.0',
              availablePeer: '1.0.0'
            }
          }
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata).value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'bar' });
    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'availablePeer' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'bar', metadata: {
        versions: {
          '1.0.0': {
            peerDependencies: {
              autoinstalledPeer: '1.0.0',
              optionalPeer: '1.0.0',
              availablePeer: '1.0.0',
            },
            peerDependenciesMeta: {
              optionalPeer: {
                optional: true
              }
            }
          }
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata).value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'autoinstalledPeer' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'availablePeer', metadata: {
        versions: {
          '1.0.0': {}
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata).value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'autoinstalledPeer', metadata: {
        versions: {
          '1.0.0': {}
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            {
              id: 'foo@1.0.0', dependencies: [
                {
                  id: 'bar@1.0.0|autoinstalledPeer',
                  dependencies: [{ id: 'autoinstalledPeer@1.0.0' }],
                  peerNames: ['availablePeer']
                }, {
                  id: 'availablePeer@1.0.0'
                }
              ]
            }
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.0']]) }],
            ['bar', { meta: expect.any(Object), ranges: new Map([['1.0.0', '1.0.0']]) }],
            ['autoinstalledPeer', { meta: expect.any(Object), ranges: new Map([['1.0.0', '1.0.0']]) }],
            ['availablePeer', { meta: expect.any(Object), ranges: new Map([['1.0.0', '1.0.0']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should support resolutions', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          '@acme/foo': '^1.0.0'
        },
        resolutions: {
          '@acme/foo/@fume/bar': '^2.0.0'
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree);

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: '@acme/foo' });
    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: '@fume/bar' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: '@acme/foo', metadata: {
        versions: {
          '1.0.0': {
            dependencies: {
              '@fume/bar': '^1.0.0'
            }
          }
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata).value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: '@fume/bar', metadata: {
        versions: {
          '1.0.0': {},
          '2.0.0': {}
        }, time: { '1.0.0': time, '2.0.0': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: '@acme/foo@1.0.0#@fume/bar', dependencies: [{ id: '@fume/bar@2.0.0' }] },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['@acme/foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.0']]) }],
            ['@fume/bar', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.0'], ['^2.0.0', '2.0.0']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should remove incompatible packages', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0'
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree, { os: 'linux' });

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'foo', metadata: {
        versions: {
          '1.0.0': {
            dependencies: {
              bar: '^1.0.0'
            }
          }
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata).value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'bar' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'bar', metadata: {
        versions: {
          '1.0.0': {
            os: 'win32'
          }
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.0' },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.0']]) }],
            ['bar', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.0']]) }]
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should perform resolution optimization if requested', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
      workspaces: [{
        json: {
          dependencies: {
            foo: '^1.0.0'
          }
        },
        workspacePath: 'w1',
      }, {
        json: {
          dependencies: {
            foo: '1.0.2'
          }
        },
        workspacePath: 'w2'
      }]
    };

    const time = new Date().toString();
    const gen = resolveScript(tree, { resolutionOptimization: true });
    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'foo', metadata: {
        versions: {
          '1.0.0': {},
          '1.0.2': {},
          '1.0.5': {}
        }, time: { '1.0.0': time, '1.0.2': time, '1.0.5': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          workspaces: [
            { id: 'workspace:w1@0.0.0', workspacePath: 'w1', dependencies: [{ id: 'foo@1.0.2' }] },
            { id: 'workspace:w2@0.0.0', workspacePath: 'w2', dependencies: [{ id: 'foo@1.0.2' }] },
          ],
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.2'], ['1.0.2', '1.0.2']]) }]
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should evict unused dependencies after resolution optimization', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
      workspaces: [{
        json: {
          dependencies: {
            foo: '^1.0.0'
          }
        },
        workspacePath: 'w1',
      }, {
        json: {
          dependencies: {
            foo: '1.0.2'
          }
        },
        workspacePath: 'w2'
      }]
    };

    const time = new Date().toString();
    const gen = resolveScript(tree, { resolutionOptimization: true });
    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'foo', metadata: {
        versions: {
          '1.0.0': {},
          '1.0.2': {},
          '1.0.5': {
            dependencies: {
              baz: '^1.0.0'
            }
          }
        }, time: { '1.0.0': time, '1.0.2': time, '1.0.5': time }
      }
    } as PackageMetadata).value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'baz' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'baz', metadata: {
        versions: {
          '1.0.0': {
            dependencies: {
              qux: '^1.0.0'
            }
          }
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata).value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'qux' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({
      name: 'qux', metadata: {
        versions: {
          '1.0.0': {}
        }, time: { '1.0.0': time }
      }
    } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          workspaces: [
            { id: 'workspace:w1@0.0.0', workspacePath: 'w1', dependencies: [{ id: 'foo@1.0.2' }] },
            { id: 'workspace:w2@0.0.0', workspacePath: 'w2', dependencies: [{ id: 'foo@1.0.2' }] },
          ],
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['1.0.2', '1.0.2'], ['^1.0.0', '1.0.2']]) }]
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should resolve dependencies on workspaces', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
      workspaces: [{
        json: {
          name: 'w1',
          version: '1.0.0',
          dependencies: {
            w2: '^1.0.0'
          }
        },
        workspacePath: 'w1',
      }, {
        json: {
          name: 'w2',
          version: '1.0.0'
        },
        workspacePath: 'w2'
      }]
    };

    const gen = resolveScript(tree);
    expect(gen.next()).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          workspaces: [
            { id: 'w1@1.0.0', workspacePath: 'w1', dependencies: [{ id: 'w2@1.0.0' }] },
            { id: 'w2@1.0.0', workspacePath: 'w2' },
          ],
        } as Graph,
      },
      done: true
    });
  });

  it('should utilize previous state for version resolution', () => {
    const tree1: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen1 = resolveScript(tree1);

    expect(gen1.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen1.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    const result = gen1.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value as ResolveResult;

    const tree2: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
          bar: '^1.0.0',
        },
        lockTime: result.state?.lockTime
      },
      workspacePath: '.'
    };

    const gen2 = resolveScript(tree2, {}, result.state);

    expect(gen2.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'bar' });
    expect(gen2.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen2.next({ name: 'bar', metadata: { versions: { '1.0.2': {} }, time: { '1.0.2': time } } } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.1' },
            { id: 'bar@1.0.2' }
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.1']]) }],
            ['bar', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.2']]) }]
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should request fresh metadata for ranges after lockTime', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
          bar: '^1.0.0'
        }
      },
      workspacePath: '.'
    };

    const date = new Date();
    const time = date.toString();
    const recentTime = new Date(date.getTime() + 1000).toString();
    const gen = resolveScript(tree);

    expect(gen.next().value).toEqual({ type: ResolveEventType.GET_METADATA, name: 'foo', lockTime: expect.any(Date) });
    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'bar' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value).toEqual({ type: ResolveEventType.NEXT_METADATA })
    expect(gen.next({ name: 'bar', metadata: { versions: { '1.0.2': { dependencies: { foo: '1.0.2' } } }, time: { '1.0.2': time } } } as PackageMetadata).value).toEqual({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', fresh: true, metadata: { versions: { '1.0.1': {}, '1.0.2': {}, '1.0.0': {} }, time: { '1.0.1': time, '1.0.2': recentTime, '1.0.0': recentTime } } } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.1' },
            { id: 'bar@1.0.2', dependencies: [{ id: 'foo@1.0.2' }] },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.1'], ['1.0.2', '1.0.2']]) }],
            ['bar', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.2']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should mark optional dependencies', () => {
    const tree: PurePackage = {
      json: {
        optionalDependencies: {
          foo: '^1.0.0',
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree);

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.0': { scripts: { postinstall: '1' } } }, time: { '1.0.0': time } } } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.0', buildScripts: { postinstall: '1' }, optional: true },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.0']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should unmark optional dependencies, if they are not optional somewhere else', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
        },
        optionalDependencies: {
          bar: '^1.0.0',
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree);

    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toMatchObject({ type: ResolveEventType.GET_METADATA, name: 'bar' });
    expect(gen.next().value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.0': { dependencies: { bar: '^1.0.0' } } }, time: { '1.0.0': time } } } as PackageMetadata).value).toEqual({ type: ResolveEventType.NEXT_METADATA });
    expect(gen.next({ name: 'bar', metadata: { versions: { '1.0.0': { scripts: { postinstall: '1' } } }, time: { '1.0.0': time } } } as PackageMetadata)).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.0', dependencies: [{ id: 'bar@1.0.0', buildScripts: { postinstall: '1' } }] },
            { id: 'bar@1.0.0', buildScripts: { postinstall: '1' } }
          ]
        } as Graph,
        state: {
          resolutions: expect.any(Object),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });
  });

  it('should reuse received metadata from options', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
        }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = resolveScript(tree, { receivedMetadata: new Map([['foo', { versions: { '1.0.0': { scripts: { postinstall: '1' } } }, time: { '1.0.0': time } }]]) });

    expect(gen.next()).toEqual({
      value: {
        graph: {
          id: 'workspace:.@0.0.0', workspacePath: '.',
          dependencies: [
            { id: 'foo@1.0.0', buildScripts: { postinstall: '1' } },
          ]
        } as Graph,
        state: {
          resolutions: new Map([
            ['foo', { meta: expect.any(Object), ranges: new Map([['^1.0.0', '1.0.0']]) }],
          ]),
          lockTime: expect.any(Date)
        }
      },
      done: true
    });

  });
});