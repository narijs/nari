import { PurePackage } from "../../resolver/workspace";
import { DEPENDENCY_TYPES } from "../../constants";

export enum RemoveEventType { MODIFY = 'modify', NOT_FOUND = 'not_found' };

export type RemoveEvent = {
  type: RemoveEventType.MODIFY;
  json: any;
} | {
  type: RemoveEventType.NOT_FOUND;
  message: string;
};

export const removeScript = function* (pkg: PurePackage, nameList: string[]): Generator<RemoveEvent, any, any> {
  let isModified = false;
  const nextJson = structuredClone(pkg.json);

  for (const name of nameList) {
    let found = false;
    for (const dependencyType of DEPENDENCY_TYPES) {
      if (nextJson[dependencyType] && nextJson[dependencyType][name]) {
        delete nextJson[dependencyType][name];
        if (Object.keys(nextJson[dependencyType]).length === 0) {
          delete nextJson[dependencyType];
        }

        found = true;
        isModified = true;
      }
    }

    if (!found) {
      yield { type: RemoveEventType.NOT_FOUND, message: `The module '${name}' is not present in the 'package.json'` };
      isModified = false;
      break;
    }
  }

  if (isModified) {
    yield { type: RemoveEventType.MODIFY, json: nextJson };
  }
}
