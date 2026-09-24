(function (global) {
    "use strict";

    function resolveRoot() {
        const cs = document.currentScript;
        if (cs && cs.src) {
            const jsDirUrl = new URL("./", cs.src);
            return new URL("../", jsDirUrl).toString();
        }
        return "../";
    }

    const ROOT = resolveRoot();
    const MAPAS_DIR = ROOT + "mapas/";
    const INDEX_URL = MAPAS_DIR + "index.oks";
    const SCAN_CONCURRENCY = 6;

    let indexPromise = null;
    let indexById = null;
    const rejected = [];

    function hashName(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0) % 900000000 + 100000;
    }

    function numOf(id) {
        const m = String(id).match(/\d+/);
        return m ? parseInt(m[0], 10) : Infinity;
    }

    async function listFromDirectory() {
        const names = [];
        try {
            const res = await fetch(MAPAS_DIR, { cache: "no-store" });
            if (!res.ok) return names;
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            const base = new URL(MAPAS_DIR);
            doc.querySelectorAll("a[href]").forEach(function (a) {
                try {
                    const u = new URL(a.getAttribute("href"), res.url || MAPAS_DIR);
                    if (u.origin !== base.origin || u.pathname.indexOf(base.pathname) !== 0) return;
                    const rest = decodeURIComponent(u.pathname.slice(base.pathname.length));
                    if (!rest || rest.indexOf("/") !== -1) return;
                    if (/\.okx$/i.test(rest)) names.push(rest);
                } catch (e) {}
            });
        } catch (e) {}
        return names;
    }

    async function listFromIndexFile() {
        try {
            const res = await fetch(INDEX_URL, { cache: "no-store" });
            if (!res.ok) return [];
            const list = OKX.parseOKS(await res.text());
            return (Array.isArray(list) ? list : [])
                .map(function (e) { return e && e.file; })
                .filter(function (f) { return typeof f === "string" && /\.okx$/i.test(f); });
        } catch (e) {
            return [];
        }
    }

    function urlForFile(file) {
        return MAPAS_DIR + encodeURIComponent(file);
    }

    async function scanFile(file) {
        const url = urlForFile(file);
        try {
            const report = await OKX.inspect(url);
            if (!report.ok) {
                rejected.push({ file: file, errors: report.errors });
                console.warn("[OKX] '" + file + "' ignorado:", report.errors.join(" | "));
                return null;
            }
            const h = report.header;
            return {
                id: h.id,
                file: file,
                nombre: h.nombre || file.replace(/\.okx$/i, ""),
                autor: h.autor || "",
                creador: h.creador || "",
                dificultad: h.dificultad || "Medium",
                star: h.star != null ? String(h.star) : "0",
                bpm: h.bpm || 0,
                duracion: h.duracion || "00:00",
                puntos: h.puntos || 0,
                hasVideo: report.hasVideo
            };
        } catch (err) {
            const reason = err && err.message === "okx-bad-magic" ? "no es un OKX1 valido" : (err && err.message) || "error";
            rejected.push({ file: file, errors: [reason] });
            console.warn("[OKX] '" + file + "' ignorado:", reason);
            return null;
        }
    }

    async function scanAll(files) {
        const results = new Array(files.length);
        let next = 0;
        async function worker() {
            while (next < files.length) {
                const i = next++;
                results[i] = await scanFile(files[i]);
            }
        }
        const workers = [];
        for (let i = 0; i < Math.min(SCAN_CONCURRENCY, files.length); i++) workers.push(worker());
        await Promise.all(workers);
        return results.filter(Boolean);
    }

    function assignIds(entries) {
        const used = new Set();
        entries.sort(function (a, b) { return a.file.localeCompare(b.file); });
        entries.forEach(function (e) {
            let id = /^m\d+$/.test(String(e.id)) ? String(e.id) : null;
            if (!id || used.has(id)) {
                let n = hashName(e.file);
                id = "m" + n;
                while (used.has(id)) id = "m" + (++n);
            }
            e.id = id;
            used.add(id);
        });
        entries.sort(function (a, b) {
            return (numOf(a.id) - numOf(b.id)) || a.nombre.localeCompare(b.nombre);
        });
        return entries;
    }

    async function loadIndex() {
        if (indexPromise) return indexPromise;
        indexPromise = (async function () {
            const found = await Promise.all([listFromDirectory(), listFromIndexFile()]);
            const seen = new Set();
            const files = [];
            found[0].concat(found[1]).forEach(function (f) {
                const k = f.toLowerCase();
                if (!seen.has(k)) { seen.add(k); files.push(f); }
            });
            const entries = assignIds(await scanAll(files));
            indexById = {};
            entries.forEach(function (entry) {
                indexById[entry.id] = entry;
                const numMatch = String(entry.id).match(/\d+/);
                if (numMatch) indexById[numMatch[0]] = entry;
            });
            return entries;
        })();
        indexPromise.catch(function () { indexPromise = null; });
        return indexPromise;
    }

    function normalizeId(rawId) {
        if (rawId == null) return null;
        const s = String(rawId);
        return s.startsWith("m") ? s : "m" + s;
    }

    function urlFor(entry) {
        return urlForFile(entry.file);
    }

    const SONGS = {
        root: ROOT,

        async list() {
            return loadIndex();
        },

        async rejected() {
            await loadIndex();
            return rejected.slice();
        },

        async entryFor(rawId) {
            await loadIndex();
            const id = normalizeId(rawId);
            return indexById[id] || indexById[rawId] || null;
        },

        async getThumbUrl(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry) return null;
            const url = urlFor(entry);
            const header = await OKX.header(url);
            return OKX.entryUrl(url, header, "fondo", url + ":fondo:" + entry.id);
        },

        async getLight(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry) return null;
            const url = urlFor(entry);
            const header = await OKX.header(url);
            const fondoUrl = await OKX.entryUrl(url, header, "fondo", url + ":fondo:" + entry.id);
            return {
                id: entry.id,
                nombre: entry.nombre,
                autor: entry.autor,
                dificultad: entry.dificultad,
                star: entry.star,
                bpm: entry.bpm,
                duracion: entry.duracion,
                puntos: entry.puntos,
                hasVideo: entry.hasVideo,
                fondo: fondoUrl,
                portada: fondoUrl
            };
        },

        async getAudioUrl(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry) return null;
            const url = urlFor(entry);
            const header = await OKX.header(url);
            return OKX.entryUrl(url, header, "audio", url + ":audio:" + entry.id);
        },

        async getVideoUrl(rawId) {
            const entry = await SONGS.entryFor(rawId);
            if (!entry || !entry.hasVideo) return null;
            const url = urlFor(entry);
            const header = await OKX.header(url);
            return OKX.entryUrl(url, header, "video", url + ":video:" + entry.id);
        },

        async getFull(rawId, opts) {
            opts = opts || {};
            const entry = await SONGS.entryFor(rawId);
            if (!entry) throw new Error("song-not-found");
            const url = urlFor(entry);
            const header = await OKX.header(url);

            const fondoUrlPromise = OKX.entryUrl(url, header, "fondo", url + ":fondo:" + entry.id);
            const audioUrlPromise = OKX.entryUrl(url, header, "audio", url + ":audio:" + entry.id);
            const videoUrlPromise = (opts.video !== false && entry.hasVideo)
                ? OKX.entryUrl(url, header, "video", url + ":video:" + entry.id)
                : Promise.resolve(null);
            const mapTextPromise = OKX.entryText(url, header, "map");

            const [fondoUrl, audioUrl, videoUrl, mapText] = await Promise.all([
                fondoUrlPromise, audioUrlPromise, videoUrlPromise, mapTextPromise
            ]);

            const mapData = OKX.parseOKS(mapText);
            if (!mapData || !Array.isArray(mapData.notas)) throw new Error("map-invalid");
            const notes = mapData.notas.map(function (n) {
                const extra = n[2] || {};
                return {
                    time: n[0],
                    col: n[1],
                    damage: extra.damage,
                    "life-perfect": extra.lp,
                    "life-comun": extra.lc,
                    "life-okey": extra.lo,
                    hold: extra.hold,
                    tag: extra.tag,
                    cambio: extra.cambio ? { time: extra.cambio[0], col: extra.cambio[1] } : null
                };
            });

            return {
                id: entry.id,
                nombre: mapData.nombre || entry.nombre,
                autor: mapData.autor || entry.autor,
                creador: mapData.creador || entry.creador,
                dificultad: mapData.dificultad || entry.dificultad,
                star: mapData.star != null ? mapData.star : entry.star,
                bpm: mapData.bpm || entry.bpm,
                velocidad: mapData.velocidad,
                duracion: mapData.duracion || entry.duracion,
                puntos: mapData.puntos || entry.puntos,
                textos: mapData.textos || [],
                notes: notes,
                fondo: fondoUrl,
                portada: fondoUrl,
                audio: audioUrl,
                video: videoUrl
            };
        }
    };

    global.SONGS = SONGS;
})(typeof window !== "undefined" ? window : this);
