export function createInputState(){
  const versions=new Map();let generation=0;
  return {get size(){return versions.size;},version:id=>versions.get(id)??0,
    touch(id){if(id)versions.set(id,++generation);},
    delete(id,expected){if(expected!==undefined&&(versions.get(id)??0)!==expected)return false;return versions.delete(id);},
    clear(){versions.clear();generation++;}};
}
