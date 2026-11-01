(() => {
  "use strict";
  if (window.__prospectAndroidExports || !window.ProspectAndroid?.postMessage) return;
  window.__prospectAndroidExports = true;
  // The SaaS intentionally has connect-src 'self', which blocks fetch(blob:).
  // Retain a bounded reference to its export Blob instead of weakening CSP.
  const blobs = new Map();
  let retainedBytes = 0;
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  const forget = url => {
    const blob = blobs.get(url);
    if (blob) { retainedBytes -= blob.size; blobs.delete(url); }
  };
  URL.createObjectURL = object => {
    const url = create(object);
    if (object instanceof Blob && object.size <= 8 * 1024 * 1024 &&
        ["text/csv", "application/json"].includes(object.type.split(";")[0])) {
      while (blobs.size && (blobs.size >= 4 || retainedBytes + object.size > 8 * 1024 * 1024))
        forget(blobs.keys().next().value);
      blobs.set(url, object); retainedBytes += object.size;
    }
    return url;
  };
  URL.revokeObjectURL = url => { forget(url); return revoke(url); };
  document.addEventListener("click", event => {
    const link = event.target.closest?.("a[download]");
    if (!link || !link.href.startsWith(`blob:${location.origin}/`) ||
        !/^prospect-ai(?:-parcial)?-\d+\.(csv|json)$/.test(link.download)) return;
    event.preventDefault();
    const blob = blobs.get(link.href);
    Promise.resolve().then(async () => {
      if (!blob) throw new Error("untracked_or_oversized_export");
      const extension = link.download.endsWith(".csv") ? "csv" : "json";
      const mime = extension === "csv" ? "text/csv" : "application/json";
      if (blob.size > 8 * 1024 * 1024 || blob.type.split(";")[0] !== mime) throw new Error("export_budget_or_type");
      // Keep the UTF-8 BOM used by CSV exports so Excel retains accents.
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer());
      window.ProspectAndroid.postMessage(JSON.stringify({ type: "export", name: link.download, mime, text }));
    }).catch(() => window.ProspectAndroid.postMessage(JSON.stringify({ type: "export-error" })));
  }, true);
})();
