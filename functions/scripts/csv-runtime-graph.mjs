import {posix} from 'node:path';
export const CSV_RUNTIME_SEEDS=['rnd-control/csv-import-audit.js','rnd-control/drive.js'];
export function safeCSVRuntimePath(name){if(typeof name!=='string'||! /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:js|mjs)$/.test(name))throw Error('Unsafe CSV runtime dependency');return name;}
export function csvRuntimeDependencies(name,content){safeCSVRuntimePath(name);const out=[];for(const match of content.toString('utf8').matchAll(/(?:require\(\s*|import\(\s*|from\s*)['"](\.\.?\/[^'"]+)['"]/g)){let path=posix.normalize(posix.join(posix.dirname(name),match[1]));if(!posix.extname(path))path+='.js';out.push(safeCSVRuntimePath(path));}return out;}
