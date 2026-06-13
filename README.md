# 編代課系統

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

`config.js` 內的 `API_URL` 需要在 public repo 部署前填入。

注意：public repo 內的 `config.js` 會被公開讀取，所以 Apps Script API 不能只依賴 URL 保密。正式使用前應確認 Apps Script Web App 的存取權限設定符合學校需要。

首頁「切換日期並同步」會呼叫 Apps Script 的 `apiSwitchScheduleDateAndLoad`：有該日 CSV 備存就載入，沒有備存就清空每日資料並保留新日期。前台不做自動同步；如線上 Apps Script 尚未部署此 API，會 fallback 用舊有 `apiSaveRequestData` 先更新日期，再嘗試 LOAD，找不到備存時清空舊有資料。

右上角 `SAVE` / `LOAD` 分別執行 CSV 備份輸出及 CSV 備份載入；「匯出 MS Access 格式」完成後會同時開啟 Google Sheet 的 `Access 專用` 工作頁。
