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
