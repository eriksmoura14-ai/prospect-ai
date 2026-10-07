"use strict";

// Navigation changes only the presentation. Private data remains managed by
// accountUI and the existing authenticated API routes.
(() => {
  const sidebar = document.getElementById("app-sidebar");
  const content = document.querySelector(".app-content");
  const toggle = document.getElementById("menu-toggle");
  const backdrop = document.getElementById("menu-backdrop");
  const workspace = document.getElementById("workspace");
  const bottomNavigation = document.getElementById("mobile-nav");
  const overview = document.getElementById("search-overview");
  const overviewToggle = document.getElementById("overview-toggle");
  const mobile = matchMedia("(max-width: 900px)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  if (!sidebar || !content || !toggle || !backdrop || !workspace) return;
  const navigationRoots = [sidebar, bottomNavigation].filter(Boolean);
  let discovery = null;
  let overviewExpanded = false;

  function navigationButtons(selector) {
    return navigationRoots.flatMap(root => [...root.querySelectorAll(selector)]);
  }

  function closeMenu(restoreFocus = false) {
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    backdrop.hidden = true;
    content.inert = false;
    if (bottomNavigation) bottomNavigation.inert = false;
    sidebar.inert = mobile.matches;
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    if (mobile.matches) sidebar.setAttribute("aria-hidden", "true");
    else sidebar.removeAttribute("aria-hidden");
    if (restoreFocus && mobile.matches) toggle.focus();
  }

  function openMenu() {
    if (!mobile.matches) return;
    document.body.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
    backdrop.hidden = false;
    sidebar.inert = false;
    sidebar.removeAttribute("aria-hidden");
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    content.inert = true;
    if (bottomNavigation) bottomNavigation.inert = true;
    document.getElementById("menu-close").focus();
  }

  function activeSection(id, label) {
    for (const button of navigationButtons("[data-nav-target]")) {
      if (button.dataset.navTarget === id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    document.getElementById("nav-current").textContent = label;
  }

  function goTo(id, label) {
    const target = document.getElementById(id);
    if (!target || target.hidden || (workspace.hidden && id !== "explore-section")) return;
    closeMenu();
    if (target instanceof HTMLDetailsElement) target.open = true;
    activeSection(id === "results-section" ? "explore-section" : id, label);
    target.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    const heading = target.querySelector("summary, h2, h1") || target;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }

  function syncNavigation() {
    const enabled = !workspace.hidden;
    for (const button of navigationButtons("[data-workspace-nav]")) {
      const target = button.dataset.navTarget && document.getElementById(button.dataset.navTarget);
      button.disabled = !enabled || Boolean(target?.hidden) ||
        (button.id === "nav-settings" && document.getElementById("account-controls").hidden);
      button.title = button.disabled ? "Entre na sua conta para acessar." : "";
    }
    const email = enabled && typeof accountUI !== "undefined" ? accountUI.profile?.email : "";
    document.getElementById("sidebar-avatar").textContent = email ? email[0].toUpperCase() : "P";
    if (!enabled) {
      discovery = null;
      overviewExpanded = false;
      activeSection("explore-section", "Descobrir");
      closeMenu();
      syncOverview();
    }
  }

  function selectedLabel(id) {
    const select = document.getElementById(id);
    if (!select?.value || select.value.startsWith("__")) return "";
    return select.selectedOptions[0]?.textContent.trim() || "";
  }

  function setOverviewText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function syncOverviewVisibility() {
    if (!overview || !overviewToggle) return;
    const expanded = !mobile.matches || overviewExpanded;
    overview.hidden = !expanded;
    overviewToggle.setAttribute("aria-expanded", String(expanded));
    overviewToggle.textContent = overviewExpanded ? "Ocultar localização" : "Ver localização";
  }

  function syncOverview() {
    if (!overview) return;
    const country = selectedLabel("country");
    const regionSelect = document.getElementById("region");
    const citySelect = document.getElementById("city");
    const region = regionSelect?.value === "__manual__"
      ? document.getElementById("manual-region")?.value.trim() || ""
      : selectedLabel("region");
    const city = citySelect?.value === "__manual__"
      ? document.getElementById("manual-city")?.value.trim() || ""
      : selectedLabel("city");
    const selectedPlace = [city, region].filter(Boolean).join(", ");
    const location = discovery
      ? discovery.place || "Localização da pesquisa"
      : selectedPlace || country || "Escolha uma localização";
    const discoveryCountry = discovery?.countryCode && [...(document.getElementById("country")?.options || [])]
      .find(option => option.value === discovery.countryCode)?.textContent.trim();
    setOverviewText("overview-location", location);
    setOverviewText("overview-country", discovery
      ? discoveryCountry || discovery.countryCode || "Conforme a localização da pesquisa"
      : country || window.prospectLocationTarget?.countryCode || "Ainda não selecionado");
    setOverviewText("overview-niche", discovery
      ? discovery.niche || "Conforme os filtros da pesquisa"
      : selectedLabel("niche") || "Ainda não selecionado");
    setOverviewText("overview-scope", discovery?.geographicScope || "Definida ao localizar a cidade");
    const target = window.prospectLocationTarget;
    const manualLocation = citySelect?.value === "__manual__" || regionSelect?.value === "__manual__";
    let status = "Escolha país, estado/província e cidade para preparar a pesquisa.";
    if (discovery) {
      status = discovery.message || (discovery.state === "done" ? "Pesquisa concluída." : "Localização da pesquisa.");
    } else if (city && manualLocation) {
      status = "Nome informado. A localização e a área serão confirmadas durante a pesquisa.";
    } else if (city && target?.stage === "city") {
      status = "Cidade selecionada. A pesquisa confirmará a área geográfica.";
    } else if (country && region) {
      status = "Escolha uma cidade para completar a localização.";
    } else if (country) {
      status = "Escolha o estado/província e a cidade.";
    }
    setOverviewText("overview-status", status);
    syncOverviewVisibility();
  }

  function changedSelection() {
    discovery = null;
    // LocationPicker updates dependent fields in its own selection handler.
    queueMicrotask(syncOverview);
  }

  toggle.addEventListener("click", () => document.body.classList.contains("nav-open") ? closeMenu(true) : openMenu());
  document.getElementById("menu-close").addEventListener("click", () => closeMenu(true));
  backdrop.addEventListener("click", () => closeMenu(true));
  mobile.addEventListener("change", () => { closeMenu(); syncOverviewVisibility(); });
  sidebar.addEventListener("keydown", event => {
    if (!mobile.matches || !document.body.classList.contains("nav-open")) return;
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    if (event.key !== "Tab") return;
    const focusable = [...sidebar.querySelectorAll("button:not(:disabled), a[href]")]
      .filter(element => element.getClientRects().length && !element.closest("[hidden]"));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  for (const button of navigationButtons("[data-nav-target]")) {
    button.addEventListener("click", () => goTo(button.dataset.navTarget, button.textContent.trim()));
  }
  const agentButtons = navigationButtons("[data-nav-action='agent'], #nav-agent");
  for (const button of agentButtons) button.addEventListener("click", () => {
    if (workspace.hidden || button.disabled) return;
    const returnFocus = mobile.matches && sidebar.contains(button) ? toggle : button;
    closeMenu();
    window.dispatchEvent(new CustomEvent("prospect:agent-settings", { detail: { trigger: button, returnFocus } }));
  });
  document.getElementById("nav-settings").addEventListener("click", () => {
    closeMenu();
    const controls = document.getElementById("account-controls");
    if (controls.hidden) return;
    controls.open = true;
    controls.querySelector("summary").focus();
  });
  window.addEventListener("prospect:history", () => goTo("results-section", "Descobrir"));
  overviewToggle?.addEventListener("click", () => {
    overviewExpanded = !overviewExpanded;
    syncOverviewVisibility();
  });
  for (const id of ["country", "region", "city", "niche"]) {
    document.getElementById(id)?.addEventListener("change", changedSelection);
  }
  for (const id of ["manual-country", "manual-region", "manual-city"]) {
    document.getElementById(id)?.addEventListener("input", changedSelection);
  }
  window.addEventListener("prospect:location", syncOverview);
  window.addEventListener("prospect:discovery", event => {
    discovery = event.detail && typeof event.detail === "object" ? event.detail : null;
    syncOverview();
  });
  window.addEventListener("prospect:session-expired", syncNavigation);
  const observer = new MutationObserver(syncNavigation);
  for (const id of ["workspace", "account-controls", "account-history", "lists-section"]) {
    const element = document.getElementById(id);
    if (element) observer.observe(element, { attributes: true, attributeFilter: ["hidden"] });
  }
  closeMenu();
  syncNavigation();
  syncOverview();
})();
