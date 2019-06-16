import harden from '@agoric/harden';
import Nat from '@agoric/nat';
import { insist } from '../insist';

export default function makeVatKeeper(
  kvstore,
  pathToRoot,
  makeExternalKVStore,
  external,
) {
  function createStartingVatState() {
    // kernelSlotToVatSlot is an object with four properties:
    //    exports, devices, promises, resolvers.
    // vatSlotToKernelSlot has imports, deviceImports, promises,
    //    resolvers

    kvstore.set(
      'kernelSlotToVatSlot',
      makeExternalKVStore(pathToRoot, external),
    );
    kvstore.set(
      'vatSlotToKernelSlot',
      makeExternalKVStore(pathToRoot, external),
    );

    const kernelSlotToVatSlot = kvstore.get('kernelSlotToVatSlot');
    const vatSlotToKernelSlot = kvstore.get('vatSlotToKernelSlot');

    kernelSlotToVatSlot.set(
      'exports',
      makeExternalKVStore(pathToRoot, external),
    );
    kernelSlotToVatSlot.set(
      'devices',
      makeExternalKVStore(pathToRoot, external),
    );
    kernelSlotToVatSlot.set(
      'promises',
      makeExternalKVStore(pathToRoot, external),
    );
    kernelSlotToVatSlot.set(
      'resolvers',
      makeExternalKVStore(pathToRoot, external),
    );

    vatSlotToKernelSlot.set(
      'imports',
      makeExternalKVStore(pathToRoot, external),
    );
    vatSlotToKernelSlot.set(
      'deviceImports',
      makeExternalKVStore(pathToRoot, external),
    );
    vatSlotToKernelSlot.set(
      'promises',
      makeExternalKVStore(pathToRoot, external),
    );
    vatSlotToKernelSlot.set(
      'resolvers',
      makeExternalKVStore(pathToRoot, external),
    );

    kvstore.set('nextIDs', makeExternalKVStore(pathToRoot, external));
    const nextIDs = kvstore.get('nextIDs');
    nextIDs.set('import', 10);
    nextIDs.set('promise', 20);
    nextIDs.set('resolver', 30);
    nextIDs.set('deviceImport', 40);

    kvstore.set('transcript', []);
  }

  const allowedVatSlotTypes = [
    'export',
    'import',
    'deviceImport',
    'promise',
    'resolver',
  ];

  const allowedKernelSlotTypes = ['export', 'device', 'promise', 'resolver'];

  function insistVatSlot(slot) {
    const properties = Object.getOwnPropertyNames(slot);
    insist(
      properties.length === 2,
      `wrong number of properties for a vatSlot ${JSON.stringify(slot)}`,
    );
    Nat(slot.id);
    insist(
      allowedVatSlotTypes.includes(slot.type),
      `unknown slot.type in '${JSON.stringify(slot)}'`,
    );
  }

  function insistKernelSlot(slot) {
    const properties = Object.getOwnPropertyNames(slot);
    insist(
      properties.length === 3 ||
        (properties.length === 2 &&
          (slot.type === 'promise' || slot.type === 'resolver')),
      `wrong number of properties for a kernelSlot ${JSON.stringify(slot)}`,
    ); // a kernel slot has a vatID property, unless it is a promise or a resolver
    Nat(slot.id);
    insist(
      allowedKernelSlotTypes.includes(slot.type),
      `unknown slot.type in '${JSON.stringify(slot)}'`,
    );
  }

  function getKernelSlotTypedMapAndKey(kernelSlot) {
    insistKernelSlot(kernelSlot);

    const { type, id } = kernelSlot;

    const tables = kvstore.get('kernelSlotToVatSlot');

    switch (type) {
      case 'promise': {
        return {
          table: tables.get('promises'),
          key: id,
        };
      }
      case 'resolver': {
        return {
          table: tables.get('resolvers'),
          key: id,
        };
      }
      case 'export': {
        return {
          table: tables.get('exports'),
          key: `${kernelSlot.vatID}-${id}`,
        };
      }
      case 'device': {
        return {
          table: tables.get('devices'),
          key: `${kernelSlot.deviceName}-${id}`,
        };
      }
      default:
        throw new Error(`unexpected kernelSlot type ${kernelSlot.type}`);
    }
  }

  function getVatSlotTypedMapAndKey(vatSlot) {
    insistVatSlot(vatSlot);
    const { type, id } = vatSlot;

    const tables = kvstore.get('vatSlotToKernelSlot');
    let table;
    // imports, deviceImports, promises, resolvers

    switch (type) {
      case 'import': {
        table = tables.get('imports');
        break;
      }
      case 'deviceImport': {
        table = tables.get('deviceImports');
        break;
      }
      case 'promise': {
        table = tables.get('promises');
        break;
      }
      case 'resolver': {
        table = tables.get('resolvers');
        break;
      }
      default:
        throw new Error(`unexpected vatSlot type ${vatSlot.type}`);
    }
    return {
      table,
      key: `${type}-${id}`,
    };
  }

  function getVatSlotTypeFromKernelSlot(kernelSlot) {
    switch (kernelSlot.type) {
      case 'export':
        return 'import';
      case 'device':
        return 'deviceImport';
      case 'promise':
        return 'promise';
      case 'resolver':
        return 'resolver';
      default:
        throw new Error('unrecognized kernelSlot type');
    }
  }

  function mapVatSlotToKernelSlot(vatSlot) {
    const { table, key } = getVatSlotTypedMapAndKey(vatSlot);
    const kernelSlot = table.get(key);
    if (kernelSlot === undefined) {
      throw new Error(`unknown ${vatSlot.type} slot '${vatSlot.id}'`);
    }
    return kernelSlot;
  }

  function mapKernelSlotToVatSlot(kernelSlot) {
    const { table, key } = getKernelSlotTypedMapAndKey(kernelSlot);
    if (!table.has(`${key}`)) {
      // must add both directions
      const vatSlotType = getVatSlotTypeFromKernelSlot(kernelSlot);
      const nextIDs = kvstore.get('nextIDs');
      const newVatSlotID = nextIDs.get(vatSlotType);
      nextIDs.set(vatSlotType, newVatSlotID + 1);
      const vatSlot = { type: vatSlotType, id: newVatSlotID };
      table.set(`${key}`, vatSlot);
      const { table: vatSlotTable, key: vatSlotKey } = getVatSlotTypedMapAndKey(
        vatSlot,
      );
      vatSlotTable.set(vatSlotKey, kernelSlot);
    }
    return table.get(`${key}`);
  }

  function getTranscript() {
    return Array.from(kvstore.get('transcript'));
  }

  function addToTranscript(msg) {
    const transcript = kvstore.get('transcript');
    transcript.push(msg);
    kvstore.set('transcript', transcript);
  }

  // pretty print for logging and testing
  function dumpState(vatID) {
    const res = [];

    function printSlots(vatSlot) {
      const { table, key } = getVatSlotTypedMapAndKey(vatSlot);
      const kernelSlot = table.get(key);
      if (vatSlot.type === 'promise' || vatSlot.type === 'resolver') {
        res.push([vatID, vatSlot.type, vatSlot.id, kernelSlot.id]);
      } else {
        res.push([
          vatID,
          vatSlot.type,
          vatSlot.id,
          kernelSlot.type,
          kernelSlot.vatID,
          kernelSlot.id,
        ]);
      }
    }

    // 'exports', 'devices', 'promises', 'resolvers'

    const kernelSlotToVatSlot = kvstore.get('kernelSlotToVatSlot');

    kernelSlotToVatSlot
      .get('exports')
      .values()
      .forEach(printSlots);
    kernelSlotToVatSlot
      .get('devices')
      .values()
      .forEach(printSlots);
    kernelSlotToVatSlot
      .get('promises')
      .values()
      .forEach(printSlots);
    kernelSlotToVatSlot
      .get('resolvers')
      .values()
      .forEach(printSlots);

    return harden(res);
  }

  return harden({
    createStartingVatState,
    mapVatSlotToKernelSlot,
    mapKernelSlotToVatSlot,
    getTranscript,
    dumpState,
    addToTranscript,
    insistKernelSlot,
    insistVatSlot,
  });
}
