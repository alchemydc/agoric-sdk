/* avaXS - ava style test runner for XS

Usage:

agoric-sdk/packages/ERTP$ node -r esm ../xsnap/src/avaXS.js test/unitTests/test-*.js
test script: test/unitTests/test-interfaces.js
SES shim...
after ses shim: [ '"hello from XS"', '"ses shim done"' ]
run...
after run: [
'"hello from XS"',
'"ses shim done"',
'"interfaces - abstracted implementation"',
...

*/

/* eslint-disable no-await-in-loop */
import '@agoric/install-ses';
import { xsnap } from './xsnap';

const importMetaUrl = `file://${__filename}`;
const asset = (ref, readFile) =>
  readFile(new URL(ref, importMetaUrl).pathname, 'utf8');

const decoder = new TextDecoder();

/**
 * @param {string} input
 * @param {string} src
 * @param {(w: XSnap) => Promise<void>} withXSnap
 *
 * @typedef {import('./avaAssertXS').TapMessage} TapMessage
 * @typedef {ReturnType<typeof import('./xsnap').xsnap>} XSnap
 */
async function runTest(input, src, withXSnap) {
  let label = '';
  let qty = 0;
  const byStatus = { ok: 0, 'not ok': 0, SKIP: 0 };

  async function handleCommand(message) {
    /** @type { TapMessage } */
    const msg = JSON.parse(decoder.decode(message));
    // console.log(input, msg, qty, byStatus);
    if (msg.label) {
      label = msg.label;
    }
    if (msg.status) {
      byStatus[msg.status] += 1;
      qty += 1;
    }
    if (msg.status === 'not ok') {
      console.warn({ ...msg, input, label });
    }
    return new Uint8Array();
  }

  const scripts = [
    // send
    `
    const encoder = new TextEncoder();
    const send = item => issueCommand(encoder.encode(JSON.stringify(item)).buffer);
    send("hello!!!");
    globalThis.send = send;
    `,
    // run test script
    `
    const harness = test.createHarness(send);
    const require = function require(specifier) {
      if (specifier !== 'ava') throw Error(specifier);
      return (label, run) => test(label, run, harness);
    };
    const c = new Compartment({ require, console, assert, harden, HandledPromise });
    const src = ${JSON.stringify(src)};
    c.evaluate(\`(\${src}\\n)()\`);
    harness.result().then(send);
    `,
  ];

  await withXSnap({ name: input, handleCommand, debug: true }, async worker => {
    for await (const script of scripts) {
      await worker.evaluate(script);
    }
  });

  return { qty, byStatus };
}

/**
 * @param {string[]} argv
 * @param {{
 *   bundleSource: typeof import('@agoric/bundle-source'),
 *   spawn: typeof import('child_process')['spawn'],
 *   osType: typeof import('os')['type'],
 *   readFile: typeof import('fs')['promises']['readFile'],
 * }} io
 */
async function main(argv, { bundleSource, spawn, osType, readFile }) {
  async function testSource(input) {
    const bundle = await bundleSource(input, 'getExport', {
      externals: ['ava'],
    });
    return bundle.source;
  }

  const sesShim = await asset(`../dist/bootstrap.umd.js`, readFile);
  const tinyAva = await asset(`./avaAssertXS.js`, readFile);

  async function withXSnap(opts, thunk) {
    const worker = xsnap({ spawn, os: osType(), ...opts });
    try {
      await worker.evaluate(sesShim);
      await worker.evaluate(tinyAva);
      return await thunk(worker);
    } finally {
      worker.terminate();
    }
  }

  let totalTests = 0;
  const stats = { ok: 0, 'not ok': 0, SKIP: 0 };
  for (const input of argv.slice(2)) {
    console.log('# test script:', input);
    const src = await testSource(input);

    const { qty, byStatus } = await runTest(input, src, withXSnap);

    totalTests += qty;
    Object.entries(byStatus).forEach(([status, q]) => {
      stats[status] += q;
    });
  }

  console.log({ totalTests, stats });
  return stats['not ok'] > 0 ? 1 : 0;
}

/* eslint-disable global-require */
if (require.main === module) {
  main(process.argv, {
    bundleSource: require('@agoric/bundle-source').default,
    spawn: require('child_process').spawn,
    osType: require('os').type,
    readFile: require('fs').promises.readFile,
  })
    .then(status => {
      process.exit(status);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
