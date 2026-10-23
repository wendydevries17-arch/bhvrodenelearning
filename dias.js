/* =====================================================================
   BHV Roden leeromgeving: dia's met een presentator op greenscreen

   Drie onderdelen:
   1. De keyer. Haalt het groen uit de video, live in de browser, met
      WebGL. Het groene doek wordt doorzichtig en de presentator staat
      op de dia.
   2. De speler voor de cursist. Dia voor dia, met de video erover, en
      door naar de volgende dia als de video klaar is.
   3. Het beheer. Een PowerPoint inlezen, de hoofdstukken indelen, en
      per dia een video koppelen en afstellen.

   app.js roept dit aan via window.BHVDias. Hier staat geen eigen
   toegangscontrole: wat een beheerder mag regelt de database.
   ===================================================================== */
(function () {
  "use strict";

  var BUCKET = "presentaties";
  var MAX_UPLOAD = 48 * 1024 * 1024; // net onder de grens van Supabase

  /* ---------- standaardinstellingen voor een video ---------- */
  function standaardVideo() {
    return { x: 26, y: 0, schaal: 100, kleur: null, sim: 0.36, zacht: 0.10, spill: 0.12, kant: "rechts" };
  }
  var KANT_X = { links: -26, midden: 0, rechts: 26 };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function laadScript(src) {
    laadScript.cache = laadScript.cache || {};
    if (laadScript.cache[src]) return laadScript.cache[src];
    laadScript.cache[src] = new Promise(function (ok, mis) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { delete laadScript.cache[src]; mis(new Error("Kon " + src + " niet laden")); };
      document.head.appendChild(s);
    });
    return laadScript.cache[src];
  }
  function mmss(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2);
  }

  /* =====================================================================
     1. DE KEYER
     Hetzelfde principe als de chroma key in OBS: we vergelijken de kleur
     van elke pixel met de kleur van het doek in een kleurruimte zonder
     helderheid. Daardoor maakt een schaduw op het doek niet uit. Wat
     dichtbij genoeg is wordt doorzichtig, met een zachte rand, en de
     groene weerschijn op haar en kleding wordt weggepoetst.
     ===================================================================== */
  var VS = "attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
  var FS = [
    "precision mediump float;",
    "uniform sampler2D t;uniform vec3 k;uniform float sim,zacht,spill;varying vec2 uv;",
    // Kleur zonder helderheid: een schaduw of een donkere hoek van het
    // doek telt dan als hetzelfde groen.
    "vec2 cc(vec3 c){float y=dot(c,vec3(.299,.587,.114));return vec2(c.r*-.169+c.g*-.331+c.b*.5,c.r*.5+c.g*-.419+c.b*-.081)/(y+.15);}",
    "void main(){",
    "  vec4 c=texture2D(t,uv);",
    "  float d=distance(cc(c.rgb),cc(k));",
    "  float b=d-sim*.5;",
    "  float a=pow(clamp(b/max(zacht*.5,.001),0.,1.),1.5);",
    "  float s=pow(clamp(b/max(spill*.5,.001),0.,1.),1.5);",
    "  float g=dot(c.rgb,vec3(.2126,.7152,.0722));",
    "  vec3 kl=mix(vec3(g),c.rgb,s);",
    "  gl_FragColor=vec4(kl*a,a);",
    "}"
  ].join("\n");

  function Keyer(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.inst = standaardVideo();
    this.actief = false;
    var gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false }) ||
             canvas.getContext("experimental-webgl", { premultipliedAlpha: true, alpha: true });
    this.gl = gl;
    if (!gl) return;
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    gl.useProgram(pr);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.u = {
      k: gl.getUniformLocation(pr, "k"), sim: gl.getUniformLocation(pr, "sim"),
      zacht: gl.getUniformLocation(pr, "zacht"), spill: gl.getUniformLocation(pr, "spill")
    };
    gl.clearColor(0, 0, 0, 0);
  }
  Keyer.prototype.zet = function (inst) {
    this.inst = Object.assign(standaardVideo(), inst || {});
  };
  Keyer.prototype.teken = function () {
    var gl = this.gl, v = this.video;
    if (!gl || !v.videoWidth || v.readyState < 2) return;
    if (this.canvas.width !== v.videoWidth || this.canvas.height !== v.videoHeight) {
      this.canvas.width = v.videoWidth; this.canvas.height = v.videoHeight;
      this.canvas.style.aspectRatio = v.videoWidth + " / " + v.videoHeight;
      gl.viewport(0, 0, v.videoWidth, v.videoHeight);
    }
    if (!this.inst.kleur) this.inst.kleur = this.proefKleur();
    var k = this.inst.kleur || [0, 177, 64];
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    } catch (e) {
      // Komt de video van een ander domein zonder toestemming, dan mag
      // de browser de pixels niet lezen. Dan tonen we hem zonder key.
      this.fout = e;
      return;
    }
    gl.uniform3f(this.u.k, k[0] / 255, k[1] / 255, k[2] / 255);
    gl.uniform1f(this.u.sim, this.inst.sim);
    gl.uniform1f(this.u.zacht, this.inst.zacht);
    gl.uniform1f(this.u.spill, this.inst.spill);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  /* De kleur van het doek: we kijken in de vier hoeken en nemen de
     groenste. In een hoek staat bijna nooit de presentator. */
  Keyer.prototype.proefKleur = function (px, py) {
    var v = this.video;
    if (!v.videoWidth) return null;
    var c = document.createElement("canvas");
    var w = c.width = 160, h = c.height = Math.round(160 * v.videoHeight / v.videoWidth);
    var x = c.getContext("2d", { willReadFrequently: true });
    try { x.drawImage(v, 0, 0, w, h); } catch (e) { return null; }
    var data;
    try { data = x.getImageData(0, 0, w, h).data; } catch (e) { return null; }
    function gem(x0, y0, x1, y1) {
      var r = 0, g = 0, b = 0, n = 0;
      for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) {
        var i = (yy * w + xx) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      return [r / n, g / n, b / n];
    }
    if (px != null) {
      var cx = Math.round(px * w), cy = Math.round(py * h);
      return gem(Math.max(0, cx - 2), Math.max(0, cy - 2), Math.min(w, cx + 3), Math.min(h, cy + 3)).map(Math.round);
    }
    // Alle duidelijk groene pixels in het beeld, en daarvan de middelste
    // waarde. Dat is stabieler dan alleen de hoeken, die vaak donkerder zijn.
    var rs = [], gs = [], bs = [];
    for (var yy = 0; yy < h; yy += 3) for (var xx = 0; xx < w; xx += 3) {
      var q = (yy * w + xx) * 4, R = data[q], G = data[q + 1], B = data[q + 2];
      if (G > 60 && G > R * 1.25 && G > B * 1.25) { rs.push(R); gs.push(G); bs.push(B); }
    }
    if (rs.length > (w * h / 9) * 0.08) {
      var mid = function (a) { a.sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; };
      return [mid(rs), mid(gs), mid(bs)];
    }
    var m = 12, hh = Math.round(h * 0.18);
    var hoeken = [gem(2, 2, m, hh), gem(w - m, 2, w - 2, hh), gem(2, h - hh, m, h - 2), gem(w - m, h - hh, w - 2, h - 2)];
    hoeken.sort(function (a, b) { return (b[1] - Math.max(b[0], b[2])) - (a[1] - Math.max(a[0], a[2])); });
    return hoeken[0].map(Math.round);
  };
  Keyer.prototype.start = function () {
    var self = this;
    if (this.actief) return;
    this.actief = true;
    var v = this.video;
    var rvfc = typeof v.requestVideoFrameCallback === "function";
    function stap() {
      if (!self.actief) return;
      self.teken();
      if (rvfc && !v.paused) v.requestVideoFrameCallback(stap);
      else requestAnimationFrame(stap);
    }
    stap();
  };
  Keyer.prototype.stop = function () { this.actief = false; };

  /* De plek van de presentator op de dia. Het videobeeld is net zo
     breed als de dia; we schuiven en schalen het. Wat buiten de dia
     valt wordt afgeknipt. */
  function plaats(canvas, inst) {
    var i = Object.assign(standaardVideo(), inst || {});
    var s = (i.schaal || 100) / 100;
    canvas.style.width = (s * 100) + "%";
    canvas.style.left = (50 + Number(i.x || 0) - s * 50) + "%";
    canvas.style.bottom = (-Number(i.y || 0)) + "%";
  }

  /* =====================================================================
     2. DE SPELER VOOR DE CURSIST
     ===================================================================== */
  /* opties: { onVoortgang(alleGezien), lesAlAf } */
  function speler(doel, les, opties) {
    opties = opties || {};
    var dias = Array.isArray(les.dias) ? les.dias : [];
    var st = { i: 0, gezien: {}, gestart: false, auto: true };
    try { st.auto = localStorage.getItem("bhv-dia-auto") !== "nee"; } catch (e) { /* niets */ }

    doel.innerHTML =
      '<div class="dia-speler">' +
        '<div class="dia-toneel" tabindex="0" aria-label="Dia\'s van deze les. Gebruik de pijltjestoetsen om te bladeren.">' +
          '<img class="dia-beeld" alt="">' +
          '<canvas class="dia-key" aria-hidden="true"></canvas>' +
          '<video class="dia-video" playsinline preload="auto" crossorigin="anonymous"></video>' +
          '<button type="button" class="dia-start" hidden><span class="rond"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span><span class="wat">Start de les</span></button>' +
          '<button type="button" class="dia-vol" aria-label="Volledig scherm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>' +
        "</div>" +
        '<div class="dia-balk">' +
          '<span class="dia-tijd"><span class="dia-lijn"><span></span></span></span>' +
          '<div class="dia-knoppen">' +
            '<button type="button" class="dia-k" data-d="vorige" aria-label="Vorige dia"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5 8 12l7 7"/></svg></button>' +
            '<button type="button" class="dia-k" data-d="speel" aria-label="Afspelen"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button>' +
            '<span class="dia-nr" aria-live="polite"></span>' +
            '<button type="button" class="dia-k" data-d="volgende" aria-label="Volgende dia"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></button>' +
            '<label class="dia-auto"><input type="checkbox"' + (st.auto ? " checked" : "") + "> Automatisch door</label>" +
          "</div>" +
        "</div>" +
        '<div class="dia-strook" role="list"></div>' +
      "</div>";

    var el = doel.querySelector(".dia-speler");
    var toneel = el.querySelector(".dia-toneel");
    var img = el.querySelector(".dia-beeld");
    var cv = el.querySelector(".dia-key");
    var vid = el.querySelector(".dia-video");
    var start = el.querySelector(".dia-start");
    var speelKnop = el.querySelector('[data-d="speel"]');
    var lijn = el.querySelector(".dia-lijn span");
    var keyer = new Keyer(cv, vid);
    var geenGL = !keyer.gl;

    /* Stan zwijgt zolang Dirk Jan praat, en op een serieuze dia. */
    var STAN = window.BHVStan;
    var stilVideo = false, stilSerieus = false;
    function stanVideo(aan) {
      if (!STAN || stilVideo === aan) return;
      stilVideo = aan; STAN.stil(aan);
    }
    function stanSerieus(aan) {
      if (!STAN || stilSerieus === aan) return;
      stilSerieus = aan; STAN.stil(aan);
    }
    function stanTip(i) {
      var d = dias[i];
      if (!STAN || !d || !d.stan || !d.stan.tekst || d.serieus) return;
      setTimeout(function () {
        if (st.i === i) STAN.zeg("tip", { tekst: d.stan.tekst, pose: d.stan.pose || "tip", altijd: true });
      }, 600);
    }

    el.querySelector(".dia-strook").innerHTML = dias.map(function (d, i) {
      return '<button type="button" role="listitem" data-i="' + i + '" aria-label="Dia ' + (i + 1) + '">' +
        '<img src="' + esc(d.beeld) + '" alt="" loading="lazy">' +
        (d.video && d.video.url ? '<span class="heeft"></span>' : "") + "</button>";
    }).join("");

    function heeftVideo(i) { return !!(dias[i] && dias[i].video && dias[i].video.url); }

    function toon(i, spelen) {
      if (i < 0 || i >= dias.length) return;
      st.i = i;
      var d = dias[i];
      img.src = d.beeld;
      img.alt = d.titel ? "Dia: " + d.titel : "Dia " + (i + 1);
      if (dias[i + 1]) { var pre = new Image(); pre.src = dias[i + 1].beeld; }
      el.querySelector(".dia-nr").textContent = "Dia " + (i + 1) + " van " + dias.length;
      el.querySelector('[data-d="vorige"]').disabled = i === 0;
      el.querySelector('[data-d="volgende"]').disabled = i === dias.length - 1;
      el.querySelectorAll(".dia-strook button").forEach(function (b, k) {
        b.classList.toggle("nu", k === i);
        b.classList.toggle("gezien", !!st.gezien[k]);
        if (k === i) b.scrollIntoView({ block: "nearest", inline: "nearest" });
      });

      keyer.stop();
      vid.pause();
      stanVideo(false);
      stanSerieus(!!d.serieus);
      cv.style.visibility = "hidden";
      lijn.style.width = "0%";
      if (heeftVideo(i)) {
        keyer.zet(d.video);
        plaats(cv, d.video);
        if (geenGL) plaats(vid, d.video);
        vid.src = d.video.url;
        speelKnop.hidden = false;
        if (spelen && st.gestart) speel();
        else if (!st.gestart) start.hidden = false;
      } else {
        vid.removeAttribute("src");
        vid.load();
        speelKnop.hidden = true;
        markeer(i);
        stanTip(i);
      }
    }

    function speel() {
      var p = vid.play();
      if (p && p.catch) p.catch(function () { start.hidden = false; });
    }
    function markeer(i) {
      if (st.gezien[i]) return;
      st.gezien[i] = true;
      var b = el.querySelector('.dia-strook [data-i="' + i + '"]');
      if (b) b.classList.add("gezien");
      if (opties.onVoortgang) opties.onVoortgang(alleGezien(), st);
    }
    function alleGezien() {
      for (var k = 0; k < dias.length; k++) if (!st.gezien[k]) return false;
      return true;
    }

    vid.addEventListener("playing", function () {
      start.hidden = true;
      stanVideo(true);
      cv.style.visibility = geenGL ? "hidden" : "visible";
      if (geenGL) vid.classList.add("zonder-key");
      keyer.start();
      speelKnop.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>';
      speelKnop.setAttribute("aria-label", "Pauzeren");
    });
    vid.addEventListener("pause", function () {
      stanVideo(false);
      speelKnop.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
      speelKnop.setAttribute("aria-label", "Afspelen");
    });
    vid.addEventListener("timeupdate", function () {
      if (vid.duration) {
        lijn.style.width = (vid.currentTime * 100 / vid.duration) + "%";
        el.querySelector(".dia-tijd").setAttribute("data-t", mmss(vid.currentTime) + " / " + mmss(vid.duration));
      }
      if (vid.duration && vid.currentTime / vid.duration > 0.9) markeer(st.i);
    });
    vid.addEventListener("ended", function () {
      markeer(st.i);
      keyer.teken();
      stanVideo(false);
      // Heeft deze dia een tip van Stan, dan komt die na de video. Dan
      // gaan we ook niet meteen door, zodat de cursist hem kan lezen.
      var heeftTip = dias[st.i] && dias[st.i].stan && dias[st.i].stan.tekst && !dias[st.i].serieus;
      if (heeftTip) { stanTip(st.i); return; }
      if (st.auto && st.i < dias.length - 1) {
        setTimeout(function () { if (vid.ended) toon(st.i + 1, true); }, 900);
      }
    });

    start.addEventListener("click", function () {
      st.gestart = true;
      start.hidden = true;
      if (heeftVideo(st.i)) speel();
    });
    speelKnop.addEventListener("click", function () {
      st.gestart = true;
      if (vid.paused) { if (vid.ended) vid.currentTime = 0; speel(); } else vid.pause();
    });
    el.querySelector('[data-d="vorige"]').addEventListener("click", function () { st.gestart = true; toon(st.i - 1, true); });
    el.querySelector('[data-d="volgende"]').addEventListener("click", function () { st.gestart = true; toon(st.i + 1, true); });
    el.querySelector(".dia-strook").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]");
      if (b) { st.gestart = true; toon(Number(b.dataset.i), true); }
    });
    el.querySelector(".dia-auto input").addEventListener("change", function (e) {
      st.auto = e.target.checked;
      try { localStorage.setItem("bhv-dia-auto", st.auto ? "ja" : "nee"); } catch (er) { /* niets */ }
    });
    toneel.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); st.gestart = true; toon(st.i + 1, true); }
      if (e.key === "ArrowLeft") { e.preventDefault(); st.gestart = true; toon(st.i - 1, true); }
      if (e.key === " ") { e.preventDefault(); speelKnop.click(); }
    });
    el.querySelector(".dia-vol").addEventListener("click", function () {
      var f = document.fullscreenElement || document.webkitFullscreenElement;
      if (f) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      var r = toneel.requestFullscreen || toneel.webkitRequestFullscreen;
      if (r) r.call(toneel);
    });

    if (opties.lesAlAf) dias.forEach(function (d, i) { st.gezien[i] = true; });
    if (!dias.length) {
      toneel.innerHTML = '<div class="vmelding"><b>Deze les heeft nog geen dia\'s</b></div>';
    } else {
      toon(0, false);
      if (!heeftVideo(0)) start.hidden = true;
    }

    return {
      stop: function () { keyer.stop(); vid.pause(); stanVideo(false); stanSerieus(false); },
      alleGezien: alleGezien
    };
  }

  /* =====================================================================
     3. HET BEHEER
     ctx komt uit app.js: { sb, toast, melding, IC, cursusId, naarBeheer, bekijkConcept }
     ===================================================================== */
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  var P = { ctx: null, modules: [], lessen: [], concept: null, cursus: null };

  function beheer(paneel, ctx) {
    P.ctx = ctx;
    paneel.innerHTML = '<div class="laden"><span class="tol"></span>Bezig met ophalen</div>';
    return haalOp().then(function () { tekenOverzicht(paneel); });
  }

  function haalOp() {
    var sb = P.ctx.sb;
    return Promise.all([
      sb.from("cursussen").select("id, titel, organisatie_id").eq("actief", true).is("organisatie_id", null).limit(1),
      sb.from("modules").select("id, titel, volgorde, organisatie_id, status, gearchiveerd_op").order("volgorde"),
      sb.from("instellingen").select("waarde").eq("sleutel", "presentatie_concept").maybeSingle()
    ]).then(function (r) {
      r.forEach(function (x) { if (x.error) throw x.error; });
      P.cursus = (r[0].data || [])[0];
      if (!P.cursus) throw new Error("Er staat geen basiscursus in de database.");
      P.modules = r[1].data || [];
      P.concept = r[2].data ? r[2].data.waarde : null;
      var ids = P.modules.filter(function (m) { return m.status !== "archief"; }).map(function (m) { return m.id; });
      if (!ids.length) { P.lessen = []; return; }
      return sb.from("lessen").select("id, module_id, titel, volgorde, dias, duur_seconden").in("module_id", ids).order("volgorde")
        .then(function (q) { if (q.error) throw q.error; P.lessen = q.data || []; });
    });
  }

  function lessenVan(mid) { return P.lessen.filter(function (l) { return l.module_id === mid; }); }

  function tekenOverzicht(paneel) {
    var concept = P.modules.filter(function (m) { return m.status === "concept"; });
    var live = P.modules.filter(function (m) { return m.status === "live" && !m.organisatie_id; });
    var klant = P.modules.filter(function (m) { return m.status === "live" && m.organisatie_id; });
    var archief = P.modules.filter(function (m) { return m.status === "archief"; });

    var uit = '<div class="kop"><h1>De <em>presentatie</em></h1>' +
      "<p>Lees een PowerPoint in. Elke dia wordt een stap in de les, en per dia koppel je een greenscreen-video. " +
      "Het groen wordt er tijdens het afspelen vanzelf uitgehaald, zodat de presentator in de dia staat.</p></div>";

    uit += '<div class="paneel"><div class="paneel-kop"><h2>Nieuwe PowerPoint inlezen</h2></div><div class="paneel-body" style="padding:16px 18px">' +
      '<div class="veld-rij">' +
        '<div class="veld"><label for="pr-pdf">De presentatie als PDF</label>' +
        '<input class="kies" id="pr-pdf" type="file" accept="application/pdf,.pdf">' +
        '<span class="hint">In PowerPoint: Bestand, Exporteren, PDF. Daar halen we de beelden van de dia\'s uit, precies zoals jij ze ziet.</span></div>' +
        '<div class="veld"><label for="pr-pptx">De PowerPoint zelf (aanbevolen)</label>' +
        '<input class="kies" id="pr-pptx" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation">' +
        '<span class="hint">Daar halen we de titels, de secties en je notities uit.</span></div>' +
      "</div>" +
      '<div class="btn-row" style="margin-top:14px"><button type="button" class="btn btn-a" id="pr-lees">Inlezen</button>' +
      '<span class="lead" id="pr-stand"></span></div>' +
      (concept.length ? '<div class="let" style="margin-top:14px"><b>Er staat al een concept klaar.</b> Lees je een nieuwe in, dan vervangt die het concept. De gekoppelde video\'s van het concept gaan dan ook weg.</div>' : "") +
      "</div></div>";

    if (concept.length) {
      uit += '<div class="paneel pr-concept"><div class="paneel-kop"><h2>Concept' +
        (P.concept && P.concept.bestand ? ": " + esc(P.concept.bestand) : "") + "</h2>" +
        '<div class="btn-row">' +
        '<button type="button" class="btn btn-g btn-sm" id="pr-bekijk">Bekijk als cursist</button>' +
        '<button type="button" class="btn btn-g btn-sm" id="pr-weg">Concept weggooien</button>' +
        '<button type="button" class="btn btn-a btn-sm" id="pr-publiceer">Publiceren</button>' +
        "</div></div>" +
        '<div class="paneel-body">' + moduleLijst(concept) + "</div>" +
        '<div class="paneel-body klein" style="padding:12px 18px;border-top:1px solid var(--line)">Cursisten zien dit nog niet. ' +
        "Bij publiceren gaan de huidige basishoofdstukken naar het archief" +
        (klant.length ? " en blijven " + klant.map(function (m) { return esc(m.titel); }).join(", ") + " gewoon staan" : "") +
        ".</div></div>";
    }

    uit += '<div class="paneel"><div class="paneel-kop"><h2>Nu live voor cursisten</h2></div><div class="paneel-body">' +
      (live.length ? moduleLijst(live) : '<div class="regel"><span class="tekst">Nog geen basishoofdstukken live.</span></div>') +
      "</div>" +
      (archief.length ? '<div class="paneel-body klein" style="padding:12px 18px;border-top:1px solid var(--line)">' +
        archief.length + " gearchiveerde " + (archief.length === 1 ? "hoofdstuk" : "hoofdstukken") +
        ' in het archief. <button type="button" class="linkknop" id="pr-terug">Vorige versie terugzetten</button></div>' : "") +
      "</div>";

    paneel.innerHTML = uit;
    paneel.querySelector("#pr-lees").addEventListener("click", function () { leesIn(paneel); });
    paneel.querySelectorAll("[data-pr-les]").forEach(function (b) {
      b.addEventListener("click", function () { tekenLesDias(paneel, b.dataset.prLes); });
    });
    function knop(sel, fn) {
      var el = paneel.querySelector(sel);
      if (el) el.addEventListener("click", function () { fn(el); });
    }
    knop("#pr-bekijk", function () { P.ctx.bekijkConcept(); });
    knop("#pr-weg", function (k) {
      if (!confirm("Het concept weggooien? De dia's en gekoppelde video's van het concept zijn dan weg uit de leeromgeving.")) return;
      doeRpc(k, "verwijder_concept", { p_cursus: P.cursus.id }, "Het concept is weggegooid", paneel);
    });
    knop("#pr-publiceer", function (k) {
      var zonder = P.lessen.filter(function (l) {
        return concept.some(function (m) { return m.id === l.module_id; });
      }).reduce(function (n, l) {
        return n + (l.dias || []).filter(function (d) { return !(d.video && d.video.url); }).length;
      }, 0);
      var vraag = "Publiceren? Cursisten zien dan meteen de nieuwe hoofdstukken. De oude gaan naar het archief en zijn terug te zetten." +
        (zonder ? "\n\nLet op: " + zonder + (zonder === 1 ? " dia heeft" : " dia's hebben") + " nog geen video." : "");
      if (!confirm(vraag)) return;
      doeRpc(k, "publiceer_presentatie", { p_cursus: P.cursus.id }, "Gepubliceerd. Cursisten zien nu de nieuwe hoofdstukken", paneel, true);
    });
    knop("#pr-terug", function (k) {
      if (!confirm("De vorige versie terugzetten? De hoofdstukken die nu live staan worden dan weer een concept.")) return;
      doeRpc(k, "zet_vorige_versie_terug", { p_cursus: P.cursus.id }, "De vorige versie staat weer live", paneel, true);
    });
  }

  function doeRpc(knop, naam, args, gelukt, paneel, herlaad) {
    var was = knop.textContent;
    knop.disabled = true; knop.textContent = "Bezig";
    P.ctx.sb.rpc(naam, args).then(function (r) {
      if (r.error) throw r.error;
      P.ctx.toast(gelukt);
      if (herlaad && P.ctx.herlaadCursus) P.ctx.herlaadCursus();
      return beheer(paneel, P.ctx);
    }).catch(function (e) {
      knop.disabled = false; knop.textContent = was;
      P.ctx.melding("Dat lukte niet", "Er is niets veranderd. Probeer het zo nog een keer.", "mis", e);
    });
  }

  function moduleLijst(mods) {
    return mods.map(function (m) {
      var ls = lessenVan(m.id);
      return '<div class="pr-mod"><div class="pr-mod-kop"><b>' + esc(m.titel) + "</b>" +
        (m.organisatie_id ? '<span class="chip nieuw">klanthoofdstuk</span>' : "") + "</div>" +
        ls.map(function (l) {
          var d = Array.isArray(l.dias) ? l.dias : [];
          var mv = d.filter(function (x) { return x.video && x.video.url; }).length;
          if (!d.length) {
            return '<div class="regel"><span class="tekst"><b>' + esc(l.titel) + "</b><span>gewone les, zonder dia's</span></span></div>";
          }
          var klaar = mv === d.length;
          return '<div class="regel"><span class="vink ' + (klaar ? "ja" : "bezig") + '">' + (klaar ? P.ctx.IC.vink : "") + "</span>" +
            '<span class="pr-duim"><img src="' + esc(d[0].beeld) + '" alt="" loading="lazy"></span>' +
            '<span class="tekst"><b>' + esc(l.titel) + "</b><span>" + d.length + (d.length === 1 ? " dia" : " dia's") +
            ", " + mv + " met video</span></span>" +
            '<button type="button" class="btn btn-g btn-sm" data-pr-les="' + esc(l.id) + '">Video\'s koppelen</button></div>';
        }).join("") + "</div>";
    }).join("");
  }

  /* ---------------------------------------------------------------------
     Inlezen
     De PDF levert het beeld van elke dia. De PowerPoint levert wat in
     een PDF niet staat: de secties, welke dia een titeldia is, en de
     notities. Verborgen dia's staan niet in de PDF, dus die slaan we in
     de PowerPoint ook over, anders lopen de twee niet meer gelijk.
     --------------------------------------------------------------------- */
  function leesIn(paneel) {
    var pdfF = paneel.querySelector("#pr-pdf").files[0];
    var pptF = paneel.querySelector("#pr-pptx").files[0];
    var stand = paneel.querySelector("#pr-stand");
    if (!pdfF) {
      P.ctx.melding("Kies eerst de PDF", "Zonder PDF hebben we geen beelden van de dia's. Exporteer de presentatie in PowerPoint als PDF en kies die hierboven.");
      return;
    }
    stand.textContent = "Bezig met lezen";
    var knop = paneel.querySelector("#pr-lees");
    knop.disabled = true;

    Promise.all([leesPdf(pdfF, function (t) { stand.textContent = t; }), pptF ? leesPptx(pptF) : Promise.resolve(null)])
      .then(function (r) {
        var pdf = r[0], ppt = r[1];
        var waarschuwing = "";
        if (ppt && ppt.dias.length !== pdf.paginas.length) {
          waarschuwing = "De PowerPoint heeft " + ppt.dias.length + " zichtbare dia's en de PDF " + pdf.paginas.length +
            " pagina's. Die lopen niet gelijk, dus de titels en notities uit de PowerPoint gebruiken we niet. " +
            "Controleer of de PDF van dezelfde versie is, of deel de hoofdstukken hieronder zelf in.";
          ppt = null;
        }
        var plan = maakPlan(pdf, ppt);
        knop.disabled = false;
        stand.textContent = "";
        tekenIndeling(paneel, { pdf: pdf, ppt: ppt, plan: plan, naam: (pptF || pdfF).name, waarschuwing: waarschuwing });
      })
      .catch(function (e) {
        knop.disabled = false;
        stand.textContent = "";
        P.ctx.melding("Het inlezen lukte niet", "Controleer of je de goede bestanden hebt gekozen. Een PDF met een wachtwoord kunnen we niet lezen.", "mis", e);
      });
  }

  function leesPdf(file, voortgang) {
    return laadScript(PDFJS).then(function () {
      var lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; });
    }).then(function (doc) {
      var paginas = [];
      var i = 0;
      function volgende() {
        i++;
        if (i > doc.numPages) return Promise.resolve({ doc: doc, paginas: paginas });
        if (voortgang) voortgang("Dia " + i + " van " + doc.numPages + " lezen");
        return doc.getPage(i).then(function (page) {
          var vp = page.getViewport({ scale: 1 });
          var sc = 320 / vp.width;
          var v2 = page.getViewport({ scale: sc });
          var c = document.createElement("canvas");
          c.width = Math.round(v2.width); c.height = Math.round(v2.height);
          return page.render({ canvasContext: c.getContext("2d"), viewport: v2 }).promise.then(function () {
            return page.getTextContent();
          }).then(function (tc) {
            // De grootste letters op de pagina zijn bijna altijd de titel.
            var items = tc.items.filter(function (it) { return it.str && it.str.trim(); });
            var max = 0;
            items.forEach(function (it) { var h = Math.abs(it.transform[3]) || it.height || 0; if (h > max) max = h; });
            var titel = items.filter(function (it) { return (Math.abs(it.transform[3]) || it.height || 0) >= max * 0.92; })
              .map(function (it) { return it.str; }).join(" ").replace(/\s+/g, " ").trim();
            paginas.push({
              nr: i, duim: c.toDataURL("image/jpeg", 0.7), breed: vp.width, hoog: vp.height,
              titel: titel.slice(0, 140),
              tekst: items.map(function (it) { return it.str; }).join(" ").replace(/\s+/g, " ").trim()
            });
            page.cleanup();
            return volgende();
          });
        });
      }
      return volgende();
    });
  }

  function xml(s) { return new DOMParser().parseFromString(s, "application/xml"); }
  function alle(node, naam) {
    var uit = [];
    var all = node.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) if (all[i].localName === naam) uit.push(all[i]);
    return uit;
  }
  function attr(el, naam) {
    if (!el) return null;
    if (el.hasAttribute(naam)) return el.getAttribute(naam);
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.localName === naam.split(":").pop() && (naam.indexOf(":") < 0 || a.name === naam)) return a.value;
    }
    return null;
  }
  function pad(basis, rel) {
    var d = basis.split("/"); d.pop();
    rel.split("/").forEach(function (x) { if (x === "..") d.pop(); else if (x !== ".") d.push(x); });
    return d.join("/");
  }
  function relaties(zip, bestand) {
    var p = bestand.split("/"); var naam = p.pop();
    var r = p.join("/") + "/_rels/" + naam + ".rels";
    var f = zip.file(r);
    if (!f) return Promise.resolve({});
    return f.async("string").then(function (s) {
      var uit = {};
      alle(xml(s), "Relationship").forEach(function (el) {
        uit[el.getAttribute("Id")] = { doel: pad(bestand, el.getAttribute("Target")), soort: el.getAttribute("Type") || "" };
      });
      return uit;
    });
  }
  function alineas(node) {
    return alle(node, "p").map(function (p) {
      return alle(p, "t").map(function (t) { return t.textContent; }).join("");
    }).filter(function (s) { return s.trim(); });
  }

  function leesPptx(file) {
    return laadScript(JSZIP).then(function () { return window.JSZip.loadAsync(file); }).then(function (zip) {
      var presPad = "ppt/presentation.xml";
      return Promise.all([zip.file(presPad).async("string"), relaties(zip, presPad)]).then(function (r) {
        var pres = xml(r[0]), rels = r[1];
        var lijst = alle(pres, "sldId").filter(function (el) { return el.parentNode && el.parentNode.localName === "sldIdLst"; });
        // Secties: in de uitbreiding p14:sectionLst
        var secties = {};
        alle(pres, "section").forEach(function (s) {
          alle(s, "sldId").forEach(function (sid) { secties[sid.getAttribute("id")] = s.getAttribute("name"); });
        });
        return Promise.all(lijst.map(function (el, idx) {
          var rid = attr(el, "r:id") || attr(el, "id_r");
          var id = el.getAttribute("id");
          var slidePad = rels[rid] && rels[rid].doel;
          if (!slidePad || !zip.file(slidePad)) return null;
          return Promise.all([zip.file(slidePad).async("string"), relaties(zip, slidePad)]).then(function (q) {
            var sx = xml(q[0]), srels = q[1];
            var root = sx.documentElement;
            var verborgen = root.getAttribute("show") === "0";
            var titel = "";
            var body = [];
            alle(sx, "sp").forEach(function (sp) {
              var ph = alle(sp, "ph")[0];
              var type = ph ? ph.getAttribute("type") : null;
              var tekst = alineas(sp);
              if (type === "title" || type === "ctrTitle") titel = titel || tekst.join(" ");
              else body = body.concat(tekst);
            });
            var notitiesPad = null, layoutPad = null;
            Object.keys(srels).forEach(function (k) {
              if (/notesSlide$/.test(srels[k].soort)) notitiesPad = srels[k].doel;
              if (/slideLayout$/.test(srels[k].soort)) layoutPad = srels[k].doel;
            });
            return Promise.all([
              notitiesPad && zip.file(notitiesPad) ? zip.file(notitiesPad).async("string") : null,
              layoutPad && zip.file(layoutPad) ? zip.file(layoutPad).async("string") : null
            ]).then(function (n) {
              var notities = "";
              if (n[0]) {
                var nx = xml(n[0]);
                alle(nx, "sp").forEach(function (sp) {
                  var ph = alle(sp, "ph")[0];
                  if (ph && ph.getAttribute("type") === "body") notities = alineas(sp).join("\n");
                });
              }
              var layout = n[1] ? (xml(n[1]).documentElement.getAttribute("type") || "") : "";
              return {
                volgorde: idx, id: id, verborgen: verborgen, titel: titel.replace(/\s+/g, " ").trim(),
                tekst: body.join("\n"), notities: notities, layout: layout, sectie: secties[id] || null
              };
            });
          });
        })).then(function (dias) {
          dias = dias.filter(Boolean);
          return { alle: dias, dias: dias.filter(function (d) { return !d.verborgen; }) };
        });
      });
    });
  }

  /* Het voorstel voor de indeling.
     - Heeft de PowerPoint secties, dan wordt elke sectie een hoofdstuk.
     - Anders begint een nieuw hoofdstuk bij elke sectiekopdia.
     - Binnen een hoofdstuk begint een nieuwe les bij een titeldia.
     Daarna past Wendy het zelf aan. */
  function maakPlan(pdf, ppt) {
    var n = pdf.paginas.length;
    var regels = [];
    var heeftSecties = ppt && ppt.dias.some(function (d) { return d.sectie; }) &&
      new Set(ppt.dias.map(function (d) { return d.sectie; })).size > 1;
    var heeftKoppen = ppt && ppt.dias.some(function (d) { return d.layout === "secHead"; });
    for (var i = 0; i < n; i++) {
      var p = pdf.paginas[i], d = ppt ? ppt.dias[i] : null;
      var titel = (d && d.titel) || p.titel || "";
      var soort = "door";
      var hTitel = "", lTitel = "";
      if (i === 0) soort = "hoofdstuk";
      else if (heeftSecties && d.sectie !== ppt.dias[i - 1].sectie) soort = "hoofdstuk";
      else if (!heeftSecties && heeftKoppen && d.layout === "secHead") soort = "hoofdstuk";
      else if (d && (d.layout === "title" || d.layout === "secHead")) soort = "les";
      if (soort === "hoofdstuk") {
        hTitel = (heeftSecties && d.sectie) ? d.sectie : titel;
        lTitel = titel;
      } else if (soort === "les") lTitel = titel;
      regels.push({ soort: soort, hTitel: hTitel, lTitel: lTitel, titel: titel, tekst: d ? d.tekst : p.tekst, notities: d ? d.notities : "" });
    }
    return regels;
  }

  function tekenIndeling(paneel, I) {
    var klant = P.modules.filter(function (m) { return m.status === "live" && m.organisatie_id; });
    function telH() { return I.plan.filter(function (r) { return r.soort === "hoofdstuk"; }).length; }

    function teken() {
      var hNr = 0, lNr = 0;
      var uit = '<button type="button" class="terug" id="pr-terug-ov">' + P.ctx.IC.terug + "Terug</button>" +
        '<div class="kop"><h1>Indeling van <em>' + esc(I.naam) + "</em></h1>" +
        "<p>" + I.plan.length + " dia's. Kies per dia of hij doorloopt, of dat er een nieuwe les of een nieuw hoofdstuk begint. " +
        "Het voorstel komt uit " + (I.ppt ? "de secties en titeldia's van je PowerPoint" : "de PDF") + ". Klopt het, dan sla je het op als concept.</p></div>";
      if (I.waarschuwing) uit += '<div class="let" style="margin-bottom:16px"><b>Let op.</b> ' + esc(I.waarschuwing) + "</div>";

      uit += '<div class="paneel"><div class="paneel-body pr-indeling">';
      I.plan.forEach(function (r, i) {
        if (r.soort === "hoofdstuk") { hNr++; lNr = 0; }
        if (r.soort === "hoofdstuk" || r.soort === "les") lNr++;
        uit += '<div class="pr-rij soort-' + r.soort + '" data-i="' + i + '">' +
          '<span class="pr-duim groot"><img src="' + I.pdf.paginas[i].duim + '" alt=""><span class="nr">' + (i + 1) + "</span></span>" +
          '<div class="pr-rij-in">' +
            '<div class="pr-keus" role="radiogroup" aria-label="Dia ' + (i + 1) + '">' +
              (i === 0 ? "" : '<button type="button" data-s="door" aria-pressed="' + (r.soort === "door") + '">Loopt door</button>') +
              '<button type="button" data-s="les" aria-pressed="' + (r.soort === "les") + '"' + (i === 0 ? " hidden" : "") + ">Nieuwe les</button>" +
              '<button type="button" data-s="hoofdstuk" aria-pressed="' + (r.soort === "hoofdstuk") + '">Nieuw hoofdstuk</button>' +
            "</div>" +
            (r.soort === "hoofdstuk" ? '<div class="veld"><label>Hoofdstuk ' + hNr + '</label><input class="kies" data-v="hTitel" value="' + esc(r.hTitel) + '" placeholder="Naam van het hoofdstuk"></div>' : "") +
            (r.soort === "hoofdstuk" || r.soort === "les" ? '<div class="veld"><label>Les ' + hNr + "." + lNr + '</label><input class="kies" data-v="lTitel" value="' + esc(r.lTitel) + '" placeholder="Naam van de les"></div>' : "") +
            (r.soort === "door" ? '<div class="klein">' + esc(r.titel || "Dia zonder titel") + "</div>" : "") +
          "</div></div>";
      });
      uit += "</div></div>";

      var h = telH();
      uit += '<div class="paneel"><div class="paneel-body" style="padding:16px 18px">' +
        (klant.length ? '<div class="veld" style="max-width:420px;margin-bottom:14px"><label for="pr-klant-na">Klanthoofdstukken (zoals ' + esc(klant[0].titel) + ") komen na</label>" +
          '<select class="kies" id="pr-klant-na">' +
          '<option value="0">vooraan, voor hoofdstuk 1</option>' +
          Array.apply(null, Array(h)).map(function (x, k) {
            return '<option value="' + (k + 1) + '"' + ((I.klantNa || 1) === k + 1 ? " selected" : "") + ">hoofdstuk " + (k + 1) + "</option>";
          }).join("") + "</select></div>" : "") +
        '<div class="btn-row"><button type="button" class="btn btn-a" id="pr-op">Opslaan als concept</button>' +
        '<span class="lead" id="pr-op-stand">' + h + (h === 1 ? " hoofdstuk" : " hoofdstukken") + ", " +
        I.plan.filter(function (r) { return r.soort !== "door"; }).length + " lessen</span></div>" +
        '<div class="pr-balk" hidden><span></span></div>' +
        "</div></div>";

      paneel.innerHTML = uit;
      paneel.querySelector("#pr-terug-ov").addEventListener("click", function () { beheer(paneel, P.ctx); });
      paneel.querySelectorAll(".pr-rij").forEach(function (rij) {
        var i = Number(rij.dataset.i);
        rij.querySelectorAll("[data-s]").forEach(function (b) {
          b.addEventListener("click", function () {
            leesVelden();
            var r = I.plan[i];
            r.soort = b.dataset.s;
            if (r.soort === "hoofdstuk" && !r.hTitel) r.hTitel = r.titel;
            if (r.soort !== "door" && !r.lTitel) r.lTitel = r.titel;
            teken();
            var nieuw = paneel.querySelector('.pr-rij[data-i="' + i + '"]');
            if (nieuw) nieuw.scrollIntoView({ block: "center" });
          });
        });
      });
      var kn = paneel.querySelector("#pr-klant-na");
      if (kn) kn.addEventListener("change", function () { I.klantNa = Number(kn.value); });
      paneel.querySelector("#pr-op").addEventListener("click", function () { leesVelden(); slaOp(paneel, I); });
    }
    function leesVelden() {
      paneel.querySelectorAll(".pr-rij").forEach(function (rij) {
        var r = I.plan[Number(rij.dataset.i)];
        rij.querySelectorAll("[data-v]").forEach(function (inp) { r[inp.dataset.v] = inp.value.trim(); });
      });
      var kn = paneel.querySelector("#pr-klant-na");
      if (kn) I.klantNa = Number(kn.value);
    }
    if (I.klantNa == null) I.klantNa = 1;
    teken();
  }

  /* Opslaan: elke dia in hoge kwaliteit als JPG naar de opslag, daarna
     in één keer de hele indeling naar de database. Gaat het halverwege
     mis, dan is er in de database nog niets veranderd. */
  function slaOp(paneel, I) {
    var knop = paneel.querySelector("#pr-op");
    var stand = paneel.querySelector("#pr-op-stand");
    var balk = paneel.querySelector(".pr-balk");
    knop.disabled = true;
    balk.hidden = false;
    var sb = P.ctx.sb;
    var map = "dias/" + Date.now().toString(36);
    var n = I.plan.length, klaar = 0;
    var urls = new Array(n);

    function render(i) {
      return I.pdf.doc.getPage(i + 1).then(function (page) {
        var vp = page.getViewport({ scale: 1 });
        var v2 = page.getViewport({ scale: 1920 / vp.width });
        var c = document.createElement("canvas");
        c.width = Math.round(v2.width); c.height = Math.round(v2.height);
        var cx = c.getContext("2d");
        cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: cx, viewport: v2 }).promise.then(function () {
          return new Promise(function (ok) { c.toBlob(ok, "image/jpeg", 0.88); });
        });
      }).then(function (blob) {
        var p = map + "/" + ("00" + (i + 1)).slice(-3) + ".jpg";
        return sb.storage.from(BUCKET).upload(p, blob, { contentType: "image/jpeg", upsert: true }).then(function (r) {
          if (r.error) throw r.error;
          urls[i] = sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
          klaar++;
          stand.textContent = "Dia " + klaar + " van " + n + " opgeslagen";
          balk.firstChild.style.width = (klaar * 100 / n) + "%";
        });
      });
    }
    // Drie tegelijk, dat gaat vlot zonder de browser te verstikken.
    var rij = I.plan.map(function (x, i) { return i; });
    function werker() {
      var i = rij.shift();
      if (i == null) return Promise.resolve();
      return render(i).then(werker);
    }
    Promise.all([werker(), werker(), werker()]).then(function () {
      var hoofdstukken = [], h = null, l = null;
      I.plan.forEach(function (r, i) {
        if (r.soort === "hoofdstuk" || !h) {
          h = { titel: r.hTitel || r.titel || "Hoofdstuk " + (hoofdstukken.length + 1), lessen: [] };
          hoofdstukken.push(h);
          l = null;
        }
        if (r.soort !== "door" || !l) {
          l = { titel: r.lTitel || r.titel || "Les " + (h.lessen.length + 1), dias: [] };
          h.lessen.push(l);
        }
        l.dias.push({ nr: i + 1, beeld: urls[i], titel: r.titel || "", tekst: r.tekst || "", notities: r.notities || "" });
      });
      stand.textContent = "Bezig met opslaan in de database";
      return sb.rpc("importeer_presentatie", {
        p_cursus: P.cursus.id,
        p_plan: { bestand: I.naam, klant_na: I.klantNa == null ? 1 : I.klantNa, hoofdstukken: hoofdstukken }
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      P.ctx.toast("Het concept staat klaar: " + r.data.hoofdstukken + " hoofdstukken, " + r.data.lessen + " lessen");
      return beheer(paneel, P.ctx);
    }).catch(function (e) {
      knop.disabled = false;
      stand.textContent = "";
      P.ctx.melding("Het opslaan lukte niet", "In de leeromgeving is nog niets veranderd. Probeer het zo nog een keer.", "mis", e);
    });
  }

  /* ---------------------------------------------------------------------
     Video's koppelen per dia
     --------------------------------------------------------------------- */
  function tekenLesDias(paneel, lesId) {
    var l = P.lessen.find(function (x) { return x.id === lesId; });
    if (!l) return;
    var dias = JSON.parse(JSON.stringify(l.dias || []));
    var gekozen = 0;
    var keyer = null;

    function teken() {
      var d = dias[gekozen];
      var v = d.video || null;
      var uit = '<button type="button" class="terug" id="pr-terug-ov">' + P.ctx.IC.terug + "Terug naar de presentatie</button>" +
        '<div class="kop"><h1>' + esc(l.titel) + "</h1><p>Kies een dia, zet er een greenscreen-video bij en stel in waar de presentator staat. " +
        "Wat je hier ziet is precies wat de cursist ziet.</p></div>";

      uit += '<div class="pr-strook">' + dias.map(function (x, i) {
        return '<button type="button" data-i="' + i + '"' + (i === gekozen ? ' aria-current="true"' : "") + ">" +
          '<img src="' + esc(x.beeld) + '" alt=""><span class="nr">' + (i + 1) + "</span>" +
          (x.video && x.video.url ? '<span class="heeft">' + P.ctx.IC.vink + "</span>" : "") + "</button>";
      }).join("") + "</div>";

      uit += '<div class="pr-werk">' +
        '<div class="pr-voorbeeld"><div class="dia-toneel">' +
          '<img class="dia-beeld" src="' + esc(d.beeld) + '" alt="">' +
          '<canvas class="dia-key"></canvas>' +
          '<video class="dia-video" playsinline loop muted crossorigin="anonymous"></video>' +
        "</div>" +
        (v ? '<div class="btn-row" style="margin-top:10px"><button type="button" class="btn btn-g btn-sm" id="pr-speel">Afspelen met geluid</button>' +
          '<span class="klein">Klik op het groen in het beeld om de kleur van het doek te kiezen.</span></div>' : "") +
        "</div>" +
        '<div class="pr-instel">' +
          '<div class="veld"><label>Dia ' + (gekozen + 1) + "</label><div class=\"klein\">" + esc(d.titel || "Zonder titel") + "</div></div>" +
          '<div class="veld"><label for="pr-stan">Stan zegt op deze dia (mag leeg)</label>' +
            '<textarea class="kies" id="pr-stan" rows="2" maxlength="160" placeholder="Bijvoorbeeld: Eerst kijken, dan pas helpen!" style="font:inherit;padding:9px 11px;border:1px solid var(--line-2);border-radius:4px;resize:vertical">' + esc((d.stan && d.stan.tekst) || "") + "</textarea>" +
            '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">' +
              '<select id="pr-stan-pose" aria-label="Houding van Stan" style="font:inherit;padding:7px;border:1px solid var(--line-2);border-radius:4px">' +
              [["tip", "Geeft een tip"], ["duim", "Duim omhoog"], ["zwaait", "Zwaait"], ["standaard", "Staat erbij"]].map(function (o) {
                return '<option value="' + o[0] + '"' + (((d.stan && d.stan.pose) || "tip") === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
              }).join("") + "</select>" +
              '<label style="display:flex;gap:7px;align-items:center;font-size:13px;font-weight:600"><input type="checkbox" id="pr-serieus"' + (d.serieus ? " checked" : "") + "> Serieuze dia, Stan zwijgt</label>" +
            "</div>" +
            '<span class="hint">Op een dia met video verschijnt Stan pas als de video klaar is.</span></div>' +
          '<div class="btn-row"><button type="button" class="btn btn-g btn-sm" id="pr-stan-op">Stan opslaan</button></div>' +
          (d.notities ? '<details class="pr-noti"><summary>Notities uit de PowerPoint</summary><p>' + esc(d.notities).replace(/\n/g, "<br>") + "</p></details>" : "") +
          '<div class="veld"><label for="pr-bestand">' + (v ? "Andere video kiezen" : "Greenscreen-video") + "</label>" +
          '<input class="kies" id="pr-bestand" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v">' +
          '<span class="hint">MP4 of MOV. Grote bestanden maken we eerst kleiner, dat duurt ongeveer zo lang als de video zelf. Houd dit venster dan open.</span></div>' +
          '<div class="pr-balk" hidden><span></span></div><div class="lead" id="pr-up-stand"></div>' +
          (v ? instelHtml(v) : "") +
          '<div class="btn-row" style="margin-top:6px">' +
            (v ? '<button type="button" class="btn btn-a" id="pr-bewaar">Opslaan</button>' +
                 '<button type="button" class="btn btn-g btn-sm" id="pr-alle">Deze plek voor alle dia\'s</button>' +
                 '<button type="button" class="btn btn-g btn-sm" id="pr-geen">Video weghalen</button>' : "") +
          "</div>" +
        "</div></div>";

      paneel.innerHTML = uit;
      paneel.querySelector("#pr-terug-ov").addEventListener("click", function () { if (keyer) keyer.stop(); beheer(paneel, P.ctx); });
      paneel.querySelectorAll(".pr-strook [data-i]").forEach(function (b) {
        b.addEventListener("click", function () { if (keyer) keyer.stop(); gekozen = Number(b.dataset.i); teken(); });
      });
      paneel.querySelector("#pr-stan-op").addEventListener("click", function () {
        var t = paneel.querySelector("#pr-stan").value.trim();
        if (t) d.stan = { tekst: t, pose: paneel.querySelector("#pr-stan-pose").value };
        else delete d.stan;
        if (paneel.querySelector("#pr-serieus").checked) d.serieus = true; else delete d.serieus;
        bewaar(t ? "Stan staat op deze dia" : "Opgeslagen", true);
      });
      paneel.querySelector("#pr-bestand").addEventListener("change", function (e) {
        var f = e.target.files[0];
        if (f) uploaden(f);
      });

      var cv = paneel.querySelector(".dia-key"), vid = paneel.querySelector(".dia-video");
      if (v) {
        keyer = new Keyer(cv, vid);
        keyer.zet(v);
        cv.style.visibility = "visible";
        plaats(cv, v);
        vid.src = v.url;
        vid.addEventListener("loadeddata", function () {
          if (!v.kleur) { v.kleur = keyer.proefKleur(); keyer.zet(v); }
          zetKleurVeld();
          keyer.start();
        });
        vid.play().catch(function () { /* stil voorbeeld, mag falen */ });
        cv.addEventListener("click", function (e) {
          var r = cv.getBoundingClientRect();
          var k = keyer.proefKleur((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
          if (k) { v.kleur = k; keyer.zet(v); zetKleurVeld(); }
        });
        paneel.querySelector("#pr-speel").addEventListener("click", function () {
          vid.muted = false; vid.loop = false; vid.currentTime = 0; vid.play(); keyer.start();
        });
        bindInstel(v, cv);
        paneel.querySelector("#pr-bewaar").addEventListener("click", function () { bewaar("Opgeslagen"); });
        paneel.querySelector("#pr-geen").addEventListener("click", function () {
          if (!confirm("De video weghalen bij deze dia?")) return;
          delete d.video; bewaar("De video is weggehaald", true);
        });
        paneel.querySelector("#pr-alle").addEventListener("click", function () {
          dias.forEach(function (x) {
            if (x.video && x !== d) ["x", "y", "schaal", "kant", "sim", "zacht", "spill"].forEach(function (k) { x.video[k] = v[k]; });
          });
          bewaar("De plek en instellingen gelden nu voor alle dia's met een video");
        });
      }

      function zetKleurVeld() {
        var k = paneel.querySelector("#pr-kleur");
        if (k && v.kleur) k.style.background = "rgb(" + v.kleur.join(",") + ")";
      }
    }

    function bewaar(gelukt, opnieuw) {
      var duur = dias.reduce(function (n, x) { return n + ((x.video && x.video.duur) || 0); }, 0);
      return P.ctx.sb.rpc("zet_dias", { p_les: l.id, p_dias: dias, p_duur: Math.round(duur) || null }).then(function (r) {
        if (r.error) throw r.error;
        l.dias = JSON.parse(JSON.stringify(dias));
        P.ctx.toast(gelukt);
        if (opnieuw) teken();
      }).catch(function (e) {
        P.ctx.melding("Opslaan lukte niet", "Probeer het zo nog een keer.", "mis", e);
      });
    }

    function uploaden(file) {
      var stand = paneel.querySelector("#pr-up-stand");
      var balk = paneel.querySelector(".pr-balk");
      balk.hidden = false;
      var zet = function (t, pct) { stand.textContent = t; balk.firstChild.style.width = (pct || 0) + "%"; };
      var d = dias[gekozen];

      leesDuur(file).then(function (duur) {
        if (file.size <= MAX_UPLOAD && /mp4|quicktime|webm/.test(file.type)) return { blob: file, duur: duur, type: file.type || "video/mp4" };
        if (!kanVerkleinen()) {
          throw new Error("te-groot");
        }
        zet("Bezig met kleiner maken. Houd dit venster open.", 0);
        return verklein(file, function (pct) { zet("Bezig met kleiner maken, " + Math.round(pct) + "%. Houd dit venster open.", pct); })
          .then(function (r) {
            if (r.blob.size > MAX_UPLOAD) throw new Error("te-groot");
            return { blob: r.blob, duur: duur, type: r.type };
          });
      }).then(function (r) {
        var ext = /webm/.test(r.type) ? "webm" : /quicktime/.test(r.type) ? "mov" : "mp4";
        var p = "videos/" + l.id + "/" + ("00" + (gekozen + 1)).slice(-3) + "-" + Date.now().toString(36) + "." + ext;
        zet("Bezig met uploaden", 0);
        return uploadMetVoortgang(p, r.blob, r.type, function (pct) { zet("Bezig met uploaden, " + Math.round(pct) + "%", pct); })
          .then(function () {
            var url = P.ctx.sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
            var oud = d.video || {};
            var basis = oud.url ? oud : vorigeInstelling();
            d.video = Object.assign(standaardVideo(), basis, { url: url, pad: p, duur: Math.round(r.duur || 0), kleur: null });
            return bewaar("De video staat bij dia " + (gekozen + 1), true);
          });
      }).catch(function (e) {
        balk.hidden = true;
        stand.textContent = "";
        if (e && e.message === "te-groot") {
          P.ctx.melding("Deze video is te groot",
            "Het bestand mag maximaal 50 MB zijn en kleiner maken lukte in deze browser niet. Exporteer de video op 720p, of stuur hem naar Claude om te laten verkleinen.");
        } else {
          P.ctx.melding("Het uploaden lukte niet", "Probeer het zo nog een keer.", "mis", e);
        }
      });
    }

    // Een nieuwe video krijgt de plek van de vorige dia met video. Dan
    // hoef je niet voor elke dia opnieuw te schuiven.
    function vorigeInstelling() {
      for (var i = gekozen - 1; i >= 0; i--) if (dias[i].video && dias[i].video.url) return dias[i].video;
      for (var k = gekozen + 1; k < dias.length; k++) if (dias[k].video && dias[k].video.url) return dias[k].video;
      return {};
    }

    function instelHtml(v) {
      function schuif(id, label, min, max, stap, waarde, hint) {
        return '<div class="veld pr-schuif"><label for="' + id + '">' + label + ' <span data-toon="' + id + '"></span></label>' +
          '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + stap + '" value="' + waarde + '">' +
          (hint ? '<span class="hint">' + hint + "</span>" : "") + "</div>";
      }
      return '<div class="veld"><label>Waar staat de presentator</label><div class="pr-keus" id="pr-kant">' +
        ["links", "midden", "rechts"].map(function (k) {
          return '<button type="button" data-k="' + k + '" aria-pressed="' + (v.kant === k) + '">' + k[0].toUpperCase() + k.slice(1) + "</button>";
        }).join("") + "</div></div>" +
        schuif("pr-x", "Links of rechts", -60, 60, 1, v.x) +
        schuif("pr-y", "Hoger of lager", -30, 40, 1, v.y) +
        schuif("pr-schaal", "Grootte", 40, 180, 1, v.schaal) +
        '<div class="veld"><label>Kleur van het doek</label><div class="pr-kleurrij"><span id="pr-kleur" class="pr-kleur"></span>' +
        '<button type="button" class="btn btn-g btn-sm" id="pr-kleur-auto">Opnieuw bepalen</button></div></div>' +
        schuif("pr-sim", "Hoeveel groen eruit", 0.1, 0.8, 0.01, v.sim, "Zie je nog groen rond de persoon, schuif naar rechts. Valt er van de persoon iets weg, naar links.") +
        schuif("pr-zacht", "Zachte rand", 0.01, 0.4, 0.01, v.zacht) +
        schuif("pr-spill", "Groene gloed weg", 0.01, 0.6, 0.01, v.spill, "Haalt de groene weerschijn van haar en schouders.");
    }

    function bindInstel(v, cv) {
      var p = paneel;
      function toon() {
        [["pr-x", "x", "%"], ["pr-y", "y", "%"], ["pr-schaal", "schaal", "%"]].forEach(function (a) {
          var t = p.querySelector('[data-toon="' + a[0] + '"]'); if (t) t.textContent = Math.round(v[a[1]]) + a[2];
        });
      }
      [["pr-x", "x"], ["pr-y", "y"], ["pr-schaal", "schaal"], ["pr-sim", "sim"], ["pr-zacht", "zacht"], ["pr-spill", "spill"]].forEach(function (a) {
        var inp = p.querySelector("#" + a[0]);
        inp.addEventListener("input", function () {
          v[a[1]] = Number(inp.value);
          if (a[1] === "x") { v.kant = null; p.querySelectorAll("#pr-kant [data-k]").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); }
          keyer.zet(v); plaats(cv, v); toon();
        });
      });
      p.querySelectorAll("#pr-kant [data-k]").forEach(function (b) {
        b.addEventListener("click", function () {
          v.kant = b.dataset.k; v.x = KANT_X[v.kant];
          p.querySelector("#pr-x").value = v.x;
          p.querySelectorAll("#pr-kant [data-k]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          plaats(cv, v); toon();
        });
      });
      p.querySelector("#pr-kleur-auto").addEventListener("click", function () {
        v.kleur = keyer.proefKleur(); keyer.zet(v);
        var k = p.querySelector("#pr-kleur"); if (k && v.kleur) k.style.background = "rgb(" + v.kleur.join(",") + ")";
      });
      toon();
    }

    teken();
  }

  function leesDuur(file) {
    return new Promise(function (ok) {
      var v = document.createElement("video");
      v.preload = "metadata"; v.muted = true;
      var url = URL.createObjectURL(file);
      v.onloadedmetadata = function () { var d = v.duration; URL.revokeObjectURL(url); ok(isFinite(d) ? d : 0); };
      v.onerror = function () { URL.revokeObjectURL(url); ok(0); };
      v.src = url;
    });
  }

  function uploadMetVoortgang(pad, blob, type, voortgang) {
    var sb = P.ctx.sb, cfg = window.CONFIG;
    return sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session ? s.data.session.access_token : null;
      if (!tok) throw new Error("Niet ingelogd");
      return new Promise(function (ok, mis) {
        var x = new XMLHttpRequest();
        x.open("POST", cfg.supabaseUrl + "/storage/v1/object/" + BUCKET + "/" + pad.split("/").map(encodeURIComponent).join("/"));
        x.setRequestHeader("Authorization", "Bearer " + tok);
        x.setRequestHeader("apikey", cfg.supabaseKey);
        x.setRequestHeader("x-upsert", "true");
        x.setRequestHeader("Content-Type", type);
        x.setRequestHeader("cache-control", "max-age=31536000");
        x.upload.onprogress = function (e) { if (e.lengthComputable) voortgang(e.loaded * 100 / e.total); };
        x.onload = function () {
          if (x.status >= 200 && x.status < 300) ok();
          else {
            var m = x.responseText;
            try { m = JSON.parse(m).message || m; } catch (e) { /* niets */ }
            mis(new Error(m || ("Status " + x.status)));
          }
        };
        x.onerror = function () { mis(new Error("Geen verbinding")); };
        x.send(blob);
      });
    });
  }

  /* ---------------------------------------------------------------------
     Kleiner maken
     Een telefoon filmt al snel 100 MB per minuut. Dat past niet in de
     opslag en het is zwaar voor een cursist op een mobiel netwerk. Dus
     spelen we de video eenmaal af in een onzichtbaar venster op 720p en
     nemen dat op als MP4. Het duurt net zo lang als de video, maar het
     resultaat is een kwart tot een tiende van het origineel.
     --------------------------------------------------------------------- */
  function opnameType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
    // Alleen H.264. Dat speelt op elke telefoon en in elke browser.
    var lijst = ["video/mp4;codecs=avc1.4d002a,mp4a.40.2", "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
                 "video/mp4;codecs=avc1,mp4a", "video/mp4;codecs=avc1"];
    for (var i = 0; i < lijst.length; i++) if (MediaRecorder.isTypeSupported(lijst[i])) return lijst[i];
    // Safari neemt in MP4 altijd op als H.264.
    var safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    if (safari && MediaRecorder.isTypeSupported("video/mp4")) return "video/mp4";
    return null;
  }
  function kanVerkleinen() {
    var c = document.createElement("canvas");
    return !!(opnameType() && c.captureStream);
  }
  function verklein(file, voortgang) {
    return new Promise(function (ok, mis) {
      var type = opnameType();
      var v = document.createElement("video");
      v.playsInline = true; v.preload = "auto";
      v.style.cssText = "position:fixed;left:-9999px;top:0;width:320px";
      document.body.appendChild(v);
      var url = URL.createObjectURL(file);
      v.src = url;
      v.onerror = function () { opruimen(); mis(new Error("Deze video kan de browser niet openen")); };
      var ctxA, rec, stukken = [], cv, cx, stop = false;
      function opruimen() {
        stop = true;
        try { v.pause(); } catch (e) { /* niets */ }
        v.remove(); URL.revokeObjectURL(url);
        if (ctxA) try { ctxA.close(); } catch (e) { /* niets */ }
      }
      v.onloadedmetadata = function () {
        var w = v.videoWidth, h = v.videoHeight;
        var sc = Math.min(1, 1280 / Math.max(w, h));
        cv = document.createElement("canvas");
        cv.width = Math.round(w * sc / 2) * 2; cv.height = Math.round(h * sc / 2) * 2;
        cx = cv.getContext("2d");
        var stroom = cv.captureStream(30);
        try {
          ctxA = new (window.AudioContext || window.webkitAudioContext)();
          var bron = ctxA.createMediaElementSource(v);
          var doel = ctxA.createMediaStreamDestination();
          bron.connect(doel);
          doel.stream.getAudioTracks().forEach(function (t) { stroom.addTrack(t); });
        } catch (e) { /* zonder geluid kan niet: dan maar het origineel */ }
        rec = new MediaRecorder(stroom, { mimeType: type, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
        rec.ondataavailable = function (e) { if (e.data && e.data.size) stukken.push(e.data); };
        rec.onstop = function () {
          var blob = new Blob(stukken, { type: type.split(";")[0] });
          opruimen();
          ok({ blob: blob, type: type.split(";")[0] });
        };
        function teken() {
          if (stop) return;
          cx.drawImage(v, 0, 0, cv.width, cv.height);
          if (v.duration) voortgang(v.currentTime * 100 / v.duration);
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(teken);
          else requestAnimationFrame(teken);
        }
        v.onended = function () { setTimeout(function () { if (rec.state !== "inactive") rec.stop(); }, 150); };
        v.play().then(function () {
          if (ctxA && ctxA.state === "suspended") ctxA.resume();
          rec.start(1000);
          teken();
        }).catch(function (e) { opruimen(); mis(e); });
      };
    });
  }

  window.BHVDias = { speler: speler, beheer: beheer, Keyer: Keyer, plaats: plaats };
})();
