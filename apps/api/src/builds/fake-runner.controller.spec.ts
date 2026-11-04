import { NotFoundException } from '@nestjs/common';
import { FakeRunnerController } from './fake-runner.controller.js';
import { FakeRunner } from './fake-runner.js';

describe('FakeRunnerController', () => {
  const originalBuildRunner = process.env.BUILD_RUNNER;

  afterEach(() => {
    if (originalBuildRunner === undefined) delete process.env.BUILD_RUNNER;
    else process.env.BUILD_RUNNER = originalBuildRunner;
  });

  it('404s when BUILD_RUNNER is not "fake" — this route does nothing on a real deployment', () => {
    process.env.BUILD_RUNNER = 'github';
    const fakeRunner = new FakeRunner();
    const controller = new FakeRunnerController(fakeRunner);

    expect(() => controller.list()).toThrow(NotFoundException);
  });

  it('returns every dispatch FakeRunner has recorded when BUILD_RUNNER=fake', () => {
    process.env.BUILD_RUNNER = 'fake';
    const fakeRunner = new FakeRunner();
    fakeRunner.dispatched.push({ id: 'build-1', token: 'raw-token', baseUrl: 'http://localhost:3011' });
    const controller = new FakeRunnerController(fakeRunner);

    expect(controller.list()).toEqual([{ id: 'build-1', token: 'raw-token', baseUrl: 'http://localhost:3011' }]);
  });
});
