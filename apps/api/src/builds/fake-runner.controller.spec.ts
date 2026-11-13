import { FakeRunnerController } from './fake-runner.controller.js';
import { FakeRunner } from './fake-runner.js';

describe('FakeRunnerController', () => {
  it('returns every dispatch FakeRunner has recorded', () => {
    const fakeRunner = new FakeRunner();
    fakeRunner.dispatched.push({ id: 'build-1', token: 'raw-token', baseUrl: 'http://localhost:3011' });
    const controller = new FakeRunnerController(fakeRunner);

    expect(controller.list()).toEqual([{ id: 'build-1', token: 'raw-token', baseUrl: 'http://localhost:3011' }]);
  });
});
