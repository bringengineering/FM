'use strict';
const MarketingCore = require('./marketing-core');

const READ_OR_CONTROL = [
  'crm:auth-state','crm:ai-assist','crm:consultation-audio-pick','crm:consultation-audio-transcribe','crm:quote-export','crm:quote-supplier-load','crm:auth-login','crm:auth-google-login','crm:field-reauthenticate-google','crm:auth-change-password','crm:auth-logout',
  'crm:load','crm:office-load','crm:office-attendance-export','crm:office-attachment-open','crm:office-messenger-presence','crm:operations-intelligence-load','crm:canonical-building-units-load',
  'crm:field-summaries-load','crm:customer-photos-load','crm:drive-import-candidates-load','crm:contract-sources-load','crm:marketing-read','crm:field-team-profiles',
  'crm:operations-load','crm:workflow-vendors','crm:workflow-files','crm:customer-photo-pick','crm:data-path','crm:update-state','crm:update-check',
  'crm:update-install','crm:field-bounds','crm:valuescope-bounds','crm:show-valuescope','crm:hide-valuescope','crm:field-cancel',
  'crm:show-field-platform','crm:hide-field-platform','crm:field-reconnect','crm:open-external','crm:vendor-lookup','crm:building-link-lookup'
];
const MUTATIONS = [
  'crm:save','crm:save-now','crm:quote-supplier-save','crm:office-attendance-save','crm:office-attendance-correct','crm:office-display-name-save','crm:office-attachment-pick','crm:office-attachment-drop','crm:office-message-send','crm:office-messages-read','crm:operation-save','crm:customer-photo-save',
  'crm:drive-import-decision','crm:contract-source-register','crm:contract-source-check','crm:contract-source-decision','crm:canonical-entity-commit','crm:building-schedule-commit','crm:marketing-commit','crm:marketing-archive',
  'crm:marketing-attribution-update','crm:work-operations-sync-retry','crm:canonical-building-units-configure','crm:case-save','crm:payment-override',
  'crm:payment-schedule-save','crm:payment-schedule-delete','crm:payment-bank-binding','crm:workflow-action','crm:field-request','crm:backup','crm:restore'
];
const CHANNEL_POLICY = Object.freeze(Object.fromEntries([
  ...READ_OR_CONTROL.map(channel => [channel, 'control']),
  ...MUTATIONS.map(channel => [channel, 'mutation'])
]));
const MARKETING_MUTATIONS = new Set(['crm:marketing-commit','crm:marketing-archive','crm:marketing-attribution-update']);

function classification(channel) { return CHANNEL_POLICY[channel] || '' }
function assertRegistered(channel) {
  if (!classification(channel)) { const error = new Error(`unclassified IPC channel: ${channel}`); error.code = 'UNCLASSIFIED_IPC'; throw error; }
}
function assertChannelAllowed(channel, user) {
  assertRegistered(channel);
  if (['crm:marketing-commit','crm:marketing-archive'].includes(channel) && !MarketingCore.canEditAdSpend(user)) {
    const error = new Error('marketing ad spend forbidden'); error.code = 'MARKETING_AD_SPEND_FORBIDDEN'; throw error;
  }
  if (channel === 'crm:marketing-attribution-update' && !MarketingCore.canEditAttribution(user)) {
    const error = new Error('marketing attribution forbidden'); error.code = 'MARKETING_ATTRIBUTION_FORBIDDEN'; throw error;
  }
  if (classification(channel) === 'mutation' && user && (user.accessRole || user.role) === 'member' && user.marketingRole === 'marketing' && !MARKETING_MUTATIONS.has(channel)) {
    const error = new Error('marketing-only session cannot perform this mutation'); error.code = 'MARKETING_ONLY_FORBIDDEN'; throw error;
  }
  return true;
}

module.exports = Object.freeze({ CHANNEL_POLICY, classification, assertRegistered, assertChannelAllowed });
