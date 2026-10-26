const { withEntitlementsPlist } = require('expo/config-plugins');
module.exports = config => withEntitlementsPlist(config, result => {
  result.modResults['com.apple.developer.default-data-protection'] = 'NSFileProtectionComplete';
  return result;
});
