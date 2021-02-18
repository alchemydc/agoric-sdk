import '@agoric/install-ses';
import test from 'ava';
import {
  Remotable,
  Far,
  // Data,
  getInterfaceOf,
  makeMarshal,
  passStyleOf,
  REMOTE_STYLE,
} from '../src/marshal';

// this only includes the tests that do not use liveSlots

test('serialize static data', t => {
  const m = makeMarshal();
  const ser = val => m.serialize(val);
  t.throws(() => ser([1, 2]), {
    message: /Cannot pass non-frozen objects like/,
  });
  t.deepEqual(ser(harden([1, 2])), { body: '[1,2]', slots: [] });
  t.deepEqual(ser(harden({ foo: 1 })), { body: '{"foo":1}', slots: [] });
  t.deepEqual(ser(true), { body: 'true', slots: [] });
  t.deepEqual(ser(1), { body: '1', slots: [] });
  t.deepEqual(ser('abc'), { body: '"abc"', slots: [] });
  t.deepEqual(ser(undefined), {
    body: '{"@qclass":"undefined"}',
    slots: [],
  });
  // -0 serialized as 0
  t.deepEqual(ser(0), { body: '0', slots: [] });
  t.deepEqual(ser(-0), { body: '0', slots: [] });
  t.deepEqual(ser(-0), ser(0));
  t.deepEqual(ser(NaN), { body: '{"@qclass":"NaN"}', slots: [] });
  t.deepEqual(ser(Infinity), {
    body: '{"@qclass":"Infinity"}',
    slots: [],
  });
  t.deepEqual(ser(-Infinity), {
    body: '{"@qclass":"-Infinity"}',
    slots: [],
  });
  // registered symbols
  t.throws(() => ser(Symbol.for('sym1')), { message: /Unsupported symbol/ });
  // unregistered symbols
  t.throws(() => ser(Symbol('sym2')), { message: /Unsupported symbol/ });
  // well known unsupported symbols
  t.throws(() => ser(Symbol.iterator), { message: /Unsupported symbol/ });
  // well known supported symbols
  t.deepEqual(ser(Symbol.asyncIterator), {
    body: '{"@qclass":"@@asyncIterator"}',
    slots: [],
  });
  let bn;
  try {
    bn = 4n;
  } catch (e) {
    if (!(e instanceof ReferenceError)) {
      throw e;
    }
  }
  if (bn) {
    t.deepEqual(ser(bn), {
      body: '{"@qclass":"bigint","digits":"4"}',
      slots: [],
    });
  }

  let emptyem;
  try {
    throw new Error();
  } catch (e) {
    emptyem = harden(e);
  }
  t.deepEqual(ser(emptyem), {
    body:
      '{"@qclass":"error","errorId":"error:anon-marshal#1","message":"","name":"Error"}',
    slots: [],
  });

  let em;
  try {
    throw new ReferenceError('msg');
  } catch (e) {
    em = harden(e);
  }
  t.deepEqual(ser(em), {
    body:
      '{"@qclass":"error","errorId":"error:anon-marshal#2","message":"msg","name":"ReferenceError"}',
    slots: [],
  });

  const cd = ser(harden([1, 2]));
  t.is(Object.isFrozen(cd), true);
  t.is(Object.isFrozen(cd.slots), true);
});

test('unserialize static data', t => {
  const m = makeMarshal();
  const uns = body => m.unserialize({ body, slots: [] });
  t.is(uns('1'), 1);
  t.is(uns('"abc"'), 'abc');
  t.is(uns('false'), false);

  // JS primitives that aren't natively representable by JSON
  t.deepEqual(uns('{"@qclass":"undefined"}'), undefined);
  t.truthy(Object.is(uns('{"@qclass":"NaN"}'), NaN));
  t.deepEqual(uns('{"@qclass":"Infinity"}'), Infinity);
  t.deepEqual(uns('{"@qclass":"-Infinity"}'), -Infinity);
  t.deepEqual(uns('{"@qclass":"@@asyncIterator"}'), Symbol.asyncIterator);

  // Normal json reviver cannot make properties with undefined values
  t.deepEqual(uns('[{"@qclass":"undefined"}]'), [undefined]);
  t.deepEqual(uns('{"foo": {"@qclass":"undefined"}}'), { foo: undefined });
  let bn;
  try {
    bn = 4n;
  } catch (e) {
    if (!(e instanceof ReferenceError)) {
      throw e;
    }
  }
  if (bn) {
    t.deepEqual(uns('{"@qclass":"bigint","digits":"1234"}'), 1234n);
  }

  const em1 = uns(
    '{"@qclass":"error","message":"msg","name":"ReferenceError"}',
  );
  t.truthy(em1 instanceof ReferenceError);
  t.is(em1.message, 'msg');
  t.truthy(Object.isFrozen(em1));

  const em2 = uns('{"@qclass":"error","message":"msg2","name":"TypeError"}');
  t.truthy(em2 instanceof TypeError);
  t.is(em2.message, 'msg2');

  const em3 = uns('{"@qclass":"error","message":"msg3","name":"Unknown"}');
  t.truthy(em3 instanceof Error);
  t.is(em3.message, 'msg3');

  t.deepEqual(uns('[1,2]'), [1, 2]);
  t.deepEqual(uns('{"a":1,"b":2}'), { a: 1, b: 2 });
  t.deepEqual(uns('{"a":1,"b":{"c": 3}}'), { a: 1, b: { c: 3 } });

  // should be frozen
  const arr = uns('[1,2]');
  t.truthy(Object.isFrozen(arr));
  const a = uns('{"b":{"c":{"d": []}}}');
  t.truthy(Object.isFrozen(a));
  t.truthy(Object.isFrozen(a.b));
  t.truthy(Object.isFrozen(a.b.c));
  t.truthy(Object.isFrozen(a.b.c.d));
});

test('serialize ibid cycle', t => {
  const m = makeMarshal();
  const ser = val => m.serialize(val);
  const cycle = ['a', 'x', 'c'];
  cycle[1] = cycle;
  harden(cycle);

  t.deepEqual(ser(cycle), {
    body: '["a",{"@qclass":"ibid","index":0},"c"]',
    slots: [],
  });
});

test('forbid ibid cycle', t => {
  const m = makeMarshal();
  const uns = body => m.unserialize({ body, slots: [] });
  t.throws(() => uns('["a",{"@qclass":"ibid","index":0},"c"]'), {
    message: /Ibid cycle at 0/,
  });
});

test('unserialize ibid cycle', t => {
  const m = makeMarshal();
  const uns = body => m.unserialize({ body, slots: [] }, 'warnOfCycles');
  const cycle = uns('["a",{"@qclass":"ibid","index":0},"c"]');
  t.truthy(Object.is(cycle[1], cycle));
});

test('passStyleOf null is "null"', t => {
  t.assert(passStyleOf(null), 'null');
});

test('mal-formed @qclass', t => {
  const m = makeMarshal();
  const uns = body => m.unserialize({ body, slots: [] });
  t.throws(() => uns('{"@qclass": 0}'), { message: /invalid qclass/ });
});

test('Remotable/getInterfaceOf', t => {
  t.throws(
    () => Remotable({ bar: 29 }),
    { message: /unimplemented/ },
    'object ifaces are not implemented',
  );
  t.throws(
    () => Far('MyHandle', { foo: 123 }),
    { message: /cannot serialize/ },
    'non-function props are not implemented',
  );
  t.throws(
    () => Far('MyHandle', a => a + 1),
    { message: /cannot serialize/ },
    'function presences are not implemented',
  );

  t.is(getInterfaceOf('foo'), undefined, 'string, no interface');
  t.is(getInterfaceOf(null), undefined, 'null, no interface');
  t.is(
    getInterfaceOf(a => a + 1),
    undefined,
    'function, no interface',
  );
  t.is(getInterfaceOf(123), undefined, 'number, no interface');

  // Check that a handle can be created.
  const p = Far('MyHandle');
  harden(p);
  // console.log(p);
  t.is(getInterfaceOf(p), 'Alleged: MyHandle', `interface is MyHandle`);
  t.is(`${p}`, '[Alleged: MyHandle]', 'stringify is [MyHandle]');

  const p2 = Far('Thing', {
    name() {
      return 'cretin';
    },
    birthYear(now) {
      return now - 64;
    },
  });
  t.is(getInterfaceOf(p2), 'Alleged: Thing', `interface is Thing`);
  t.is(p2.name(), 'cretin', `name() method is presence`);
  t.is(p2.birthYear(2020), 1956, `birthYear() works`);

  // Remotables and Fars can be serialized, of course
  function convertValToSlot(_val) {
    return 'slot';
  }
  const m = makeMarshal(convertValToSlot);
  t.deepEqual(m.serialize(p2), {
    body: JSON.stringify({
      '@qclass': 'slot',
      iface: 'Alleged: Thing',
      index: 0,
    }),
    slots: ['slot'],
  });
});

const GOOD_PASS_STYLE = Symbol.for('passStyle');
const BAD_PASS_STYLE = Symbol('passStyle');

const goodRemotableProto = harden({
  [GOOD_PASS_STYLE]: REMOTE_STYLE,
  toString: Object, // Any function will do
  [Symbol.toStringTag]: 'Alleged: Good remotable proto',
});

const badRemotableProto1 = harden({
  [BAD_PASS_STYLE]: REMOTE_STYLE,
  toString: Object, // Any function will do
  [Symbol.toStringTag]: 'Alleged: Good remotable proto',
});
const badRemotableProto2 = harden({
  [GOOD_PASS_STYLE]: 'string',
  toString: Object, // Any function will do
  [Symbol.toStringTag]: 'Alleged: Good remotable proto',
});
const badRemotableProto3 = harden({
  [GOOD_PASS_STYLE]: REMOTE_STYLE,
  toString: {}, // Any function will do
  [Symbol.toStringTag]: 'Alleged: Good remotable proto',
});
const badRemotableProto4 = harden({
  [GOOD_PASS_STYLE]: REMOTE_STYLE,
  toString: Object, // Any function will do
  [Symbol.toStringTag]: 'Bad remotable proto',
});

const sub = sup => harden({ __proto__: sup });

test('getInterfaceOf validation', t => {
  t.throws(() => getInterfaceOf(goodRemotableProto), {
    message: /cannot serialize objects with non-methods like "Symbol\(passStyle\)" in .*/,
  });
  t.is(getInterfaceOf(badRemotableProto1), undefined);
  t.is(getInterfaceOf(badRemotableProto2), undefined);
  t.throws(() => getInterfaceOf(badRemotableProto3), {
    message: /cannot serialize objects with non-methods like "toString" in .*/,
  });
  t.throws(() => getInterfaceOf(badRemotableProto4), {
    message: /cannot serialize objects with non-methods like "Symbol\(passStyle\)" in .*/,
  });

  t.is(
    getInterfaceOf(sub(goodRemotableProto)),
    'Alleged: Good remotable proto',
  );
  t.is(getInterfaceOf(sub(badRemotableProto1)), undefined);
  t.is(getInterfaceOf(sub(badRemotableProto2)), undefined);
  t.throws(() => getInterfaceOf(sub(badRemotableProto3)), {
    message: /toString must be a function/,
  });
  t.throws(() => getInterfaceOf(sub(badRemotableProto4)), {
    message: /For now, iface "Bad remotable proto" must be "Remotable" or begin with "Alleged: "; unimplemented/,
  });
});

test('records', t => {
  function convertValToSlot(_val) {
    return 'slot';
  }
  const presence = harden({});
  function convertSlotToVal(_slot) {
    return presence;
  }
  const m = makeMarshal(convertValToSlot, convertSlotToVal);
  const ser = val => m.serialize(val);
  const noIface = {
    body: JSON.stringify({ '@qclass': 'slot', index: 0 }),
    slots: ['slot'],
  };
  const yesIface = {
    body: JSON.stringify({
      '@qclass': 'slot',
      iface: 'Alleged: iface',
      index: 0,
    }),
    slots: ['slot'],
  };
  // const emptyData = { body: JSON.stringify({}), slots: [] };

  // For objects with Symbol-named properties
  const symEnumData = Symbol.for('symEnumData');
  const symEnumFunc = Symbol.for('symEnumFunc');
  const symNonenumData = Symbol.for('symNonenumData');
  const symNonenumFunc = Symbol.for('symNonenumFunc');
  const symNonenumGetFunc = Symbol.for('symNonenumGetFunc');

  function build(...opts) {
    const props = {};
    let mark;
    for (const opt of opts) {
      if (opt === 'enumStringData') {
        props.key1 = { enumerable: true, value: 'data' };
      } else if (opt === 'enumStringFunc') {
        props.enumStringFunc = { enumerable: true, value: () => 0 };
      } else if (opt === 'enumStringGetData') {
        props.enumStringGetData = { enumerable: true, get: () => 0 };
      } else if (opt === 'enumStringGetFunc') {
        props.enumStringGetFunc = { enumerable: true, get: () => () => 0 };
      } else if (opt === 'enumStringSet') {
        props.enumStringSet = { enumerable: true, set: () => undefined };
      } else if (opt === 'enumSymbolData') {
        props[symEnumData] = { enumerable: true, value: 2 };
      } else if (opt === 'enumSymbolFunc') {
        props[symEnumFunc] = { enumerable: true, value: () => 0 };
      } else if (opt === 'nonenumStringData') {
        props.nonEnumStringData = { enumerable: false, value: 3 };
      } else if (opt === 'nonenumStringFunc') {
        props.nonEnumStringFunc = { enumerable: false, value: () => 0 };
      } else if (opt === 'nonenumSymbolData') {
        props[symNonenumData] = { enumerable: false, value: 4 };
      } else if (opt === 'nonenumSymbolFunc') {
        props[symNonenumFunc] = { enumerable: false, value: () => 0 };
      } else if (opt === 'nonenumSymbolGetFunc') {
        props[symNonenumGetFunc] = { enumerable: false, get: () => () => 0 };
      } else if (opt === 'data') {
        mark = 'data';
      } else if (opt === 'far') {
        mark = 'far';
      } else {
        throw Error(`unknown option ${opt}`);
      }
    }
    const o = Object.create(Object.prototype, props);
    // if (mark === 'data') {
    //   return Data(o);
    // }
    if (mark === 'far') {
      return Far('iface', o);
    }
    return harden(o);
  }

  function shouldThrow(opts, message = /XXX/) {
    t.throws(() => ser(build(...opts)), { message });
  }
  const CSO = /cannot serialize objects/;
  const NOACC = /Records must not contain accessors/;
  const RECENUM = /Record fields must be enumerable/;
  const NOMETH = /cannot serialize objects with non-methods/;

  // empty objects

  // rejected because it is not hardened
  t.throws(
    () => ser({}),
    { message: /Cannot pass non-frozen objects/ },
    'non-frozen data cannot be serialized',
  );

  // harden({})
  // old: pass-by-ref without complaint
  // interim1: pass-by-ref with warning
  // interim2: rejected
  // final: pass-by-copy without complaint
  t.deepEqual(ser(build()), noIface); // old+interim1
  // t.throws(() => ser(harden({})), { message: /??/ }, 'unmarked empty object rejected'); // int2
  // t.deepEqual(ser(build()), emptyData); // final

  // Data({})
  // old: not applicable, Data() not yet added
  // interim1: pass-by-copy without warning
  // interim2: pass-by-copy without warning
  // final: not applicable, Data() removed
  // t.deepEqual(build('data'), emptyData); // interim 1+2

  // Far('iface', {})
  // all cases: pass-by-ref
  t.deepEqual(ser(build('far')), yesIface);

  // Far('iface', {key: func})
  // all cases: pass-by-ref
  t.deepEqual(ser(build('far', 'enumStringFunc')), yesIface);
  t.deepEqual(ser(build('far', 'enumSymbolFunc')), yesIface);
  t.deepEqual(ser(build('far', 'nonenumStringFunc')), yesIface);
  t.deepEqual(ser(build('far', 'nonenumSymbolFunc')), yesIface);

  // { key: data }
  // all: pass-by-copy without warning
  t.deepEqual(ser(build('enumStringData')), {
    body: '{"key1":"data"}',
    slots: [],
  });

  // { key: func }
  // old: pass-by-ref without warning
  // interim1: pass-by-ref with warning
  // interim2: reject
  // final: reject
  t.deepEqual(ser(build('enumStringFunc')), noIface);
  t.deepEqual(ser(build('enumSymbolFunc')), noIface);
  t.deepEqual(ser(build('nonenumStringFunc')), noIface);
  t.deepEqual(ser(build('nonenumSymbolFunc')), noIface);

  // Data({ key: data, key: func }) : rejected
  // shouldThrow('data', 'enumStringData', 'enumStringFunc');

  // Far('iface', { key: data, key: func }) : rejected
  // (some day this might add auxilliary data, but not now
  shouldThrow(['far', 'enumStringData', 'enumStringFunc'], CSO);

  // anything with getters is rejected
  shouldThrow(['enumStringGetData'], NOACC);
  shouldThrow(['enumStringGetData', 'enumStringData'], NOACC);
  shouldThrow(['enumStringGetData', 'enumStringFunc'], CSO);
  shouldThrow(['enumStringGetFunc'], NOACC);
  shouldThrow(['enumStringGetFunc', 'enumStringData'], NOACC);
  shouldThrow(['enumStringGetFunc', 'enumStringFunc'], CSO);
  shouldThrow(['enumStringSet'], NOACC);
  shouldThrow(['enumStringSet', 'enumStringData'], NOACC);
  shouldThrow(['enumStringSet', 'enumStringFunc'], CSO);
  shouldThrow(['nonenumSymbolGetFunc'], CSO);
  shouldThrow(['nonenumSymbolGetFunc', 'enumStringData'], CSO);
  shouldThrow(['nonenumSymbolGetFunc', 'enumStringFunc'], CSO);

  // anything with symbols can only be a remotable
  shouldThrow(['enumSymbolData'], NOMETH);
  shouldThrow(['enumSymbolData', 'enumStringData'], NOMETH);
  shouldThrow(['enumSymbolData', 'enumStringFunc'], NOMETH);

  shouldThrow(['nonenumSymbolData'], NOMETH);
  shouldThrow(['nonenumSymbolData', 'enumStringData'], NOMETH);
  shouldThrow(['nonenumSymbolData', 'enumStringFunc'], NOMETH);

  // anything with non-enumerable properties is rejected
  shouldThrow(['nonenumStringData'], RECENUM);
  shouldThrow(['nonenumStringData', 'enumStringData'], RECENUM);
  shouldThrow(['nonenumStringData', 'enumStringFunc'], NOMETH);
});
