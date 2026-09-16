/* AK GC Web Audit — local-first SPA viewer (vanilla JS) */
(function () {
  "use strict";

  const PAGE_SIZE = 50;
  const ROUTES = ["overview", "browse", "could", "wnb", "top10", "gold"];

  const state = {
    scored: null,
    top10: null,
    builders: null,
    aiScores: null,
    context: null,
    browse: { q: "", category: "", status: "", web: "", sortKey: "business_name", sortDir: 1, page: 1 },
    could: { q: "", status: "", sortKey: "business_name", sortDir: 1, page: 1 },
    wnb: { q: "", status: "", sortKey: "business_name", sortDir: 1, page: 1 },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(n) {
    return Number(n).toLocaleString("en-US");
  }

  function pct(n, total) {
    if (!total) return "0%";
    return ((100 * n) / total).toFixed(1) + "%";
  }

  function hasWebsite(row) {
    return !!(row.website_url && row.website_url.trim());
  }

  function urlCell(url) {
    const u = (url || "").trim();
    if (!u) return '<span class="muted">—</span>';
    const href = /^https?:\/\//i.test(u) ? u : "https://" + u;
    return `<a class="url" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
  }



  function aiScoreCell(license) {
    const a = (state.aiScores && state.aiScores.rows && state.aiScores.rows[license]) || null;
    if (!a) return '<div class="ai-score muted">AI-assist likelihood: n/a</div>';
    const n = Number(a.ai_assist_likelihood != null ? a.ai_assist_likelihood : a.ai_likelihood);
    if (Number.isNaN(n)) return '<div class="ai-score muted">AI-assist likelihood: n/a</div>';
    const band = esc(a.ai_assist_band || a.band || '');
    const factory = a.ai_factory_likelihood != null ? Number(a.ai_factory_likelihood) : null;
    const tip = esc(a.rationale || '');
    const factoryBit = factory != null
      ? `<span class="ai-factory"> · factory ${factory}/100</span>`
      : '';
    return `<div class="ai-score band-${band}" title="${tip}"><span class="ai-label">AI-assist</span> <strong>${n}</strong><span class="ai-band">/100 · ${band}</span>${factoryBit}</div>`;
  }

  function builderCell(license) {
    const b = (state.builders && state.builders.rows && state.builders.rows[license]) || null;
    if (!b || !b.builder_name || !b.builder_url) {
      return '<div class="built-by muted">Built by: No public credit found</div>';
    }
    const href = /^https?:\/\//i.test(b.builder_url) ? b.builder_url : "https://" + b.builder_url;
    return `<div class="built-by">Built by: <a class="url" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(b.builder_name)}</a></div>`;
  }

  function pill(cat) {
    const c = esc(cat || "—");
    const cls = ["no_website", "could_benefit", "would_not_benefit", "Active", "Suspended"].includes(cat)
      ? cat
      : "other";
    return `<span class="pill ${cls}">${c}</span>`;
  }

  /* --- Markdown (simple) --- */
  function renderMd(md) {
    if (!md) return "<p class='muted'>No content.</p>";
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let inUl = false;

    function closeUl() {
      if (inUl) {
        html += "</ul>";
        inUl = false;
      }
    }

    function inline(t) {
      return esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(
          /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        )
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        closeUl();
        continue;
      }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        closeUl();
        const level = h[1].length;
        html += `<h${level}>${inline(h[2])}</h${level}>`;
        continue;
      }
      const li = line.match(/^[-*]\s+(.*)$/);
      if (li) {
        if (!inUl) {
          html += "<ul>";
          inUl = true;
        }
        html += `<li>${inline(li[1])}</li>`;
        continue;
      }
      closeUl();
      html += `<p>${inline(line)}</p>`;
    }
    closeUl();
    return html;
  }

  /* --- Routing --- */
  function currentRoute() {
    const h = (location.hash || "#overview").replace(/^#/, "").split("?")[0];
    return ROUTES.includes(h) ? h : "overview";
  }

  function setRoute(route) {
    if (!ROUTES.includes(route)) route = "overview";
    location.hash = route;
  }

  function applyRoute() {
    const route = currentRoute();
    $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === route));
  }

  /* --- Overview --- */
  function renderOverview() {
    const meta = state.scored.meta;
    const cats = meta.categories || {};
    const st = meta.status || {};
    const total = meta.total;
    const nw = cats.no_website || 0;
    const cb = cats.could_benefit || 0;
    const wnb = cats.would_not_benefit || 0;
    const active = st.Active || 0;
    const otherStatus = total - active;

    $("#overview-stats").innerHTML = `
      <div class="stat-card">
        <div class="label">Total licenses</div>
        <div class="value">${fmtNum(total)}</div>
        <div class="hint">Scored roster rows</div>
      </div>
      <div class="stat-card nw">
        <div class="label">No website</div>
        <div class="value">${fmtNum(nw)}</div>
        <div class="hint">${pct(nw, total)}</div>
      </div>
      <div class="stat-card cb">
        <div class="label">Could benefit</div>
        <div class="value">${fmtNum(cb)}</div>
        <div class="hint">${pct(cb, total)}</div>
      </div>
      <div class="stat-card wnb">
        <div class="label">Would not benefit</div>
        <div class="value">${fmtNum(wnb)}</div>
        <div class="hint">${pct(wnb, total)}</div>
      </div>
      <div class="stat-card web">
        <div class="label">With website</div>
        <div class="value">${fmtNum(meta.with_website)}</div>
        <div class="hint">${meta.pct_with_website}% of roster</div>
      </div>
      <div class="stat-card">
        <div class="label">Active licenses</div>
        <div class="value">${fmtNum(active)}</div>
        <div class="hint">${fmtNum(otherStatus)} other (e.g. Suspended)</div>
      </div>
    `;

    function bars(target, items) {
      $(target).innerHTML = items
        .map(
          ([name, count, cls]) => `
        <div class="bar-row">
          <span class="name">${esc(name)}</span>
          <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct(count, total)}"></div></div>
          <span class="count">${fmtNum(count)}</span>
        </div>`
        )
        .join("");
    }

    bars("#cat-bars", [
      ["no_website", nw, "nw"],
      ["could_benefit", cb, "cb"],
      ["would_not_benefit", wnb, "wnb"],
    ]);
    bars("#status-bars", [
      ["Active", active, "active"],
      ["Other", otherStatus, "other"],
    ]);

    const sumMd = (state.context && state.context.summary_md) || "";
    const firstBullets = sumMd
      .split("\n")
      .filter((l) => l.trim().startsWith("-"))
      .slice(0, 4)
      .map((l) => l.replace(/^-\s*/, "").trim());
    $("#summary-blurb").innerHTML = firstBullets.length
      ? firstBullets.map((b) => `<span class="blurb">• ${esc(b)}</span>`).join("")
      : `<span class="blurb">Categories: no_website=${nw}, could_benefit=${cb}, would_not_benefit=${wnb}</span>`;

    $("#overview-updated").textContent = `Categories sum ${nw + cb + wnb} · source scored CSV`;
  }

  /* --- Tables --- */
  const COLS = {
    browse: [
      { key: "license_number", label: "License", mono: true },
      { key: "business_name", label: "Business" },
      { key: "dba", label: "DBA" },
      { key: "status", label: "Status", pill: true },
      { key: "city", label: "City" },
      { key: "state", label: "St" },
      { key: "category", label: "Category", pill: true },
      { key: "website_url", label: "Website", url: true },
      { key: "resolve_method", label: "Resolve" },
    ],
    could: [
      { key: "license_number", label: "License", mono: true },
      { key: "business_name", label: "Business" },
      { key: "status", label: "Status", pill: true },
      { key: "city", label: "City" },
      { key: "website_url", label: "Website", url: true },
      { key: "reason", label: "Reason" },
      { key: "gold_signals_missing", label: "Missing signals" },
    ],
    wnb: [
      { key: "license_number", label: "License", mono: true },
      { key: "business_name", label: "Business" },
      { key: "status", label: "Status", pill: true },
      { key: "city", label: "City" },
      { key: "website_url", label: "Website", url: true },
      { key: "reason", label: "Reason" },
      { key: "gold_signals_found", label: "Signals found" },
    ],
  };

  function sortRows(rows, key, dir) {
    const mul = dir >= 0 ? 1 : -1;
    return rows.slice().sort((a, b) => {
      let av = (a[key] ?? "").toString().toLowerCase();
      let bv = (b[key] ?? "").toString().toLowerCase();
      if (key === "license_number") {
        const an = parseInt(av, 10);
        const bn = parseInt(bv, 10);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * mul;
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return 0;
    });
  }

  function filterRows(rows, opts) {
    const q = (opts.q || "").trim().toLowerCase();
    return rows.filter((r) => {
      if (opts.category && r.category !== opts.category) return false;
      if (opts.status && r.status !== opts.status) return false;
      if (opts.web === "yes" && !hasWebsite(r)) return false;
      if (opts.web === "no" && hasWebsite(r)) return false;
      if (opts.onlyCategory && r.category !== opts.onlyCategory) return false;
      if (!q) return true;
      const hay = [r.license_number, r.business_name, r.dba, r.city, r.state, r.reason, r.website_url]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderTable(tableId, pagerId, metaId, cols, filtered, viewState) {
    const table = $(tableId);
    const thead = $("thead", table);
    const tbody = $("tbody", table);
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (viewState.page > pages) viewState.page = pages;
    if (viewState.page < 1) viewState.page = 1;
    const start = (viewState.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    thead.innerHTML =
      "<tr>" +
      cols
        .map((c) => {
          const sorted = viewState.sortKey === c.key;
          const ind = sorted ? (viewState.sortDir > 0 ? "▲" : "▼") : "↕";
          return `<th data-key="${esc(c.key)}" class="${sorted ? "sorted" : ""}">${esc(c.label)}<span class="sort-ind">${ind}</span></th>`;
        })
        .join("") +
      "</tr>";

    tbody.innerHTML = pageRows.length
      ? pageRows
          .map((r) => {
            return (
              "<tr>" +
              cols
                .map((c) => {
                  const v = r[c.key] ?? "";
                  if (c.url) return `<td>${urlCell(v)}</td>`;
                  if (c.pill) return `<td>${pill(v)}</td>`;
                  if (c.mono) return `<td class="mono">${esc(v) || "—"}</td>`;
                  return `<td>${esc(v) || '<span class="muted">—</span>'}</td>`;
                })
                .join("") +
              "</tr>"
            );
          })
          .join("")
      : `<tr><td colspan="${cols.length}" class="muted">No matching rows.</td></tr>`;

    $$(`${tableId} thead th`).forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (viewState.sortKey === key) viewState.sortDir *= -1;
        else {
          viewState.sortKey = key;
          viewState.sortDir = 1;
        }
        viewState.page = 1;
        refreshViews();
      });
    });

    if (metaId) {
      $(metaId).textContent = `${fmtNum(total)} row${total === 1 ? "" : "s"}`;
    }

    const pager = $(pagerId);
    pager.innerHTML = `
      <div class="info">Showing ${total ? start + 1 : 0}–${Math.min(start + PAGE_SIZE, total)} of ${fmtNum(total)}</div>
      <div class="pages">
        <button type="button" data-act="prev" ${viewState.page <= 1 ? "disabled" : ""}>Prev</button>
        <span class="info">Page ${viewState.page} / ${pages}</span>
        <button type="button" data-act="next" ${viewState.page >= pages ? "disabled" : ""}>Next</button>
      </div>`;
    $$("button", pager).forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.act === "prev") viewState.page -= 1;
        if (btn.dataset.act === "next") viewState.page += 1;
        refreshViews();
      });
    });
  }

  function refreshViews() {
    const all = state.scored.rows;

    const browseFiltered = sortRows(
      filterRows(all, state.browse),
      state.browse.sortKey,
      state.browse.sortDir
    );
    renderTable("#browse-table", "#browse-pager", "#browse-meta", COLS.browse, browseFiltered, state.browse);

    const couldBase = all.filter((r) => r.category === "could_benefit");
    $("#could-sub").textContent = `${fmtNum(couldBase.length)} licenses · gaps vs Far North craft`;
    const couldFiltered = sortRows(
      filterRows(couldBase, state.could),
      state.could.sortKey,
      state.could.sortDir
    );
    renderTable("#could-table", "#could-pager", "#could-meta", COLS.could, couldFiltered, state.could);

    const wnbBase = all.filter((r) => r.category === "would_not_benefit");
    $("#wnb-sub").textContent = `${fmtNum(wnbBase.length)} licenses · already near bar or not a product fit`;
    const wnbFiltered = sortRows(filterRows(wnbBase, state.wnb), state.wnb.sortKey, state.wnb.sortDir);
    renderTable("#wnb-table", "#wnb-pager", "#wnb-meta", COLS.wnb, wnbFiltered, state.wnb);
  }

  /* --- Top 10 --- */
  function extractTldr(briefMd) {
    if (!briefMd) return "No brief loaded.";
    const m = briefMd.match(/## TLDR\s*([\s\S]*?)(?=\n## |\n---|\s*$)/i);
    if (!m) return briefMd.split("\n").slice(0, 8).join("\n");
    return m[1].trim().replace(/^[-*]\s+/gm, "• ");
  }

  function renderTop10() {
    const brief = state.top10.brief_md || "";
    $("#top10-brief").textContent = extractTldr(brief);
    const sumEl = $("#top10-builders-summary");
    if (sumEl && state.builders) {
      const attributed = Object.values(state.builders.rows || {}).filter((x) => x.builder_name);
      sumEl.innerHTML = attributed.length
        ? `Verified studio credits on ${attributed.length}/10 peers: ` +
          attributed
            .map((x) => {
              const href = /^https?:\/\//i.test(x.builder_url) ? x.builder_url : "https://" + x.builder_url;
              return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(x.builder_name)}</a>`;
            })
            .join(" · ")
        : "No public studio credits found on Top10 peers.";
    }
    const aiSum = $("#top10-ai-summary");
    if (aiSum && state.aiScores && state.aiScores.summary) {
      const s = state.aiScores.summary;
      const assist = state.aiScores.summary_assist || s;
      aiSum.textContent = `AI-assist (primary): high ${assist.high_count || 0} · mid ${assist.mid_count || 0} · low ${assist.low_count || 0}. Factory score shown beside each card. Hover for rationale.`;
    }

    const rows = (state.top10.rows || []).slice().sort((a, b) => Number(a.rank) - Number(b.rank));
    $("#top10-grid").innerHTML = rows
      .map((r) => {
        const newTag =
          (r.new_since_last_refresh || "").toLowerCase() === "yes"
            ? '<span class="tag new">New since refresh</span>'
            : "";
        const stage3 =
          (r.new_since_stage3 || "").toLowerCase() === "yes"
            ? '<span class="tag">New since Stage3</span>'
            : "";
        const secondary = r.secondary_reason_code
          ? `<span class="tag">${esc(r.secondary_reason_code)}</span>`
          : "";
        return `
        <article class="peer-card">
          <div class="rank">Rank #${esc(r.rank)}</div>
          <h3>${esc(r.business_name)}</h3>
          <div class="meta-line">${esc(r.city || "—")} · ${esc(r.license_number)} · ${urlCell(r.website_url)}</div>
          ${builderCell(r.license_number)}
          ${aiScoreCell(r.license_number)}
          <div class="tags">
            <span class="tag">${esc(r.primary_reason_code || "—")}</span>
            ${secondary}${newTag}${stage3}
          </div>
          <p class="why">${esc(r.why_ranked_here || r.scout_reason || "")}</p>
          <div class="signals">found: ${esc(r.gold_signals_found || "—")}</div>
          <div class="signals">missing: ${esc(r.gold_signals_missing || "—")}</div>
        </article>`;
      })
      .join("");
  }

  function renderGold() {
    const md = (state.context && state.context.gold_standard_md) || "";
    const goldAi = state.aiScores && state.aiScores.gold_standard;
    let banner = "";
    if (goldAi) {
      const n = Number(goldAi.ai_assist_likelihood != null ? goldAi.ai_assist_likelihood : goldAi.ai_likelihood);
      const band = esc(goldAi.ai_assist_band || goldAi.band || "");
      const factory = goldAi.ai_factory_likelihood != null ? Number(goldAi.ai_factory_likelihood) : null;
      const tip = esc(goldAi.rationale || "");
      const built = goldAi.attributed_builder && goldAi.attributed_builder.name
        ? ` · Built by <a href="${esc(goldAi.attributed_builder.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(goldAi.attributed_builder.name)}</a>`
        : "";
      const factoryBit = factory != null ? `<span class="ai-factory"> · factory ${factory}/100</span>` : "";
      if (!Number.isNaN(n)) {
        banner = `<div class="ai-score band-${band} gold-ai" title="${tip}"><span class="ai-label">AI-assist (Far North)</span> <strong>${n}</strong><span class="ai-band">/100 · ${band}</span>${factoryBit}${built}</div>`;
      }
    }
    $("#gold-body").innerHTML = banner + renderMd(md);
  }

  /* --- Wire filters --- */
  function wireFilters() {
    const bind = (id, view, key) => {
      const el = $(id);
      if (!el) return;
      const ev = el.tagName === "INPUT" ? "input" : "change";
      el.addEventListener(ev, () => {
        view[key] = el.value;
        view.page = 1;
        refreshViews();
      });
    };
    bind("#q", state.browse, "q");
    bind("#f-category", state.browse, "category");
    bind("#f-status", state.browse, "status");
    bind("#f-web", state.browse, "web");
    bind("#could-q", state.could, "q");
    bind("#could-status", state.could, "status");
    bind("#wnb-q", state.wnb, "q");
    bind("#wnb-status", state.wnb, "status");
  }

  /* --- Boot --- */
  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.json();
  }

  async function boot() {
    const bootEl = $("#boot");
    try {
      const [scored, top10, builders, aiScores, context] = await Promise.all([
        loadJson("./data/scored.json"),
        loadJson("./data/top10.json"),
        loadJson("./data/site-builders.json"),
        loadJson("./data/ai-built-likelihood.json"),
        loadJson("./data/context.json"),
      ]);
      state.scored = scored;
      state.top10 = top10;
      state.builders = builders;
      state.aiScores = aiScores;
      state.context = context;

      renderOverview();
      refreshViews();
      renderTop10();
      renderGold();
      wireFilters();

      $$("#nav button").forEach((b) =>
        b.addEventListener("click", () => setRoute(b.dataset.route))
      );
      window.addEventListener("hashchange", applyRoute);
      applyRoute();

      bootEl.hidden = true;
      $("#main").hidden = false;
    } catch (err) {
      console.error(err);
      bootEl.classList.add("error");
      bootEl.innerHTML = `
        <p><strong>Could not load data.</strong></p>
        <p>${esc(err.message || String(err))}</p>
        <p>Open via a local server (file:// often blocks fetch):</p>
        <p><code>cd /workspace/rainmaker/ak-gc/viewer && python3 -m http.server 8080</code></p>
        <p>Then visit <code>http://localhost:8080/</code></p>`;
    }
  }

  boot();
})();
