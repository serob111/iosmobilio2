export { RepackError, type RepackErrorCode } from './errors.js';
export { sha256File, assertBaseChecksum } from './checksum.js';
export { extractZip } from './extract.js';
export { createZip } from './archive.js';
export {
  readInfoPlist,
  writeInfoPlist,
  applyClientIdentity,
  type InfoPlistDict,
  type ClientIdentity,
} from './info-plist.js';
