// Build version is shared by both entry and workspace screens.
export const APP_VERSION:string = (require('../package.json') as {version:string}).version;
