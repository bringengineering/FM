// Never delete a gallery URI or the only camera copy after a failed commit.
// A generated cache copy can be discarded even if the vault write fails.
export function captureCleanupUris(source:string,output:string|undefined,cache:string,committed:boolean):string[]{
  const prefix=cache.endsWith('/')?cache:cache+'/';
  const values=committed?[source,output]:output&&output!==source?[output]:[];
  return [...new Set(values.filter((uri):uri is string=>typeof uri==='string'&&uri.startsWith(prefix)))];
}
