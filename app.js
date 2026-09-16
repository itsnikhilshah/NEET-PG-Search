const PAGE_SIZE = 50;

const elements = {
  search: document.querySelector("#search-input"),
  round: document.querySelector("#round-filter"),
  course: document.querySelector("#course-filter"),
  courseOptions: document.querySelector("#course-options"),
  state: document.querySelector("#state-filter"),
  quota: document.querySelector("#quota-filter"),
  category: document.querySelector("#category-filter"),
  rankMin: document.querySelector("#rank-min"),
  rankMax: document.querySelector("#rank-max"),
  sort: document.querySelector("#sort-filter"),
  clear: document.querySelector("#clear-filters"),
  emptyClear: document.querySelector("#empty-clear"),
  roundPill: document.querySelector("#round-pill"),
  sourceSummary: document.querySelector("#source-summary"),
  resultCount: document.querySelector("#result-count"),
  resultsSection: document.querySelector("#results-section"),
  results: document.querySelector("#results"),
  empty: document.querySelector("#empty-state"),
  pagination: document.querySelector("#pagination"),
  previous: document.querySelector("#previous-page"),
  next: document.querySelector("#next-page"),
  pageStatus: document.querySelector("#page-status"),
};

let allPrograms = [];
let filteredPrograms = [];
let currentPage = 1;
let renderTimer;

const formatNumber = new Intl.NumberFormat("en-IN");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addOptions(select, values, getLabel = (value) => value) {
  const fragment = document.createDocumentFragment();
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = typeof value === "string" ? value : value.id;
    option.textContent = getLabel(value);
    fragment.append(option);
  });
  select.append(fragment);
}

function searchableText(row) {
  return [row.institute, row.instituteFull, row.course, row.state, row.quota, row.category]
    .join(" ")
    .toLocaleLowerCase();
}

function mergeRounds(roundPayloads) {
  const grouped = new Map();
  roundPayloads.forEach(({ round, payload }) => {
    payload.ranges.forEach((range) => {
      const key = [range.instituteFull, range.course, range.quota, range.category].join("\u001f");
      if (!grouped.has(key)) {
        grouped.set(key, {
          institute: range.institute,
          instituteFull: range.instituteFull,
          state: range.state,
          course: range.course,
          quota: range.quota,
          category: range.category,
          rounds: [],
        });
      }
      grouped.get(key).rounds.push({
        id: round.id,
        label: round.label,
        shortLabel: round.shortLabel,
        order: round.order,
        openingRank: range.openingRank,
        closingRank: range.closingRank,
        allotments: range.allotments,
        ranks: range.ranks,
        candidateCategories: range.candidateCategories,
      });
    });
  });

  return [...grouped.values()].map((program) => {
    program.rounds.sort((a, b) => b.order - a.order);
    program._search = searchableText(program);
    return program;
  });
}

function visibleRounds(program) {
  const selectedRound = elements.round.value;
  return selectedRound ? program.rounds.filter((round) => round.id === selectedRound) : program.rounds;
}

function primaryRound(program) {
  return visibleRounds(program)[0] || program.rounds[0];
}

function applyFilters({ resetPage = true } = {}) {
  if (resetPage) currentPage = 1;
  const query = elements.search.value.trim().toLocaleLowerCase();
  const course = elements.course.value.trim().toLocaleLowerCase();
  const selectedRound = elements.round.value;
  const state = elements.state.value;
  const quota = elements.quota.value;
  const category = elements.category.value;
  const rankMin = Number(elements.rankMin.value) || 0;
  const rankMax = Number(elements.rankMax.value) || Number.POSITIVE_INFINITY;

  filteredPrograms = allPrograms.filter((program) => {
    const rounds = selectedRound ? program.rounds.filter((round) => round.id === selectedRound) : program.rounds;
    if (!rounds.length) return false;
    if (query && !program._search.includes(query)) return false;
    if (course && !program.course.toLocaleLowerCase().includes(course)) return false;
    if (state && program.state !== state) return false;
    if (quota && program.quota !== quota) return false;
    if (category && program.category !== category) return false;
    if (!rounds.some((round) => round.closingRank >= rankMin && round.closingRank <= rankMax)) return false;
    return true;
  });

  const sort = elements.sort.value;
  filteredPrograms.sort((a, b) => {
    const aRound = primaryRound(a);
    const bRound = primaryRound(b);
    if (sort === "closing-desc") return bRound.closingRank - aRound.closingRank || bRound.order - aRound.order;
    if (sort === "closing-asc") return aRound.closingRank - bRound.closingRank || bRound.order - aRound.order;
    if (sort === "name-asc") return a.institute.localeCompare(b.institute) || a.course.localeCompare(b.course);
    return bRound.order - aRound.order || aRound.closingRank - bRound.closingRank;
  });

  render();
}

function roundMarkup(round) {
  const exactRanks = round.ranks.map((rank) => formatNumber.format(rank)).join(", ");
  const candidates = round.candidateCategories.join(", ");
  return `
    <div class="round-entry">
      <div class="round-range">
        <span class="round-label">${escapeHtml(round.shortLabel)}</span>
        <span class="round-numbers">
          ${formatNumber.format(round.openingRank)} → <b>${formatNumber.format(round.closingRank)}</b>
          <span class="round-caption">${round.allotments} allotment${round.allotments === 1 ? "" : "s"}</span>
        </span>
      </div>
      <details>
        <summary>${escapeHtml(round.label)} details</summary>
        <div class="detail-copy">
          <div>Candidate categories observed: ${escapeHtml(candidates)}</div>
          <div class="exact-ranks">Exact ranks: ${escapeHtml(exactRanks)}</div>
        </div>
      </details>
    </div>`;
}

function resultMarkup(program) {
  return `
    <article class="result-row" role="row">
      <div class="institution" role="cell">
        <strong>${escapeHtml(program.institute)}</strong>
        <span class="course">${escapeHtml(program.course)}</span>
        <span class="location">${escapeHtml(program.state)}</span>
        <details>
          <summary>Full institution record</summary>
          <div class="detail-copy">${escapeHtml(program.instituteFull)}</div>
        </details>
      </div>
      <span class="badge" role="cell">${escapeHtml(program.quota)}</span>
      <span class="badge category" role="cell">${escapeHtml(program.category)}</span>
      <div class="round-ranges" role="cell">${visibleRounds(program).map(roundMarkup).join("")}</div>
    </article>`;
}

function render() {
  const totalPages = Math.max(1, Math.ceil(filteredPrograms.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredPrograms.slice(start, start + PAGE_SIZE);

  elements.resultCount.textContent = `${formatNumber.format(filteredPrograms.length)} matching program${filteredPrograms.length === 1 ? "" : "s"}`;
  elements.results.innerHTML = pageRows.map(resultMarkup).join("");
  elements.empty.hidden = filteredPrograms.length !== 0;
  elements.pagination.hidden = filteredPrograms.length <= PAGE_SIZE;
  elements.pageStatus.textContent = `Page ${currentPage} of ${formatNumber.format(totalPages)}`;
  elements.previous.disabled = currentPage === 1;
  elements.next.disabled = currentPage === totalPages;
  elements.resultsSection.setAttribute("aria-busy", "false");
}

function clearFilters() {
  elements.search.value = "";
  elements.round.value = "";
  elements.course.value = "";
  elements.state.value = "";
  elements.quota.value = "";
  elements.category.value = "";
  elements.rankMin.value = "";
  elements.rankMax.value = "";
  elements.sort.value = "round-desc";
  applyFilters();
  elements.search.focus();
}

function scheduleFilter() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => applyFilters(), 90);
}

function wireEvents() {
  [elements.search, elements.course, elements.rankMin, elements.rankMax].forEach((input) => {
    input.addEventListener("input", scheduleFilter);
  });
  [elements.round, elements.state, elements.quota, elements.category, elements.sort].forEach((select) => {
    select.addEventListener("change", () => applyFilters());
  });
  elements.clear.addEventListener("click", clearFilters);
  elements.emptyClear.addEventListener("click", clearFilters);
  elements.previous.addEventListener("click", () => {
    currentPage -= 1;
    applyFilters({ resetPage: false });
    document.querySelector(".results-heading").scrollIntoView({ behavior: "smooth" });
  });
  elements.next.addEventListener("click", () => {
    currentPage += 1;
    applyFilters({ resetPage: false });
    document.querySelector(".results-heading").scrollIntoView({ behavior: "smooth" });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === "Escape" && document.activeElement === elements.search) {
      elements.search.value = "";
      applyFilters();
    }
  });
}

async function loadData() {
  try {
    const manifestResponse = await fetch("./data/index.json");
    if (!manifestResponse.ok) throw new Error(`Manifest request failed (${manifestResponse.status})`);
    const manifest = await manifestResponse.json();
    const rounds = [...manifest.rounds].sort((a, b) => b.order - a.order);
    const roundPayloads = await Promise.all(
      rounds.map(async (round) => {
        const response = await fetch(round.file);
        if (!response.ok) throw new Error(`${round.label} request failed (${response.status})`);
        return { round, payload: await response.json() };
      }),
    );

    allPrograms = mergeRounds(roundPayloads);
    const states = [...new Set(allPrograms.map((row) => row.state))].sort();
    const courses = [...new Set(allPrograms.map((row) => row.course))].sort();
    const quotas = [...new Set(allPrograms.map((row) => row.quota))].sort();
    const categories = [...new Set(allPrograms.map((row) => row.category))].sort();
    const sourceRows = roundPayloads.reduce((total, item) => total + item.payload.meta.sourceRows, 0);

    addOptions(elements.round, rounds, (round) => round.label);
    addOptions(elements.state, states);
    addOptions(elements.quota, quotas);
    addOptions(elements.category, categories);
    addOptions(elements.courseOptions, courses);
    elements.roundPill.textContent = `${manifest.cycle} · ${rounds.length} round${rounds.length === 1 ? "" : "s"}`;
    elements.sourceSummary.textContent = `${formatNumber.format(sourceRows)} allotments across ${rounds.length} round${rounds.length === 1 ? "" : "s"}, grouped into searchable programs.`;
    applyFilters();
  } catch (error) {
    elements.sourceSummary.textContent = "The counselling data could not be loaded.";
    elements.resultCount.textContent = "Data unavailable";
    elements.results.innerHTML = `<div class="empty-state"><h3>Could not load the dataset</h3><p>Run the site through a web server or publish it with GitHub Pages.</p></div>`;
    elements.resultsSection.setAttribute("aria-busy", "false");
    console.error(error);
  }
}

wireEvents();
loadData();
