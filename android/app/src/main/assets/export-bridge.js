(() => {
  "use strict";
  if (window.__prospectAndroidExports || !window.ProspectAndroid?.postMessage) return;
  window.__prospectAndroidExports = true;
  document.addEventListener("click", event => {
    const link = event.target.closest?.("a[download]");
    if (!link || !link.href.startsWith(`blob:${location.origin}/`) ||
        !/^prospect-ai(?:-parcial)?-\d+\.(csv|json)$/.test(link.download)) return;
    event.preventDefault();
    // Start fetching synchronously before the SaaS revokes its object URL.
    fetch(link.href).then(response => response.blob()).then(async blob => {
      const extension = link.download.endsWith(".csv") ? "csv" : "json";
      const mime = extension === "csv" ? "text/csv" : "application/json";
      if (blob.size > 8 * 1024 * 1024 || blob.type.split(";")[0] !== mime) throw new Error("export_budget_or_type");
      // Keep the UTF-8 BOM used by CSV exports so Excel retains accents.
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer());
      window.ProspectAndroid.postMessage(JSON.stringify({ type: "export", name: link.download, mime, text }));
    }).catch(() => window.ProspectAndroid.postMessage(JSON.stringify({ type: "export-error" })));
  }, true);
})();
