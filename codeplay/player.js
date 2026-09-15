/**
 * 码上听：GitHub Pages / COS 播放页共用。
 * 打开页只读曲目信息；点播放才下 MP3。
 * IndexedDB 存 ArrayBuffer（微信里 Blob 常写不进去）。
 * 后台 fetch 依赖 COS CORS；失败时角标显示「缓存失败」。
 */
(function () {
  var COS_CATALOG = "https://codeplay-audio-1484782458.cos.ap-shanghai.myqcloud.com/codeplay/catalog.json";
  var LOCAL_CATALOG = "./catalog.json";
  var LS_KEY = "codeplay.catalog.v1";
  var DB_NAME = "codeplay-audio";
  var DB_VER = 2;
  var STORE = "tracks";

  var nameEl = document.getElementById("name");
  var groupEl = document.getElementById("group");
  var msgEl = document.getElementById("msg");
  var playBtn = document.getElementById("play");
  var audio = document.getElementById("player");
  var cacheEl = document.getElementById("cache");
  var params = new URLSearchParams(location.search);
  var id = (params.get("id") || "").trim().toLowerCase();
  var track = null;
  var blobUrl = "";
  var fromCache = false;
  var caching = false;

  function setMsg(text, isErr) {
    msgEl.className = isErr ? "msg err" : "msg";
    msgEl.textContent = text || "";
  }

  function setCache(text, ok) {
    if (!cacheEl) return;
    cacheEl.textContent = text || "";
    cacheEl.className = ok ? "cache-pill ok" : "cache-pill";
  }

  function stripLeadingZeros(name) {
    return String(name || "").replace(/^0+(\d+)/, "$1");
  }

  function refreshMarquee() {
    var line = document.getElementById("trackline");
    var scroll = document.getElementById("trackscroll");
    var unit = document.getElementById("trackunit");
    if (!line || !scroll || !unit) return;
    Array.prototype.slice.call(scroll.querySelectorAll(".clone")).forEach(function (n) {
      n.parentNode.removeChild(n);
    });
    scroll.classList.remove("is-marquee");
    void unit.offsetWidth;
    if (unit.offsetWidth > line.clientWidth + 2) {
      var clone = unit.cloneNode(true);
      clone.className += " clone";
      clone.removeAttribute("id");
      var ids = clone.querySelectorAll("[id]");
      for (var i = 0; i < ids.length; i++) ids[i].removeAttribute("id");
      scroll.appendChild(clone);
      scroll.classList.add("is-marquee");
    }
  }

  function showError(text) {
    nameEl.textContent = "打不开这首";
    if (groupEl) groupEl.textContent = "";
    setMsg(text, true);
    playBtn.disabled = true;
    playBtn.textContent = "无法播放";
    setCache("无缓存", false);
    refreshMarquee();
  }

  function fetchJson(url, cacheMode) {
    return fetch(url, { cache: cacheMode || "default" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function catalogFromStorage() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveCatalog(file) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(file));
    } catch (e) { /* 微信存储配额满时忽略 */ }
  }

  function findTrack(file, trackId) {
    var tracks = (file && file.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      if (String(tracks[i].id || "").toLowerCase() === trackId) return tracks[i];
    }
    return null;
  }

  function loadTrackMeta() {
    var stored = catalogFromStorage();
    return fetchJson(LOCAL_CATALOG, "force-cache").then(function (file) {
      saveCatalog(file);
      var hit = findTrack(file, id);
      if (hit) return hit;
      throw new Error("local-miss");
    }).catch(function () {
      var hit = stored && findTrack(stored, id);
      if (hit) return hit;
      return fetchJson(COS_CATALOG, "default").then(function (file) {
        saveCatalog(file);
        var cloudHit = findTrack(file, id);
        if (!cloudHit) throw new Error("cloud-miss");
        return cloudHit;
      });
    });
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("no-idb"));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("idb")); };
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.objectStore(STORE).put(value, key);
      });
    });
  }

  function rowToBlob(row) {
    if (!row) return null;
    if (row.buffer && row.buffer.byteLength > 0) {
      return new Blob([row.buffer], { type: row.type || "audio/mpeg" });
    }
    if (row.blob && row.blob.size > 0) return row.blob;
    return null;
  }

  function applyBlob(blob) {
    if (blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ }
    }
    blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
    fromCache = true;
  }

  function cacheInBackground(url) {
    if (!url || caching || fromCache) return;
    caching = true;
    setCache("缓存中…", false);
    fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      if (!buf || buf.byteLength <= 0) throw new Error("empty");
      return idbPut(id, {
        id: id,
        sha256: (track && track.sha256) || "",
        type: (track && /\.m4a/i.test(track.url || "")) ? "audio/mp4" : "audio/mpeg",
        buffer: buf,
        savedAt: Date.now()
      }).then(function () {
        setCache("已缓存", true);
      });
    }).catch(function () {
      setCache("缓存失败", false);
    }).then(function () {
      caching = false;
    });
  }

  function tryLoadCache() {
    return idbGet(id).then(function (row) {
      var blob = rowToBlob(row);
      if (blob) {
        applyBlob(blob);
        setCache("已缓存", true);
        return true;
      }
      setCache("未缓存", false);
      return false;
    }).catch(function () {
      setCache("未缓存", false);
      return false;
    });
  }

  function playNow() {
    if (audio.paused) {
      if (!audio.getAttribute("src") && track && track.url) {
        audio.src = track.url;
        cacheInBackground(track.url);
      } else if (!fromCache && track && track.url) {
        cacheInBackground(track.url);
      }
      audio.play().then(function () {
        playBtn.textContent = "暂停";
        setMsg("", false);
      }).catch(function (err) {
        setMsg("播放失败：" + (err && err.message ? err.message : "请再点一次"), true);
      });
    } else {
      audio.pause();
      playBtn.textContent = "播放";
      setMsg("", false);
    }
  }

  if (!id) {
    showError("二维码里没有曲目 id。请用码上海报重新出码。");
    return;
  }

  loadTrackMeta().then(function (found) {
    track = found;
    if (!track || !track.url) {
      showError("曲库里还没有这首。可能尚未上传到云端。");
      return;
    }
    nameEl.textContent = stripLeadingZeros(track.displayName || "音频");
    groupEl.textContent = track.groupFolder || "";
    playBtn.disabled = false;
    playBtn.textContent = "播放";
    setMsg("", false);
    refreshMarquee();
    window.addEventListener("resize", refreshMarquee);
    playBtn.addEventListener("click", playNow);
    audio.addEventListener("ended", function () {
      playBtn.textContent = "再听一次";
      setMsg("", false);
    });
    return tryLoadCache();
  }).catch(function () {
    showError("曲目目录加载失败。请检查网络后重试。");
  });
})();
