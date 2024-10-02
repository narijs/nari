import { Graph, hoist } from '../../hoister';
import { fromSimpleGraph } from '../../hoister/__test__/util';
import { DirEntryType, InstallEventType, installScript, InstallState, setBuildFailures } from '../index';

const getInstallState = (graph: Graph): InstallState => {
  let gen = installScript(graph);

  let step;
  do {
    step = gen.next();
  } while (!step.done);

  return step.value;
};

describe('install script', () => {
  it('should run promises in dependency order', () => {
    const graph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'C',
          buildScripts: { postinstall: 'C' },
          dependencies: [
            {
              id: 'B',
              buildScripts: { postinstall: 'B' },
              dependencies: [{ id: 'A' }],
            },
          ],
        },
        { id: 'D' },
      ],
      buildScripts: { postinstall: '.' },
      workspacePath: '.',
    };

    const installGraph = hoist(fromSimpleGraph(graph));

    const gen = installScript(installGraph);
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/A', id: 'A' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/B', id: 'B' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.BUILD,
      waitPaths: ['node_modules/A', 'node_modules/B'],
      targetPath: 'node_modules/B',
      buildScripts: new Map([['postinstall', 'B']]),
      id: 'B',
    });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/C', id: 'C' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.BUILD,
      waitPaths: ['node_modules/A', 'node_modules/B', 'node_modules/C'],
      targetPath: 'node_modules/C',
      buildScripts: new Map([['postinstall', 'C']]),
      id: 'C',
    });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/D', id: 'D' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.BUILD,
      waitPaths: ['node_modules/A', 'node_modules/B', 'node_modules/C', 'node_modules/D'],
      targetPath: '.',
      isWorkspace: true,
      buildScripts: new Map([['postinstall', '.']]),
      id: '.',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should clean up workspaces without dependencies', () => {
    const graph: Graph = {
      id: '.',
      workspacePath: '.',
      workspaces: [
        {
          id: 'w1',
          workspacePath: 'w1',
          workspaces: [
            {
              id: 'w2',
              workspacePath: 'w1/w2',
            },
          ],
        },
      ],
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph);

    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.DELETE, targetPath: 'w1/node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.DELETE, targetPath: 'w1/w2/node_modules' });
    expect(gen.next()).toEqual({ done: true, value: undefined });
  });

  it('should not install existing dependencies', () => {
    const graph: Graph = {
      id: '.',
      dependencies: [{ id: 'A' }, { id: 'B' }],
      workspacePath: '.',
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph, getInstallState(installGraph));

    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next([{ name: 'A', type: DirEntryType.DIRECTORY }]).value).toEqual({
      type: InstallEventType.INSTALL,
      targetPath: 'node_modules/B',
      id: 'B',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should clone duplicated dependencies', () => {
    const graph: Graph = {
      id: '.',
      dependencies: [
        { id: 'A', wall: ['D'], dependencies: [{ id: 'D' }] },
        { id: 'B', wall: ['D'], dependencies: [{ id: 'D' }] },
      ],
      workspacePath: '.',
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph);
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/A', id: 'A' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/B', id: 'B' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.INSTALL,
      targetPath: 'node_modules/A/node_modules/D',
      id: 'D',
    });
    expect(gen.next().value).toEqual({
      type: InstallEventType.CLONE,
      targetPath: 'node_modules/B/node_modules/D',
      sourcePath: 'node_modules/A/node_modules/D',
      id: 'D',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should install absent bin entries', () => {
    // If package A was previously installed, but bin entry `bar` is not a symlink, only bin entry `bar` must be reinstalled
    const graph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'A',
          bin: {
            foo: 'foo.js',
            bar: 'bar.js',
          },
        },
      ],
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph, getInstallState(installGraph));
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(
      gen.next([
        { name: '.bin', type: DirEntryType.DIRECTORY },
        { name: 'A', type: DirEntryType.DIRECTORY },
      ]).value,
    ).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules/.bin' });
    expect(
      gen.next([
        { name: 'foo', type: DirEntryType.SYMLINK },
        { name: 'bar', type: DirEntryType.FILE },
      ]).value,
    ).toEqual({ type: InstallEventType.DELETE, targetPath: 'node_modules/.bin/bar' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.INSTALL,
      skipUnpack: true,
      targetPath: 'node_modules/A',
      binPath: 'node_modules/.bin',
      bin: { bar: 'bar.js' },
      id: 'A',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should clone aliased dependencies', () => {
    const graph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'A',
          alias: 'B',
        },
        {
          id: 'A',
        },
      ],
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph);
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/A', id: 'A' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.CLONE,
      sourcePath: 'node_modules/A',
      targetPath: 'node_modules/B',
      id: 'A',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should not readdir common scope directory twice', () => {
    const graph: Graph = {
      id: '.',
      dependencies: [
        {
          id: '@scope/A',
        },
        {
          id: '@scope/B',
        },
      ],
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph, getInstallState(installGraph));
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next([{ name: '@scope', type: DirEntryType.DIRECTORY }]).value).toEqual({
      type: InstallEventType.READDIR,
      targetPath: 'node_modules/@scope',
    });
    expect(gen.next().value).toEqual({
      type: InstallEventType.INSTALL,
      targetPath: 'node_modules/@scope/A',
      id: '@scope/A',
    });
    expect(gen.next().value).toEqual({
      type: InstallEventType.INSTALL,
      targetPath: 'node_modules/@scope/B',
      id: '@scope/B',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should reinstall changed dependency', () => {
    const firstGraph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'C',
          wall: ['A', 'B'],
          dependencies: [{ id: 'A@X' }, { id: 'B' }],
        },
      ],
    };

    const firstState = getInstallState(hoist(fromSimpleGraph(firstGraph)));

    const secondGraph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'C',
          wall: ['A', 'B'],
          dependencies: [{ id: 'A@Y' }, { id: 'B' }],
        },
      ],
    };

    const installGraph = hoist(fromSimpleGraph(secondGraph));
    const gen = installScript(installGraph, firstState);

    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next([{ name: 'C', type: DirEntryType.DIRECTORY }]).value).toEqual({
      type: InstallEventType.READDIR,
      targetPath: 'node_modules/C/node_modules',
    });
    expect(
      gen.next([
        { name: 'A', type: DirEntryType.DIRECTORY },
        { name: 'B', type: DirEntryType.DIRECTORY },
      ]).value,
    ).toEqual({ type: InstallEventType.DELETE, targetPath: 'node_modules/C/node_modules/A' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.INSTALL,
      targetPath: 'node_modules/C/node_modules/A',
      id: 'A@Y',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should remove everything if there is no previous state', () => {
    const graph: Graph = {
      id: '.',
      workspacePath: '.',
      dependencies: [{ id: 'A@X' }, { id: 'B@X' }],
      workspaces: [
        {
          id: 'w1',
          workspacePath: 'w1',
          dependencies: [{ id: 'A@Y' }, { id: 'B@Y' }],
        },
      ],
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph);

    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/A', id: 'A@X' });
    expect(gen.next().value).toEqual({ type: InstallEventType.DELETE, targetPath: 'w1/node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'w1/node_modules/A', id: 'A@Y' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/B', id: 'B@X' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'w1/node_modules/B', id: 'B@Y' });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should only clean the dependency with children', () => {
    const firstGraph: Graph = {
      id: '.',
      workspacePath: '.',
      dependencies: [{ id: 'A@X', wall: ['B'], dependencies: [{ id: 'B' }] }],
    };

    const firstState = getInstallState(hoist(fromSimpleGraph(firstGraph)));

    const secondGraph: Graph = {
      id: '.',
      workspacePath: '.',
      dependencies: [{ id: 'A@Y', wall: ['B'], dependencies: [{ id: 'B' }] }],
    };

    const installGraph = hoist(fromSimpleGraph(secondGraph));
    const gen = installScript(installGraph, firstState);
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next([{ name: 'A', type: DirEntryType.DIRECTORY }]).value).toEqual({
      type: InstallEventType.DELETE,
      targetPath: 'node_modules/A',
      cleanOnly: true,
    });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/A', id: 'A@Y' });
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules/A/node_modules' });
    expect(gen.next([{ name: 'B', type: DirEntryType.DIRECTORY }])).toMatchObject({ done: true });
  });

  it('should continue from last build failure', () => {
    const graph: Graph = {
      id: '.',
      buildScripts: { preinstall: '1', install: '2', postinstall: '3' },
    };

    const firstState = getInstallState(hoist(fromSimpleGraph(graph)));
    setBuildFailures(firstState, new Map([['.', 'install']]));

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph, firstState);
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.BUILD,
      waitPaths: [],
      targetPath: '.',
      isWorkspace: true,
      buildScripts: new Map([
        ['install', '2'],
        ['postinstall', '3'],
      ]),
      id: '.',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should rebuild changed dependencies', () => {
    const firstGraph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'A',
          dependencies: [{ id: 'B@X' }],
          buildScripts: { postinstall: '1' },
        },
      ],
    };

    const firstState = getInstallState(hoist(fromSimpleGraph(firstGraph)));

    const secondGraph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'A',
          dependencies: [{ id: 'B@Y' }],
          buildScripts: { postinstall: '1' },
        },
      ],
    };

    const installGraph = hoist(fromSimpleGraph(secondGraph));
    const gen = installScript(installGraph, firstState);
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(
      gen.next([
        { name: 'A', type: DirEntryType.DIRECTORY },
        { name: 'B', type: DirEntryType.DIRECTORY },
      ]).value,
    ).toEqual({ type: InstallEventType.DELETE, targetPath: 'node_modules/B' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/B', id: 'B@Y' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.BUILD,
      waitPaths: ['node_modules/B'],
      targetPath: 'node_modules/A',
      buildScripts: new Map([['postinstall', '1']]),
      id: 'A',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });

  it('should ignore exit code for optional dependencies', () => {
    const graph: Graph = {
      id: '.',
      dependencies: [{ id: 'A', buildScripts: { postinstall: '1' }, optional: true }],
    };

    const installGraph = hoist(fromSimpleGraph(graph));
    const gen = installScript(installGraph);
    expect(gen.next().value).toEqual({ type: InstallEventType.READDIR, targetPath: 'node_modules' });
    expect(gen.next().value).toEqual({ type: InstallEventType.INSTALL, targetPath: 'node_modules/A', id: 'A' });
    expect(gen.next().value).toEqual({
      type: InstallEventType.BUILD,
      waitPaths: ['node_modules/A'],
      targetPath: 'node_modules/A',
      optional: true,
      buildScripts: new Map([['postinstall', '1']]),
      id: 'A',
    });
    expect(gen.next()).toMatchObject({ done: true });
  });
});
