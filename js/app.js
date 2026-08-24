const state = {
  url: "",
  headers: [],
  rows: [],
  timer: null,
  sortKey: "score",
  sortDirection: "desc"
};

const $ = (id) => document.getElementById(id);
const savedUrlKey = "top-collectors-sheet-url";

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

function parseSheetUrl(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  if (!match) {
    throw new Error("Не удалось найти ID Google Таблицы в ссылке.");
  }

  const spreadsheetId = match[1];
  const gid = (url.match(/[?#&]gid=(\d+)/) || [])[1] || "0";

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
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

function calculateLeaderboard() {
  const nameIndex = Number($("nameCol").value);
  const statusIndex = Number($("statusCol").value);
  const grindsIndex = Number($("grindsCol").value);

  const counters = new Map();

  for (const row of state.rows) {
    const name = (row[nameIndex] || "").trim();
    const status = (row[statusIndex] || "").trim().toLowerCase();
    const grindsValue = (row[grindsIndex] || "").trim();

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
      counter.grinds += 1;
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

function renderLeaderboard() {
  const data = calculateLeaderboard();
  const totalGrinds = data.reduce((sum, item) => sum + item.grinds, 0);

  $("total").textContent = `Сборщиков: ${data.length}`;
  $("totalGrinds").textContent = `Всего помолов: ${totalGrinds}`;

  document.querySelectorAll(".sort-button").forEach((button) => {
    const isActive = button.dataset.sort === state.sortKey;
    button.classList.toggle("active", isActive);
    button.dataset.direction = isActive ? state.sortDirection : "";
    button.setAttribute("aria-sort", isActive
      ? state.sortDirection === "asc" ? "ascending" : "descending"
      : "none");
  });

  if (!data.length) {
    $("rows").innerHTML =
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

  $("rows").innerHTML = data.map((item, index) => {
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

async function fetchTable(silent = false) {
  clearError();

  if (!state.url) {
    return;
  }

  try {
    const csvUrl = parseSheetUrl(state.url);
    const response = await fetch(csvUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(
        "Google Таблица недоступна. Проверьте, что она открыта для просмотра по ссылке."
      );
    }

    const text = await response.text();

    if (
      text.trim().startsWith("<!DOCTYPE") ||
      text.includes("Sign in")
    ) {
      throw new Error(
        "Таблица закрыта. Откройте доступ «Все, у кого есть ссылка — читатель»."
      );
    }

    const data = parseCSV(text);

    if (data.length < 2) {
      throw new Error("В таблице не найдено данных.");
    }

    state.headers = data[0];
    state.rows = data.slice(1);

    if (!silent) {
      fillColumnSelects(state.headers);
    }

    renderLeaderboard();

    $("updated").textContent =
      "Обновлено: " + new Date().toLocaleTimeString("ru-RU");
  } catch (error) {
    $("updated").textContent = "Ошибка обновления";

    if (!silent) {
      showError(error.message || "Ошибка загрузки данных.");
    }
  }
}

async function loadTable() {
  const url = $("sheetUrl").value.trim();

  if (!url) {
    showError("Вставьте ссылку на Google Таблицу.");
    return;
  }

  $("loadBtn").disabled = true;
  $("loadBtn").textContent = "Загрузка…";

  state.url = url;
  localStorage.setItem(savedUrlKey, url);

  await fetchTable(false);

  if (state.timer) {
    clearInterval(state.timer);
  }

  state.timer = setInterval(() => fetchTable(true), 15000);

  $("loadBtn").disabled = false;
  $("loadBtn").textContent = "Загрузить";
}

const savedUrl = localStorage.getItem(savedUrlKey);

if (savedUrl) {
  $("sheetUrl").value = savedUrl;
}

$("loadBtn").addEventListener("click", loadTable);
$("nameCol").addEventListener("change", renderLeaderboard);
$("statusCol").addEventListener("change", renderLeaderboard);
$("grindsCol").addEventListener("change", renderLeaderboard);
document.querySelectorAll(".sort-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.sortKey === button.dataset.sort) {
      state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = button.dataset.sort;
      state.sortDirection = button.dataset.sort === "name" ? "asc" : "desc";
    }

    renderLeaderboard();
  });
});
