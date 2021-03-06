// Copyright (C) 2019 Agoric, under Apache License 2.0

import { assert, details as X } from '@agoric/assert';

// Allows multiple parties to store values for retrieval by others.
function makeSharedMap(name) {
  const namedEntries = new Map();
  const orderedEntries = [];

  return harden({
    lookup(propertyName) {
      if (!namedEntries.has(propertyName)) {
        return undefined;
      }
      return namedEntries.get(propertyName)[0];
    },
    addEntry(key, value) {
      assert(
        !namedEntries.has(key),
        X`SharedMap ${name} already has an entry for ${key}.`,
      );
      orderedEntries.push([key, value]);
      namedEntries.set(key, [value, orderedEntries.length]);
      return orderedEntries.length;
    },
    getName() {
      return name;
    },
    // TODO(hibbert) retrieve by numbered position
  });
}
harden(makeSharedMap);

export { makeSharedMap };
