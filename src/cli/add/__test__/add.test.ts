import { PurePackage } from '../../../resolver/workspace';
import { AddEventType, addScript, PackageMetadata } from '../addScript';

describe('add script', () => {
  it('should support adding a dependency to an empty project', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
    };

    const timeNow = new Date();
    const time = timeNow.toString();
    const gen = addScript(tree, ['foo'], { timeNow });

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime: timeNow });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata)
        .value,
    ).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { foo: '^1.0.1' },
        lockTime: timeNow.toISOString(),
      },
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should support adding multiple dependencies to an empty project', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
    };

    const timeNow = new Date();
    const time = timeNow.toString();
    const gen = addScript(tree, ['foo', '@scope/bar'], { timeNow });

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime: timeNow });
    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: '@scope/bar', lockTime: timeNow });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata)
        .value,
    ).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({
        name: '@scope/bar',
        metadata: { versions: { '2.0.1': {} }, time: { '2.0.1': time } },
      } as PackageMetadata).value,
    ).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { foo: '^1.0.1', '@scope/bar': '^2.0.1' },
        lockTime: timeNow.toISOString(),
      },
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should detect if the project need not be modified when the dependency is of the latest version', () => {
    const lockTime = new Date();
    const tree: PurePackage = {
      json: {
        dependencies: { foo: '^1.0.1' },
        lockTime: lockTime.toISOString(),
      },
      workspacePath: '.',
    };

    const time = lockTime;
    const gen = addScript(tree, ['foo']);

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata),
    ).toEqual({ done: true });
  });

  it('should support basic options', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
    };

    const timeNow = new Date();
    const time = timeNow.toString();
    const gen = addScript(tree, ['foo'], { optional: true, tilde: true, timeNow });

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime: timeNow });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata)
        .value,
    ).toEqual({
      type: AddEventType.MODIFY,
      json: {
        optionalDependencies: { foo: '~1.0.1' },
        lockTime: timeNow.toISOString(),
      },
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should left specified range intact', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
    };

    const timeNow = new Date();
    const time = timeNow.toString();
    const gen = addScript(tree, ['foo@^1.0.0'], { timeNow });

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime: timeNow });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata)
        .value,
    ).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { foo: '^1.0.0' },
        lockTime: timeNow.toISOString(),
      },
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should support aliases', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.',
    };

    const timeNow = new Date();
    const time = timeNow.toString();
    const gen = addScript(tree, ['fp@npm:foo'], { timeNow });

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime: timeNow });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata)
        .value,
    ).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { fp: 'npm:foo:^1.0.1' },
        lockTime: timeNow.toISOString(),
      },
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should replace existing range in devDependencies', () => {
    const tree: PurePackage = {
      json: { devDependencies: { foo: '0.1.0' } },
      workspacePath: '.',
    };

    const timeNow = new Date();
    const time = timeNow.toString();
    const gen = addScript(tree, ['foo@^1.0.0']);

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime: timeNow });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({
        name: 'foo',
        metadata: { versions: { '0.1.0': {}, '1.0.1': {} }, time: { '0.1.0': time, '1.0.1': time } },
      } as PackageMetadata).value,
    ).toEqual({
      type: AddEventType.MODIFY,
      json: {
        devDependencies: { foo: '^1.0.0' },
        lockTime: timeNow.toISOString(),
      },
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should prefer version before lockTime to the highest version available', () => {
    const lockTime = new Date('2010-01-01');
    const tree: PurePackage = {
      json: { lockTime },
      workspacePath: '.',
    };

    const time = new Date('2010-01-02');
    const gen = addScript(tree, ['foo']);
    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo', lockTime });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(
      gen.next({
        name: 'foo',
        metadata: { versions: { '0.1.0': {}, '1.0.1': {} }, time: { '0.1.0': lockTime, '1.0.1': time } },
      } as PackageMetadata).value,
    ).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { foo: '^0.1.0' },
        lockTime,
      },
    });
  });
});
