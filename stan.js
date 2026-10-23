/* =====================================================================
   BHV-Stan, de rechterhand van Dirk Jan

   Stan verschijnt rechtsonder met een korte tekstballon, op vaste
   momenten: bij de start, aan het begin van een module, bij een toets,
   na een goed of fout antwoord en bij het afronden. Zijn teksten staan
   in de database (tabel stan_uitspraken) en zijn in het beheer aan te
   passen.

   Spelregels:
   - Nooit tijdens een video van Dirk Jan en nooit op een dia die als
     serieus is gemarkeerd. Dan zwijgt hij.
   - Niet te vaak: na een uitspraak minstens een halve minuut rust,
     behalve als het een reactie op een antwoord is.
   - Geen herhaling: per cursist onthouden we welke teksten al geweest
     zijn, en kiezen we eerst uit wat nog niet getoond is.
   - De afbeeldingen laden pas als Stan voor het eerst in beeld komt.

   app.js praat met Stan via window.BHVStan.
   ===================================================================== */
(function () {
  "use strict";

  var POSES = { standaard: 1, zwaait: 1, tip: 1, duim: 1 };
  var RUST_MS = 30000;
  var SLEUTEL = "bhv-stan-gezien";
  var UIT_SLEUTEL = "bhv-stan-uit";

  var st = {
    lijst: [], geladen: false, sb: null,
    stil: 0, laatst: 0, reactie: 0, timer: null, el: null, uit: false, wacht: null
  };
  try { st.uit = localStorage.getItem(UIT_SLEUTEL) === "ja"; } catch (e) { /* niets */ }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function beeld(pose) { return "img/stan/" + (POSES[pose] ? pose : "standaard") + ".webp"; }

  function gezien() {
    try { return JSON.parse(localStorage.getItem(SLEUTEL) || "[]"); } catch (e) { return []; }
  }
  function onthoud(id) {
    if (!id) return;
    var g = gezien().filter(function (x) { return x !== id; });
    g.push(id);
    try { localStorage.setItem(SLEUTEL, JSON.stringify(g.slice(-80))); } catch (e) { /* niets */ }
  }

  /* Het onderwerp van een module of les, uit de titel. Zo hoeft
     niemand dat apart in te stellen. Reanimatie gaat voor EHBO, omdat
     reanimatie in het EHBO-hoofdstuk zit maar zijn eigen toon heeft. */
  function onderwerp(tekst) {
    var t = String(tekst || "").toLowerCase();
    if (/reanim|aed|hartstilstand/.test(t)) return "reanimatie";
    if (/brand|blus|vuur/.test(t)) return "brand";
    if (/ontruim|evacu|verzamel/.test(t)) return "ontruiming";
    if (/ehbo|eerste hulp|letsel|bloed|verslik|wond/.test(t)) return "ehbo";
    return null;
  }

  function laad(sb) {
    st.sb = sb;
    return sb.from("stan_uitspraken").select("id, moment, onderwerp, tekst, pose").eq("actief", true)
      .then(function (r) {
        // Bestaat de tabel nog niet, dan is Stan er gewoon niet. De rest
        // van de leeromgeving merkt daar niets van.
        st.lijst = (r && !r.error && r.data) || [];
        st.geladen = true;
      })
      .catch(function () { st.geladen = true; });
  }

  function kies(moment, ond) {
    var opties = st.lijst.filter(function (u) { return u.moment === moment && ond && u.onderwerp === ond; });
    if (!opties.length) opties = st.lijst.filter(function (u) { return u.moment === moment && !u.onderwerp; });
    if (!opties.length) return null;
    var g = gezien();
    var nieuw = opties.filter(function (u) { return g.indexOf(u.id) < 0; });
    if (!nieuw.length) {
      // Alles is al eens geweest: neem de tekst die het langst geleden was.
      opties.sort(function (a, b) { return g.indexOf(a.id) - g.indexOf(b.id); });
      return opties[0];
    }
    return nieuw[Math.floor(Math.random() * nieuw.length)];
  }

  function bouw() {
    if (st.el) return st.el;
    var el = document.createElement("div");
    el.className = "stan";
    el.hidden = true;
    el.innerHTML =
      '<div class="stan-ballon" role="status" aria-live="polite">' +
        '<span class="stan-naam">BHV-Stan</span>' +
        '<p class="stan-tekst"></p>' +
        '<button type="button" class="stan-weg" aria-label="Tekstballon van Stan sluiten">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        "</button>" +
      "</div>" +
      '<img class="stan-pop" alt="" width="220" height="300">';
    document.body.appendChild(el);
    el.querySelector(".stan-weg").addEventListener("click", function () { verberg(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el.hidden) verberg();
    });
    st.el = el;
    return el;
  }

  function verberg() {
    if (!st.el || st.el.hidden) return;
    clearTimeout(st.timer);
    st.el.classList.remove("in");
    st.el.classList.add("uit");
    setTimeout(function () {
      if (st.el) { st.el.hidden = true; st.el.classList.remove("uit"); }
      var w = st.wacht; st.wacht = null;
      if (w && st.stil === 0) setTimeout(w, 900);
    }, 260);
  }

  function toon(tekst, pose, ms) {
    var el = bouw();
    el.querySelector(".stan-tekst").textContent = tekst;
    var img = el.querySelector(".stan-pop");
    var bron = beeld(pose);
    var zet = function () {
      el.hidden = false;
      el.classList.remove("uit");
      // Opnieuw laten inspringen, ook als hij al in beeld stond.
      el.classList.remove("in");
      void el.offsetWidth;
      el.classList.add("in");
    };
    if (img.getAttribute("src") !== bron) {
      img.onload = zet; img.onerror = zet;
      img.src = bron;
    } else zet();
    clearTimeout(st.timer);
    // Leestijd: een halve seconde per woord, minstens zes seconden.
    var woorden = String(tekst).split(/\s+/).length;
    st.timer = setTimeout(verberg, ms || Math.max(6000, woorden * 500 + 2500));
    st.laatst = Date.now();
  }

  /* opties: { onderwerp, titel, pose, tekst, altijd }
     altijd: ook als hij net nog iets zei (reactie op een antwoord). */
  function zeg(moment, opties) {
    opties = opties || {};
    if (st.uit || st.stil > 0) return false;
    var sinds = Date.now() - st.laatst;
    if (!opties.altijd && sinds < RUST_MS) return false;
    // Na een goed of fout antwoord niet bij elke volgende vraag weer.
    if (opties.min && Date.now() - st.reactie < opties.min) return false;
    // Staat Stan nog iets anders te zeggen, dan wacht dit tot hij klaar is.
    if (opties.naAfloop && st.el && !st.el.hidden) {
      st.wacht = function () { zeg(moment, Object.assign({}, opties, { naAfloop: false })); };
      return true;
    }
    var tekst = opties.tekst, pose = opties.pose, id = null;
    if (!tekst) {
      var u = kies(moment, opties.onderwerp || onderwerp(opties.titel));
      if (!u) return false;
      tekst = u.tekst; pose = pose || u.pose; id = u.id;
    }
    toon(tekst, pose || "standaard");
    onthoud(id);
    if (moment === "goed" || moment === "fout") st.reactie = Date.now();
    return true;
  }

  /* Stil houden, bijvoorbeeld zolang Dirk Jan in beeld is. Telt op en
     af, zodat twee redenen om stil te zijn elkaar niet opheffen. */
  function stil(aan) {
    st.stil = Math.max(0, st.stil + (aan ? 1 : -1));
    if (st.stil > 0) verberg();
  }

  function zetUit(uit) {
    st.uit = !!uit;
    try { localStorage.setItem(UIT_SLEUTEL, uit ? "ja" : "nee"); } catch (e) { /* niets */ }
    if (uit) verberg();
  }

  window.BHVStan = {
    laad: laad, zeg: zeg, stil: stil, verberg: verberg, onderwerp: onderwerp,
    zetUit: zetUit, isUit: function () { return st.uit; },
    POSES: Object.keys(POSES), beeld: beeld,
    herlaad: function () { return st.sb ? laad(st.sb) : Promise.resolve(); }
  };
})();
