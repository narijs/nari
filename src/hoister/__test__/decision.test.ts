import { DecisionMap, finalizeDependedDecisions, Hoistable } from '../decision';

describe('hoist', () => {
  it('should finalize decisions that depend on the package hoisted lower than dependants', () => {
    const decisionMap: DecisionMap = new Map([
      [
        'A',
        {
          isHoistable: Hoistable.DEPENDS,
          dependsOn: new Set(['B']),
          newParentIndex: 0,
        },
      ],
      [
        'B',
        {
          isHoistable: Hoistable.DEPENDS,
          dependsOn: new Set(['A', 'C']),
          newParentIndex: 0,
        },
      ],
      [
        'C',
        {
          isHoistable: Hoistable.YES,
          newParentIndex: 2,
          reason: 'C@X is blocked by C@Y',
        },
      ],
    ]);

    const finalDecisions = finalizeDependedDecisions([], decisionMap);
    expect(finalDecisions).toEqual({
      decisionMap: new Map([
        [
          'A',
          {
            isHoistable: Hoistable.YES,
            newParentIndex: 2,
            reason: 'peer dependency was not hoisted, due to C@X is blocked by C@Y',
          },
        ],
        [
          'B',
          {
            isHoistable: Hoistable.YES,
            newParentIndex: 2,
            reason: 'peer dependency was not hoisted, due to C@X is blocked by C@Y',
          },
        ],
        [
          'C',
          {
            isHoistable: Hoistable.YES,
            newParentIndex: 2,
            reason: 'C@X is blocked by C@Y',
          },
        ],
      ]),
      circularPackageNames: new Set(),
    });
  });

  it('should finalize decisions that depend on the package hoisted higher than dependants', () => {
    const decisionMap: DecisionMap = new Map([
      [
        'A',
        {
          isHoistable: Hoistable.DEPENDS,
          dependsOn: new Set(['B']),
          newParentIndex: 2,
          reason: 'A@X is blocked by A@Y',
        },
      ],
      [
        'B',
        {
          isHoistable: Hoistable.YES,
          newParentIndex: 1,
          reason: 'B@X is blocked by B@Y',
        },
      ],
    ]);

    const finalDecisions = finalizeDependedDecisions([], decisionMap);
    expect(finalDecisions).toEqual({
      decisionMap: new Map([
        [
          'A',
          {
            isHoistable: Hoistable.YES,
            newParentIndex: 2,
            reason: 'A@X is blocked by A@Y',
          },
        ],
        [
          'B',
          {
            isHoistable: Hoistable.YES,
            newParentIndex: 1,
            reason: 'B@X is blocked by B@Y',
          },
        ],
      ]),
      circularPackageNames: new Set(),
    });
  });

  it('should finalize decisions that circular depend on each another', () => {
    const decisionMap: DecisionMap = new Map([
      [
        'A',
        {
          isHoistable: Hoistable.DEPENDS,
          dependsOn: new Set(['B']),
          newParentIndex: 2,
          reason: 'A@X is blocked by A@Y',
        },
      ],
      [
        'B',
        {
          isHoistable: Hoistable.DEPENDS,
          dependsOn: new Set(['A']),
          newParentIndex: 1,
          reason: 'B@X is blocked by B@Y',
        },
      ],
    ]);

    const finalDecisions = finalizeDependedDecisions([], decisionMap);
    expect(finalDecisions).toEqual({
      decisionMap: new Map([
        [
          'A',
          {
            isHoistable: Hoistable.DEPENDS,
            dependsOn: new Set(['B']),
            newParentIndex: 2,
            reason: 'A@X is blocked by A@Y',
          },
        ],
        [
          'B',
          {
            isHoistable: Hoistable.DEPENDS,
            dependsOn: new Set(['A']),
            newParentIndex: 2,
            reason: 'peer dependency was not hoisted, due to A@X is blocked by A@Y',
          },
        ],
      ]),
      circularPackageNames: new Set(['A', 'B']),
    });
  });

  it('should finalize decisions when dependees need to be hoisted later', () => {
    const decisionMap: DecisionMap = new Map([
      [
        'A',
        {
          isHoistable: Hoistable.DEPENDS,
          dependsOn: new Set(['B', 'C']),
          newParentIndex: 2,
          reason: 'A@X is blocked by A@Y',
        },
      ],
      [
        'B',
        {
          isHoistable: Hoistable.LATER,
          queueIndex: 1,
        },
      ],
      [
        'C',
        {
          isHoistable: Hoistable.LATER,
          queueIndex: 3,
        },
      ],
    ]);

    const finalDecisions = finalizeDependedDecisions([], decisionMap);
    expect(finalDecisions).toEqual({
      decisionMap: new Map([
        [
          'A',
          {
            isHoistable: Hoistable.LATER,
            queueIndex: 3,
          },
        ],
        [
          'B',
          {
            isHoistable: Hoistable.LATER,
            queueIndex: 1,
          },
        ],
        [
          'C',
          {
            isHoistable: Hoistable.LATER,
            queueIndex: 3,
          },
        ],
      ]),
      circularPackageNames: new Set(),
    });
  });
});
