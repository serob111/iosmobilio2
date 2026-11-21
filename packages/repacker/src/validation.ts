import { RepackError } from './errors.js';

// Reverse-DNS, matching what the server-side generator actually produces
// (am.mobilio.t.<id>) — never trusted from raw user input in the first place, but
// validated here too as defense in depth against a caller bug reaching this deep
// into the pipeline with something unvalidated.
const BUNDLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;

export function assertValidBundleId(bundleId: string): void {
  if (!BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new RepackError('INVALID_CONFIG', `bundleId "${bundleId}" is not a valid reverse-DNS identifier`);
  }
}

// Apple Team IDs are always exactly 10 uppercase alphanumeric characters.
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

export function assertValidTeamId(teamId: string): void {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new RepackError('INVALID_CONFIG', `teamId "${teamId}" is not a valid 10-character Apple Team ID`);
  }
}
