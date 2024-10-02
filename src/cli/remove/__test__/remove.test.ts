import { PurePackage } from '../../../resolver/workspace';
import { RemoveEventType, removeScript } from '../removeScript';

describe('remove script', () => {
  it('should support removing a dependency from the project', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
        },
      },
      workspacePath: '.',
    };

    const gen = removeScript(tree, ['foo']);

    expect(gen.next().value).toEqual({
      type: RemoveEventType.MODIFY,
      json: {},
    });
    expect(gen.next()).toEqual({ done: true });
  });

  it('should not modify package.json if one of the modules were not found', () => {
    const tree: PurePackage = {
      json: {
        dependencies: {
          foo: '^1.0.0',
        },
      },
      workspacePath: '.',
    };

    const gen = removeScript(tree, ['foo', 'bar']);

    expect(gen.next().value).toEqual({
      type: RemoveEventType.NOT_FOUND,
      message: expect.any(String),
    });
    expect(gen.next()).toEqual({ done: true });
  });
});
