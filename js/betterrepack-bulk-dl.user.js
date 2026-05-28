// ==UserScript==
// @name         BetterRepack .zipmod bulk downloader
// @namespace    betterrepack-bulk-dl
// @version      1.2.0
// @description  Bulk-download .zipmod files from BetterRepack directory listings. Copy URLs for IDM/FDM batch import, push to Motrix/aria2 via JSON-RPC, or trigger sequential browser downloads.
// @author       DCinAC
// @license      GNU General Public License v3.0
// @homepageURL  https://github.com/DCinAC/KK_betterrepack_downloader
// @supportURL   https://github.com/DCinAC/KK_betterrepack_downloader/issues
// @downloadURL  https://github.com/DCinAC/KK_betterrepack_downloader/raw/main/betterrepack-bulk-dl.user.js
// @updateURL    https://github.com/DCinAC/KK_betterrepack_downloader/raw/main/betterrepack-bulk-dl.user.js
// @match        https://sideload.betterrepack.com/*
// @match        http://sideload.betterrepack.com/*
// @icon         https://sideload.betterrepack.com/download/theme/favicon.ico
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // ---------- config ----------
  const DEFAULTS = {
    rpcUrl: "http://localhost:16800/jsonrpc", // Motrix default; aria2 default is :6800
    rpcSecret: "", // Motrix: Preferences > Advanced > RPC Secret
    downloadDir: "", // empty = use download manager's default
    sequentialDelayMs: 800,
    defaultAction: null, // 'seq' | 'copy' | 'txt' | 'rpc' — null on first launch
    subfolderEnabled: true, // append URL-derived subfolder to RPC downloads
  };
  const cfg = (k) => GM_getValue(k, DEFAULTS[k]);
  const setCfg = (k, v) => GM_setValue(k, v);

  // ---------- collect ----------
  const collectZipmods = () => {
    const anchors = document.querySelectorAll(
      '#indexlist a[href$=".zipmod" i]',
    );
    const seen = new Set();
    const out = [];
    anchors.forEach((a) => {
      const u = a.href;
      if (!seen.has(u)) {
        seen.add(u);
        out.push({ url: u, name: decodeURIComponent(u.split("/").pop()) });
      }
    });
    return out;
  };

  // Build a per-URL subfolder name from the current pathname.
  // /download/KKEC/Sideloader%20Modpack/Noble_kale/ → KKEC-Sideloader%20Modpack-Noble_kale
  // Strips /download/ prefix, joins remaining segments with "-", sanitizes
  // Windows-illegal chars. URL-encoded chars (e.g. %20) are kept verbatim.
  const computeSubfolder = () => {
    let p = location.pathname.replace(/^\/+|\/+$/g, "");
    p = p.replace(/^download\//i, "");
    p = p.replace(/\//g, "-");
    p = p.replace(/[<>:"|?*\\]/g, "_");
    return p;
  };

  const joinPath = (a, b) => {
    if (!a) return b || "";
    if (!b) return a;
    return a.replace(/[\\/]+$/, "") + "/" + b.replace(/^[\\/]+/, "");
  };

  // ---------- actions ----------
  const copyUrlsToClipboard = (items) => {
    const text = items.map((i) => i.url).join("\n");
    GM_setClipboard(text, "text");
    toast(
      `Copied ${items.length} URLs. Paste into IDM/FDM > Add Batch Download.`,
    );
  };

  const downloadUrlListAsTxt = (items) => {
    const blob = new Blob([items.map((i) => i.url).join("\n")], {
      type: "text/plain",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "zipmod-urls.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const sendToAria2 = (items) => {
    const url = cfg("rpcUrl");
    const secret = cfg("rpcSecret");
    const baseDir = cfg("downloadDir");
    const useSub = cfg("subfolderEnabled");
    const sub = useSub ? computeSubfolder() : "";
    const finalDir = joinPath(baseDir, sub);
    if (!url) {
      toast('No RPC URL configured. Click "Settings".', true);
      return;
    }

    let ok = 0,
      fail = 0;
    let lastErr = null;
    const finalize = () => {
      if (ok + fail === items.length) {
        if (fail === 0) {
          toast(`Sent ${ok}/${items.length} to aria2/Motrix.`);
        } else {
          const detail = lastErr ? ` — ${lastErr}` : "";
          toast(`Sent ${ok}/${items.length} (${fail} failed)${detail}`, true);
          console.warn("[brdl] last error:", lastErr);
        }
      }
    };

    items.forEach((it, idx) => {
      const params = [];
      if (secret) params.push(`token:${secret}`);
      params.push([it.url]);
      const options = { out: it.name };
      if (finalDir) options.dir = finalDir;
      params.push(options);

      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: `br-${Date.now()}-${idx}`,
          method: "aria2.addUri",
          params,
        }),
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            fail++;
            lastErr = `HTTP ${res.status}`;
            console.warn("[brdl] HTTP", res.status, res.responseText);
          } else {
            try {
              const body = JSON.parse(res.responseText);
              if (body.error) {
                fail++;
                lastErr = `RPC ${body.error.code}: ${body.error.message}`;
                console.warn("[brdl] aria2 error:", body.error, it.url);
              } else {
                ok++;
              }
            } catch (e) {
              fail++;
              lastErr = "Invalid JSON response";
              console.warn("[brdl] bad JSON:", res.responseText);
            }
          }
          finalize();
        },
        onerror: (e) => {
          fail++;
          lastErr = `Network error (is aria2/Motrix running at ${url}?)`;
          console.warn("[brdl] network error:", e);
          finalize();
        },
        ontimeout: () => {
          fail++;
          lastErr = "Request timed out";
          finalize();
        },
      });
    });
  };

  const testRpcConnection = (urlOverride, secretOverride) => {
    const url = urlOverride !== undefined ? urlOverride : cfg("rpcUrl");
    const secret =
      secretOverride !== undefined ? secretOverride : cfg("rpcSecret");
    if (!url) {
      toast("No RPC URL configured.", true);
      return;
    }
    const params = secret ? [`token:${secret}`] : [];
    toast("Testing RPC connection…");
    GM_xmlhttpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: "brdl-test",
        method: "aria2.getVersion",
        params,
      }),
      onload: (res) => {
        if (res.status < 200 || res.status >= 300) {
          toast(`Reachable but HTTP ${res.status}. Check secret/path.`, true);
          return;
        }
        try {
          const body = JSON.parse(res.responseText);
          if (body.error) {
            toast(`RPC error ${body.error.code}: ${body.error.message}`, true);
          } else {
            const v = body.result && body.result.version;
            toast(`Connected. aria2 version ${v || "?"}.`);
          }
        } catch (_e) {
          toast("Connected but response was not JSON.", true);
        }
      },
      onerror: () =>
        toast(
          `Cannot reach ${url}. Is aria2/Motrix running on this port?`,
          true,
        ),
      ontimeout: () => toast("Connection timed out.", true),
    });
  };

  const sequentialBrowserDownload = async (items) => {
    const delay = cfg("sequentialDelayMs");
    toast(
      `Triggering ${items.length} downloads (~${Math.round((items.length * delay) / 1000)}s).`,
    );
    for (let i = 0; i < items.length; i++) {
      const a = document.createElement("a");
      a.href = items[i].url;
      // No download attribute: lets IDM/FDM extensions sniff the request.
      a.rel = "noopener";
      a.target = "_self";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, delay));
    }
  };

  // ---------- UI ----------
  const css = `
    #brdl-bar {
        position: sticky; top: 0; z-index: 9999;
        display: flex; gap: 12px; align-items: center;
        padding: 10px 14px; margin: 0 0 12px 0;
        background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px;
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
        #brdl-bar { background: #1f1f1f; border-color: #333; color: #e6e6e6; }
        #brdl-bar .brdl-trigger { background: #2a2a2a; border-color: #444; color: #e6e6e6; }
        #brdl-bar .brdl-trigger-main { border-right-color: #444; }
        #brdl-bar .brdl-trigger-main:hover,
        #brdl-bar .brdl-trigger-caret:hover { background: #333; }
    }
    #brdl-bar .brdl-count { font-weight: 600; }
    #brdl-bar .brdl-spacer { flex: 1; }

    /* split trigger button */
    .brdl-menu-wrap { position: relative; }
    .brdl-trigger {
        display: inline-flex; align-items: stretch;
        border: 1px solid #d0d7de; border-radius: 6px;
        background: white; overflow: hidden;
    }
    .brdl-trigger-main, .brdl-trigger-caret {
        display: inline-flex; align-items: center; gap: 8px;
        border: 0; background: transparent; cursor: pointer;
        font: inherit; font-weight: 600; color: inherit;
    }
    .brdl-trigger-main  { padding: 7px 12px; border-right: 1px solid #d0d7de; }
    .brdl-trigger-caret { padding: 7px 10px; }
    .brdl-trigger-main:hover,
    .brdl-trigger-caret:hover { background: #eaeef2; }
    .brdl-caret {
        width: 0; height: 0;
        border-left: 4px solid transparent; border-right: 4px solid transparent;
        border-top: 5px solid currentColor; opacity: .7;
    }
    .brdl-menu {
        position: absolute; top: calc(100% + 6px); right: 0;
        min-width: 240px; padding: 6px;
        background: #fff; color: #222;
        border: 1px solid #d0d7de; border-radius: 8px;
        box-shadow: 0 6px 20px rgba(0,0,0,.12);
        display: none;
    }
    .brdl-menu.open { display: block; }
    .brdl-menu button {
        display: flex; align-items: center; width: 100%;
        padding: 7px 10px; border: 0; background: transparent;
        border-radius: 5px; cursor: pointer;
        font: inherit; text-align: left; color: inherit;
    }
    .brdl-menu button:hover { background: #eaeef2; }
    .brdl-menu .brdl-check {
        display: inline-block; width: 16px; flex: 0 0 16px;
        text-align: center; opacity: 0;
    }
    .brdl-menu button.selected .brdl-check { opacity: 1; }
    .brdl-menu hr {
        border: 0; border-top: 1px solid #e0e4e8; margin: 4px 2px;
    }
    .brdl-menu .brdl-sub {
        font-size: 11px; opacity: .6; padding: 4px 10px 2px 26px;
    }
    @media (prefers-color-scheme: dark) {
        .brdl-menu { background: #1f1f1f; color: #e6e6e6; border-color: #333; }
        .brdl-menu button:hover { background: #2a2a2a; }
        .brdl-menu hr { border-top-color: #333; }
    }

    /* download icon (light theme — matches BetterRepack page bg) */
    .brdl-icon {
        --bg: #1ca0e6;
        --fg: #ffffff;
        width: 18px; height: 18px;
        border-radius: 50%;
        background: var(--bg);
        position: relative; display: inline-block;
        flex: 0 0 auto;
    }
    .brdl-icon::before {
        content: '';
        position: absolute; left: 50%; top: 18%;
        transform: translateX(-50%);
        width: 60%; height: 50%;
        background: var(--fg);
        clip-path: polygon(34% 0%, 66% 0%, 66% 50%, 100% 50%, 50% 100%, 0% 50%, 34% 50%);
    }
    .brdl-icon::after {
        content: '';
        position: absolute; left: 50%; bottom: 16%;
        transform: translateX(-50%);
        width: 64%; height: 22%;
        border: 0 solid var(--fg); box-sizing: border-box;
        border-bottom-width: 2px;
        border-left-width: 2px;
        border-right-width: 2px;
        border-radius: 0 0 2px 2px;
    }
    @media (prefers-color-scheme: dark) {
        .brdl-icon { --bg: #1f1f1f; --fg: #4ab8ff; box-shadow: 0 0 0 1px #333; }
    }

    /* settings dialog */
    #brdl-modal {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,.5);
        display: flex; align-items: center; justify-content: center;
    }
    #brdl-modal .box {
        background: #fff; color: #222; padding: 18px 20px; border-radius: 10px;
        width: min(420px, 90vw); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
        #brdl-modal .box { background: #1f1f1f; color: #e6e6e6; }
        #brdl-modal input { background: #2a2a2a; color: #e6e6e6; border-color: #444; }
    }
    #brdl-modal h3 { margin: 0 0 12px 0; }
    #brdl-modal label { display: block; margin: 8px 0 4px; font-weight: 600; font-size: 12px; }
    #brdl-modal input {
        width: 100%; padding: 6px 8px; border: 1px solid #d0d7de; border-radius: 6px;
        box-sizing: border-box; font: inherit;
    }
    #brdl-modal .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; align-items: center; }
    #brdl-modal .check-row {
        display: flex; align-items: flex-start; gap: 8px;
        margin: 10px 0 0; font-weight: 500; font-size: 13px;
    }
    #brdl-modal .check-row input { width: auto; margin-top: 2px; }
    #brdl-modal .hint { font-size: 11px; opacity: .7; margin-top: 2px; }
    #brdl-modal .hint code {
        background: rgba(127,127,127,.18); padding: 1px 4px; border-radius: 3px;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px;
    }
    #brdl-modal button {
        padding: 6px 12px; border-radius: 6px; border: 1px solid #d0d7de; background: white; cursor: pointer;
    }

    /* toast */
    #brdl-toast {
        position: fixed; right: 16px; bottom: 16px; z-index: 10001;
        padding: 10px 14px; border-radius: 8px;
        background: #2da44e; color: white;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        max-width: 360px;
        box-shadow: 0 4px 12px rgba(0,0,0,.2);
    }
    #brdl-toast.err { background: #cf222e; }
    `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const toast = (msg, isErr = false) => {
    const old = document.getElementById("brdl-toast");
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = "brdl-toast";
    if (isErr) el.classList.add("err");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  };

  const openSettings = () => {
    const modal = document.createElement("div");
    modal.id = "brdl-modal";
    modal.innerHTML = `
            <div class="box">
                <h3>Bulk downloader settings</h3>
                <label>RPC URL (Motrix: http://localhost:16800/jsonrpc · aria2: http://localhost:6800/jsonrpc)</label>
                <input id="brdl-url" type="text" value="${escapeAttr(cfg("rpcUrl"))}">
                <label>RPC secret (leave blank if none)</label>
                <input id="brdl-secret" type="text" value="${escapeAttr(cfg("rpcSecret"))}">
                <label>Base download directory (absolute path; leave blank for default)</label>
                <input id="brdl-dir" type="text" value="${escapeAttr(cfg("downloadDir"))}">
                <div class="check-row">
                    <input id="brdl-subfolder" type="checkbox" ${cfg("subfolderEnabled") ? "checked" : ""}>
                    <div>
                        <label for="brdl-subfolder" style="display:inline; font-weight:500; font-size:13px;">Save into a subfolder derived from the URL <span style="opacity:.6">(RPC only)</span></label>
                        <div class="hint">This page would save to: <code id="brdl-sub-preview"></code></div>
                    </div>
                </div>
                <label>Sequential download delay (ms)</label>
                <input id="brdl-delay" type="number" min="0" step="100" value="${cfg("sequentialDelayMs")}">
                <div class="row">
                    <button id="brdl-test" style="margin-right:auto">Test connection</button>
                    <button id="brdl-cancel">Cancel</button>
                    <button id="brdl-save">Save</button>
                </div>
            </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    // Live preview of the resolved download path.
    const subInput = modal.querySelector("#brdl-subfolder");
    const dirInput = modal.querySelector("#brdl-dir");
    const preview = modal.querySelector("#brdl-sub-preview");
    const updatePreview = () => {
      const sub = subInput.checked ? computeSubfolder() : "";
      const full = joinPath(dirInput.value.trim(), sub);
      preview.textContent = full || "(download manager default)";
    };
    subInput.addEventListener("change", updatePreview);
    dirInput.addEventListener("input", updatePreview);
    updatePreview();

    modal.querySelector("#brdl-cancel").onclick = () => modal.remove();
    modal.querySelector("#brdl-save").onclick = () => {
      setCfg("rpcUrl", modal.querySelector("#brdl-url").value.trim());
      setCfg("rpcSecret", modal.querySelector("#brdl-secret").value.trim());
      setCfg("downloadDir", dirInput.value.trim());
      setCfg("subfolderEnabled", subInput.checked);
      setCfg(
        "sequentialDelayMs",
        Math.max(
          0,
          parseInt(modal.querySelector("#brdl-delay").value, 10) || 0,
        ),
      );
      modal.remove();
      toast("Settings saved.");
    };
    modal.querySelector("#brdl-test").onclick = () => {
      testRpcConnection(
        modal.querySelector("#brdl-url").value.trim(),
        modal.querySelector("#brdl-secret").value.trim(),
      );
    };
  };

  const escapeAttr = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  // ---------- inject bar ----------
  const items = collectZipmods();
  if (items.length === 0) return; // not a relevant page

  const totalBytes = (() => {
    // size column is "2.2M" / "912K" etc. — best-effort parse, just for display
    const rows = document.querySelectorAll("#indexlist tr");
    let total = 0;
    rows.forEach((r) => {
      const link = r.querySelector('a[href$=".zipmod" i]');
      if (!link) return;
      const sz = r.querySelector(".indexcolsize");
      if (!sz) return;
      const m = sz.textContent.trim().match(/^([\d.]+)\s*([KMG])$/i);
      if (!m) return;
      const n = parseFloat(m[1]);
      const u = m[2].toUpperCase();
      total += n * (u === "G" ? 1024 ** 3 : u === "M" ? 1024 ** 2 : 1024);
    });
    return total;
  })();
  const humanSize = (b) =>
    b > 1024 ** 3
      ? (b / 1024 ** 3).toFixed(1) + " GB"
      : (b / 1024 ** 2).toFixed(0) + " MB";

  // ---------- action registry ----------
  const ACTIONS = {
    seq: {
      label: "Direct download",
      run: () => {
        if (
          confirm(
            `Trigger ${items.length} sequential downloads through your browser?`,
          )
        )
          sequentialBrowserDownload(items);
      },
    },
    copy: {
      label: "Copy links to clipboard",
      run: () => copyUrlsToClipboard(items),
    },
    txt: {
      label: "Save URL list (.txt)",
      run: () => downloadUrlListAsTxt(items),
    },
    rpc: { label: "Send to Motrix / aria2", run: () => sendToAria2(items) },
  };

  const bar = document.createElement("div");
  bar.id = "brdl-bar";
  bar.innerHTML = `
        <span class="brdl-count">${items.length} .zipmod files${totalBytes ? ` · ~${humanSize(totalBytes)}` : ""}</span>
        <span class="brdl-spacer"></span>
        <div class="brdl-menu-wrap">
            <div class="brdl-trigger">
                <button class="brdl-trigger-main" id="brdl-trigger-main" title="Run selected download mode">
                    <span class="brdl-icon" aria-hidden="true"></span>
                    <span>Download</span>
                </button>
                <button class="brdl-trigger-caret" id="brdl-trigger-caret" aria-haspopup="menu" aria-expanded="false" title="Choose download mode">
                    <span class="brdl-caret" aria-hidden="true"></span>
                </button>
            </div>
            <div class="brdl-menu" id="brdl-menu" role="menu">
                <button data-action="seq"  role="menuitem" title="Trigger sequential browser downloads (lets IDM/FDM extensions sniff)"><span class="brdl-check">✓</span>Direct download</button>
                <button data-action="copy" role="menuitem" title="Copy URL list to clipboard — paste into IDM/FDM > Add Batch Download"><span class="brdl-check">✓</span>Copy links to clipboard</button>
                <div class="brdl-sub">More</div>
                <button data-action="txt"  role="menuitem" title="Download a .txt file containing every URL"><span class="brdl-check">✓</span>Save URL list (.txt)</button>
                <button data-action="rpc"  role="menuitem" title="Send every URL to Motrix/aria2 over JSON-RPC"><span class="brdl-check">✓</span>Send to Motrix / aria2</button>
                <hr>
                <button id="brdl-cfg" role="menuitem"><span class="brdl-check"></span>Settings…</button>
            </div>
        </div>
    `;

  const wrapper = document.querySelector(".wrapper") || document.body;
  const list = document.getElementById("indexlist");
  if (list && list.parentNode === wrapper) wrapper.insertBefore(bar, list);
  else wrapper.insertBefore(bar, wrapper.firstChild);

  const mainBtn = bar.querySelector("#brdl-trigger-main");
  const caretBtn = bar.querySelector("#brdl-trigger-caret");
  const menu = bar.querySelector("#brdl-menu");

  const setMenuOpen = (open) => {
    menu.classList.toggle("open", open);
    caretBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  const syncChecks = () => {
    const def = cfg("defaultAction");
    menu.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.action === def);
    });
  };
  syncChecks();

  mainBtn.onclick = (e) => {
    e.stopPropagation();
    const def = cfg("defaultAction");
    if (!def || !ACTIONS[def]) {
      setMenuOpen(true);
      toast("Pick a default download mode — your choice will be remembered.");
      return;
    }
    ACTIONS[def].run();
  };
  caretBtn.onclick = (e) => {
    e.stopPropagation();
    setMenuOpen(!menu.classList.contains("open"));
  };
  document.addEventListener("click", (e) => {
    if (!bar.contains(e.target)) setMenuOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenuOpen(false);
  });

  menu.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      setCfg("defaultAction", action);
      syncChecks();
      setMenuOpen(false);
      ACTIONS[action].run();
    };
  });
  bar.querySelector("#brdl-cfg").onclick = () => {
    setMenuOpen(false);
    openSettings();
  };

  // ---------- menu commands ----------
  GM_registerMenuCommand("Copy .zipmod URLs", () => copyUrlsToClipboard(items));
  GM_registerMenuCommand("Send to Motrix / aria2", () => sendToAria2(items));
  GM_registerMenuCommand("Settings", openSettings);
})();
