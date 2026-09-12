/** Browser storage access and bounded page-context handshake. No token cache. */
function readStorageArea(storageName) {
  try {
    const storage = globalThis[storageName];
    if (!storage) return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key) out[key] = storage.getItem(key) || "";
    }
    return out;
  } catch {
    return {};
  }
}

export function currentStorageSnapshot() {
  return {
    localStorage: readStorageArea("localStorage"),
    sessionStorage: readStorageArea("sessionStorage"),
  };
}
export async function readPageStorageSnapshot(timeoutMs = 1200) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const id = `plaud-exporter-session-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => finish(null), timeoutMs);

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      resolve(value);
    }

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (
        !data ||
        data.source !== "plaud-exporter-page-session" ||
        data.id !== id
      ) {
        return;
      }
      finish(data.snapshot || null);
    }

    window.addEventListener("message", onMessage);

    try {
      const script = document.createElement("script");
      script.textContent = `(() => {
      const id = ${JSON.stringify(id)};
      function dump(name) {
        try {
          const storage = window[name];
          const out = {};
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key) out[key] = storage.getItem(key) || "";
          }
          return out;
        } catch (_) {
          return {};
        }
      }
      window.postMessage({
        source: "plaud-exporter-page-session",
        id,
        snapshot: {
          localStorage: dump("localStorage"),
          sessionStorage: dump("sessionStorage"),
        },
      }, "*");
    })();`;
      (document.documentElement || document.head || document.body).appendChild(
        script
      );
      script.remove();
    } catch {
      finish(null);
    }
  });
}
