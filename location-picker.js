"use strict";

// As listas vêm do backend local. Trocar uma seleção sempre limpa seus dependentes.
class LocationPicker {
  constructor({ api, isLocked, canResume = () => false }) {
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
    this.loading = "countries";
    this.failed = "";
    this.generation = 0;
    this.country.addEventListener("change", () => { void this.loadStates(); });
    this.region.addEventListener("change", () => { void this.loadCities(); });
    this.city.addEventListener("change", () => this.sync());
    for (const input of [this.manualRegion, this.manualCity]) {
      input.addEventListener("input", () => this.sync());
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
    this.options(this.city, "Selecione o estado primeiro", []);
    this.manualCity.value = "";
  }

  async initialize() {
    const generation = ++this.generation;
    this.loading = "countries";
    this.failed = "";
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

  sync() {
    const locked = this.isLocked();
    const manualRegion = this.region.value === "__manual__";
    const manualCity = this.city.value === "__manual__";
    this.country.disabled = locked || !this.countries.length || this.loading === "countries";
    this.region.disabled = locked || !this.country.value || ["countries", "states"].includes(this.loading) || this.failed === "states";
    this.city.disabled = locked || !this.region.value || Boolean(this.loading);
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
