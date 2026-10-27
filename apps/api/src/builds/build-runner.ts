/**
 * Whatever actually produces the .ipa for a build — GitHub Actions today, a
 * template-repack step later. BuildsService only ever talks to this interface, never to
 * GitHub directly, so swapping the implementation later doesn't touch anything else.
 */
export interface BuildRunner {
  dispatch(build: { id: string; token: string; baseUrl: string }): Promise<void>;
}

/** ObjectStorage-style symbol token — BuildRunner is an interface, DI needs something concrete to bind it to. */
export const BUILD_RUNNER = Symbol('BUILD_RUNNER');
