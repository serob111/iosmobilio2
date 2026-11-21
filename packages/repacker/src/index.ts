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
export { generateIcons, ICON_FILES } from './icons.js';
export { generateSplash } from './splash.js';
export { validateProjectConfig, writeConfigJson } from './config-bundle.js';
export { buildEntitlements, writeEntitlements, type EntitlementsInput } from './entitlements.js';
export { embedProvisioningProfile } from './provisioning.js';
export { assertValidBundleId, assertValidTeamId } from './validation.js';
export { signBundle, verifyBundle, type RcodesignConfig, type SigningCredentials } from './sign.js';
