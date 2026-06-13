(function () {
  "use strict";

  const PAGE_TITLES = {
    dashboard: "首頁",
    request: "缺課名單",
    adjust: "調堂安排",
    manualPlan: "外援代課老師安排",
    cancelled: "取消課節可調入名單",
    duty: "編排是日代課節數",
    tools: "系統工具"
  };

  const READ_ACTIONS = {
    meta: "apiGetAppMeta",
    request: "apiGetRequestData",
    adjust: "apiGetAdjustData",
    manualPlan: "apiGetManualPlanData",
    cancelled: "apiGetCancelledAvailableData",
    duty: "apiGetDutyData"
  };

  const state = {
    activeView: "dashboard",
    meta: null,
    request: { header: [], rows: [] },
    adjust: { rows: [] },
    manualPlan: { headers: [], rows: [] },
    cancelled: { headers: [], rows: [] },
    duty: { headers: [], rows: [], visibleCols: [], statusOptions: [] },
    dutyFilter: {
      search: "",
      status: "",
      period: "",
      teacher: "",
      sortBy: "period",
      direction: "asc"
    },
    dirty: new Set(),
    isSyncing: false,
    lastSyncAt: null
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function init() {
    applyConfigText();
    bindNavigation();
    bindActions();
    bindApiStatus();
    renderAll();
  }

  function applyConfigText() {
    const config = window.APP_CONFIG || {};
    $$("[data-app-name]").forEach(el => { el.textContent = config.APP_NAME || "編代課系統"; });
    $$("[data-app-subtitle]").forEach(el => { el.textContent = config.APP_SUBTITLE || ""; });
    $$("[data-school-name]").forEach(el => { el.textContent = config.SCHOOL_NAME || ""; });
  }

  function bindNavigation() {
    $$("[data-nav]").forEach(button => {
      button.addEventListener("click", () => setActiveView(button.dataset.nav));
    });
  }

  function bindActions() {
    $$("[data-refresh-current]").forEach(button => button.addEventListener("click", refreshCurrentView));
    $$("[data-refresh-all]").forEach(button => button.addEventListener("click", syncAll));
    $$("[data-refresh-section]").forEach(button => {
      button.addEventListener("click", () => refreshSection(button.dataset.refreshSection));
    });
    $$("[data-save-section]").forEach(button => {
      button.addEventListener("click", () => saveSection(button.dataset.saveSection));
    });
    $$("[data-add-row]").forEach(button => {
      button.addEventListener("click", () => addRow(button.dataset.addRow));
    });
    $$("[data-remove-row]").forEach(button => {
      button.addEventListener("click", () => removeRow(button.dataset.removeRow));
    });
    $$("[data-confirm-arrange]").forEach(button => {
      button.addEventListener("click", confirmArrange);
    });
    const switchDateButton = $("[data-switch-date]");
    if (switchDateButton) switchDateButton.addEventListener("click", switchScheduleDate);
    bindDutyFilter();
    $$("[data-run-action]").forEach(button => {
      button.addEventListener("click", () => runBackendAction(button.dataset.runAction, button.textContent.trim()));
    });
  }

  function bindDutyFilter() {
    const search = $("#dutySearch");
    const status = $("#dutyStatusFilter");
    const period = $("#dutyPeriodFilter");
    const teacher = $("#dutyTeacherFilter");
    const sortBy = $("#dutySortBy");
    const sortDirection = $("#dutySortDirection");
    const reset = $("#dutyFilterReset");

    if (search) search.addEventListener("input", () => {
      state.dutyFilter.search = search.value.trim();
      renderDutyTable();
    });
    if (status) status.addEventListener("change", () => {
      state.dutyFilter.status = status.value;
      renderDutyTable();
    });
    if (period) period.addEventListener("change", () => {
      state.dutyFilter.period = period.value;
      renderDutyTable();
    });
    if (teacher) teacher.addEventListener("change", () => {
      state.dutyFilter.teacher = teacher.value;
      renderDutyTable();
    });
    if (sortBy) sortBy.addEventListener("change", () => {
      state.dutyFilter.sortBy = sortBy.value;
      renderDutyTable();
    });
    if (sortDirection) sortDirection.addEventListener("click", () => {
      state.dutyFilter.direction = state.dutyFilter.direction === "asc" ? "desc" : "asc";
      syncDutyFilterControls();
      renderDutyTable();
    });
    if (reset) reset.addEventListener("click", () => {
      state.dutyFilter = { search: "", status: "", period: "", teacher: "", sortBy: "period", direction: "asc" };
      syncDutyFilterControls();
      renderDutyTable();
    });
  }

  function bindApiStatus() {
    window.AppApi.onStatus(info => {
      state.isSyncing = info.status === "syncing";
      if (info.status === "syncing") {
        setSyncStatus("正在同步", "syncing");
      } else if (info.status === "synced") {
        setSyncStatus("已同步", state.dirty.size ? "dirty" : "synced");
      } else if (info.status === "failed") {
        setSyncStatus("同步失敗", "failed");
        showToast(info.message || "同步失敗", "error");
      }
      setButtonsDisabled(state.isSyncing);
    });
  }

  function setActiveView(viewName) {
    state.activeView = viewName;
    $$("[data-nav]").forEach(button => button.classList.toggle("active", button.dataset.nav === viewName));
    $$("[data-view]").forEach(view => view.classList.toggle("active", view.dataset.view === viewName));
    $("[data-page-title]").textContent = PAGE_TITLES[viewName] || "編代課系統";
  }

  async function syncAll() {
    if (!ensureApiConfigured()) {
      renderAll();
      return;
    }

    try {
      const meta = await window.AppApi.apiCall(READ_ACTIONS.meta);
      const request = await window.AppApi.apiCall(READ_ACTIONS.request);
      const adjust = await window.AppApi.apiCall(READ_ACTIONS.adjust);
      const manualPlan = await window.AppApi.apiCall(READ_ACTIONS.manualPlan);
      const cancelled = await window.AppApi.apiCall(READ_ACTIONS.cancelled);
      const duty = await window.AppApi.apiCall(READ_ACTIONS.duty);

      state.meta = meta || null;
      state.request = normalizeRequestData(request);
      state.adjust = normalizeAdjustData(adjust);
      state.manualPlan = normalizeEditableData(manualPlan);
      state.cancelled = normalizeEditableData(cancelled);
      state.duty = normalizeDutyData(duty);
      state.dirty.clear();
      updateLastSync();
      renderAll();
    } catch (err) {
      renderConfigAlert(err.message || "同步失敗");
    }
  }

  async function refreshSection(sectionName) {
    if (!ensureApiConfigured()) return;
    if (state.dirty.has(sectionName)) {
      showToast("此頁有尚未同步改動，請先確認並同步。", "error");
      setSyncStatus("尚未同步", "dirty");
      return;
    }

    try {
      if (sectionName === "dashboard") {
        await refreshMeta();
      } else {
        const data = await window.AppApi.apiCall(READ_ACTIONS[sectionName]);
        assignSectionData(sectionName, data);
        await refreshMeta();
      }
      updateLastSync();
      renderAll();
    } catch (err) {
      renderConfigAlert(err.message || "同步失敗");
    }
  }

  async function refreshCurrentView() {
    if (state.activeView === "tools") {
      await refreshMeta();
      renderAll();
      return;
    }
    await refreshSection(state.activeView);
  }

  async function refreshMeta() {
    state.meta = await window.AppApi.apiCall(READ_ACTIONS.meta);
  }

  function assignSectionData(sectionName, data) {
    if (sectionName === "request") state.request = normalizeRequestData(data);
    if (sectionName === "adjust") state.adjust = normalizeAdjustData(data);
    if (sectionName === "manualPlan") state.manualPlan = normalizeEditableData(data);
    if (sectionName === "cancelled") state.cancelled = normalizeEditableData(data);
    if (sectionName === "duty") state.duty = normalizeDutyData(data);
    state.dirty.delete(sectionName);
  }

  async function saveSection(sectionName) {
    if (!ensureApiConfigured()) return;
    if (!state.dirty.has(sectionName)) {
      showToast("此頁沒有尚未同步改動。");
      return;
    }

    try {
      if (sectionName === "request") {
        await window.AppApi.apiCall("apiSaveRequestData", {
          dateInput: state.request.dateInput || summaryValue("selectedDateInput"),
          rows: state.request.rows
        });
        await window.AppApi.apiCall("apiRunAction", { actionName: "autoGenerateAndApplyManualSubstitutePlan" });
      }
      if (sectionName === "adjust") {
        await window.AppApi.apiCall("apiSaveAdjustData", { rows: state.adjust.rows });
      }
      if (sectionName === "manualPlan") {
        await window.AppApi.apiCall("apiSaveManualPlanData", { rows: state.manualPlan.rows });
      }
      if (sectionName === "cancelled") {
        await window.AppApi.apiCall("apiSaveCancelledAvailableData", { rows: state.cancelled.rows });
      }
      if (sectionName === "duty") {
        await window.AppApi.apiCall("apiSaveDutyData", { rows: state.duty.rows });
      }

      state.dirty.delete(sectionName);
      await syncAll();
      showToast("已同步");
    } catch (err) {
      showToast(err.message || "同步失敗", "error");
    }
  }

  async function confirmArrange() {
    if (!ensureApiConfigured()) return;
    try {
      const saveResult = state.dirty.has("duty")
        ? await window.AppApi.apiCall("apiSaveDutyData", { rows: state.duty.rows })
        : null;
      if (saveResult && saveResult.success === false) throw new Error(saveResult.message || "同步失敗");
      await window.AppApi.apiCall("apiRunAction", { actionName: "autoGenerateAndSuggest" });
      state.dirty.delete("duty");
      await syncAll();
      showToast("已同步");
    } catch (err) {
      showToast(err.message || "同步失敗", "error");
    }
  }

  async function runBackendAction(actionName, label) {
    if (!ensureApiConfigured()) return;
    if (state.dirty.size) {
      showToast("仍有尚未同步改動，請先處理表格改動。", "error");
      setSyncStatus("尚未同步", "dirty");
      return;
    }
    const confirmed = window.confirm("執行「" + label + "」？");
    if (!confirmed) return;

    const accessWindow = prepareAccessSheetWindow(actionName);
    try {
      await window.AppApi.apiCall("apiRunAction", { actionName });
      await syncAll();
      completeAccessSheetWindow(accessWindow);
      showToast("已同步");
    } catch (err) {
      closeAccessSheetWindow(accessWindow);
      showToast(err.message || "同步失敗", "error");
    }
  }

  function prepareAccessSheetWindow(actionName) {
    if (actionName !== "exportAndUpdateSummary") return null;
    const url = getAccessSheetUrl();
    if (url) {
      window.open(url, "_blank", "noopener");
      return { opened: true, popup: null };
    }
    return { opened: false, popup: window.open("about:blank", "_blank") };
  }

  function completeAccessSheetWindow(accessWindow) {
    if (!accessWindow || accessWindow.opened) return;
    const url = getAccessSheetUrl();
    if (!url) {
      closeAccessSheetWindow(accessWindow);
      return;
    }
    if (accessWindow.popup && !accessWindow.popup.closed) {
      accessWindow.popup.location.href = url;
      try {
        accessWindow.popup.opener = null;
      } catch (err) {
        // Some browsers block opener reassignment after navigation.
      }
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  function closeAccessSheetWindow(accessWindow) {
    if (accessWindow && accessWindow.popup && !accessWindow.popup.closed) {
      accessWindow.popup.close();
    }
  }

  function getAccessSheetUrl() {
    return state.meta && state.meta.accessSheetUrl ? state.meta.accessSheetUrl : "";
  }

  async function switchScheduleDate() {
    if (!ensureApiConfigured()) return;

    const input = $("#dateSwitchInput");
    const dateInput = input ? input.value : "";
    const confirmed = window.confirm("切換日期會檢查該日備存；有資料會載入，沒有資料會清空每日資料並保留新日期。確定繼續？");
    if (!confirmed) return;

    try {
      const result = await switchScheduleDateAndLoad(dateInput);
      await syncAll();
      showToast(result && result.message ? result.message : "已同步");
    } catch (err) {
      showToast(err.message || "同步失敗", "error");
    }
  }

  async function switchScheduleDateAndLoad(dateInput) {
    try {
      return await window.AppApi.apiCall("apiSwitchScheduleDateAndLoad", { dateInput }, { suppressFailureStatus: true });
    } catch (err) {
      if (!isUnsupportedActionError(err, "apiSwitchScheduleDateAndLoad")) {
        setSyncStatus("同步失敗", "failed");
        throw err;
      }
      return switchScheduleDateAndLoadFallback(dateInput);
    }
  }

  async function switchScheduleDateAndLoadFallback(dateInput) {
    const requestRows = await readCurrentRequestRowsForDateFallback();
    await window.AppApi.apiCall("apiSaveRequestData", {
      dateInput,
      rows: requestRows
    });
    try {
      return await window.AppApi.apiCall("apiRunAction", { actionName: "importCsv" });
    } catch (err) {
      if (!isMissingDateBackupError(err)) throw err;
      await window.AppApi.apiCall("apiRunAction", { actionName: "clearDailyData" });
      return { success: true, loaded: false, cleared: true, message: "找不到該日期備存，已清空舊有資料。" };
    }
  }

  async function readCurrentRequestRowsForDateFallback() {
    try {
      const requestData = await window.AppApi.apiCall(READ_ACTIONS.request);
      return requestData && Array.isArray(requestData.rows) ? requestData.rows : [];
    } catch (err) {
      return state.request && Array.isArray(state.request.rows) ? state.request.rows : [];
    }
  }

  function isUnsupportedActionError(err, actionName) {
    const message = err && err.message ? err.message : String(err || "");
    return message.includes("不支援的 API action") && message.includes(actionName);
  }

  function isMissingDateBackupError(err) {
    const message = err && err.message ? err.message : String(err || "");
    return message.includes("找不到日期子資料夾") || message.includes("B2 沒日期");
  }

  function addRow(sectionName) {
    if (sectionName === "request") {
      const width = Math.max(1, state.request.header.length || 15);
      state.request.rows.push(Array.from({ length: width }, (_, index) => index === 0 ? "" : false));
    }
    if (sectionName === "adjust") {
      state.adjust.rows.push({ id: "", weekday: "", period: "", subject: "", group: "", originTeacher: "", swapTeacher: "", repay: false });
    }
    if (sectionName === "manualPlan") {
      state.manualPlan.rows.push(["", ""]);
    }
    if (sectionName === "cancelled") {
      state.cancelled.rows.push([""]);
    }
    if (sectionName === "duty") {
      const width = Math.max(25, state.duty.headers.length || 0);
      state.duty.rows.push(Array.from({ length: width }, () => ""));
    }
    markDirty(sectionName);
    renderAll();
  }

  function removeRow(sectionName) {
    const rows = getRowsForSection(sectionName);
    if (!rows || !rows.length) {
      showToast("沒有可刪除的列。", "error");
      return;
    }
    rows.pop();
    markDirty(sectionName);
    renderAll();
    showToast("已刪除最後一列，按「同步到後台」後才會寫入。");
  }

  function getRowsForSection(sectionName) {
    if (sectionName === "request") return state.request.rows;
    if (sectionName === "adjust") return state.adjust.rows;
    if (sectionName === "manualPlan") return state.manualPlan.rows;
    if (sectionName === "cancelled") return state.cancelled.rows;
    if (sectionName === "duty") return state.duty.rows;
    return null;
  }

  function renderAll() {
    renderConfigState();
    renderDashboard();
    renderRequestTable();
    renderAdjustTable();
    renderEditableTable("manualPlanTable", "manualPlan", state.manualPlan, [0, 1]);
    renderEditableTable("cancelledTable", "cancelled", state.cancelled, [0]);
    renderDutyFilterOptions();
    renderDutyTable();
    renderDirtyLines();
    updateLinks();
  }

  function renderConfigState() {
    if (!window.AppApi.hasApiUrl()) {
      renderConfigAlert("未設定 API_URL：請在 docs/config.js 填入 Apps Script Web App /exec URL。");
      setSyncStatus("同步失敗", "failed");
      $("#apiEndpointState").textContent = "未設定";
      return;
    }
    renderConfigAlert("");
    $("#apiEndpointState").textContent = "已設定";
  }

  function renderConfigAlert(message) {
    const alert = $("#configAlert");
    if (!message) {
      alert.classList.add("hidden");
      alert.textContent = "";
      return;
    }
    alert.classList.remove("hidden");
    alert.textContent = message;
  }

  function renderDashboard() {
    const summary = (state.meta && state.meta.summary) || {};
    setText("#metricDate", summary.selectedDateDisplay || "--");
    setText("#metricWeekday", summary.selectedWeekday || "--");
    setText("#metricRequestCount", numberOrDash(summary.requestCount));
    setText("#metricAdjustCount", numberOrDash(summary.adjustCount));
    setText("#metricDutyCount", numberOrDash(summary.dutyCount));
    setText("#metricFolder", summary.folderName || "--");
    setText("#homeLastSync", state.lastSyncAt ? formatTime(state.lastSyncAt) : "--");
    const dateInput = $("#dateSwitchInput");
    if (dateInput && document.activeElement !== dateInput) {
      dateInput.value = summary.selectedDateInput || "";
    }
  }

  function renderRequestTable() {
    const table = $("#requestTable");
    clear(table);
    const headers = state.request.header.length ? state.request.header : ["教師", "D1", "L1", "L2", "D3", "L3", "L4", "D4", "L5", "D5", "L6", "D7", "L7", "不用扣課節", "備註"];
    appendHeader(table, headers);
    const body = table.createTBody();
    state.request.rows.forEach((row, rowIndex) => {
      const tr = body.insertRow();
      headers.forEach((header, colIndex) => {
        const td = tr.insertCell();
        if (colIndex === 0) {
          td.appendChild(createInput(row[colIndex] || "", value => {
            row[colIndex] = value;
            markDirty("request");
          }));
        } else {
          td.appendChild(createCheckbox(Boolean(row[colIndex]), checked => {
            row[colIndex] = checked;
            markDirty("request");
          }));
          td.className = "checkbox-td";
        }
      });
    });
    appendEmptyState(table, state.request.rows.length, headers.length);
  }

  function renderAdjustTable() {
    const table = $("#adjustTable");
    clear(table);
    const headers = ["課節編號", "星期", "節", "科目", "班別或組別", "原任老師", "調堂老師", "還"];
    appendHeader(table, headers);
    const body = table.createTBody();
    state.adjust.rows.forEach(row => {
      const tr = body.insertRow();
      appendEditableCell(tr, row.id || "", value => { row.id = value; markDirty("adjust"); });
      ["weekday", "period", "subject", "group", "originTeacher"].forEach(key => appendReadonlyCell(tr, row[key] || ""));
      appendEditableCell(tr, row.swapTeacher || "", value => { row.swapTeacher = value; markDirty("adjust"); });
      const td = tr.insertCell();
      td.appendChild(createCheckbox(Boolean(row.repay), checked => { row.repay = checked; markDirty("adjust"); }));
    });
    appendEmptyState(table, state.adjust.rows.length, headers.length);
  }

  function renderEditableTable(tableId, sectionName, data, editableCols) {
    const table = $("#" + tableId);
    clear(table);
    const headers = data.headers && data.headers.length ? data.headers : ["A", "B", "C", "D", "E", "F", "G", "H"];
    appendHeader(table, headers);
    const body = table.createTBody();
    data.rows.forEach(row => {
      const tr = body.insertRow();
      headers.forEach((header, colIndex) => {
        if (editableCols.includes(colIndex)) {
          appendEditableCell(tr, row[colIndex] || "", value => {
            row[colIndex] = value;
            markDirty(sectionName);
          });
        } else {
          appendReadonlyCell(tr, row[colIndex] || "");
        }
      });
    });
    appendEmptyState(table, data.rows.length, headers.length);
  }

  function renderDutyTable() {
    const table = $("#dutyTable");
    clear(table);
    const visibleCols = state.duty.visibleCols && state.duty.visibleCols.length
      ? state.duty.visibleCols
      : fallbackDutyVisibleCols();
    appendHeader(table, visibleCols.map(col => col.label || state.duty.headers[col.idx] || ("欄 " + (col.idx + 1))));
    const body = table.createTBody();
    getVisibleDutyRows().forEach(row => {
      const tr = body.insertRow();
      visibleCols.forEach(col => {
        const value = row[col.idx] || "";
        if (col.readonly) {
          appendReadonlyCell(tr, value);
        } else if (col.idx === 7 && state.duty.statusOptions && state.duty.statusOptions.length) {
          appendSelectCell(tr, value, state.duty.statusOptions, selected => {
            row[col.idx] = selected;
            applyDutyStatusSideEffectsToClientRow(row);
            markDirty("duty");
            renderDutyFilterOptions();
            renderDutyTable();
          });
        } else {
          appendEditableCell(tr, value, updated => {
            row[col.idx] = updated;
            markDirty("duty");
          });
        }
      });
    });
    appendEmptyState(table, getVisibleDutyRows().length, visibleCols.length);
  }

  function applyDutyStatusSideEffectsToClientRow(row) {
    if (!Array.isArray(row)) return;
    const status = String(row[7] || "").trim();
    if (!status) return;

    const writeKLM = ({ k, l, m }) => {
      if (k !== undefined) row[10] = k;
      if (l !== undefined) row[11] = l;
      if (m !== undefined) row[12] = m;
    };

    const clearIJO = () => {
      row[8] = "";
      row[9] = "";
      row[14] = "";
    };

    if (status.startsWith("系統編代課")) {
      writeKLM({ k: "", l: false, m: false });
      clearIJO();
    } else if (status.startsWith("手動編代課")) {
      writeKLM({ k: "代堂", l: true, m: false });
      clearIJO();
    } else if (status.startsWith("取消課節") && status.includes("原任調課")) {
      writeKLM({ k: "", l: true, m: true });
      clearIJO();
    } else if (status.startsWith("取消課節")) {
      writeKLM({ k: "", l: true, m: false });
      clearIJO();
    } else if (status.includes("調入被取消課節老師")) {
      writeKLM({ k: "調堂", l: true, m: true });
      clearIJO();
    }
  }

  function renderDutyFilterOptions() {
    setSelectOptions("#dutyStatusFilter", "全部狀態", uniqueFromDutyRows(7));
    setSelectOptions("#dutyPeriodFilter", "全部節次", uniqueFromDutyRows(2));
    setSelectOptions("#dutyTeacherFilter", "全部建議代課老師", uniqueFromDutyRows(8));
    syncDutyFilterControls();
  }

  function syncDutyFilterControls() {
    const filter = state.dutyFilter;
    setControlValue("#dutySearch", filter.search);
    setControlValue("#dutyStatusFilter", filter.status);
    setControlValue("#dutyPeriodFilter", filter.period);
    setControlValue("#dutyTeacherFilter", filter.teacher);
    setControlValue("#dutySortBy", filter.sortBy);
    const direction = $("#dutySortDirection");
    if (direction) {
      direction.textContent = filter.direction === "asc" ? "升序" : "降序";
      direction.setAttribute("aria-pressed", filter.direction === "desc" ? "true" : "false");
    }
  }

  function setSelectOptions(selector, emptyLabel, values) {
    const select = $(selector);
    if (!select) return;
    const previousValue = select.value;
    clear(select);
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = emptyLabel;
    select.appendChild(empty);
    values.forEach(value => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = values.includes(previousValue) ? previousValue : "";
    if (selector === "#dutyStatusFilter") state.dutyFilter.status = select.value;
    if (selector === "#dutyPeriodFilter") state.dutyFilter.period = select.value;
    if (selector === "#dutyTeacherFilter") state.dutyFilter.teacher = select.value;
  }

  function setControlValue(selector, value) {
    const control = $(selector);
    if (control && control.value !== value) control.value = value;
  }

  function uniqueFromDutyRows(index) {
    return Array.from(new Set(
      state.duty.rows
        .map(row => String(row[index] || "").trim())
        .filter(Boolean)
    )).sort((a, b) => compareDutyValues(a, b, index));
  }

  function getVisibleDutyRows() {
    const filter = state.dutyFilter;
    const query = filter.search.toLowerCase();
    const rows = state.duty.rows.filter(row => {
      const matchesQuery = !query || row.some(cell => String(cell || "").toLowerCase().includes(query));
      const matchesStatus = !filter.status || String(row[7] || "") === filter.status;
      const matchesPeriod = !filter.period || String(row[2] || "") === filter.period;
      const matchesTeacher = !filter.teacher || String(row[8] || "") === filter.teacher;
      return matchesQuery && matchesStatus && matchesPeriod && matchesTeacher;
    });

    const sortedRows = rows.slice().sort((a, b) => compareDutyRows(a, b, filter.sortBy));
    return filter.direction === "desc" ? sortedRows.reverse() : sortedRows;
  }

  function compareDutyRows(a, b, sortBy) {
    const indexMap = {
      period: 2,
      status: 7,
      originTeacher: 6,
      substituteTeacher: 8,
      group: 4
    };
    const index = indexMap[sortBy] === undefined ? 2 : indexMap[sortBy];
    const primary = compareDutyValues(a[index], b[index], index);
    if (primary !== 0) return primary;
    return compareDutyValues(a[0], b[0], 0);
  }

  function compareDutyValues(a, b, index) {
    const av = String(a || "");
    const bv = String(b || "");
    if (index === 2 || index === 0) {
      const ao = periodOrderValue(av);
      const bo = periodOrderValue(bv);
      if (ao !== bo) return ao - bo;
    }
    return av.localeCompare(bv, "zh-Hant-HK", { numeric: true, sensitivity: "base" });
  }

  function periodOrderValue(value) {
    const period = String(value || "").match(/\b(D|L)\d+\b/);
    const normalized = period ? period[0] : String(value || "");
    const order = ["D1", "L1", "L2", "D3", "L3", "L4", "D4", "L5", "D5", "L6", "D7", "L7"];
    const found = order.indexOf(normalized);
    return found === -1 ? 999 : found;
  }

  function appendHeader(table, headers) {
    const thead = table.createTHead();
    const tr = thead.insertRow();
    headers.forEach(label => {
      const th = document.createElement("th");
      th.textContent = label || "";
      tr.appendChild(th);
    });
  }

  function appendEditableCell(tr, value, onChange) {
    const td = tr.insertCell();
    td.appendChild(createInput(value, onChange));
  }

  function appendReadonlyCell(tr, value) {
    const td = tr.insertCell();
    td.className = "readonly";
    td.textContent = value || "";
  }

  function appendSelectCell(tr, value, options, onChange) {
    const td = tr.insertCell();
    const select = document.createElement("select");
    select.className = "cell-select";
    options.forEach(optionValue => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue || "未設定";
      option.selected = optionValue === value;
      select.appendChild(option);
    });
    select.addEventListener("change", () => onChange(select.value));
    td.appendChild(select);
  }

  function appendEmptyState(table, rowCount, colCount) {
    if (rowCount > 0) return;
    const body = table.tBodies[0] || table.createTBody();
    const tr = body.insertRow();
    const td = tr.insertCell();
    td.colSpan = Math.max(1, colCount);
    td.className = "readonly";
    td.textContent = "暫無資料";
  }

  function createInput(value, onInput) {
    const input = document.createElement("input");
    input.className = "cell-input";
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  function createCheckbox(value, onChange) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "check-cell";
    input.checked = Boolean(value);
    input.addEventListener("change", () => onChange(input.checked));
    return input;
  }

  function normalizeRequestData(data) {
    return {
      header: Array.isArray(data && data.header) ? data.header : [],
      rows: Array.isArray(data && data.rows) ? data.rows.map(row => row.slice()) : [],
      dateInput: data && data.dateInput,
      dateDisplay: data && data.dateDisplay,
      weekday: data && data.weekday
    };
  }

  function normalizeAdjustData(data) {
    return {
      currentWeekday: data && data.currentWeekday,
      scheduleOptions: Array.isArray(data && data.scheduleOptions) ? data.scheduleOptions : [],
      rows: Array.isArray(data && data.rows) ? data.rows.map(row => Object.assign({}, row)) : []
    };
  }

  function normalizeEditableData(data) {
    return {
      sheetName: data && data.sheetName,
      headers: Array.isArray(data && data.headers) ? data.headers : [],
      editableCols: Array.isArray(data && data.editableCols) ? data.editableCols : [],
      rows: Array.isArray(data && data.rows) ? data.rows.map(row => row.slice()) : []
    };
  }

  function normalizeDutyData(data) {
    return {
      headers: Array.isArray(data && data.headers) ? data.headers : [],
      rows: Array.isArray(data && data.rows) ? data.rows.map(row => row.slice()) : [],
      visibleCols: Array.isArray(data && data.visibleCols) ? data.visibleCols : [],
      statusOptions: Array.isArray(data && data.statusOptions) ? data.statusOptions : []
    };
  }

  function fallbackDutyVisibleCols() {
    return [
      { idx: 0, label: "課節編號", readonly: true },
      { idx: 1, label: "星期", readonly: true },
      { idx: 2, label: "節", readonly: true },
      { idx: 3, label: "科目", readonly: true },
      { idx: 4, label: "班別或組別", readonly: true },
      { idx: 6, label: "原任老師", readonly: true },
      { idx: 7, label: "狀態", readonly: false },
      { idx: 8, label: "建議代課老師", readonly: false },
      { idx: 14, label: "代課紙備註", readonly: false }
    ];
  }

  function markDirty(sectionName) {
    state.dirty.add(sectionName);
    setSyncStatus("尚未同步", "dirty");
    renderDirtyLines();
  }

  function renderDirtyLines() {
    $$("[data-dirty]").forEach(el => {
      const dirty = state.dirty.has(el.dataset.dirty);
      el.textContent = dirty ? "尚未同步" : "已同步";
      el.classList.toggle("is-dirty", dirty);
    });
  }

  function setSyncStatus(label, mode) {
    const pill = $("#syncStatus");
    pill.textContent = label;
    pill.className = "sync-pill " + (mode || "neutral");
  }

  function updateLastSync() {
    state.lastSyncAt = new Date();
    $("#lastSyncText").textContent = "最後同步時間：" + formatTime(state.lastSyncAt);
    $("#homeLastSync").textContent = formatTime(state.lastSyncAt);
  }

  function updateLinks() {
    const backendUrl = summaryValue("backendUrl") || (state.meta && state.meta.sheetUrl);
    setLink("#sheetLink", backendUrl);
    setLink("#toolsSheetLink", backendUrl);
    setLink("#dutyPaperLink", state.meta && state.meta.substitutePaperFolderUrl);
    setLink("#dutyTeacherSearchLink", state.meta && state.meta.teacherFreePeriodSearchUrl);
  }

  function setLink(selector, href) {
    const el = $(selector);
    if (!el) return;
    if (href) {
      el.href = href;
      el.classList.remove("disabled-link");
    } else {
      el.href = "#";
      el.classList.add("disabled-link");
    }
  }

  function ensureApiConfigured() {
    if (window.AppApi.hasApiUrl()) return true;
    renderConfigState();
    showToast("未設定 API_URL。", "error");
    return false;
  }

  function setButtonsDisabled(disabled) {
    $$("button").forEach(button => {
      if (button.dataset.nav) return;
      button.disabled = disabled;
    });
  }

  function showToast(message, type) {
    const host = $("#toastHost");
    const toast = document.createElement("div");
    toast.className = "toast" + (type === "error" ? " error" : "");
    toast.textContent = message;
    host.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function summaryValue(key) {
    return state.meta && state.meta.summary ? state.meta.summary[key] : "";
  }

  function numberOrDash(value) {
    return Number.isFinite(Number(value)) ? String(value) : "--";
  }

  function formatTime(date) {
    return date.toLocaleString("zh-HK", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value;
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
