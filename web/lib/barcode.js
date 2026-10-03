// Continuous UPC/EAN scanning with the vendored ZXing build (Safari has no
// built-in BarcodeDetector). Loaded only when the scanner is opened.
let loading = null;

function load() {
  if (window.ZXingBrowser) return Promise.resolve();
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = new URL("../vendor/zxing-browser.min.js", import.meta.url).href;
      s.onload = () => res();
      s.onerror = () => rej(new Error("Could not load the barcode scanner"));
      document.head.appendChild(s);
    });
  }
  return loading;
}

const RETAIL = /^\d{8}$|^\d{12,13}$/;

/** Calls onCode(code) once per new code. Returns a stop() function. */
export async function startScanner(video, onCode) {
  await load();
  const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
  const recent = new Map();
  const controls = await reader.decodeFromConstraints(
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    video,
    (result) => {
      if (!result) return;
      const code = result.getText();
      if (!RETAIL.test(code)) return;
      const last = recent.get(code) ?? 0;
      if (Date.now() - last < 4000) return;
      recent.set(code, Date.now());
      onCode(code);
    },
  );
  return () => controls.stop();
}
