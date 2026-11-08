import {
  realpathSync,
  lstatSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  constants,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const PRIVATE_TARGET_PATH = '.wrangler/production-target.private.json';
const MAX_BYTES = 8192;
const fail = () => {
  throw Error('Private production selection unavailable.');
};
/** Fixed ignored file only; no env/CLI location or target overrides, credentials or remote ownership claim. */
export function loadProductionTarget(workspace) {
  let fd;
  try {
    const root = realpathSync(workspace),
      dir = join(root, '.wrangler'),
      path = join(root, PRIVATE_TARGET_PATH),
      uid = process.getuid?.();
    const parent = lstatSync(dir);
    if (
      parent.isSymbolicLink() ||
      !parent.isDirectory() ||
      uid === undefined ||
      parent.uid !== uid ||
      (parent.mode & 0o022) !== 0
    )
      fail();
    const before = lstatSync(path);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.uid !== uid ||
      before.nlink !== 1 ||
      (before.mode & 0o7777) !== 0o600 ||
      before.size < 1 ||
      before.size > MAX_BYTES
    )
      fail();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const first = fstatSync(fd);
    if (
      !first.isFile() ||
      first.dev !== before.dev ||
      first.ino !== before.ino ||
      first.uid !== uid ||
      first.nlink !== 1 ||
      (first.mode & 0o7777) !== 0o600 ||
      first.size !== before.size
    )
      fail();
    const buffer = Buffer.alloc(MAX_BYTES + 1),
      size = readSync(fd, buffer, 0, buffer.length, 0),
      last = fstatSync(fd);
    if (
      size < 1 ||
      size > MAX_BYTES ||
      size !== first.size ||
      last.nlink !== 1 ||
      last.size !== first.size ||
      last.dev !== first.dev ||
      last.ino !== first.ino ||
      last.mtimeMs !== first.mtimeMs ||
      last.ctimeMs !== first.ctimeMs
    )
      fail();
    const bytes = buffer.subarray(0, size),
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 3 ||
      !['version', 'target', 'preview'].every((k) => Object.hasOwn(value, k)) ||
      value.version !== 1
    )
      fail();
    return {
      target: value.target,
      preview: value.preview,
      manifestSha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch {
    fail();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
