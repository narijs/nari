import { getChildren, getUsages, getPriorities } from '../priority';
import { Graph, PackageType, toWorkGraph } from '../hoist';
import { fromSimpleGraph } from './util';

describe('priority', () => {
  it(`should compute usages for repetetive package occurences`, () => {
    // . -> A -> B -> C
    //   -> D -> B -> C
    const B = { id: 'B', dependencies: [{ id: 'C' }] };
    const graph: Graph = {
      id: '.',
      dependencies: [
        { id: 'A', dependencies: [B] },
        { id: 'D', dependencies: [B] },
      ],
    };

    expect(getUsages(toWorkGraph(graph))).toEqual(
      new Map([
        ['A', new Set(['.'])],
        ['B', new Set(['A', 'D'])],
        ['C', new Set(['B'])],
        ['D', new Set(['.'])],
      ]),
    );
  });

  it(`should compute usages for peer dependencies`, () => {
    // . -> A -> B -> C --> D
    //             -> D
    const graph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'A',
          dependencies: [
            {
              id: 'B',
              dependencies: [
                {
                  id: 'C',
                  peerNames: ['D'],
                },
                { id: 'D' },
              ],
            },
          ],
        },
      ],
    };

    expect(getUsages(toWorkGraph(graph))).toEqual(
      new Map([
        ['A', new Set(['.'])],
        ['B', new Set(['A'])],
        ['C', new Set(['B'])],
        ['D', new Set(['C', 'B'])],
      ]),
    );
  });

  it('should return priorities according to workspace nesting', () => {
    // . -> A -> C@X
    //   -> w1 -> C@1
    //   -> w2 -> C@2
    // should have priorites for C:
    // C@1, C@2, C@X
    const graph: Graph = {
      id: '.',
      dependencies: [{ id: 'A', dependencies: [{ id: 'C@X' }] }],
      workspaces: [
        { id: 'w1', dependencies: [{ id: 'C@1' }] },
        { id: 'w2', dependencies: [{ id: 'C@2' }] },
      ],
    };

    const workGraph = toWorkGraph(graph);
    const usages = getUsages(workGraph);
    const children = getChildren(workGraph);

    expect(getPriorities(usages, children)).toEqual(
      new Map([
        ['A', ['A']],
        ['C', ['C@1', 'C@2', 'C@X']],
      ]),
    );
  });

  it('should prioritize direct workspace dependencies over indirect', () => {
    // . -> w1 -> A@X
    //         -> B -> A@Y
    //         -> C -> A@Y
    // should prioritize A@X over A@Y
    const graph: Graph = fromSimpleGraph({
      id: '.',
      workspaces: [
        {
          id: 'w1',
          dependencies: [
            { id: 'A@X' },
            {
              id: 'B',
              dependencies: [{ id: 'A@Y' }],
            },
            {
              id: 'C',
              dependencies: [{ id: 'A@Y' }],
            },
          ],
        },
      ],
    });

    const workGraph = toWorkGraph(graph);
    const usages = getUsages(workGraph);
    const children = getChildren(workGraph);

    expect(getPriorities(usages, children)).toEqual(
      new Map([
        ['A', ['A@X', 'A@Y']],
        ['B', ['B']],
        ['C', ['C']],
      ]),
    );
  });

  it('should take into account peer dependency usages', () => {
    // . -> C -> A@Y -> B --> A
    //   -> D -> A@X
    // A@Y should be prioritized over A@X to hoist B as well to the top
    const graph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'C',
          dependencies: [
            {
              id: 'A@Y',
              dependencies: [
                {
                  id: 'B',
                  peerNames: ['A'],
                },
              ],
            },
          ],
        },
        {
          id: 'D',
          dependencies: [{ id: 'A@X' }],
        },
      ],
    };

    const workGraph = toWorkGraph(graph);
    const usages = getUsages(workGraph);
    const children = getChildren(workGraph);

    expect(getPriorities(usages, children)).toEqual(
      new Map([
        ['A', ['A@Y', 'A@X']],
        ['B', ['B']],
        ['C', ['C']],
        ['D', ['D']],
      ]),
    );
  });

  it(`should give priority to portal dependencies`, () => {
    // . -> A -> B@X
    //   -> p1 -> B@Z
    //   -> w1 -> B@Y
    // B@Z should be prioritized over B@Y, which should be prioritized over B@X
    const graph: Graph = {
      id: '.',
      dependencies: [
        {
          id: 'A',
          dependencies: [{ id: 'B@X' }],
        },
        {
          id: 'p1',
          dependencies: [{ id: 'B@Z' }],
          packageType: PackageType.PORTAL,
        },
      ],
      workspaces: [
        {
          id: 'w1',
          dependencies: [{ id: 'B@Y' }],
        },
      ],
    };

    const workGraph = toWorkGraph(graph);
    const usages = getUsages(workGraph);
    const children = getChildren(workGraph);

    expect(getPriorities(usages, children)).toEqual(
      new Map([
        ['p1', ['p1']],
        ['A', ['A']],
        ['B', ['B@Z', 'B@Y', 'B@X']],
      ]),
    );
  });

  it(`should take into accout user-defined package hoisting priorities`, () => {
    // . -> A -> B@X
    //   -> C -> B@X
    //   -> D -> B@P (priority: 1)
    //   -> p1 -> B@Z
    //   -> w1 -> B@Y
    // Resulting priorities should be in order: B@Z, B@Y, B@P, B@X
    const graph: Graph = fromSimpleGraph({
      id: '.',
      dependencies: [
        {
          id: 'A',
          dependencies: [{ id: 'B@X' }],
        },
        {
          id: 'C',
          dependencies: [{ id: 'B@X' }],
        },
        {
          id: 'D',
          dependencies: [{ id: 'B@P', priority: 1 }],
        },
        {
          id: 'p1',
          dependencies: [{ id: 'B@Z' }],
          packageType: PackageType.PORTAL,
        },
      ],
      workspaces: [
        {
          id: 'w1',
          dependencies: [{ id: 'B@Y' }],
        },
      ],
    });

    const workGraph = toWorkGraph(graph);
    const usages = getUsages(workGraph);
    const children = getChildren(workGraph);

    expect(getPriorities(usages, children)).toEqual(
      new Map([
        ['p1', ['p1']],
        ['A', ['A']],
        ['C', ['C']],
        ['D', ['D']],
        ['B', ['B@Z', 'B@Y', 'B@P', 'B@X']],
      ]),
    );
  });
});
