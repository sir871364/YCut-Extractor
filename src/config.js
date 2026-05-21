export const SEL = {
  anchor: "a",
  iconUser: "i.icon.icon-user",
  dropdown: "ul.dropdown-menu"
};

export const CONFIG = {
  DELAY_BETWEEN_MS: 2000,
  PER_ITEM_TIMEOUT_MS: 30000,
  MAX_RETRIES_PER_ITEM: 2
};

export const LICENSE_STATUS_API = "https://ycut-license-api.sir8713642.workers.dev/api/license-status";
export const PRODUCT_ID = "ycut_extractor";
export const COMM_GATEWAY_URL = "https://is.ycut.com.tw/magent/ashx/CommGateway.ashx";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log("[YCUT]", ...a);
