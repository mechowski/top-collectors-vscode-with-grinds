const state = {
  url: "",
  headers: [],
  periods: {
    day: { days: 1, sheets: [] },
    week: { days: 7, sheets: [] },
    month: { days: 30, sheets: [] }
  },
  dateFormat: "DD.MM.YYYY",
  columnsInitialized: false,
  timer: null,
  sortKey: "score",
  sortDirection: "desc"
};

const savedUrlKey = "top-collectors-sheet-url";
const $ = (id) => document.getElementById(id);
const adminAuthKey = "top-collectors-admin-auth";
const savedTabUrlKey = "top-collectors-tab-url";
const tabState = {
  headers: [],
  rows: []
};

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

function fillColumnSelects(headers) {
  const options = headers
    .map((header, index) =>
      `<option value="${index}">${escapeHtml(header || `Столбец ${index + 1}`)}</option>`
    )
    .join("");

  $("nameCol").innerHTML = options;
  $("statusCol").innerHTML = options;
  $("grindsCol").innerHTML = options;

  $("nameCol").disabled = false;
  $("statusCol").disabled = false;
  $("grindsCol").disabled = false;

  const nameIndex = headers.findIndex((header) =>
    /фам|сборщик|name|surname/i.test(header)
  );

  const statusIndex = headers.findIndex((header) =>
    /статус|status/i.test(header)
  );

  if (nameIndex >= 0) {
    $("nameCol").value = nameIndex;
  }

  if (statusIndex >= 0) {
    $("statusCol").value = statusIndex;
  }

  const grindsIndex = headers.findIndex((header) =>
    /помол|grind/i.test(header)
  );

  $("grindsCol").value = grindsIndex >= 0 ? grindsIndex : statusIndex;
}

function calculateLeaderboard(rows) {
  const nameIndex = Number($("nameCol").value);
  const statusIndex = Number($("statusCol").value);
  const grindsIndex = Number($("grindsCol").value);

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

function calculatePeriodLeaderboard(sheets) {
  const totals = new Map();

  for (const sheet of sheets || []) {
    for (const item of calculateLeaderboard(sheet.rows || [])) {
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

function renderLeaderboard(periodId) {
  const periodElement = document.querySelector(`[data-period="${periodId}"]`);
  const period = state.periods[periodId];
  const data = calculatePeriodLeaderboard(period.sheets);
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
  const columnName = (index) => {
    if (!Number.isInteger(index) || index < 0) {
      return "Не выбран";
    }

    return state.headers[index] || `Столбец ${index + 1}`;
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
        <li>Сборщик: <strong>${escapeHtml(columnName(Number($("nameCol").value)))}</strong></li>
        <li>Статус: <strong>${escapeHtml(columnName(Number($("statusCol").value)))}</strong></li>
        <li>Помолы: <strong>${escapeHtml(columnName(Number($("grindsCol").value)))}</strong></li>
      </ul>
    </div>
    ${periods.map(([periodId, title]) => {
    const names = state.periods[periodId].sourceNames || [];
    return `
        <div class="info-block">
          <h3>${title}</h3>
          <p>${names.length ? escapeHtml(names.join(", ")) : "Листы не найдены"}</p>
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

async function fetchAllPeriods(silent = false) {
  if (!state.url) {
    return;
  }

  const sheets = await fetchWorkbook(state.url);
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

  if (!state.columnsInitialized) {
    state.headers = availableSheet.headers;
    fillColumnSelects(state.headers);
    state.columnsInitialized = true;
  }

  Object.entries(state.periods).forEach(([periodId, period]) => {
    const periodRange = periodId === "week" ? "currentWeek" : period.days;
    const periodNames = getDateSheetNames(periodRange);
    const periodSheets = periodNames
      .map((sheetName) => sheets.get(sheetName))
      .filter(Boolean);

    period.sheets = periodSheets;
    period.sourceNames = periodNames.filter((sheetName) => sheets.has(sheetName));

    renderLeaderboard(periodId);
    document.querySelector(`[data-period="${periodId}"] .updated`).textContent =
      "Обновлено: " + new Date().toLocaleTimeString("ru-RU");
  });
}

async function loadTable() {
  clearError();
  const url = $("sheetUrl").value.trim();

  if (!url) {
    showError("Укажите ссылку на базу ИМ.");
    return;
  }

  $("loadBtn").disabled = true;
  $("loadBtn").textContent = "Загрузка…";

  state.url = url;
  localStorage.setItem(savedUrlKey, url);

  state.dateFormat = $("dateFormat").value.trim() || "DD.MM.YYYY";
  localStorage.setItem(`${savedUrlKey}-date-format`, state.dateFormat);

  state.columnsInitialized = false;

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
  $("loadBtn").textContent = "Обновить";
}

const savedUrl = localStorage.getItem(savedUrlKey);

if (savedUrl) {
  $("sheetUrl").value = savedUrl;
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
  $("sheetUrl").focus();
  $("sheetUrl").select();
});
const renderAllGroups = () => {
  Object.keys(state.periods).forEach((periodId) => renderLeaderboard(periodId));
};

$("nameCol").addEventListener("change", renderAllGroups);
$("statusCol").addEventListener("change", renderAllGroups);
$("grindsCol").addEventListener("change", renderAllGroups);
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

if (savedUrl) {
  loadTable();
}
const savedTabUrl = localStorage.getItem(savedTabUrlKey);
if (savedTabUrl) {
  $("tabUrl").value = savedTabUrl;
}
