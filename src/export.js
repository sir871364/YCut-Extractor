import { isValidPdfHref } from "./pdf.js";

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 0);
}

function downloadJson(data, filename = `ycut_${Date.now()}.json`) {
  downloadBlob(JSON.stringify(data, null, 2), "application/json;charset=utf-8", filename);
}

export function normalizePdfUrls(pdfUrls) {
  const seen = new Set();
  const normalized = [];
  for (const value of pdfUrls || []) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url || !isValidPdfHref(url) || seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
  }
  return normalized;
}

function safeName(value) {
  return String(value || "community")
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "community";
}

export function getCommunityName() {
  const breadcrumb = document.querySelector('.breadcrumb, [class*="breadcrumb"], [class*="crumb"]');
  if (breadcrumb) {
    const parts = (breadcrumb.innerText || breadcrumb.textContent || "")
      .split(/[\/\n>]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (document.title || "community").replace(/[^\p{L}\p{N}_-]/gu, "") || "community";
}

export function createPdfExportBaseFilename(communityName = "community") {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `ycut_pdf_database_${safeName(communityName)}_${stamp}`;
}

export function exportPdfUrlJson(pdfUrls, filename) {
  const normalized = normalizePdfUrls(pdfUrls);
  downloadJson(normalized, filename.endsWith(".json") ? filename : `${filename}.json`);
  return normalized;
}

function csvCell(value) {
  return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
}

export function buildFailuresCsv(failures) {
  const headers = ["路段", "門牌", "Etr_idx", "Owner_idx", "重試次數", "失敗原因"];
  const rows = failures.map((failure) => [
    failure.route,
    failure.door ?? failure.doorplate ?? failure.household ?? failure.text,
    failure.etr_idx ?? failure.etrIdx,
    failure.owner_idx ?? failure.ownerIdx,
    failure.attempts,
    failure.reason
  ]);
  return `\uFEFF${headers.map(csvCell).join(",")}\r\n${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function exportFailuresCsv(failures, filename) {
  if (!Array.isArray(failures) || failures.length === 0) return false;
  const csv = buildFailuresCsv(failures);
  downloadBlob(csv, "text/csv;charset=utf-8", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  return true;
}

export function exportPdfResults(pdfUrls, failures, communityName = "community") {
  const baseFilename = createPdfExportBaseFilename(communityName);
  const normalizedUrls = exportPdfUrlJson(pdfUrls, `${baseFilename}.json`);
  if (failures.length > 0) {
    exportFailuresCsv(failures, `${baseFilename}_failures.csv`);
  }
  return { baseFilename, pdfUrls: normalizedUrls };
}

export function exportFailureList(failures, communityName = "community") {
  if (!Array.isArray(failures) || failures.length === 0) return false;
  const baseFilename = createPdfExportBaseFilename(communityName);
  return exportFailuresCsv(failures, `${baseFilename}_failures.csv`);
}
