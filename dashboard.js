"use strict";

// Navigation changes only the presentation. Private data remains managed by
// accountUI and the existing authenticated API routes.
(() => {
  const sidebar = document.getElementById("app-sidebar");
  const content = document.querySelector(".app-content");
  const toggle = document.getElementById("menu-toggle");
  const backdrop = document.getElementById("menu-backdrop");
  const workspace = document.getElementById("workspace");
  const mobile = matchMedia("(max-width: 900px)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  if (!sidebar || !content || !toggle || !backdrop || !workspace) return;

  function closeMenu(restoreFocus = false) {
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    backdrop.hidden = true;
    content.inert = false;
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
    document.getElementById("menu-close").focus();
  }

  function activeSection(id, label) {
    for (const button of sidebar.querySelectorAll("[data-nav-target]")) {
      if (button.dataset.navTarget === id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    document.getElementById("nav-current").textContent = label;
  }

  function goTo(id, label) {
    const target = document.getElementById(id);
    if (!target || target.hidden) return;
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
    for (const button of sidebar.querySelectorAll("[data-workspace-nav]")) {
      const target = button.dataset.navTarget && document.getElementById(button.dataset.navTarget);
      button.disabled = !enabled || Boolean(target?.hidden) ||
        (button.id === "nav-settings" && document.getElementById("account-controls").hidden);
      button.title = button.disabled ? "Entre na sua conta para acessar." : "";
    }
    const email = enabled ? accountUI.profile?.email : "";
    document.getElementById("sidebar-avatar").textContent = email ? email[0].toUpperCase() : "P";
    if (!enabled) { activeSection("explore-section", "Explorar"); closeMenu(); }
  }

  toggle.addEventListener("click", () => document.body.classList.contains("nav-open") ? closeMenu(true) : openMenu());
  document.getElementById("menu-close").addEventListener("click", () => closeMenu(true));
  backdrop.addEventListener("click", () => closeMenu(true));
  mobile.addEventListener("change", () => closeMenu());
  sidebar.addEventListener("keydown", event => {
    if (!mobile.matches || !document.body.classList.contains("nav-open")) return;
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    if (event.key !== "Tab") return;
    const focusable = [...sidebar.querySelectorAll("button:not(:disabled), a[href]")];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  for (const button of sidebar.querySelectorAll("[data-nav-target]")) {
    button.addEventListener("click", () => goTo(button.dataset.navTarget, button.textContent.trim()));
  }
  document.getElementById("nav-agent").addEventListener("click", () => {
    closeMenu(true);
    window.dispatchEvent(new Event("prospect:agent-settings"));
  });
  document.getElementById("nav-settings").addEventListener("click", () => {
    closeMenu();
    const controls = document.getElementById("account-controls");
    if (controls.hidden) return;
    controls.open = true;
    controls.querySelector("summary").focus();
  });
  window.addEventListener("prospect:history", () => goTo("results-section", "Explorar"));
  window.addEventListener("prospect:session-expired", syncNavigation);
  const observer = new MutationObserver(syncNavigation);
  for (const id of ["workspace", "account-controls", "account-history", "lists-section"]) {
    observer.observe(document.getElementById(id), { attributes: true, attributeFilter: ["hidden"] });
  }
  closeMenu();
  syncNavigation();
})();
