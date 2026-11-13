import { randomBytes } from 'node:crypto';
import { validateBuildEnv } from './validate-build-env.js';

const VALID_KEY = randomBytes(32).toString('base64');

describe('validateBuildEnv', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function setGithubEnv(): void {
    process.env.BUILD_RUNNER = 'github';
    process.env.API_PUBLIC_URL = 'https://api.example.com';
    process.env.GITHUB_DISPATCH_TOKEN = 'gh-dispatch-token';
    process.env.GITHUB_REPO = 'serob111/iosmobilio2';
    process.env.BUILD_TOKEN_KEY = VALID_KEY;
  }

  it('passes with BUILD_RUNNER=github and every required var set', () => {
    setGithubEnv();
    expect(() => validateBuildEnv()).not.toThrow();
  });

  it('treats an unset BUILD_RUNNER the same as "github" (the real default)', () => {
    setGithubEnv();
    delete process.env.BUILD_RUNNER;
    expect(() => validateBuildEnv()).not.toThrow();
  });

  it('throws when API_PUBLIC_URL is missing', () => {
    setGithubEnv();
    delete process.env.API_PUBLIC_URL;
    expect(() => validateBuildEnv()).toThrow(/API_PUBLIC_URL/);
  });

  it('throws when API_PUBLIC_URL does not start with https://', () => {
    setGithubEnv();
    process.env.API_PUBLIC_URL = 'http://not-secure.example.com';
    expect(() => validateBuildEnv()).toThrow(/https/);
  });

  it('throws when GITHUB_DISPATCH_TOKEN is missing', () => {
    setGithubEnv();
    delete process.env.GITHUB_DISPATCH_TOKEN;
    expect(() => validateBuildEnv()).toThrow(/GITHUB_DISPATCH_TOKEN/);
  });

  it('throws when GITHUB_REPO is missing', () => {
    setGithubEnv();
    delete process.env.GITHUB_REPO;
    expect(() => validateBuildEnv()).toThrow(/GITHUB_REPO/);
  });

  it('throws when BUILD_TOKEN_KEY is missing', () => {
    setGithubEnv();
    delete process.env.BUILD_TOKEN_KEY;
    expect(() => validateBuildEnv()).toThrow(/BUILD_TOKEN_KEY/);
  });

  it('throws when BUILD_TOKEN_KEY does not decode to 32 bytes', () => {
    setGithubEnv();
    process.env.BUILD_TOKEN_KEY = Buffer.from('too-short').toString('base64');
    expect(() => validateBuildEnv()).toThrow(/32 bytes/);
  });

  it('BUILD_RUNNER=fake skips every other check, even with nothing else set', () => {
    process.env.BUILD_RUNNER = 'fake';
    delete process.env.API_PUBLIC_URL;
    delete process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.GITHUB_REPO;
    delete process.env.BUILD_TOKEN_KEY;
    delete process.env.NODE_ENV;
    expect(() => validateBuildEnv()).not.toThrow();
  });

  it('refuses to start with BUILD_RUNNER=fake when NODE_ENV=production', () => {
    process.env.BUILD_RUNNER = 'fake';
    process.env.NODE_ENV = 'production';
    expect(() => validateBuildEnv()).toThrow(/production/);
  });

  it('allows BUILD_RUNNER=fake outside production (e.g. test/development)', () => {
    process.env.BUILD_RUNNER = 'fake';
    process.env.NODE_ENV = 'test';
    expect(() => validateBuildEnv()).not.toThrow();
  });
});
