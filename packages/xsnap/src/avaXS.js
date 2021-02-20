/* avaXS - ava style test runner for XS

Usage:

agoric-sdk/packages/ERTP$ node -r esm ../xsnap/src/avaXS.js test/unitTests/test-*.js

*/
// @ts-check

/* eslint-disable no-await-in-loop */
import '@agoric/install-ses';
import { xsnap } from './xsnap';

const importMetaUrl = `file://${__filename}`;
const asset = (ref, readFile) =>
  readFile(new URL(ref, importMetaUrl).pathname, 'utf8');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param {string} input
 * @param {string} src
 * @param {{
 *   withXSnap: (o: Object, fn: ((w: XSnap) => Promise<void>)) => Promise<void>,
 *   bundleSource: (...args: unknown[]) => Bundle,
 *   resolve: typeof import('path').resolve,
 *   dirname: typeof import('path').dirname,
 * }} io
 *
 * @typedef {{
 *   id: number, status: 'ok' | 'not ok' | 'SKIP', message?: string
 * } | { plan: number} | { note: string, label?: string }} TapMessage
 * @typedef {ReturnType<typeof import('./xsnap').xsnap>} XSnap
 * @typedef {{ moduleFormat: string }} Bundle
 */
async function runTest(
  input,
  src,
  { withXSnap, bundleSource, resolve, dirname },
) {
  let label = '';
  let qty = 0;
  const byStatus = { ok: 0, 'not ok': 0, SKIP: 0 };

  async function handleCommand(message) {
    /** @type { TapMessage | { bundleSource: unknown[] } | { message: string } } */
    const msg = JSON.parse(decoder.decode(message));
    // console.log(input, msg, qty, byStatus);

    if ('message' in msg) {
      throw msg;
    }
    if ('bundleSource' in msg) {
      const bundle = await bundleSource(...msg.bundleSource);
      return encoder.encode(JSON.stringify(bundle));
    }

    if ('label' in msg) {
      label = msg.label || label;
      console.log(`@@verbose ${input}: ${msg.label}`);
    }
    if ('status' in msg) {
      byStatus[msg.status] += 1;
      qty += 1;
      if (msg.status === 'not ok') {
        console.warn({ ...msg, input, label });
      }
    }
    return encoder.encode('null');
  }

  const testPath = resolve(input);
  const literal = JSON.stringify;

  const scripts = [
    // send
    `
    const encoder = new TextEncoder();
    const send = item => issueCommand(encoder.encode(JSON.stringify(item)).buffer);
    globalThis.send = send;
    `,
    // run test script
    `
    const decoder = new TextDecoder();
    const bundleSource = async (...args) => {
      const msg = await send({ bundleSource: args });
      return JSON.parse(decoder.decode(msg));
    };

    const harness = test.createHarness(send);
    const require = function require(specifier) {
      switch(specifier) {
        case 'ava':
          return test;
        case '@agoric/install-ses':
          return undefined;
        case '@agoric/bundle-source':
          return bundleSource;
        default:
          throw Error(specifier);
      }
    };

    const __filename = ${literal(testPath)};
    const __dirname = ${literal(dirname(testPath))};

    function handler(msg) {
      const src = decoder.decode(msg);
      const c = new Compartment({
        require, __dirname, __filename,
        console, assert,
        harden, HandledPromise,
        TextEncoder, TextDecoder,
      });
      c.evaluate(\`(\${src}\\n)()\`);
      harness.result()
        .then(send)
        .catch(ex => send({ message: ex.message}));
    }
    globalThis.handleCommand = handler;
    `,
  ];

  await withXSnap({ name: input, handleCommand, debug: true }, async worker => {
    await worker.evaluate('console.log(123)');
    for await (const script of scripts) {
      await worker.evaluate(script);
    }
    await worker.issueStringCommand(src);
  });

  return { qty, byStatus };
}

/**
 * @param {string[]} argv
 * @param {{
 *   bundleSource: typeof import('@agoric/bundle-source').default,
 *   spawn: typeof import('child_process')['spawn'],
 *   osType: typeof import('os')['type'],
 *   readFile: typeof import('fs')['promises']['readFile'],
 *   resolve: typeof import('path').resolve,
 *   dirname: typeof import('path').dirname,
 * }} io
 */
async function main(
  argv,
  { bundleSource, spawn, osType, readFile, resolve, dirname },
) {
  async function testSource(input) {
    const bundle = await bundleSource(input, 'getExport', {
      externals: ['ava', '@agoric/bundle-source', '@agoric/install-ses'],
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

    const { qty, byStatus } = await runTest(input, src, {
      withXSnap,
      bundleSource,
      resolve,
      dirname,
    });

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
    resolve: require('path').resolve,
    dirname: require('path').dirname,
  })
    .then(status => {
      process.exit(status);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
