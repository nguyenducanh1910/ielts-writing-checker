// Version of this back end (a hash of its source, set by apps-script/build.mjs).
// The site compares it with the version it was built for and warns the teacher when the
// web app deployment runs older code.
declare const __BACKEND_VERSION__: string | undefined;

export const BACKEND_VERSION: string =
  typeof __BACKEND_VERSION__ === 'string' ? __BACKEND_VERSION__ : 'dev';
