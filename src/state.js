export const STATE = {
  nodes: new Set(),
  highlighted: false,
  observer: null,
  acting: false,
  extractStartedAt: 0,
  autoFollow: true,
  doorplateSelectEnabled: false,
  selectedColIdx: new Set(),
  colIdxToDoorplate: new Map()
};

export const legacyExtractorState = {
  running: false
};

export const databaseExtractorState = {
  running: false,
  cancelRequested: false,
  abortController: null,
  lastFailures: [],
  lastCommunityName: "community"
};

export function anyExtractorRunning() {
  return legacyExtractorState.running || databaseExtractorState.running;
}
