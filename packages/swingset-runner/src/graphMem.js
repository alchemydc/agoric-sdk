#!/usr/bin/env node
/* eslint-env node */

import { dataGraphApp } from './dataGraphApp.js';

export async function main() {
  // prettier-ignore
  await dataGraphApp(
    'block',
    'Block #',
    'rss',
    'Memory usage',
    ['rss', 'heapTotal', 'heapUsed', 'external'],
  );
}

process.exitCode = 1;
main().then(
  () => {
    process.exitCode = 0;
  },
  error => {
    console.error(error);
  },
);
