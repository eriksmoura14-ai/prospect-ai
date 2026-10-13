"use strict";

// Keep the original selects as the data/form contract, with a scrollable UI menu.
class LocationMenu {
  constructor(select, name) {
    this.select = select;
    this.name = name;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.id = `${select.id}-menu-button`;
    this.button.className = "location-menu-button";
    this.button.setAttribute("aria-label", name);
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-describedby", "location-status");
    select.before(this.button);
    select.hidden = true;
    select.closest("label").htmlFor = this.button.id;

    this.popup = document.createElement("div");
    this.popup.id = `${select.id}-menu`;
    this.popup.className = "location-menu";
    this.popup.hidden = true;
    this.popup.tabIndex = -1;
    this.popup.setAttribute("role", "dialog");
    this.popup.setAttribute("aria-label", `Selecionar ${name.toLocaleLowerCase("pt-BR")}`);
    this.button.setAttribute("aria-controls", this.popup.id);
    this.query = document.createElement("input");
    this.query.type = "search";
    this.query.placeholder = `Buscar ${name.toLocaleLowerCase("pt-BR")}…`;
    this.query.setAttribute("aria-label", this.query.placeholder);
    this.query.setAttribute("role", "combobox");
    this.query.setAttribute("aria-autocomplete", "list");
    this.query.setAttribute("aria-expanded", "true");
    this.list = document.createElement("div");
    this.list.id = `${select.id}-menu-options`;
    this.list.className = "location-menu-options";
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", name);
    this.query.setAttribute("aria-controls", this.list.id);
    this.popup.append(this.query, this.list);
    document.body.append(this.popup);
    this.button.addEventListener("click", () => this.popup.hidden ? this.open() : this.close());
    this.button.addEventListener("keydown", event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); this.open(); }
    });
    this.query.addEventListener("input", () => this.render());
    this.popup.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); this.close(true); }
      else if (event.key === "Tab") this.close(true);
      else if (event.key === "Enter") { event.preventDefault(); this.choose(this.items[this.active]); }
      else if (["ArrowDown", "ArrowUp"].includes(event.key) && this.items.length) {
        event.preventDefault();
        this.highlight(Math.max(0, Math.min(this.items.length - 1, this.active + (event.key === "ArrowDown" ? 1 : -1))));
      }
    });
    this.list.addEventListener("click", event => {
      const option = event.target.closest('[role="option"]');
      if (option) this.choose(this.items[Number(option.dataset.index)]);
    });
    // Even at either end of the list, wheel events must not scroll the page.
    this.popup.addEventListener("wheel", event => {
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 36 : event.deltaMode === 2 ? this.list.clientHeight : 1;
      this.list.scrollTop += event.deltaY * unit;
    }, { passive: false });
    document.addEventListener("pointerdown", event => {
      if (!this.popup.contains(event.target) && !this.button.contains(event.target)) this.close();
    });
    document.addEventListener("focusin", event => {
      if (!this.popup.contains(event.target) && event.target !== this.button) this.close();
    });
    window.addEventListener("resize", () => this.position());
    window.visualViewport?.addEventListener("resize", () => this.position());
    window.visualViewport?.addEventListener("scroll", () => this.position());
    document.addEventListener("scroll", event => {
      if (!this.popup.contains(event.target)) this.position();
    }, true);
    select.addEventListener("invalid", event => { event.preventDefault(); this.open(); });
    this.sync();
  }

  sync() {
    this.button.disabled = this.select.disabled;
    this.button.textContent = this.select.selectedOptions[0]?.textContent || `Selecione ${this.name.toLocaleLowerCase("pt-BR")}`;
    this.button.classList.toggle("has-value", Boolean(this.select.value));
    if (this.select.disabled) this.close();
  }

  open() {
    if (this.select.disabled) return;
    this.popup.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.query.value = "";
    this.position();
    this.render();
    // Touch users choose from the list first; searching explicitly opens the keyboard.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    (touch ? this.popup : this.query).focus({ preventScroll: true });
  }

  position() {
    if (this.popup.hidden) return;
    const rect = this.button.getBoundingClientRect();
    if (!this.button.getClientRects().length) { this.close(); return; }
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const width = Math.min(Math.max(rect.width, 260), viewportWidth - 24);
    const above = rect.top - viewportTop - 18;
    const below = viewportTop + viewportHeight - rect.bottom - 18;
    const upwards = below < 240 && above > below;
    const space = upwards ? above : below;
    const listHeight = Math.max(48, Math.min(280, space - 70, viewportHeight - 94));
    this.list.style.maxHeight = `${listHeight}px`;
    this.popup.style.width = `${width}px`;
    this.popup.style.left = `${Math.max(viewportLeft + 12, Math.min(rect.left, viewportLeft + viewportWidth - width - 12))}px`;
    const desiredTop = upwards ? rect.top - listHeight - 76 : rect.bottom + 6;
    this.popup.style.top = `${Math.max(viewportTop + 12, Math.min(desiredTop, viewportTop + viewportHeight - listHeight - 82))}px`;
    this.popup.style.bottom = "auto";
  }

  render() {
    const fold = text => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    const query = fold(this.query.value.trim());
    this.items = Array.from(this.select.options).filter(option => option.value && !option.disabled && fold(option.textContent).includes(query));
    this.list.replaceChildren(...this.items.map((option, index) => {
      const item = document.createElement("div");
      item.id = `${this.select.id}-menu-option-${index}`;
      item.dataset.index = String(index);
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === this.select.value));
      item.textContent = option.textContent;
      return item;
    }));
    this.list.scrollTop = 0;
    if (!this.items.length) {
      const empty = document.createElement("p");
      empty.className = "location-menu-empty";
      empty.setAttribute("role", "status");
      empty.textContent = "Nenhuma opção encontrada.";
      this.list.append(empty);
    }
    this.highlight(Math.max(0, this.items.findIndex(option => option.value === this.select.value)));
  }

  highlight(index) {
    this.active = index;
    Array.from(this.list.children).forEach((item, i) => item.classList.toggle("is-active", i === index && this.items.length > 0));
    const item = this.items.length && this.list.children[index];
    if (!item) { this.query.removeAttribute("aria-activedescendant"); return; }
    this.query.setAttribute("aria-activedescendant", item.id);
    if (item.offsetTop < this.list.scrollTop) this.list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > this.list.scrollTop + this.list.clientHeight)
      this.list.scrollTop = item.offsetTop + item.offsetHeight - this.list.clientHeight;
  }

  choose(option) {
    if (!option || this.select.disabled) return;
    this.select.value = option.value;
    this.close(true);
    this.select.dispatchEvent(new Event("input", { bubbles: true }));
    this.select.dispatchEvent(new Event("change", { bubbles: true }));
    this.sync();
  }

  close(focus = false) {
    this.popup.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    if (focus) this.button.focus({ preventScroll: true });
  }
}

// As listas vêm do backend local. Trocar uma seleção sempre limpa seus dependentes.
class LocationPicker {
  constructor({ api, isLocked, canResume = () => false, menus = [] }) {
    this.api = api;
    this.isLocked = isLocked;
    this.canResume = canResume;
    this.country = document.getElementById("country");
    this.region = document.getElementById("region");
    this.city = document.getElementById("city");
    this.manualRegion = document.getElementById("manual-region");
    this.manualCity = document.getElementById("manual-city");
    this.status = document.getElementById("location-status");
    this.retry = document.getElementById("location-retry");
    this.countries = [];
    this.regions = [];
    this.cities = [];
    this.lastLocationTarget = undefined;
    this.loading = "countries";
    this.failed = "";
    this.generation = 0;
    this.menus = menus;
    this.country.addEventListener("change", () => { void this.loadStates(); });
    this.region.addEventListener("change", () => { void this.loadCities(); });
    this.city.addEventListener("change", () => this.sync());
    for (const input of [this.manualRegion, this.manualCity]) {
      input.addEventListener("input", () => {
        // Um nome editado não deve manter o ponto de uma cidade já pesquisada.
        if (window.prospectLocationTarget?.stage === "city") this.lastLocationTarget = undefined;
        this.sync();
      });
    }
    this.retry.addEventListener("click", () => {
      if (this.failed === "countries") void this.initialize();
      else if (this.failed === "states") void this.loadStates();
      else if (this.failed === "cities") void this.loadCities();
    });
  }

  options(select, placeholder, entries) {
    const first = new Option(placeholder, "");
    select.replaceChildren(first, ...entries.map(item => new Option(item.label, String(item.value))));
  }

  resetCities() {
    this.cities = [];
    this.options(this.city, "Selecione o estado primeiro", []);
    this.manualCity.value = "";
  }

  async initialize() {
    const generation = ++this.generation;
    this.loading = "countries";
    this.failed = "";
    this.regions = [];
    this.options(this.country, "Carregando países…", []);
    this.options(this.region, "Selecione o país primeiro", []);
    this.manualRegion.value = "";
    this.resetCities();
    this.status.textContent = "Carregando países…";
    this.sync();
    try {
      const countries = await this.api("/api/locations/countries");
      if (generation !== this.generation) return;
      this.countries = countries;
      this.options(this.country, "Selecione o país", countries.map(item => ({
        value: item.code, label: item.labelpt || item.name
      })));
      this.status.textContent = "Escolha país, estado/província e cidade.";
    } catch (error) {
      if (generation !== this.generation) return;
      this.countries = [];
      this.failed = "countries";
      this.status.textContent = `Não foi possível carregar os países. ${error.message}`;
    } finally {
      if (generation === this.generation) { this.loading = ""; this.sync(); }
    }
  }

  async loadStates() {
    const generation = ++this.generation;
    const country = this.country.value;
    this.regions = [];
    this.failed = "";
    this.loading = country ? "states" : "";
    this.options(this.region, country ? "Carregando estados…" : "Selecione o país primeiro", []);
    this.manualRegion.value = "";
    this.resetCities();
    this.status.textContent = country ? "Carregando estados/províncias…" : "Escolha um país.";
    this.sync();
    if (!country) return;
    try {
      const regions = await this.api(`/api/locations/states?country=${encodeURIComponent(country)}`);
      if (generation !== this.generation) return;
      this.regions = regions;
      this.options(this.region, "Selecione o estado / província", [
        ...regions.map(item => ({ value: item.code, label: item.name })),
        ...(!regions.length ? [{ value: "__none__", label: "Sem estado / província" }] : []),
        { value: "__manual__", label: "Meu estado / província não está na lista" }
      ]);
      this.loading = "";
      this.status.textContent = "Agora escolha o estado/província.";
      if (!regions.length) {
        this.region.value = "__none__";
        void this.loadCities();
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.failed = "states";
      this.status.textContent = `Não foi possível carregar os estados. ${error.message}`;
    } finally {
      if (generation === this.generation) { this.loading = ""; this.sync(); }
    }
  }

  async loadCities() {
    const generation = ++this.generation;
    const country = this.country.value;
    const region = this.region.value;
    this.failed = "";
    this.resetCities();
    this.loading = country && region ? "cities" : "";
    this.status.textContent = this.loading ? "Carregando cidades…" : "Escolha um estado/província.";
    this.sync();
    if (!country || !region) return;
    try {
      const cities = ["__manual__", "__none__"].includes(region) ? []
        : await this.api(`/api/locations/cities?country=${encodeURIComponent(country)}&state=${encodeURIComponent(region)}`);
      if (generation !== this.generation) return;
      this.cities = cities;
      this.options(this.city, "Selecione a cidade", [
        ...cities.map(item => ({ value: item.id, label: item.name })),
        { value: "__manual__", label: "Minha cidade não está na lista" }
      ]);
      if (!cities.length) this.city.value = "__manual__";
      this.status.textContent = cities.length
        ? "Escolha a cidade. Se ela não estiver na lista, informe seu nome."
        : "Informe o nome da cidade; ela será localizada dentro do país escolhido.";
    } catch (error) {
      if (generation !== this.generation) return;
      this.failed = "cities";
      this.options(this.city, "Lista indisponível — escolha uma alternativa", [
        { value: "__manual__", label: "Informar o nome da cidade" }
      ]);
      this.status.textContent = `Não foi possível carregar a lista de cidades. Informe seu nome ou tente carregar novamente. ${error.message}`;
    } finally {
      if (generation === this.generation) { this.loading = ""; this.sync(); }
    }
  }

  valid() {
    return Boolean(!this.loading && (!this.failed || (this.failed === "cities" && this.city.value === "__manual__")) && this.country.value && this.region.value && this.city.value &&
      (this.region.value !== "__manual__" || this.manualRegion.value.trim().length >= 2) &&
      (this.city.value !== "__manual__" || this.manualCity.value.trim().length >= 1));
  }

  updateGlobeTarget() {
    const country = this.countries.find(item => item.code === this.country.value);
    const region = country && this.regions.find(item => item.code === this.region.value);
    const city = region && this.cities.find(item => String(item.id) === this.city.value);
    const selected = [["city", city], ["state", region], ["country", country]].find(([, item]) =>
      item && typeof item.latitude === "number" && typeof item.longitude === "number" &&
      Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
      Math.abs(item.latitude) <= 90 && Math.abs(item.longitude) <= 180 &&
      !(item.latitude === 0 && item.longitude === 0));
    const detail = selected ? {
      latitude: selected[1].latitude,
      longitude: selected[1].longitude,
      stage: selected[0],
      label: selected[1].labelpt || selected[1].name,
      countryCode: country.code
    } : null;
    const key = JSON.stringify(detail);
    if (key === this.lastLocationTarget) return;
    this.lastLocationTarget = key;
    // Um módulo 3D que termina de carregar depois dos filtros reaproveita o alvo atual.
    window.prospectLocationTarget = detail;
    window.dispatchEvent(new CustomEvent("prospect:location", { detail }));
  }

  sync() {
    this.updateGlobeTarget();
    const locked = this.isLocked();
    const manualRegion = this.region.value === "__manual__";
    const manualCity = this.city.value === "__manual__";
    this.country.disabled = locked || !this.countries.length || this.loading === "countries";
    this.region.disabled = locked || !this.country.value || ["countries", "states"].includes(this.loading) || this.failed === "states";
    this.city.disabled = locked || !this.region.value || Boolean(this.loading);
    this.menus.forEach(menu => menu.sync());
    document.getElementById("manual-region-label").hidden = !manualRegion;
    document.getElementById("manual-city-label").hidden = !manualCity;
    this.manualRegion.required = manualRegion;
    this.manualCity.required = manualCity;
    this.manualRegion.disabled = locked || !manualRegion;
    this.manualCity.disabled = locked || !manualCity;
    this.retry.hidden = !this.failed;
    this.retry.disabled = locked || Boolean(this.loading);
    const submit = document.querySelector('#search button[type="submit"]');
    submit.disabled = locked || !(this.valid() || this.canResume());
    submit.formNoValidate = this.canResume();
  }

  payload() {
    return {
      countryCode: this.country.value,
      stateCode: this.region.value,
      cityId: this.city.value === "__manual__" ? "__manual__" : Number(this.city.value),
      ...(this.region.value === "__manual__" ? { manualState: this.manualRegion.value.trim() } : {}),
      ...(this.city.value === "__manual__" ? { manualCity: this.manualCity.value.trim() } : {})
    };
  }
}
