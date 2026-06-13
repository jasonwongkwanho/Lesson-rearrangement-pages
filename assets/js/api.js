(function () {
  "use strict";

  const listeners = new Set();
  let pendingCount = 0;

  function getConfig() {
    return window.APP_CONFIG || {};
  }

  function hasApiUrl() {
    return Boolean((getConfig().API_URL || "").trim());
  }

  function emit(status, message) {
    listeners.forEach(listener => listener({ status, message, pendingCount }));
  }

  function onStatus(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function buildGetUrl(action) {
    const rawUrl = (getConfig().API_URL || "").trim();
    const url = new URL(rawUrl);
    url.searchParams.set("action", action);
    return url.toString();
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error("無法解析 API 回應，請確認 Apps Script Web App 已重新部署為 API Gateway。");
    }
  }

  async function apiCall(action, payload) {
    if (!hasApiUrl()) {
      const message = "未設定 API_URL，請先在 docs/config.js 填入 Apps Script Web App /exec URL。";
      emit("failed", message);
      throw new Error(message);
    }

    pendingCount += 1;
    emit("syncing", "正在同步");

    const isReadOnly = payload === undefined || payload === null;
    const options = isReadOnly
      ? { method: "GET" }
      : {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action, payload })
        };

    const url = isReadOnly ? buildGetUrl(action) : (getConfig().API_URL || "").trim();

    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error("API HTTP 錯誤：" + response.status);
      }

      const result = await readJsonResponse(response);
      if (!result || result.ok !== true) {
        throw new Error((result && result.message) || "Apps Script 回傳同步失敗。");
      }

      pendingCount -= 1;
      if (pendingCount === 0) emit("synced", "已同步");
      return result.data;
    } catch (err) {
      pendingCount = Math.max(0, pendingCount - 1);
      emit("failed", err && err.message ? err.message : "同步失敗");
      throw err;
    }
  }

  window.AppApi = {
    apiCall,
    hasApiUrl,
    onStatus
  };
})();
