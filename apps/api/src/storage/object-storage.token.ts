/** ObjectStorage (from @mobilio/storage) is an interface, not a class — DI needs a concrete token to bind it to. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
