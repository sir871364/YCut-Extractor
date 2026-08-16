export const STATE = {
  nodes: new Set(),
  highlighted: false,
  observer: null,
  acting: false,
  extractStartedAt: 0,
  autoFollow: true,
  doorplateSelectEnabled: false,
  // 篩選依據是門牌名稱而非欄位索引：換路段／棟別後表格會重建，
  // 同一個欄位索引會對應到完全不同的門牌
  selectedDoorplates: new Set(),
  colIdxToDoorplate: new Map()
};

export const legacyExtractorState = {
  running: false,
  cancelRequested: false,
  abortController: null
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
