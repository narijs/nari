import { PurePackage } from "../../../resolver/workspace";
import { AddEventType, addScript, PackageMetadata } from "../addScript";

describe('add script', () => {
  it('should support adding a dependency to an empty project', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = addScript(tree, ['foo']);

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { foo: '^1.0.1' }
      }
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should support adding multiple dependencies to an empty project', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = addScript(tree, ['foo', '@scope/bar']);

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: '@scope/bar' });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(gen.next({ name: '@scope/bar', metadata: { versions: { '2.0.1': {} }, time: { '2.0.1': time } } } as PackageMetadata).value).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { foo: '^1.0.1', '@scope/bar': '^2.0.1' }
      }
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should detect if the project need not be modified when the dependency is of the latest version', () => {
    const tree: PurePackage = {
      json: {
        dependencies: { foo: '^1.0.1' }
      },
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = addScript(tree, ['foo']);

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata)).toEqual({ done: true });
  });

  it('should support basic options', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = addScript(tree, ['foo'], { optional: true, tilde: true });

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value).toEqual({
      type: AddEventType.MODIFY,
      json: {
        optionalDependencies: { foo: '~1.0.1' }
      }
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should left specified range intact', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = addScript(tree, ['foo@^1.0.0']);

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { foo: '^1.0.0' }
      }
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should support aliases', () => {
    const tree: PurePackage = {
      json: {},
      workspacePath: '.'
    };

    const time = new Date().toString();
    const gen = addScript(tree, ['fp@npm:foo']);

    expect(gen.next().value).toEqual({ type: AddEventType.GET_METADATA, name: 'foo' });
    expect(gen.next().value).toEqual({ type: AddEventType.NEXT_METADATA });
    expect(gen.next({ name: 'foo', metadata: { versions: { '1.0.1': {} }, time: { '1.0.1': time } } } as PackageMetadata).value).toEqual({
      type: AddEventType.MODIFY,
      json: {
        dependencies: { fp: 'npm:foo:^1.0.1' }
      }
    });
    expect(gen.next()).toEqual({ done: true });
  });
});
