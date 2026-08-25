const state = {
  urls: {
    im: "",
    mp: ""
  },
  headers: { im: [], mp: [] },
  periods: {
    day: { days: 1, sheets: [], groupSheets: {} },
    week: { days: 7, sheets: [], groupSheets: {} },
    month: { days: 30, sheets: [], groupSheets: {} }
  },
  dateFormat: "DD.MM.YYYY",
  columnsInitialized: { im: false, mp: false },
  timer: null,
  sortKey: "score",
  sortDirection: "desc"
};

const mpCollectors = new Set(["ОЗОН ФБС", "ВБ ФБС", "ЯНДЕКС ФБС"]);
const mpSheetName = "МП";
const savedUrlKey = "top-collectors-sheet-url";
const savedMpUrlKey = "top-collectors-mp-sheet-url";
const $ = (id) => document.getElementById(id);
const adminAuthKey = "top-collectors-admin-auth";
const savedTabUrlKey = "top-collectors-tab-url";
const tabState = {
  headers: [],
  rows: []
};

function normalizeCollectorName(name) {
  return name.trim().replace(/\s+/g, " ").toLocaleUpperCase("ru-RU");
}

function columnElementId(prefix, column) {
  return prefix ? `mp${column[0].toUpperCase()}${column.slice(1)}Col` : `${column}Col`;
}

function setAdminMode(isAdmin) {
  document.body.classList.toggle("admin-mode", isAdmin);
  $("loginPanel").classList.remove("open");
  $("loginPanel").setAttribute("aria-hidden", "true");
}

function openLogin() {
  $("loginPanel").classList.add("open");
  $("loginPanel").setAttribute("aria-hidden", "false");
  $("loginName").focus();
}

function login(event) {
  event.preventDefault();

  const isValid = $("loginName").value === "admin" &&
    $("loginPassword").value === "1234";

  if (!isValid) {
    $("loginError").textContent = "Неверный логин или пароль.";
    return;
  }

  localStorage.setItem(adminAuthKey, "true");
  $("loginError").textContent = "";
  $("loginForm").reset();
  setAdminMode(true);
}

function showError(message) {
  const box = $("error");
  box.textContent = message;
  box.style.display = "block";
}

function clearError() {
  const box = $("error");
  box.textContent = "";
  box.style.display = "none";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function isCollectorName(name) {
  const normalized = name.toLocaleLowerCase("ru-RU");
  const serviceNames = ["итого", "всего", "сумма", "total", "sum", "сборщик", "фамилия", "имя"];

  return !serviceNames.includes(normalized) &&
    /^[\p{L}][\p{L}'’-]*(?:[\s-]+[\p{L}][\p{L}'’-]*)*$/u.test(name);
}

function parseSheetUrl(url, sheetName) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  if (!match) {
    throw new Error("Не удалось найти ID Google Таблицы в ссылке.");
  }

  const spreadsheetId = match[1];
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

function parseExportUrl(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  if (!match) {
    throw new Error("Не удалось найти ID Google Таблицы в ссылке.");
  }

  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
}

function parseTabUrl(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gid = (url.match(/[?#&]gid=(\d+)/) || [])[1];

  if (!match || !gid) {
    throw new Error("Ссылка должна вести на вкладку и содержать gid.");
  }

  return `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

async function fetchPublicData(url, sourceName) {
  try {
    return await fetch(url, { cache: "no-store", mode: "cors" });
  } catch {
    throw new Error(
      `Не удалось загрузить ${sourceName}. Откройте сайт через Live Server и проверьте, что Google Таблица доступна по ссылке.`
    );
  }
}

function formatDateSheetName(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  return state.dateFormat
    .replace(/DD/g, day)
    .replace(/MM/g, month)
    .replace(/YYYY/g, year);
}

function getDateSheetNames(days) {
  const names = [];
  const date = new Date();
  const currentWeek = days === "currentWeek";
  const daysFromMonday = (date.getDay() + 6) % 7;
  const dateCount = currentWeek ? daysFromMonday + 1 : days;

  for (let offset = 0; offset < dateCount; offset++) {
    const sheetDate = new Date(date);
    sheetDate.setDate(date.getDate() - offset);
    names.push(formatDateSheetName(sheetDate));
  }

  return names;
}

function parseCSV(text) {
  const result = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        i++;
      }

      row.push(cell);
      cell = "";

      if (row.some((item) => item.trim() !== "")) {
        result.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length) {
    row.push(cell);

    if (row.some((item) => item.trim() !== "")) {
      result.push(row);
    }
  }

  return result;
}

function fillColumnSelects(headers, prefix = "") {
  const options = headers
    .map((header, index) =>
      `<option value="${index}">${escapeHtml(header || `Столбец ${index + 1}`)}</option>`
    )
    .join("");

  $(columnElementId(prefix, "name")).innerHTML = options;
  $(columnElementId(prefix, "status")).innerHTML = options;
  $(columnElementId(prefix, "grinds")).innerHTML = options;

  $(columnElementId(prefix, "name")).disabled = false;
  $(columnElementId(prefix, "status")).disabled = false;
  $(columnElementId(prefix, "grinds")).disabled = false;

  const nameIndex = headers.findIndex((header) =>
    /фам|сборщик|name|surname/i.test(header)
  );

  const statusIndex = headers.findIndex((header) =>
    /статус|status/i.test(header)
  );

  if (nameIndex >= 0) {
    $(columnElementId(prefix, "name")).value = nameIndex;
  }

  if (statusIndex >= 0) {
    $(columnElementId(prefix, "status")).value = statusIndex;
  }

  const grindsIndex = headers.findIndex((header) =>
    /помол|grind/i.test(header)
  );

  $(columnElementId(prefix, "grinds")).value = grindsIndex >= 0 ? grindsIndex : statusIndex;
}

function calculateLeaderboard(rows, prefix = "") {
  const nameIndex = Number($(columnElementId(prefix, "name")).value);
  const statusIndex = Number($(columnElementId(prefix, "status")).value);
  const grindsIndex = Number($(columnElementId(prefix, "grinds")).value);

  const counters = new Map();

  for (const row of rows) {
    const name = (row[nameIndex] || "").trim().replace(/\s+/g, " ");
    const status = (row[statusIndex] || "").trim().toLowerCase();
    const grindsValue = (row[grindsIndex] || "").trim().replace(",", ".");

    if (!isCollectorName(name)) {
      continue;
    }

    if (!counters.has(name)) {
      counters.set(name, { collected: 0, grinds: 0 });
    }

    const counter = counters.get(name);

    if (status === "собран") {
      counter.collected += 1;
    }

    if (grindsValue) {
      const numericGrinds = Number(grindsValue);
      counter.grinds += Number.isFinite(numericGrinds)
        ? Math.max(0, numericGrinds)
        : 1;
    }
  }

  return [...counters.entries()]
    .map(([name, values]) => ({
      name,
      collected: values.collected,
      grinds: values.grinds,
      score: values.collected + values.grinds * 2
    }))
    .sort((a, b) => {
      const first = a[state.sortKey];
      const second = b[state.sortKey];
      const comparison = typeof first === "string"
        ? first.localeCompare(second, "ru")
        : first - second;

      if (comparison !== 0) {
        return state.sortDirection === "asc" ? comparison : -comparison;
      }

      return a.name.localeCompare(b.name, "ru");
    });
}

function calculatePeriodLeaderboard(sheets, allowedNames = null, excludedNames = null, prefix = "") {
  const totals = new Map();

  for (const sheet of sheets || []) {
    for (const item of calculateLeaderboard(sheet.rows || [], prefix)) {
      const normalizedName = normalizeCollectorName(item.name);

      if (allowedNames && !allowedNames.has(normalizedName)) {
        continue;
      }

      if (excludedNames && excludedNames.has(normalizedName)) {
        continue;
      }
      const current = totals.get(item.name) || {
        collected: 0,
        grinds: 0
      };

      current.collected += item.collected || 0;
      current.grinds += item.grinds || 0;
      totals.set(item.name, current);
    }
  }

  return [...totals.entries()]
    .map(([name, values]) => ({
      name,
      collected: values.collected,
      grinds: values.grinds,
      score: values.collected + values.grinds * 2
    }))
    .sort((a, b) => {
      const first = a[state.sortKey];
      const second = b[state.sortKey];
      const comparison = typeof first === "string"
        ? first.localeCompare(second, "ru")
        : first - second;

      if (comparison !== 0) {
        return state.sortDirection === "asc" ? comparison : -comparison;
      }

      return a.name.localeCompare(b.name, "ru");
    });
}

function renderLeaderboard(periodId, groupId = "im") {
  const periodElement = document.querySelector(`[data-group="${groupId}"][data-period="${periodId}"]`);
  const period = state.periods[periodId];
  const sheets = period.groupSheets[groupId] || [];
  const prefix = groupId === "mp" ? "mp" : "";
  const allowedNames = groupId === "mp"
    ? new Set([...mpCollectors].map(normalizeCollectorName))
    : null;
  const excludedNames = groupId === "im"
    ? new Set([...mpCollectors].map(normalizeCollectorName))
    : null;
  const data = calculatePeriodLeaderboard(sheets, allowedNames, excludedNames, prefix);
  const totalGrinds = data.reduce((sum, item) => sum + item.grinds, 0);

  periodElement.querySelector(".total").textContent = `Сборщиков: ${data.length}`;
  periodElement.querySelector(".totalGrinds").textContent = `Всего помолов: ${totalGrinds}`;
  renderDataInfo();

  periodElement.querySelectorAll(".sort-button").forEach((button) => {
    const isActive = button.dataset.sort === state.sortKey;
    button.classList.toggle("active", isActive);
    button.dataset.direction = isActive ? state.sortDirection : "";
    button.setAttribute("aria-sort", isActive
      ? state.sortDirection === "asc" ? "ascending" : "descending"
      : "none");
  });

  if (!data.length) {
    periodElement.querySelector(".rows").innerHTML =
      '<div class="empty">Нет данных для отображения.</div>';
    return;
  }

  const scorePlaces = new Map();
  let previousScore = null;
  let previousPlace = 0;

  [...data]
    .sort((a, b) => b.score - a.score)
    .forEach((item, index) => {
      const place = item.score === previousScore ? previousPlace : index + 1;

      scorePlaces.set(item.name, place);
      previousScore = item.score;
      previousPlace = place;
    });

  periodElement.querySelector(".rows").innerHTML = data.map((item) => {
    const place = scorePlaces.get(item.name);
    const medal = place === 1 ? "🥇 " :
      place === 2 ? "🥈 " :
        place === 3 ? "🥉 " : "";

    return `
      <div class="row ${place === 1 ? "top1" : ""}">
        <div class="rank">${medal}${place}</div>
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="count">${item.collected}</div>
        <div class="count">${item.grinds}</div>
        <div class="count score">${item.score}</div>
      </div>
    `;
  }).join("");
}

function renderDataInfo() {
  const getColumnItems = (prefix, source) => {
    const columnName = (index) => state.headers[source][index] || `Столбец ${index + 1}`;
    return [
      `Сборщик: <strong>${escapeHtml(columnName(Number($(columnElementId(prefix, "name")).value)))}</strong>`,
      `Статус: <strong>${escapeHtml(columnName(Number($(columnElementId(prefix, "status")).value)))}</strong>`,
      `Помолы: <strong>${escapeHtml(columnName(Number($(columnElementId(prefix, "grinds")).value)))}</strong>`
    ];
  };
  const periods = [
    ["day", "За день"],
    ["week", "За 7 дней"],
    ["month", "За 30 дней"]
  ];

  $("dataInfoContent").innerHTML = `
    <div class="info-block">
      <h3>Столбцы</h3>
      <ul>
        ${getColumnItems("", "im").map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
    <div class="info-block">
      <h3>Столбцы МП</h3>
      <ul>
        ${getColumnItems("mp", "mp").map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
    ${periods.map(([periodId, title]) => {
    const names = state.periods[periodId].sourceNames?.im || [];
    const mpNames = state.periods[periodId].sourceNames?.mp || [];
    return `
        <div class="info-block">
          <h3>${title}, ИМ</h3>
          <p>${names.length ? escapeHtml(names.join(", ")) : "Листы не найдены"}</p>
        </div>
        <div class="info-block">
          <h3>${title}, МП</h3>
          <p>${mpNames.length ? escapeHtml(mpNames.join(", ")) : "Лист «ОПТ и МП» не найден"}</p>
        </div>
      `;
  }).join("")}
    <div class="info-block">
      <h3>Формула</h3>
      <p>Собран = 1 балл. Непустой помол = 2 балла. Пустые значения дают 0.</p>
    </div>
  `;
}

function fillTabColumnSelects(headers) {
  const options = headers
    .map((header, index) =>
      `<option value="${index}">${escapeHtml(header || `Столбец ${index + 1}`)}</option>`
    )
    .join("");

  $("tabNameCol").innerHTML = options;
  $("tabStatusCol").innerHTML = options;
  $("tabPositionsCol").innerHTML = options;
  $("tabNameCol").disabled = false;
  $("tabStatusCol").disabled = false;
  $("tabPositionsCol").disabled = false;

  const nameIndex = headers.findIndex((header) => /фам|сборщик|name|surname/i.test(header));
  const statusIndex = headers.findIndex((header) => /статус|status/i.test(header));
  const positionsIndex = headers.findIndex((header) => /кол-?во\s*позиц|количеств.*позиц|позици/i.test(header));

  $("tabNameCol").value = nameIndex >= 0 ? nameIndex : 0;
  $("tabStatusCol").value = statusIndex >= 0 ? statusIndex : 0;
  $("tabPositionsCol").value = positionsIndex >= 0 ? positionsIndex : 0;
}

function renderTabStatistics() {
  const nameIndex = Number($("tabNameCol").value);
  const statusIndex = Number($("tabStatusCol").value);
  const positionsIndex = Number($("tabPositionsCol").value);
  const counters = new Map();

  for (const row of tabState.rows) {
    const name = (row[nameIndex] || "").trim();
    const status = (row[statusIndex] || "").trim();
    const positionsValue = (row[positionsIndex] || "").trim().replace(",", ".");
    const positions = Number(positionsValue);

    if (!isCollectorName(name)) {
      continue;
    }

    const item = counters.get(name) || { positions: 0, statuses: new Set() };
    item.positions += Number.isFinite(positions) ? positions : 0;
    if (status) {
      item.statuses.add(status);
    }
    counters.set(name, item);
  }

  const rows = [...counters.entries()]
    .map(([name, item]) => ({
      name,
      positions: item.positions,
      statuses: [...item.statuses].join(", ") || "Не указан"
    }))
    .sort((a, b) => b.positions - a.positions || a.name.localeCompare(b.name, "ru"));

  $("tabRows").innerHTML = rows.length
    ? `<div class="tab-table-head"><div>Сборщик</div><div>Позиций</div><div>Статусы</div></div>${rows.map((item) => `
        <div class="tab-row"><div class="name">${escapeHtml(item.name)}</div><div class="count">${item.positions}</div><div>${escapeHtml(item.statuses)}</div></div>
      `).join("")}`
    : '<div class="empty">Вкладка не содержит позиций со сборщиком.</div>';
}

async function loadTabStatistics() {
  clearError();
  const url = $("tabUrl").value.trim();

  if (!url) {
    showError("Вставьте ссылку на вкладку Google Таблицы.");
    return;
  }

  try {
    const response = await fetchPublicData(parseTabUrl(url), "вкладку");
    if (!response.ok) {
      throw new Error("Вкладка недоступна. Проверьте доступ по ссылке.");
    }

    const data = parseCSV(await response.text());
    if (data.length < 1) {
      throw new Error("Вкладка пустая.");
    }

    tabState.headers = data[0];
    tabState.rows = data.slice(1);
    fillTabColumnSelects(tabState.headers);
    localStorage.setItem(savedTabUrlKey, url);
    $("tabStatus").textContent = `Загружено строк: ${tabState.rows.length}`;
    renderTabStatistics();
  } catch (error) {
    $("tabStatus").textContent = "Ошибка загрузки вкладки";
    showError(error.message || "Не удалось загрузить вкладку.");
  }
}

async function fetchWorkbook(url) {
  if (!window.XLSX) {
    throw new Error("Не загрузилась библиотека чтения Google Таблицы.");
  }

  const response = await fetchPublicData(parseExportUrl(url), "Google Таблицу");

  if (!response.ok) {
    throw new Error("Google Таблица недоступна. Проверьте доступ по ссылке.");
  }

  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
  const sheets = new Map();

  workbook.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false
    });

    if (rows.length > 0) {
      sheets.set(sheetName, { headers: rows[0], rows: rows.slice(1) });
    }
  });

  return sheets;
}

async function fetchMpSheet(url) {
  const gid = (url.match(/[?#&]gid=(\d+)/) || [])[1];

  if (!gid) {
    const sheets = await fetchWorkbook(url);
    const namedSheet = sheets.get(mpSheetName);

    if (!namedSheet) {
      throw new Error(`В базе МП не найден лист «${mpSheetName}».`);
    }

    return namedSheet;
  }

  const response = await fetchPublicData(parseTabUrl(url), "вкладку МП");

  if (!response.ok) {
    throw new Error("Вкладка МП недоступна. Проверьте доступ по ссылке.");
  }

  const data = parseCSV(await response.text());

  if (data.length < 1) {
    throw new Error("Вкладка МП пустая.");
  }

  return { headers: data[0], rows: data.slice(1) };
}

async function fetchAllPeriods(silent = false) {
  if (!state.urls.im) {
    return;
  }

  const imSheets = await fetchWorkbook(state.urls.im);
  let mpSheet = null;

  if (state.urls.mp) {
    try {
      mpSheet = await fetchMpSheet(state.urls.mp);
    } catch (error) {
      if (!silent) {
        showError("База МП недоступна. Статистика ИМ продолжит работать.");
      }
    }
  }
  const sheets = imSheets;
  const availableSheet = [...sheets.values()][0];

  if (!availableSheet) {
    Object.keys(state.periods).forEach((periodId) => {
      document.querySelector(`[data-period="${periodId}"] .updated`).textContent = "Лист не найден";
    });

    if (!silent) {
      showError("Не найдено листов с датами. Проверьте формат даты и доступ таблицы.");
    }

    return;
  }

  if (!state.columnsInitialized.im) {
    state.headers.im = availableSheet.headers;
    fillColumnSelects(state.headers.im);
    state.columnsInitialized.im = true;
  }

  if (!state.columnsInitialized.mp && mpSheet) {
    state.headers.mp = mpSheet.headers;
    fillColumnSelects(state.headers.mp, "mp");
    state.columnsInitialized.mp = true;
  }

  Object.entries(state.periods).forEach(([periodId, period]) => {
    const periodRange = periodId === "week" ? "currentWeek" : period.days;
    const periodNames = getDateSheetNames(periodRange);
    const periodSheets = periodNames
      .map((sheetName) => sheets.get(sheetName))
      .filter(Boolean);

    const dateSourceNames = periodNames.filter((sheetName) => sheets.has(sheetName));
    period.sheets = periodSheets;
    period.groupSheets = {
      im: periodSheets,
      mp: mpSheet ? [mpSheet] : []
    };
    period.sourceNames = {
      im: dateSourceNames,
      mp: mpSheet ? [mpSheetName] : []
    };
    ["im", "mp"].forEach((groupId) => {
      renderLeaderboard(periodId, groupId);
      document.querySelector(`[data-group="${groupId}"][data-period="${periodId}"] .updated`).textContent =
        groupId === "mp" && !mpSheet
          ? "База МП не подключена"
          : "Обновлено: " + new Date().toLocaleTimeString("ru-RU");
    });
  });
}

async function loadMpTable() {
  clearError();
  const url = $("mpSheetUrl").value.trim();

  if (!url) {
    showError("Укажите ссылку на базу МП.");
    return;
  }

  $("loadMpBtn").disabled = true;
  $("loadMpBtn").textContent = "Загрузка…";
  state.urls.mp = url;
  localStorage.setItem(savedMpUrlKey, url);

  try {
    const mpSheet = await fetchMpSheet(url);

    state.headers.mp = mpSheet.headers;
    fillColumnSelects(state.headers.mp, "mp");
    state.columnsInitialized.mp = true;

    Object.values(state.periods).forEach((period) => {
      period.groupSheets.mp = [mpSheet];
      period.sourceNames = period.sourceNames || {};
      period.sourceNames.mp = [mpSheetName];
    });

    ["day", "week", "month"].forEach((periodId) => {
      renderLeaderboard(periodId, "mp");
      document.querySelector(`[data-group="mp"][data-period="${periodId}"] .updated`).textContent =
        "Обновлено: " + new Date().toLocaleTimeString("ru-RU");
    });
  } catch (error) {
    showError(error.message || "Не удалось загрузить базу МП.");
  }

  $("loadMpBtn").disabled = false;
  $("loadMpBtn").textContent = "Обновить МП";
}

async function loadTable() {
  clearError();
  const url = $("sheetUrl").value.trim();
  const mpUrl = $("mpSheetUrl").value.trim();

  if (!url) {
    showError("Укажите ссылку на базу ИМ.");
    return;
  }

  $("loadBtn").disabled = true;
  $("loadBtn").textContent = "Загрузка…";

  state.urls.im = url;
  state.urls.mp = mpUrl;
  localStorage.setItem(savedUrlKey, url);

  if (mpUrl) {
    localStorage.setItem(savedMpUrlKey, mpUrl);
  } else {
    localStorage.removeItem(savedMpUrlKey);
  }

  state.dateFormat = $("dateFormat").value.trim() || "DD.MM.YYYY";
  localStorage.setItem(`${savedUrlKey}-date-format`, state.dateFormat);

  state.columnsInitialized = { im: false, mp: false };

  try {
    await fetchAllPeriods(false);

    if (state.timer) {
      clearInterval(state.timer);
    }

    state.timer = setInterval(() => {
      fetchAllPeriods(true);
    }, 15000);
  } catch (error) {
    showError(error.message || "Ошибка загрузки Google Таблицы.");
  }

  $("loadBtn").disabled = false;
  $("loadBtn").textContent = "Загрузить";
}

const savedUrl = localStorage.getItem(savedUrlKey);
const savedMpUrl = localStorage.getItem(savedMpUrlKey);

if (savedUrl) {
  $("sheetUrl").value = savedUrl;
}

if (savedMpUrl) {
  $("mpSheetUrl").value = savedMpUrl;
}

Object.keys(state.periods).forEach((periodId) => {
  state.periods[periodId].sheets = [];
});

const savedDateFormat = localStorage.getItem(`${savedUrlKey}-date-format`);

if (savedDateFormat) {
  state.dateFormat = savedDateFormat;
  $("dateFormat").value = savedDateFormat;
}

$("loadBtn").addEventListener("click", loadTable);
$("loadMpBtn").addEventListener("click", loadMpTable);
$("loadTabBtn").addEventListener("click", loadTabStatistics);
$("loginForm").addEventListener("submit", login);
$("adminLoginBtn").addEventListener("click", openLogin);
$("closeLoginBtn").addEventListener("click", () => setAdminMode(false));
$("loginPanel").addEventListener("click", (event) => {
  if (event.target === $("loginPanel")) {
    setAdminMode(false);
  }
});
$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(adminAuthKey);
  setAdminMode(false);
});
$("changeDbBtn").addEventListener("click", () => {
  $("sheetUrl").disabled = false;
  $("mpSheetUrl").disabled = false;
  $("sheetUrl").focus();
  $("sheetUrl").select();
});
const renderAllGroups = () => {
  Object.keys(state.periods).forEach((periodId) => {
    ["im", "mp"].forEach((groupId) => renderLeaderboard(periodId, groupId));
  });
};

$("nameCol").addEventListener("change", renderAllGroups);
$("statusCol").addEventListener("change", renderAllGroups);
$("grindsCol").addEventListener("change", renderAllGroups);
$("mpNameCol").addEventListener("change", () => ["day", "week", "month"].forEach((periodId) => renderLeaderboard(periodId, "mp")));
$("mpStatusCol").addEventListener("change", () => ["day", "week", "month"].forEach((periodId) => renderLeaderboard(periodId, "mp")));
$("mpGrindsCol").addEventListener("change", () => ["day", "week", "month"].forEach((periodId) => renderLeaderboard(periodId, "mp")));
$("tabNameCol").addEventListener("change", renderTabStatistics);
$("tabStatusCol").addEventListener("change", renderTabStatistics);
$("tabPositionsCol").addEventListener("change", renderTabStatistics);
document.querySelectorAll(".sort-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.sortKey === button.dataset.sort) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = button.dataset.sort;
      state.sortDirection = button.dataset.sort === "name" ? "asc" : "desc";
    }

    renderAllGroups();
  });
});

const isAdmin = localStorage.getItem(adminAuthKey) === "true";
setAdminMode(isAdmin);

if (savedUrl && isAdmin) {
  loadTable();
}
const savedTabUrl = localStorage.getItem(savedTabUrlKey);
if (savedTabUrl) {
  $("tabUrl").value = savedTabUrl;
}
