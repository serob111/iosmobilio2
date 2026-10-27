import { Injectable } from '@nestjs/common';
import type { BuildRunner } from './build-runner.js';

const GITHUB_API = 'https://api.github.com';

/**
 * Dispatches build-ipa.yml via GitHub's workflow_dispatch REST endpoint. The workflow
 * itself calls back into this api using the bearer token passed here — GITHUB_* env vars
 * are only ever read in this one class, never by BuildsService or anything downstream of it.
 */
@Injectable()
export class GithubActionsRunner implements BuildRunner {
  async dispatch(build: { id: string; token: string; baseUrl: string }): Promise<void> {
    const dispatchToken = process.env.GITHUB_DISPATCH_TOKEN;
    const repo = process.env.GITHUB_REPO;
    if (!dispatchToken || !repo) {
      throw new Error('GITHUB_DISPATCH_TOKEN/GITHUB_REPO are not configured');
    }
    const workflow = process.env.GITHUB_WORKFLOW ?? 'build-ipa.yml';
    const ref = process.env.GITHUB_REF ?? 'main';

    const res = await fetch(`${GITHUB_API}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dispatchToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref,
        inputs: { buildId: build.id, buildToken: build.token, baseUrl: build.baseUrl },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub Actions dispatch failed (${res.status}): ${text}`);
    }
  }
}
