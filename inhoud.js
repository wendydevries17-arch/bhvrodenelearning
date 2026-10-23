/* =====================================================================
   Beheer: de cursusinhoud zelf aanpassen

   Hoofdstukken en lessen toevoegen, hernoemen, verschuiven en weghalen.
   De tekst van een les bewerken met blokken (alinea, stappenplan,
   tegels, kerncijfers, wel en niet doen, tip van Stan). En de vragen:
   evaluatievragen per les, de kennistoets per hoofdstuk en de
   examenvragen.

   Wat live staat en wat concept is, blijft gescheiden. Een live
   hoofdstuk weghalen zet het in het archief, zodat de voortgang van
   cursisten niet verloren gaat. Een concept wordt echt verwijderd.

   De database controleert zelf of je beheerder bent. De juiste
   antwoorden komen via vragen_beheer(), want een cursist mag die
   kolom niet lezen.
   ===================================================================== */
(function () {
  "use strict";

  var C = { ctx: null, paneel: null, cursus: null, modules: [], lessen: [], vragen: [], versie: null };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function $(sel) { return C.paneel.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(C.paneel.querySelectorAll(sel)); }
  function fout(titel, e) { C.ctx.melding(titel, "Er is niets veranderd. Probeer het zo nog een keer.", "mis", e); }
  function chk(r) { if (r && r.error) throw r.error; return r; }

  /* ---------- ophalen ---------- */
  function haal() {
    var sb = C.ctx.sb;
    return sb.from("cursussen").select("id, titel").eq("actief", true).is("organisatie_id", null).limit(1).then(function (r) {
      chk(r);
      C.cursus = (r.data || [])[0];
      if (!C.cursus) throw new Error("Er staat geen basiscursus in de database.");
      return Promise.all([
        sb.from("modules").select("id, titel, volgorde, organisatie_id, status").eq("cursus_id", C.cursus.id).neq("status", "archief").order("volgorde"),
        sb.rpc("vragen_beheer", { p_cursus: C.cursus.id })
      ]);
    }).then(function (r) {
      chk(r[0]); chk(r[1]);
      C.modules = r[0].data || [];
      C.vragen = r[1].data || [];
      var ids = C.modules.map(function (m) { return m.id; });
      if (!ids.length) { C.lessen = []; return; }
      return sb.from("lessen").select("id, module_id, titel, volgorde, duur_seconden, tekst, dias, videos").in("module_id", ids).order("volgorde")
        .then(function (q) { chk(q); C.lessen = q.data || []; });
    }).then(function () {
      var heeftConcept = C.modules.some(function (m) { return m.status === "concept"; });
      if (!C.versie || (C.versie === "concept" && !heeftConcept)) C.versie = heeftConcept ? "concept" : "live";
    });
  }

  function modulesInVersie() {
    // In het concept staan ook de klanthoofdstukken erbij, want die
    // blijven na publiceren gewoon staan.
    return C.modules.filter(function (m) {
      if (m.organisatie_id) return true;
      return m.status === C.versie;
    });
  }
  function lessenVan(id) { return C.lessen.filter(function (l) { return l.module_id === id; }).sort(function (a, b) { return a.volgorde - b.volgorde; }); }
  function vragenVan(soort, sleutel, id) { return C.vragen.filter(function (v) { return v.soort === soort && v[sleutel] === id; }).sort(function (a, b) { return a.volgorde - b.volgorde; }); }

  /* =====================================================================
     OVERZICHT
     ===================================================================== */
  function beheer(paneel, ctx) {
    C.paneel = paneel; C.ctx = ctx;
    paneel.innerHTML = '<div class="laden"><span class="tol"></span>Bezig met ophalen</div>';
    return haal().then(tekenOverzicht).catch(function (e) {
      paneel.innerHTML = '<div class="let mis"><b>De inhoud kon niet worden opgehaald</b>' + esc(e && e.message ? e.message : e) + "</div>";
    });
  }

  function tekenOverzicht() {
    if (C.invoer) { C.paneel.removeEventListener("input", C.invoer); C.invoer = null; }
    var heeftConcept = C.modules.some(function (m) { return m.status === "concept"; });
    var mods = modulesInVersie();
    var uit = '<div class="kop"><h1>Cursus<em>inhoud</em></h1>' +
      "<p>Pas hier zelf de hoofdstukken, lessen en vragen aan. Wijzigingen in de versie die live staat zien cursisten meteen. " +
      "Wijzigingen in het concept pas na publiceren, op het tabblad Presentatie.</p></div>";

    uit += '<div class="ih-balk">' +
      (heeftConcept ? '<div class="pr-keus" role="group" aria-label="Welke versie">' +
        '<button type="button" data-versie="concept" aria-pressed="' + (C.versie === "concept") + '">Concept</button>' +
        '<button type="button" data-versie="live" aria-pressed="' + (C.versie === "live") + '">Nu live</button></div>' :
        '<span class="chip af">Je bewerkt de versie die live staat</span>') +
      '<div class="btn-row">' +
        '<button type="button" class="btn btn-g btn-sm" id="ih-examen">Examenvragen (' + C.vragen.filter(function (v) { return v.soort === "examen" && v.actief && examenHoortBij(v); }).length + ")</button>" +
        '<button type="button" class="btn btn-a btn-sm" id="ih-hoofdstuk">Hoofdstuk erbij</button>' +
      "</div></div>";

    uit += mods.map(function (m, i) {
      var ls = lessenVan(m.id);
      var tv = vragenVan("toets", "module_id", m.id).filter(function (v) { return v.actief; }).length;
      return '<div class="paneel ih-mod" data-mod="' + esc(m.id) + '">' +
        '<div class="paneel-kop"><div class="ih-titelrij">' +
          '<span class="ih-nr">' + (i + 1) + "</span>" +
          '<input class="ih-titel" value="' + esc(m.titel) + '" aria-label="Naam van het hoofdstuk" data-mod-titel>' +
          (m.organisatie_id ? '<span class="chip nieuw">klanthoofdstuk</span>' : "") +
        "</div>" +
        '<div class="btn-row">' +
          (m.organisatie_id ? "" :
            '<button type="button" class="btn btn-g btn-sm" data-mod-op aria-label="Hoofdstuk omhoog"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
            '<button type="button" class="btn btn-g btn-sm" data-mod-neer aria-label="Hoofdstuk omlaag"' + (i === mods.length - 1 ? " disabled" : "") + ">↓</button>") +
          '<button type="button" class="btn btn-g btn-sm" data-toets>Kennistoets (' + tv + ")</button>" +
          (m.organisatie_id ? "" : '<button type="button" class="btn btn-g btn-sm" data-mod-weg>Weghalen</button>') +
        "</div></div>" +
        '<div class="paneel-body">' +
        (ls.length ? ls.map(function (l, k) {
          var ev = vragenVan("evaluatie", "les_id", l.id).filter(function (v) { return v.actief; }).length;
          var blokken = Array.isArray(l.tekst) ? l.tekst.length : 0;
          return '<div class="regel ih-les" data-les="' + esc(l.id) + '">' +
            '<span class="tekst"><b>' + esc(l.titel) + "</b><span>" + blokken + (blokken === 1 ? " blok" : " blokken") + ", " + ev +
            (ev === 1 ? " evaluatievraag" : " evaluatievragen") + (l.dias && l.dias.length ? ", " + l.dias.length + " dia's" : "") + "</span></span>" +
            '<div class="btn-row">' +
              '<button type="button" class="btn btn-g btn-sm" data-les-op aria-label="Les omhoog"' + (k === 0 ? " disabled" : "") + ">↑</button>" +
              '<button type="button" class="btn btn-g btn-sm" data-les-neer aria-label="Les omlaag"' + (k === ls.length - 1 ? " disabled" : "") + ">↓</button>" +
              '<button type="button" class="btn btn-p btn-sm" data-les-bewerk>Bewerken</button>' +
              '<button type="button" class="btn btn-g btn-sm" data-les-weg>Weg</button>' +
            "</div></div>";
        }).join("") : '<div class="regel"><span class="tekst"><span>Nog geen lessen in dit hoofdstuk.</span></span></div>') +
        '<div class="btn-row" style="padding:12px 0"><button type="button" class="btn btn-g btn-sm" data-les-erbij>Les erbij</button></div>' +
        "</div></div>";
    }).join("") || '<div class="let">In deze versie staan nog geen hoofdstukken.</div>';

    C.paneel.innerHTML = uit;
    bindOverzicht(mods);
  }

  // Examenvragen die bij de getoonde versie horen: gekoppeld aan een
  // hoofdstuk in die versie, of de oude losse bank als er niets
  // gekoppeld is.
  function examenHoortBij(v) {
    var mods = modulesInVersie().map(function (m) { return m.id; });
    var gekoppeld = C.vragen.some(function (x) { return x.soort === "examen" && x.module_id && mods.indexOf(x.module_id) > -1; });
    return gekoppeld ? mods.indexOf(v.module_id) > -1 : !v.module_id;
  }

  function bindOverzicht(mods) {
    var sb = C.ctx.sb;
    $$("[data-versie]").forEach(function (b) {
      b.addEventListener("click", function () { C.versie = b.dataset.versie; tekenOverzicht(); });
    });
    $("#ih-examen").addEventListener("click", function () { tekenVragen("examen", null); });
    $("#ih-hoofdstuk").addEventListener("click", function () {
      var max = mods.reduce(function (n, m) { return Math.max(n, m.volgorde || 0); }, 0);
      sb.from("modules").insert({ cursus_id: C.cursus.id, titel: "Nieuw hoofdstuk", volgorde: max + 10, status: C.versie })
        .then(chk).then(function () { C.ctx.toast("Hoofdstuk toegevoegd"); return beheer(C.paneel, C.ctx); })
        .catch(function (e) { fout("Toevoegen lukte niet", e); });
    });

    $$(".ih-mod").forEach(function (el) {
      var id = el.dataset.mod;
      var m = C.modules.find(function (x) { return x.id === id; });
      var inp = el.querySelector("[data-mod-titel]");
      inp.addEventListener("change", function () {
        var t = inp.value.trim();
        if (!t) { inp.value = m.titel; return; }
        sb.from("modules").update({ titel: t }).eq("id", id).then(chk).then(function () { m.titel = t; C.ctx.toast("Naam bewaard"); })
          .catch(function (e) { fout("Bewaren lukte niet", e); });
      });
      var op = el.querySelector("[data-mod-op]"), neer = el.querySelector("[data-mod-neer]");
      if (op) op.addEventListener("click", function () { verschuif(mods, id, -1, "modules"); });
      if (neer) neer.addEventListener("click", function () { verschuif(mods, id, 1, "modules"); });
      el.querySelector("[data-toets]").addEventListener("click", function () { tekenVragen("toets", m); });
      var weg = el.querySelector("[data-mod-weg]");
      if (weg) weg.addEventListener("click", function () {
        var live = m.status === "live";
        var vraag = live
          ? "Hoofdstuk \"" + m.titel + "\" weghalen? Cursisten zien het dan niet meer. Het gaat naar het archief, dus de voortgang blijft bewaard."
          : "Hoofdstuk \"" + m.titel + "\" uit het concept verwijderen, met alle lessen en vragen erin?";
        if (!confirm(vraag)) return;
        var p = live
          ? sb.from("modules").update({ status: "archief", gearchiveerd_op: new Date().toISOString() }).eq("id", id)
          : sb.from("modules").delete().eq("id", id);
        p.then(chk).then(function () { C.ctx.toast("Hoofdstuk weggehaald"); if (live && C.ctx.herlaadCursus) C.ctx.herlaadCursus(); return beheer(C.paneel, C.ctx); })
          .catch(function (e) { fout("Weghalen lukte niet", e); });
      });
      el.querySelector("[data-les-erbij]").addEventListener("click", function () {
        var ls = lessenVan(id);
        sb.from("lessen").insert({ module_id: id, titel: "Nieuwe les", volgorde: ls.length + 1, tekst: [{ t: "p", v: "" }], markeringen: [], videos: [], dias: [] })
          .then(chk).then(function () { return haal(); }).then(function () {
            var nieuw = lessenVan(id).pop();
            if (nieuw) tekenLes(nieuw.id); else tekenOverzicht();
          }).catch(function (e) { fout("Toevoegen lukte niet", e); });
      });
      el.querySelectorAll(".ih-les").forEach(function (rij) {
        var lid = rij.dataset.les;
        rij.querySelector("[data-les-bewerk]").addEventListener("click", function () { tekenLes(lid); });
        rij.querySelector("[data-les-op]").addEventListener("click", function () { verschuif(lessenVan(id), lid, -1, "lessen"); });
        rij.querySelector("[data-les-neer]").addEventListener("click", function () { verschuif(lessenVan(id), lid, 1, "lessen"); });
        rij.querySelector("[data-les-weg]").addEventListener("click", function () {
          var l = C.lessen.find(function (x) { return x.id === lid; });
          if (!confirm("Les \"" + l.titel + "\" verwijderen, met de evaluatievragen erbij?" + (m.status === "live" ? " Cursisten die de les al deden, verliezen die voortgang." : ""))) return;
          sb.from("lessen").delete().eq("id", lid).then(chk).then(function () {
            C.ctx.toast("Les verwijderd");
            return herNummer(lessenVan(id).filter(function (x) { return x.id !== lid; }), "lessen");
          }).then(function () { return beheer(C.paneel, C.ctx); }).catch(function (e) { fout("Verwijderen lukte niet", e); });
        });
      });
    });
  }

  function herNummer(rij, tabel) {
    var stap = tabel === "modules" ? 10 : 1;
    return Promise.all(rij.map(function (x, i) {
      var nr = (i + 1) * stap;
      if (x.volgorde === nr) return null;
      x.volgorde = nr;
      return C.ctx.sb.from(tabel).update({ volgorde: nr }).eq("id", x.id).then(chk);
    }));
  }

  function verschuif(rij, id, richting, tabel) {
    var lijst = rij.filter(function (x) { return !x.organisatie_id; }).slice();
    var i = lijst.findIndex(function (x) { return x.id === id; });
    var j = i + richting;
    if (i < 0 || j < 0 || j >= lijst.length) return;
    var t = lijst[i]; lijst[i] = lijst[j]; lijst[j] = t;
    // Klanthoofdstukken houden hun eigen plek tussen de basishoofdstukken.
    herNummer(lijst, tabel).then(function () {
      if (tabel === "modules" && C.ctx.herlaadCursus) C.ctx.herlaadCursus();
      return beheer(C.paneel, C.ctx);
    }).catch(function (e) { fout("Verschuiven lukte niet", e); });
  }

  /* =====================================================================
     LES BEWERKEN
     ===================================================================== */
  var SOORTEN = function () { return (window.BHVBlokken && window.BHVBlokken.soorten) || [["p", "Alinea"]]; };
  var ICONEN = function () { return (window.BHVBlokken && window.BHVBlokken.iconen) || ["plus"]; };
  var POSES = [["tip", "Geeft een tip"], ["duim", "Duim omhoog"], ["zwaait", "Zwaait"], ["standaard", "Staat erbij"]];

  function leeg(t) {
    if (t === "ul") return { t: t, v: [""] };
    if (t === "stappen") return { t: t, titel: "", v: [{ k: "", v: "" }] };
    if (t === "kaarten") return { t: t, v: [{ i: "plus", k: "", v: "" }] };
    if (t === "cijfers") return { t: t, v: [{ n: "", v: "" }] };
    if (t === "goedfout") return { t: t, goed: [""], fout: [""] };
    if (t === "stan") return { t: t, v: "", pose: "tip" };
    return { t: t, v: "" };
  }

  function tekenLes(lesId) {
    var l = C.lessen.find(function (x) { return x.id === lesId; });
    if (!l) return tekenOverzicht();
    var m = C.modules.find(function (x) { return x.id === l.module_id; });
    var blokken = JSON.parse(JSON.stringify(Array.isArray(l.tekst) ? l.tekst : []));
    var vragen = JSON.parse(JSON.stringify(vragenVan("evaluatie", "les_id", l.id)));
    var weg = [];
    var gewijzigd = false;

    function opties(lijst, waarde) {
      return lijst.map(function (o) {
        var k = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(k) + '"' + (k === waarde ? " selected" : "") + ">" + esc(t) + "</option>";
      }).join("");
    }
    function naam(t) { var s = SOORTEN().find(function (x) { return x[0] === t; }); return s ? s[1] : t; }

    function blokHtml(b, i) {
      var kop = '<div class="ih-blok-kop"><b>' + esc(naam(b.t)) + "</b><div class=\"btn-row\">" +
        '<button type="button" class="btn btn-g btn-sm" data-b-op="' + i + '" aria-label="Blok omhoog"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button type="button" class="btn btn-g btn-sm" data-b-neer="' + i + '" aria-label="Blok omlaag"' + (i === blokken.length - 1 ? " disabled" : "") + ">↓</button>" +
        '<button type="button" class="btn btn-g btn-sm" data-b-weg="' + i + '">Weg</button></div></div>';
      var body = "";
      if (b.t === "p" || b.t === "call") body = '<textarea data-veld="v" rows="4">' + esc(b.v) + "</textarea>";
      else if (b.t === "h") body = '<input data-veld="v" value="' + esc(b.v) + '">';
      else if (b.t === "stan") body = '<textarea data-veld="v" rows="2">' + esc(b.v) + '</textarea><select data-veld="pose">' + opties(POSES, b.pose || "tip") + "</select>";
      else if (b.t === "ul") body = '<label class="ih-hint">Eén punt per regel</label><textarea data-veld="ul" rows="4">' + esc((b.v || []).join("\n")) + "</textarea>";
      else if (b.t === "goedfout") body = '<div class="ih-twee"><div><label class="ih-hint">Wel doen, één per regel</label><textarea data-veld="goed" rows="4">' + esc((b.goed || []).join("\n")) +
        '</textarea></div><div><label class="ih-hint">Niet doen, één per regel</label><textarea data-veld="fout" rows="4">' + esc((b.fout || []).join("\n")) + "</textarea></div></div>";
      else if (b.t === "stappen" || b.t === "kaarten" || b.t === "cijfers") {
        var velden = b.t === "cijfers" ? ["n", "v"] : ["k", "v"];
        body = (b.t === "stappen" ? '<input data-veld="titel" placeholder="Titel boven het stappenplan (mag leeg)" value="' + esc(b.titel || "") + '">' : "") +
          (b.v || []).map(function (r, k) {
            return '<div class="ih-rij" data-r="' + k + '">' +
              (b.t === "kaarten" ? '<select data-r-veld="i" aria-label="Icoon">' + opties(ICONEN(), r.i || "plus") + "</select>" : "") +
              (b.t === "stappen" ? '<span class="lb-nr">' + (k + 1) + "</span>" : "") +
              '<input data-r-veld="' + velden[0] + '" placeholder="' + (b.t === "cijfers" ? "Cijfer, bijvoorbeeld 112" : "Kop") + '" value="' + esc(r[velden[0]]) + '">' +
              '<textarea data-r-veld="v" rows="2" placeholder="Uitleg">' + esc(r.v) + "</textarea>" +
              '<button type="button" class="btn btn-g btn-sm" data-r-weg="' + k + '" aria-label="Regel weghalen">×</button></div>';
          }).join("") +
          '<button type="button" class="btn btn-g btn-sm" data-r-erbij>Regel erbij</button>';
      }
      return '<div class="ih-blok" data-b="' + i + '">' + kop + '<div class="ih-blok-body">' + body + "</div></div>";
    }

    function vraagHtml(v, i) {
      var opts = Array.isArray(v.opties) ? v.opties : [];
      return '<div class="ih-vraag" data-q="' + i + '">' +
        '<div class="ih-blok-kop"><b>Vraag ' + (i + 1) + "</b>" +
        '<button type="button" class="btn btn-g btn-sm" data-q-weg="' + i + '">Weg</button></div>' +
        '<input data-q-veld="vraag" placeholder="De vraag" value="' + esc(v.vraag) + '">' +
        '<div class="ih-opties">' + opts.map(function (o, k) {
          return '<label class="ih-optie"><input type="radio" name="juist-' + i + '" value="' + k + '"' + (v.juist_index === k ? " checked" : "") + ' aria-label="Dit is het goede antwoord">' +
            '<input data-q-optie="' + k + '" value="' + esc(o) + '" placeholder="Antwoord ' + "ABCDEF"[k] + '">' +
            (opts.length > 2 ? '<button type="button" class="btn btn-g btn-sm" data-q-optie-weg="' + k + '" aria-label="Antwoord weghalen">×</button>' : "") + "</label>";
        }).join("") +
        (opts.length < 5 ? '<button type="button" class="btn btn-g btn-sm" data-q-optie-erbij>Antwoord erbij</button>' : "") + "</div>" +
        '<span class="ih-hint">Kies met het rondje het goede antwoord.</span>' +
        '<textarea data-q-veld="uitleg" rows="2" placeholder="Uitleg die de cursist na het antwoorden ziet">' + esc(v.uitleg) + "</textarea></div>";
    }

    function teken() {
      var uit = '<button type="button" class="terug" id="ih-terug">' + C.ctx.IC.terug + "Terug naar de cursusinhoud</button>" +
        '<div class="kop"><h1>Les <em>bewerken</em></h1><p>' + esc(m ? m.titel : "") + (m && m.status === "live" ? " · staat live, cursisten zien wijzigingen direct na opslaan" : " · concept") + "</p></div>";
      uit += '<div class="ih-werk"><div class="ih-links">' +
        '<div class="paneel"><div class="paneel-body" style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">' +
          '<div class="veld"><label for="ih-ltitel">Titel van de les</label><input class="kies" id="ih-ltitel" value="' + esc(l.titel) + '"></div>' +
          '<div class="veld" style="max-width:220px"><label for="ih-duur">Duur in minuten</label><input class="kies" id="ih-duur" type="number" min="1" max="120" value="' + (l.duur_seconden ? Math.max(1, Math.round(l.duur_seconden / 60)) : "") + '"></div>' +
        "</div></div>" +
        '<div class="paneel"><div class="paneel-kop"><h2>Lesinhoud</h2></div><div class="paneel-body ih-blokken">' + blokken.map(blokHtml).join("") +
          '<div class="btn-row ih-erbij"><select id="ih-nieuw" aria-label="Soort blok">' + opties(SOORTEN(), "p") + '</select><button type="button" class="btn btn-g btn-sm" id="ih-blok-erbij">Blok erbij</button></div>' +
        "</div></div>" +
        '<div class="paneel"><div class="paneel-kop"><h2>Evaluatievragen</h2><button type="button" class="btn btn-g btn-sm" id="ih-vraag-erbij">Vraag erbij</button></div>' +
          '<div class="paneel-body ih-blokken">' + (vragen.length ? vragen.map(vraagHtml).join("") : '<div class="regel"><span class="tekst"><span>Deze les heeft nog geen evaluatievragen.</span></span></div>') + "</div></div>" +
        '<div class="ih-opslaan"><button type="button" class="btn btn-a" id="ih-op">Opslaan</button><span class="lead" id="ih-stand"></span></div>' +
        "</div>" +
        '<div class="ih-rechts"><div class="ih-voorbeeld-kop">Zo ziet de cursist het</div><div class="leskop"><h2 id="ih-vb-titel">' + esc(l.titel) + '</h2></div><div class="proza" id="ih-vb"></div></div>' +
        "</div>";
      C.paneel.innerHTML = uit;
      bind();
      voorbeeld();
    }

    function lees() {
      $$(".ih-blok").forEach(function (el) {
        var b = blokken[Number(el.dataset.b)];
        el.querySelectorAll("[data-veld]").forEach(function (f) {
          var k = f.dataset.veld;
          if (k === "ul") b.v = f.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
          else if (k === "goed" || k === "fout") b[k] = f.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
          else b[k] = f.value;
        });
        el.querySelectorAll(".ih-rij").forEach(function (r) {
          var rij = b.v[Number(r.dataset.r)];
          r.querySelectorAll("[data-r-veld]").forEach(function (f) { rij[f.dataset.rVeld] = f.value; });
        });
      });
      $$(".ih-vraag").forEach(function (el) {
        var v = vragen[Number(el.dataset.q)];
        v.vraag = el.querySelector('[data-q-veld="vraag"]').value;
        v.uitleg = el.querySelector('[data-q-veld="uitleg"]').value;
        v.opties = Array.prototype.map.call(el.querySelectorAll("[data-q-optie]"), function (f) { return f.value; });
        var r = el.querySelector('input[type="radio"]:checked');
        v.juist_index = r ? Number(r.value) : null;
      });
      l.titel = $("#ih-ltitel").value;
    }

    function voorbeeld() {
      lees();
      var vb = $("#ih-vb");
      if (vb && window.BHVBlokken) vb.innerHTML = window.BHVBlokken.html(blokken);
      var t = $("#ih-vb-titel"); if (t) t.textContent = $("#ih-ltitel").value;
    }

    function opnieuw(fn) { lees(); fn(); gewijzigd = true; teken(); }

    function bind() {
      $("#ih-terug").addEventListener("click", function () {
        if (gewijzigd && !confirm("Je wijzigingen zijn nog niet opgeslagen. Toch terug?")) return;
        tekenOverzicht();
      });
      // Eén luisteraar per paneel, ook als de les opnieuw getekend wordt.
      if (C.invoer) C.paneel.removeEventListener("input", C.invoer);
      C.invoer = function () { gewijzigd = true; clearTimeout(bind.t); bind.t = setTimeout(voorbeeld, 250); };
      C.paneel.addEventListener("input", C.invoer);
      $("#ih-blok-erbij").addEventListener("click", function () { var t = $("#ih-nieuw").value; opnieuw(function () { blokken.push(leeg(t)); }); });
      $$("[data-b-op]").forEach(function (b) { b.addEventListener("click", function () { var i = Number(b.dataset.bOp); opnieuw(function () { var x = blokken[i]; blokken[i] = blokken[i - 1]; blokken[i - 1] = x; }); }); });
      $$("[data-b-neer]").forEach(function (b) { b.addEventListener("click", function () { var i = Number(b.dataset.bNeer); opnieuw(function () { var x = blokken[i]; blokken[i] = blokken[i + 1]; blokken[i + 1] = x; }); }); });
      $$("[data-b-weg]").forEach(function (b) { b.addEventListener("click", function () { var i = Number(b.dataset.bWeg); if (confirm("Dit blok weghalen?")) opnieuw(function () { blokken.splice(i, 1); }); }); });
      $$(".ih-blok").forEach(function (el) {
        var b = blokken[Number(el.dataset.b)];
        var erbij = el.querySelector("[data-r-erbij]");
        if (erbij) erbij.addEventListener("click", function () { opnieuw(function () { b.v.push(b.t === "cijfers" ? { n: "", v: "" } : b.t === "kaarten" ? { i: "plus", k: "", v: "" } : { k: "", v: "" }); }); });
        el.querySelectorAll("[data-r-weg]").forEach(function (x) {
          x.addEventListener("click", function () { opnieuw(function () { b.v.splice(Number(x.dataset.rWeg), 1); }); });
        });
      });
      $("#ih-vraag-erbij").addEventListener("click", function () {
        opnieuw(function () { vragen.push({ vraag: "", opties: ["", "", ""], juist_index: 0, uitleg: "", soort: "evaluatie", actief: true }); });
      });
      $$(".ih-vraag").forEach(function (el) {
        var i = Number(el.dataset.q);
        el.querySelector("[data-q-weg]").addEventListener("click", function () {
          if (!confirm("Deze vraag weghalen?")) return;
          opnieuw(function () { var v = vragen.splice(i, 1)[0]; if (v.id) weg.push(v.id); });
        });
        var oe = el.querySelector("[data-q-optie-erbij]");
        if (oe) oe.addEventListener("click", function () { opnieuw(function () { vragen[i].opties.push(""); }); });
        el.querySelectorAll("[data-q-optie-weg]").forEach(function (x) {
          x.addEventListener("click", function () {
            opnieuw(function () {
              var k = Number(x.dataset.qOptieWeg), v = vragen[i];
              v.opties.splice(k, 1);
              if (v.juist_index === k) v.juist_index = 0;
              else if (v.juist_index > k) v.juist_index--;
            });
          });
        });
      });
      $("#ih-op").addEventListener("click", bewaar);
    }

    function bewaar() {
      lees();
      var titel = l.titel.trim();
      if (!titel) { C.ctx.melding("De les heeft een titel nodig", "Vul bovenaan een titel in."); return; }
      var schoon = blokken.filter(function (b) {
        if (b.t === "ul") return b.v.length;
        if (b.t === "goedfout") return b.goed.length || b.fout.length;
        if (Array.isArray(b.v)) { b.v = b.v.filter(function (r) { return (r.k || r.n || r.v || "").trim(); }); return b.v.length; }
        return String(b.v || "").trim();
      });
      for (var i = 0; i < vragen.length; i++) {
        var v = vragen[i];
        v.opties = v.opties.map(function (o) { return o.trim(); });
        if (!v.vraag.trim() || v.opties.filter(Boolean).length < 2 || v.juist_index == null || !v.opties[v.juist_index]) {
          C.ctx.melding("Vraag " + (i + 1) + " is nog niet compleet", "Een vraag heeft tekst nodig, minstens twee antwoorden en een aangevinkt goed antwoord.");
          return;
        }
      }
      var knop = $("#ih-op"), stand = $("#ih-stand");
      knop.disabled = true; stand.textContent = "Bezig met opslaan";
      var sb = C.ctx.sb;
      var duur = Number($("#ih-duur").value);
      var upd = { titel: titel, tekst: schoon };
      if (duur > 0) upd.duur_seconden = Math.round(duur * 60);
      var taken = [sb.from("lessen").update(upd).eq("id", l.id).then(chk)];
      weg.forEach(function (id) { taken.push(sb.from("vragen").delete().eq("id", id).then(chk)); });
      vragen.forEach(function (v, k) {
        var rij = { vraag: v.vraag.trim(), opties: v.opties, juist_index: v.juist_index, uitleg: (v.uitleg || "").trim(), volgorde: k + 1, actief: true };
        if (v.id) taken.push(sb.from("vragen").update(rij).eq("id", v.id).then(chk));
        else taken.push(sb.from("vragen").insert(Object.assign(rij, { cursus_id: C.cursus.id, soort: "evaluatie", les_id: l.id })).then(chk));
      });
      Promise.all(taken).then(function () {
        gewijzigd = false;
        C.ctx.toast("De les is opgeslagen");
        if (C.ctx.herlaadCursus) C.ctx.herlaadCursus();
        return haal();
      }).then(function () { tekenLes(l.id); }).catch(function (e) {
        knop.disabled = false; stand.textContent = "";
        fout("Opslaan lukte niet", e);
      });
    }

    teken();
  }

  /* =====================================================================
     KENNISTOETS EN EXAMENVRAGEN
     ===================================================================== */
  function tekenVragen(soort, m) {
    var mods = modulesInVersie().filter(function (x) { return !x.organisatie_id; });
    var lijst = soort === "toets"
      ? vragenVan("toets", "module_id", m.id)
      : C.vragen.filter(function (v) { return v.soort === "examen" && examenHoortBij(v); }).sort(function (a, b) { return a.volgorde - b.volgorde; });
    lijst = JSON.parse(JSON.stringify(lijst));
    var weg = [];
    // Hangt de examenbank van deze versie nog niet aan hoofdstukken (de
    // oude losse bank), dan houden nieuwe vragen ook geen hoofdstuk.
    // Anders telt het examen ineens alleen nog die ene nieuwe vraag.
    var ids = modulesInVersie().map(function (x) { return x.id; });
    var gekoppeld = soort === "examen" && C.vragen.some(function (x) { return x.soort === "examen" && x.module_id && ids.indexOf(x.module_id) > -1; });
    var titel = soort === "toets" ? "Kennistoets: " + m.titel : "Examenvragen";

    function teken() {
      var uit = '<button type="button" class="terug" id="ih-terug">' + C.ctx.IC.terug + "Terug naar de cursusinhoud</button>" +
        '<div class="kop"><h1>' + esc(titel) + "</h1><p>" +
        (soort === "toets"
          ? "Bij de kennistoets krijgt de cursist alle actieve vragen van dit hoofdstuk. Hij heeft 70 procent nodig."
          : "Uit deze vragen wordt bij elk examen willekeurig getrokken. Zorg dat er ruim meer zijn dan het aantal examenvragen, dan is elk examen anders.") +
        "</p></div>" +
        '<div class="paneel"><div class="paneel-kop"><h2>' + lijst.length + (lijst.length === 1 ? " vraag" : " vragen") + "</h2>" +
        '<button type="button" class="btn btn-g btn-sm" id="ih-vraag-erbij">Vraag erbij</button></div><div class="paneel-body ih-blokken">' +
        lijst.map(function (v, i) {
          var opts = v.opties || [];
          return '<div class="ih-vraag' + (v.actief ? "" : " uitgezet") + '" data-q="' + i + '">' +
            '<div class="ih-blok-kop"><b>Vraag ' + (i + 1) + "</b><div class=\"btn-row\">" +
            (soort === "examen" && gekoppeld ? '<select data-q-mod aria-label="Hoort bij hoofdstuk">' + mods.map(function (x) {
              return '<option value="' + esc(x.id) + '"' + (x.id === v.module_id ? " selected" : "") + ">" + esc(x.titel) + "</option>";
            }).join("") + "</select>" : "") +
            '<label class="ih-hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-q-aan' + (v.actief ? " checked" : "") + "> Actief</label>" +
            '<button type="button" class="btn btn-g btn-sm" data-q-weg>Weg</button></div></div>' +
            '<input data-q-veld="vraag" placeholder="De vraag" value="' + esc(v.vraag) + '">' +
            '<div class="ih-opties">' + opts.map(function (o, k) {
              return '<label class="ih-optie"><input type="radio" name="juist-' + i + '" value="' + k + '"' + (v.juist_index === k ? " checked" : "") + ' aria-label="Dit is het goede antwoord">' +
                '<input data-q-optie="' + k + '" value="' + esc(o) + '" placeholder="Antwoord ' + "ABCDEF"[k] + '"></label>';
            }).join("") + "</div>" +
            '<textarea data-q-veld="uitleg" rows="2" placeholder="Uitleg bij het nakijken">' + esc(v.uitleg) + "</textarea></div>";
        }).join("") + "</div></div>" +
        '<div class="ih-opslaan"><button type="button" class="btn btn-a" id="ih-op">Opslaan</button><span class="lead" id="ih-stand"></span></div>';
      C.paneel.innerHTML = uit;

      $("#ih-terug").addEventListener("click", function () { tekenOverzicht(); });
      $("#ih-vraag-erbij").addEventListener("click", function () {
        lees();
        lijst.push({ vraag: "", opties: ["", "", ""], juist_index: 0, uitleg: "", actief: true, module_id: m ? m.id : (gekoppeld && mods[0] ? mods[0].id : null) });
        teken();
      });
      $$(".ih-vraag").forEach(function (el) {
        el.querySelector("[data-q-weg]").addEventListener("click", function () {
          if (!confirm("Deze vraag weghalen?")) return;
          lees(); var v = lijst.splice(Number(el.dataset.q), 1)[0]; if (v.id) weg.push(v.id); teken();
        });
      });
      $("#ih-op").addEventListener("click", bewaar);
    }

    function lees() {
      $$(".ih-vraag").forEach(function (el) {
        var v = lijst[Number(el.dataset.q)];
        v.vraag = el.querySelector('[data-q-veld="vraag"]').value;
        v.uitleg = el.querySelector('[data-q-veld="uitleg"]').value;
        v.opties = Array.prototype.map.call(el.querySelectorAll("[data-q-optie]"), function (f) { return f.value; });
        var r = el.querySelector('input[type="radio"]:checked');
        v.juist_index = r ? Number(r.value) : null;
        v.actief = el.querySelector("[data-q-aan]").checked;
        var mk = el.querySelector("[data-q-mod]");
        if (mk) v.module_id = mk.value;
      });
    }

    function bewaar() {
      lees();
      for (var i = 0; i < lijst.length; i++) {
        var v = lijst[i];
        v.opties = v.opties.map(function (o) { return o.trim(); });
        if (!v.vraag.trim() || v.opties.filter(Boolean).length < 2 || v.juist_index == null || !v.opties[v.juist_index]) {
          C.ctx.melding("Vraag " + (i + 1) + " is nog niet compleet", "Een vraag heeft tekst nodig, minstens twee antwoorden en een aangevinkt goed antwoord.");
          return;
        }
      }
      var sb = C.ctx.sb;
      $("#ih-op").disabled = true; $("#ih-stand").textContent = "Bezig met opslaan";
      var taken = weg.map(function (id) { return sb.from("vragen").delete().eq("id", id).then(chk); });
      lijst.forEach(function (v, k) {
        var rij = { vraag: v.vraag.trim(), opties: v.opties, juist_index: v.juist_index, uitleg: (v.uitleg || "").trim(), volgorde: k + 1, actief: !!v.actief, module_id: soort === "toets" ? m.id : (v.module_id || null) };
        if (v.id) taken.push(sb.from("vragen").update(rij).eq("id", v.id).then(chk));
        else taken.push(sb.from("vragen").insert(Object.assign(rij, { cursus_id: C.cursus.id, soort: soort })).then(chk));
      });
      Promise.all(taken).then(function () {
        C.ctx.toast("De vragen zijn opgeslagen");
        if (C.ctx.herlaadCursus) C.ctx.herlaadCursus();
        return haal();
      }).then(function () { tekenVragen(soort, m ? C.modules.find(function (x) { return x.id === m.id; }) : null); })
        .catch(function (e) { $("#ih-op").disabled = false; $("#ih-stand").textContent = ""; fout("Opslaan lukte niet", e); });
    }

    teken();
  }

  window.BHVInhoud = { beheer: beheer };
})();
