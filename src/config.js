export const SEL = {
  anchor: "a",
  iconUser: "i.icon.icon-user",
  dropdown: "ul.dropdown-menu"
};

export const CONFIG = {
  DELAY_BETWEEN_MS: 2000,
  PER_ITEM_TIMEOUT_MS: 30000,
  MAX_RETRIES_PER_ITEM: 2,
  ROUTE_REFRESH_TIMEOUT_MS: 30000,
  ROUTE_SETTLE_MS: 350,
  ROUTE_EMPTY_GRACE_MS: 2500,
  OWNER_API_TIMEOUT_MS: 15000,
  OWNER_API_RETRY_DELAYS_MS: [800, 1500],
  DATABASE_API_GAP_MS: 100
};

export const LICENSE_API_BASE_URL = "https://ycut-license-api.sir8713642.workers.dev";
export const LICENSE_REQUEST_API = `${LICENSE_API_BASE_URL}/api/request-license`;
export const LICENSE_STATUS_API = `${LICENSE_API_BASE_URL}/api/license-status`;
export const PRODUCT_ID = "ycut_extractor";
export const COMM_GATEWAY_URL = "https://is.ycut.com.tw/magent/ashx/CommGateway.ashx";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log("[YCUT]", ...a);
