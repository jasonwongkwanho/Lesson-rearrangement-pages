# 編代課系統網頁同步版

這個資料夾是 public pages repo 專用輸出版，只包含可公開部署的靜態網頁檔案。

## 建議用途

將本資料夾內的檔案複製到另一個新的 public repository root，例如：

```text
Lesson-rearrangement-pages/
  index.html
  config.js
  assets/
```

然後在該 public repository 啟用 GitHub Pages。

## Do not copy internal files

不要把主系統 repo 的以下檔案或資料夾放到 public repo：

- Apps Script source files，例如 `WebApp.gs`、`Index.html`、`*.gs.txt`
- 主 repo 的 `docs/AI_CONTEXT.md`
- 主 repo 的 `docs/SHEET_DATA_MODEL.md`
- 主 repo 的 `docs/SCRIPT_MAP.md`
- 主 repo 的 `docs/OPERATIONS_AND_SAFETY.md`
- 測試檔、skill、CSV helper、git history

## 部署設定

`config.js` 內的 `API_URL` 和 `LEGACY_WEBAPP_URL` 需要在 public repo 部署前填入。

注意：public repo 內的 `config.js` 會被公開讀取，所以 Apps Script API 不能只依賴 URL 保密。正式使用前應確認 Apps Script Web App 的存取權限設定符合學校需要。

## 同步策略

- 前台輸入會即時更新畫面。
- 輕量頁面可用背景自動同步，預設停手 5 秒後才寫入後台，避免每打一格都呼叫 Apps Script。
- `AUTO_SAVE_SECTIONS` 預設只包含 `request`、`adjust`、`manualPlan`、`cancelled`。
- `duty`（安排代課）保留手動「同步到後台 / 確認並同步」，因為後端儲存會連動較重的 Apps Script 流程。
