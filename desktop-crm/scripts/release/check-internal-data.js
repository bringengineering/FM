'use strict';
// Specific packaging gate, not a general secret scanner or permission to push source.
function assertPublishable(pack) {
  if (!pack || pack.containsInternalAssignments !== false || !Array.isArray(pack.projects) || pack.projects.length) {
    throw Object.assign(new Error('Internal weekly assignments are embedded. Separate private assignment data before publishing CRM artifacts.'), {code:'INTERNAL_DATA_EMBEDDED'});
  }
}
if (require.main === module) {
  try {
    assertPublishable(require('../../src/weekly-execution-core').createWeeklyPack());
    console.log('Internal assignment artifact gate passed. Source-history privacy review remains required.');
  } catch (error) {
    console.error(error.code === 'INTERNAL_DATA_EMBEDDED' ? error.message : 'Unable to verify internal assignment packaging. Publication stopped.');
    process.exitCode=1;
  }
}
module.exports={assertPublishable};
