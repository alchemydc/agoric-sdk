import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

import { openSwingStore } from '@agoric/swing-store-simple';

// Adapted from https://stackoverflow.com/a/43866992/14073862
export function generateAccessToken({
  stringBase = 'base64url',
  byteLength = 48,
} = {}) {
  return new Promise((resolve, reject) =>
    crypto.randomBytes(byteLength, (err, buffer) => {
      if (err) {
        reject(err);
      } else if (stringBase === 'base64url') {
        // Convert to url-safe base64.
        const base64 = buffer.toString('base64');
        const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_');
        resolve(base64url);
      } else {
        resolve(buffer.toString(stringBase));
      }
    }),
  );
}

export async function getAccessToken(port) {
  // Ensure we're protected with a unique accessToken for this basedir.
  const sharedStateDir = path.join(os.homedir(), '.agoric');
  await fs.promises.mkdir(sharedStateDir, { mode: 0o700, recursive: true });

  // Ensure an access token exists.
  const { kvStore, commit, close } = openSwingStore(sharedStateDir, 'state');
  const accessTokenKey = `accessToken/${port}`;
  if (!kvStore.has(accessTokenKey)) {
    kvStore.set(accessTokenKey, await generateAccessToken());
    commit();
  }
  const accessToken = kvStore.get(accessTokenKey);
  close();
  return accessToken;
}