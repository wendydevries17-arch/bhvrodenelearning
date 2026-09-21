/* =====================================================================
   BHV Roden leeromgeving
   De cursistkant, draaiend op de echte database.

   Wat hier bewust NIET gebeurt:
   - nakijken van een toets of examen. Dat doet de database, zodat het
     juiste antwoord de browser pas bereikt nadat er is ingeleverd.
   - loten van examenvragen. Ook database, anders ziet iedereen de
     hele bank.
   ===================================================================== */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  var IC = {
    vink:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg>',
    kruis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    slot:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="11" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>'
  };

  /* ---------- controle vooraf ---------- */
  var cfg = window.CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || cfg.supabaseUrl.indexOf("http") !== 0) {
    startfout("Instellingen ontbreken", "In het bestand config.js staan de Project URL en de sleutel nog niet goed ingevuld.");
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    startfout("Supabase kon niet geladen worden", "De bibliotheek van Supabase is niet binnengekomen. Controleer je internetverbinding, of een adblocker die cdn.jsdelivr.net blokkeert.");
    return;
  }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  function startfout(titel, tekst) {
    var doel = $("#login-fout");
    if (!doel) return;
    doel.hidden = false;
    doel.innerHTML = "<b>" + titel + "</b>" + tekst;
    var knop = $("#login-knop");
    if (knop) knop.disabled = true;
  }

  /* ---------- gereedschap ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function datumNL(iso) {
    if (!iso) return "";
    var d = String(iso).slice(0, 10).split("-");
    return d.length === 3 ? d[2] + "-" + d[1] + "-" + d[0] : iso;
  }
  function duur(sec) {
    if (!sec) return "";
    var m = Math.round(sec / 60);
    return m + " min";
  }
  function toast(t) {
    var o = document.querySelector(".toast");
    if (o) o.remove();
    var d = document.createElement("div");
    d.className = "toast";
    d.setAttribute("role", "status");
    d.innerHTML = IC.vink + "<span>" + esc(t) + "</span>";
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2800);
  }
  function toon(id) {
    ["view-laden", "view-profiel", "view-dashboard", "view-les", "view-toets", "view-controle"]
      .forEach(function (v) { $("#" + v).hidden = (v !== id); });
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  /* =====================================================================
     INLOGGEN
     ===================================================================== */
  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var knop = $("#login-knop"), fout = $("#login-fout");
    fout.hidden = true;
    knop.disabled = true;
    knop.textContent = "Bezig met inloggen";

    sb.auth.signInWithPassword({
      email: $("#mail").value.trim(),
      password: $("#pw").value
    }).then(function (res) {
      knop.disabled = false;
      knop.textContent = "Inloggen";
      if (res.error) {
        fout.hidden = false;
        fout.innerHTML = "<b>" + foutTitel(res.error) + "</b>" + foutUitleg(res.error);
        return;
      }
      naarApp();
    }).catch(function (err) {
      knop.disabled = false;
      knop.textContent = "Inloggen";
      fout.hidden = false;
      fout.innerHTML = "<b>Geen verbinding</b>De leeromgeving kon Supabase niet bereiken. Melding: " + esc(err && err.message ? err.message : err);
    });
  });

  function foutTitel(e) {
    var m = (e.message || "").toLowerCase();
    if (m.indexOf("legacy api key") > -1 || m.indexOf("invalid api key") > -1) return "Verkeerde sleutel in config.js";
    if (m.indexOf("invalid login") > -1) return "Inloggen mislukt";
    if (m.indexOf("email not confirmed") > -1) return "Account nog niet bevestigd";
    if (m.indexOf("failed to fetch") > -1) return "Geen verbinding";
    return "Er ging iets mis";
  }
  function foutUitleg(e) {
    var m = (e.message || "").toLowerCase();
    if (m.indexOf("legacy api key") > -1 || m.indexOf("invalid api key") > -1)
      return "Supabase gebruikt in dit project de nieuwe publishable key, en in config.js staat nog de oude. Haal in Supabase onder Project Settings, API Keys de sleutel op die begint met sb_publishable_ en zet die in config.js.";
    if (m.indexOf("invalid login") > -1)
      return "Het e-mailadres of het wachtwoord klopt niet.";
    if (m.indexOf("email not confirmed") > -1)
      return "Dit account is aangemaakt zonder Auto Confirm User. Zet dat aan in Supabase onder Authentication, of bevestig het account daar handmatig.";
    if (m.indexOf("failed to fetch") > -1)
      return "De leeromgeving kon Supabase niet bereiken. Controleer de Project URL in config.js.";
    return esc(e.message || "Onbekende melding.");
  }

  $("#uitloggen").addEventListener("click", function () {
    sb.auth.signOut().then(function () { location.reload(); });
  });
  $("#nav-overzicht").addEventListener("click", function () { naarDashboard(); });
  $("#nav-controle").addEventListener("click", function () { toon("view-controle"); controleer(); });
  $("#c-opnieuw").addEventListener("click", function () { controleer(); });
  $("#les-terug").addEventListener("click", function () { naarDashboard(); });
  $("#toets-terug").addEventListener("click", function () { naarDashboard(); });

  sb.auth.getSession().then(function (res) {
    if (res.data && res.data.session) naarApp();
  });

  function naarApp() {
    $("#scherm-login").hidden = true;
    $("#scherm-app").hidden = false;
    toon("view-laden");
    laadAlles();
  }

  /* =====================================================================
     GEGEVENS OPHALEN
     ===================================================================== */
  var S = {
    gebruiker: null, profiel: null,
    cursus: null, modules: [], lessen: [], evaluaties: {},
    toetsModules: {}, inschrijving: null, voortgang: {}, pogingen: [],
    antwoorden: {}
  };

  function storing(titel, tekst) {
    toon("view-dashboard");
    $("#view-dashboard").innerHTML =
      '<div class="kop"><h1>' + esc(titel) + '</h1></div><div class="let"><b>Wat er aan de hand is</b>' + tekst + "</div>";
  }

  function laadAlles() {
    sb.auth.getUser().then(function (u) {
      S.gebruiker = u.data ? u.data.user : null;
      if (!S.gebruiker) { location.reload(); return; }

      return sb.from("profielen")
        .select("voornaam, achternaam, geboortedatum, rol, email, organisatie_id, organisaties(naam)")
        .eq("id", S.gebruiker.id).maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!r.data) throw new Error("geen-profiel");
          S.profiel = r.data;

          var naam = [S.profiel.voornaam, S.profiel.achternaam].filter(Boolean).join(" ");
          var org = S.profiel.organisaties ? S.profiel.organisaties.naam : "";
          $("#wie").innerHTML = esc(naam || S.profiel.email) + "<span>" + esc(org) + "</span>";
          $("#nav-controle").hidden = S.profiel.rol !== "beheerder";

          if (!S.profiel.voornaam || !S.profiel.achternaam || !S.profiel.geboortedatum) {
            $("#pf-voor").value = S.profiel.voornaam || "";
            $("#pf-achter").value = S.profiel.achternaam || "";
            $("#pf-gb").max = new Date().toISOString().slice(0, 10);
            toon("view-profiel");
            return null;
          }
          return laadCursus();
        });
    }).catch(function (e) {
      if (e && e.message === "geen-profiel") {
        storing("Geen profiel gevonden",
          "Je kunt wel inloggen, maar er staat geen profiel bij dit account. Draai <b>03_gebruikers.sql</b> in Supabase, dat is stap 6 op de installatiepagina.");
      } else {
        storing("Er ging iets mis bij het ophalen",
          "Melding van de database: " + esc(e && e.message ? e.message : e));
      }
    });
  }

  $("#profiel-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var knop = $("#profiel-knop"), fout = $("#profiel-fout");
    fout.hidden = true;
    var gb = $("#pf-gb").value;
    if (gb && gb > new Date().toISOString().slice(0, 10)) {
      fout.hidden = false;
      fout.innerHTML = "<b>Controleer de geboortedatum</b>Die ligt in de toekomst.";
      return;
    }
    knop.disabled = true; knop.textContent = "Bezig met opslaan";
    sb.from("profielen").update({
      voornaam: $("#pf-voor").value.trim(),
      achternaam: $("#pf-achter").value.trim(),
      geboortedatum: gb
    }).eq("id", S.gebruiker.id).then(function (r) {
      knop.disabled = false; knop.textContent = "Opslaan en beginnen";
      if (r.error) {
        fout.hidden = false;
        fout.innerHTML = "<b>Opslaan mislukt</b>" + esc(r.error.message);
        return;
      }
      S.profiel.voornaam = $("#pf-voor").value.trim();
      S.profiel.achternaam = $("#pf-achter").value.trim();
      S.profiel.geboortedatum = gb;
      $("#wie").innerHTML = esc(S.profiel.voornaam + " " + S.profiel.achternaam) +
        "<span>" + esc(S.profiel.organisaties ? S.profiel.organisaties.naam : "") + "</span>";
      toon("view-laden");
      laadCursus().catch(function (e2) {
        storing("Er ging iets mis", esc(e2 && e2.message ? e2.message : e2));
      });
    });
  });

  function laadCursus() {
    return sb.from("cursussen")
      .select("id, titel, omschrijving, organisatie_id, slaagcriterium, aantal_examenvragen, duur_minuten, in_ontwikkeling")
      .eq("actief", true)
      .then(function (r) {
        if (r.error) throw r.error;
        var lijst = r.data || [];
        if (!lijst.length) throw new Error("geen-cursus");
        // Een maatwerkvariant voor de eigen organisatie gaat voor de hoofdcursus.
        var eigen = lijst.filter(function (c) { return c.organisatie_id && c.organisatie_id === S.profiel.organisatie_id; });
        S.cursus = eigen.length ? eigen[0] : lijst.filter(function (c) { return !c.organisatie_id; })[0] || lijst[0];
        $("#ontwikkelbalk").hidden = !S.cursus.in_ontwikkeling;

        return sb.rpc("schrijf_mij_in", { p_cursus: S.cursus.id });
      })
      .then(function (r) {
        if (r.error) throw r.error;
        S.inschrijving = r.data;
        return Promise.all([
          sb.from("modules").select("id, titel, volgorde").eq("cursus_id", S.cursus.id).order("volgorde"),
          sb.from("vragen").select("id, les_id, module_id, soort, volgorde, vraag, opties").eq("cursus_id", S.cursus.id).in("soort", ["evaluatie", "toets"]).order("volgorde"),
          sb.from("voortgang").select("les_id, antwoorden, afgerond_op").eq("inschrijving_id", S.inschrijving),
          sb.from("pogingen").select("id, soort, module_id, score, geslaagd, ingeleverd_op").eq("inschrijving_id", S.inschrijving).order("gestart_op")
        ]);
      })
      .then(function (r) {
        r.forEach(function (x) { if (x.error) throw x.error; });
        S.modules = r[0].data || [];
        if (!S.modules.length) throw new Error("geen-inhoud");

        S.evaluaties = {}; S.toetsModules = {};
        (r[1].data || []).forEach(function (v) {
          if (v.soort === "evaluatie") {
            (S.evaluaties[v.les_id] = S.evaluaties[v.les_id] || []).push(v);
          } else {
            S.toetsModules[v.module_id] = (S.toetsModules[v.module_id] || 0) + 1;
          }
        });

        S.voortgang = {};
        (r[2].data || []).forEach(function (v) { S.voortgang[v.les_id] = v; });
        S.pogingen = r[3].data || [];

        var ids = S.modules.map(function (m) { return m.id; });
        return sb.from("lessen")
          .select("id, module_id, titel, volgorde, duur_seconden, tekst, markeringen, foto_url")
          .in("module_id", ids).order("volgorde");
      })
      .then(function (r) {
        if (r.error) throw r.error;
        S.lessen = r.data || [];
        S.modules.forEach(function (m) {
          m.lessen = S.lessen.filter(function (l) { return l.module_id === m.id; });
        });
        naarDashboard();
      })
      .catch(function (e) {
        if (e && e.message === "geen-cursus") {
          storing("Er staat nog geen cursus klaar",
            "De database is leeg. Draai <b>04_cursusinhoud.sql</b> in Supabase, dat is stap 7 op de installatiepagina.");
        } else if (e && e.message === "geen-inhoud") {
          storing("De cursus heeft nog geen modules",
            "Draai <b>04_cursusinhoud.sql</b> opnieuw in Supabase, stap 7 op de installatiepagina.");
        } else if (e && /schrijf_mij_in|function|does not exist/i.test(e.message || "")) {
          storing("De database mist nog een functie",
            "Melding: " + esc(e.message) + ". Draai <b>06_cursist.sql</b>, dat is stap 9 op de installatiepagina.");
        } else {
          storing("Er ging iets mis bij het ophalen",
            "Melding van de database: " + esc(e && e.message ? e.message : e));
        }
      });
  }

  /* =====================================================================
     VOORTGANG UITREKENEN
     ===================================================================== */
  function lesAf(id) { return !!(S.voortgang[id] && S.voortgang[id].afgerond_op); }
  function toetsGehaald(mid) {
    return S.pogingen.some(function (p) { return p.soort === "toets" && p.module_id === mid && p.geslaagd; });
  }
  function examenGehaald() {
    return S.pogingen.some(function (p) { return p.soort === "examen" && p.geslaagd; });
  }
  function moduleHeeftToets(m) { return !!S.toetsModules[m.id]; }
  function moduleLessenAf(m) { return m.lessen.length > 0 && m.lessen.every(function (l) { return lesAf(l.id); }); }
  function moduleAf(m) { return moduleLessenAf(m) && (!moduleHeeftToets(m) || toetsGehaald(m.id)); }
  function examenOpen() { return S.modules.every(moduleAf); }

  function alleLessenOpVolgorde() {
    var rij = [];
    S.modules.forEach(function (m) { m.lessen.forEach(function (l) { rij.push(l); }); });
    return rij;
  }
  function lesOpen(id) {
    var rij = alleLessenOpVolgorde();
    var i = rij.findIndex(function (l) { return l.id === id; });
    if (i <= 0) return true;
    return lesAf(rij[i - 1].id);
  }
  function telAf() {
    return alleLessenOpVolgorde().filter(function (l) { return lesAf(l.id); }).length;
  }

  /* =====================================================================
     DASHBOARD
     ===================================================================== */
  function naarDashboard() {
    toon("view-dashboard");
    $("#nav-overzicht").hidden = false;

    var rij = alleLessenOpVolgorde(), af = telAf();
    var pct = rij.length ? Math.round(af * 100 / rij.length) : 0;

    $("#dash-titel").textContent = S.cursus.titel;
    $("#dash-omschrijving").textContent = S.cursus.omschrijving || "";
    $("#dash-bar").style.width = pct + "%";
    $("#dash-tel").textContent = af + " van " + rij.length + " lessen";
    $("#dash-pct").textContent = pct + "%";
    $("#dash-status").textContent =
      examenGehaald() ? "Geslaagd" : af === 0 ? "Nog niet begonnen" : pct === 100 ? "Klaar voor het examen" : "Bezig";

    var uit = "";
    S.modules.forEach(function (m, i) {
      var lAf = m.lessen.filter(function (l) { return lesAf(l.id); }).length;
      var klaar = moduleAf(m);
      var chip = klaar ? '<span class="chip af">Afgerond</span>'
        : lAf ? '<span class="chip bezig">Bezig</span>'
              : '<span class="chip nieuw">Nog te doen</span>';
      var mpct = m.lessen.length ? Math.round(lAf * 100 / m.lessen.length) : 0;
      var eerste = m.lessen.find(function (l) { return !lesAf(l.id); }) || m.lessen[0];
      var kanOpen = eerste && lesOpen(eerste.id);

      uit += '<div class="kaart"><div class="kaart-body">' +
        chip +
        "<h3>" + esc(m.titel) + "</h3>" +
        '<div class="kaart-meta"><span>' + m.lessen.length + " lessen</span>" +
        (moduleHeeftToets(m) ? "<span>kennistoets</span>" : "") + "</div>" +
        '<span class="bar"><span style="width:' + mpct + '%"></span></span>' +
        '<div class="bar-rij"><span>' + lAf + " van " + m.lessen.length + " af</span><span>" + mpct + "%</span></div>" +
        "</div><div class=\"kaart-foot\">";

      if (eerste) {
        uit += '<button type="button" class="btn ' + (kanOpen ? "btn-p" : "btn-g") + '" data-les="' + eerste.id + '"' +
          (kanOpen ? "" : " disabled") + ">" +
          (lAf === 0 ? "Beginnen" : lAf === m.lessen.length ? "Lessen teruglezen" : "Verder gaan") + "</button>";
      }
      if (moduleHeeftToets(m)) {
        var tOpen = moduleLessenAf(m);
        var tOk = toetsGehaald(m.id);
        uit += '<button type="button" class="btn ' + (tOk ? "btn-g" : tOpen ? "btn-a" : "btn-g") + '" data-toets="' + m.id + '"' +
          (tOpen ? "" : " disabled") + ">" +
          (tOk ? "Kennistoets opnieuw maken" : "Kennistoets maken") + "</button>";
        if (!tOpen) uit += '<span class="slot">' + IC.slot + "Eerst alle lessen van deze module afronden</span>";
      }
      uit += "</div></div>";
    });

    // Eindexamen
    var exOk = examenGehaald();
    var exOpen = examenOpen();
    uit += '<div class="kaart"><div class="kaart-body">' +
      (exOk ? '<span class="chip af">Geslaagd</span>' : exOpen ? '<span class="chip bezig">Klaar om te maken</span>' : '<span class="chip nieuw">Nog op slot</span>') +
      "<h3>Eindexamen</h3>" +
      '<div class="kaart-meta"><span>' + S.cursus.aantal_examenvragen + " vragen</span><span>" + S.cursus.slaagcriterium + "% nodig</span></div>" +
      "<p class=\"lead\">De vragen worden geloot uit de examenbank, dus elke poging is anders. Haal je het niet, dan mag je het opnieuw proberen.</p>" +
      '</div><div class="kaart-foot">' +
      '<button type="button" class="btn ' + (exOpen ? "btn-a" : "btn-g") + '" id="start-examen"' + (exOpen ? "" : " disabled") + ">" +
      (exOk ? "Examen opnieuw maken" : "Eindexamen starten") + "</button>" +
      (exOpen ? "" : '<span class="slot">' + IC.slot + "Eerst alle modules en kennistoetsen afronden</span>") +
      (exOk ? '<button type="button" class="btn btn-g" id="toon-cert">Mijn certificaat bekijken</button>' : "") +
      "</div></div>";

    $("#dash-modules").innerHTML = uit;

    $("#dash-modules").querySelectorAll("[data-les]").forEach(function (b) {
      b.addEventListener("click", function () { naarLes(b.dataset.les); });
    });
    $("#dash-modules").querySelectorAll("[data-toets]").forEach(function (b) {
      b.addEventListener("click", function () { startToets("toets", b.dataset.toets); });
    });
    var ex = $("#start-examen");
    if (ex) ex.addEventListener("click", function () { startToets("examen", null); });
    var tc = $("#toon-cert");
    if (tc) tc.addEventListener("click", function () { toonCertificaat(); });
  }

  /* =====================================================================
     LES
     ===================================================================== */
  function naarLes(id) {
    if (!lesOpen(id)) { toast("Rond eerst de vorige les af"); return; }
    S.huidig = id;
    toon("view-les");
    tekenToc();
    tekenLes();
  }

  function tekenToc() {
    var rij = alleLessenOpVolgorde(), af = telAf();
    var pct = rij.length ? Math.round(af * 100 / rij.length) : 0;
    $("#toc-titel").textContent = S.cursus.titel;
    $("#toc-sub").textContent = rij.length + " lessen";
    $("#toc-bar").style.width = pct + "%";
    $("#toc-tel").textContent = af + " van " + rij.length;
    $("#toc-pct").textContent = pct + "%";

    var uit = "";
    S.modules.forEach(function (m) {
      uit += '<div class="modlab">' + esc(m.titel) + "</div>";
      m.lessen.forEach(function (l) {
        var ok = lesAf(l.id), open = lesOpen(l.id);
        uit += '<button type="button" class="tocknop" data-les="' + l.id + '"' +
          (open ? "" : " disabled") + (l.id === S.huidig ? ' aria-current="true"' : "") + ">" +
          '<span class="n' + (ok ? " ok" : "") + '">' + (ok ? IC.vink : String(l.volgorde)) + "</span>" +
          "<span>" + esc(l.titel) + '<span class="dur">' + duur(l.duur_seconden) + "</span></span></button>";
      });
      if (moduleHeeftToets(m)) {
        var tOk = toetsGehaald(m.id), tOpen = moduleLessenAf(m);
        uit += '<button type="button" class="tocknop" data-toets="' + m.id + '"' + (tOpen ? "" : " disabled") + ">" +
          '<span class="n t' + (tOk ? " ok" : "") + '">' + (tOk ? IC.vink : "T") + "</span>" +
          "<span>Kennistoets" + '<span class="dur">' + S.toetsModules[m.id] + " vragen</span></span></button>";
      }
    });
    $("#toc-body").innerHTML = uit;
    $("#toc-body").querySelectorAll("[data-les]").forEach(function (b) {
      b.addEventListener("click", function () { naarLes(b.dataset.les); });
    });
    $("#toc-body").querySelectorAll("[data-toets]").forEach(function (b) {
      b.addEventListener("click", function () { startToets("toets", b.dataset.toets); });
    });
  }

  function tekenLes() {
    var l = S.lessen.find(function (x) { return x.id === S.huidig; });
    if (!l) { naarDashboard(); return; }
    var m = S.modules.find(function (x) { return x.id === l.module_id; });
    var vragen = S.evaluaties[l.id] || [];
    var bewaard = (S.voortgang[l.id] && S.voortgang[l.id].antwoorden) || {};
    S.antwoorden[l.id] = S.antwoorden[l.id] || {};
    Object.keys(bewaard).forEach(function (k) {
      if (S.antwoorden[l.id][k] == null) S.antwoorden[l.id][k] = { keuze: bewaard[k] };
    });

    var mark = Array.isArray(l.markeringen) ? l.markeringen : [];
    var uit = "";

    /* video, voorlopig een stilstaand beeld */
    uit += '<div class="speler"><div class="toneel">' +
      (l.foto_url ? '<img src="' + esc(l.foto_url) + '" alt="">' : "") +
      '<span class="waas"></span><span class="vtag">Video volgt</span>' +
      '<div class="vmelding"><b>De video van deze les staat er nog niet op</b>' +
      "<span>De lesstof hieronder is compleet. Zodra de opnames klaar zijn verschijnt de video hier.</span></div></div>" +
      (mark.length ? '<div class="hoofdstukken">' + mark.map(function (x) {
        return "<span>" + esc(x[0]) + "  " + esc(x[1]) + "</span>";
      }).join("") + "</div>" : "") +
      "</div>";

    /* kop en tekst */
    uit += '<div class="leskop"><span class="eyebrow">' + esc(m ? m.titel : "") + "</span>" +
      "<h2>" + esc(l.titel) + "</h2></div>";
    uit += '<div class="proza">' + prozaHtml(l.tekst) + "</div>";

    /* evaluatievragen */
    if (vragen.length) {
      uit += '<div class="blok" id="ev-blok"><div class="blok-kop"><h3>Evaluatievragen</h3>' +
        '<span class="lead">Tellen niet mee voor je cijfer</span></div><div class="vragen" id="ev-vragen"></div>' +
        '<div class="btn-row"><button type="button" class="btn btn-a" id="les-klaar">Les afronden</button>' +
        '<span class="lead" id="ev-stand"></span></div></div>';
    } else {
      uit += '<div class="blok"><div class="btn-row"><button type="button" class="btn btn-a" id="les-klaar">Les afronden</button></div></div>';
    }

    $("#les-paneel").innerHTML = uit;
    if (vragen.length) tekenEvaluatie(l, vragen);
    $("#les-klaar").addEventListener("click", function () { rondLesAf(l, vragen); });
    werkKlaarknopBij(l, vragen);
  }

  function prozaHtml(blokken) {
    if (!Array.isArray(blokken)) return "";
    return blokken.map(function (b) {
      if (b.t === "h") return "<h3>" + b.v + "</h3>";
      if (b.t === "ul") return "<ul>" + (b.v || []).map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>";
      if (b.t === "call") return '<div class="uitroep"><span class="eyebrow">Let op</span>' + b.v + "</div>";
      return "<p>" + b.v + "</p>";
    }).join("");
  }

  function tekenEvaluatie(l, vragen) {
    var doel = $("#ev-vragen");
    doel.innerHTML = vragen.map(function (v, i) {
      var opties = Array.isArray(v.opties) ? v.opties : [];
      return '<div class="vraag" data-v="' + v.id + '">' +
        '<div class="vraag-t"><span class="n">' + (i + 1) + ".</span>" + esc(v.vraag) + "</div>" +
        '<div class="opties">' + opties.map(function (o, k) {
          return '<button type="button" class="optie" data-k="' + k + '">' +
            '<span class="k">' + "ABCDEF"[k] + "</span><span>" + esc(o) + "</span></button>";
        }).join("") + "</div><div class=\"tk\"></div></div>";
    }).join("");

    doel.querySelectorAll(".vraag").forEach(function (vd) {
      var id = vd.dataset.v;
      vd.querySelectorAll(".optie").forEach(function (b) {
        b.addEventListener("click", function () { beantwoord(l, vragen, id, parseInt(b.dataset.k, 10)); });
      });
      if (S.antwoorden[l.id][id] && S.antwoorden[l.id][id].keuze != null) {
        var a = S.antwoorden[l.id][id];
        if (a.juist_index == null) {
          sb.rpc("controleer_antwoord", { p_vraag: id, p_keuze: a.keuze }).then(function (r) {
            if (!r.error && r.data) {
              S.antwoorden[l.id][id] = { keuze: a.keuze, juist: r.data.juist, juist_index: r.data.juist_index, uitleg: r.data.uitleg };
              schilderVraag(vd, S.antwoorden[l.id][id]);
            }
          });
        } else schilderVraag(vd, a);
      }
    });
  }

  function beantwoord(l, vragen, vraagId, keuze) {
    if (S.antwoorden[l.id][vraagId] && S.antwoorden[l.id][vraagId].juist_index != null) return;
    sb.rpc("controleer_antwoord", { p_vraag: vraagId, p_keuze: keuze }).then(function (r) {
      if (r.error || !r.data) { toast("Nakijken lukte niet"); return; }
      S.antwoorden[l.id][vraagId] = {
        keuze: keuze, juist: r.data.juist, juist_index: r.data.juist_index, uitleg: r.data.uitleg
      };
      schilderVraag($("#ev-vragen").querySelector('[data-v="' + vraagId + '"]'), S.antwoorden[l.id][vraagId]);
      werkKlaarknopBij(l, vragen);
      bewaarAntwoorden(l);
    });
  }

  function schilderVraag(vd, a) {
    if (!vd) return;
    vd.querySelectorAll(".optie").forEach(function (b, k) {
      b.disabled = true;
      b.classList.remove("gekozen", "juist", "onjuist");
      if (k === a.juist_index) b.classList.add("juist");
      else if (k === a.keuze) b.classList.add("onjuist");
    });
    vd.querySelector(".tk").innerHTML =
      '<div class="terugkoppeling ' + (a.juist ? "ja" : "nee") + '">' + (a.juist ? IC.vink : IC.kruis) +
      "<span><b>" + (a.juist ? "Goed" : "Niet goed") + ".</b> " + esc(a.uitleg || "") + "</span></div>";
  }

  function werkKlaarknopBij(l, vragen) {
    var gedaan = vragen.filter(function (v) {
      return S.antwoorden[l.id][v.id] && S.antwoorden[l.id][v.id].juist_index != null;
    }).length;
    var stand = $("#ev-stand");
    if (stand) stand.textContent = gedaan + " van " + vragen.length + " beantwoord";
    var knop = $("#les-klaar");
    if (!knop) return;
    knop.disabled = gedaan < vragen.length;
    knop.textContent = lesAf(l.id) ? "Volgende les" : "Les afronden";
  }

  function bewaarAntwoorden(l, afronden) {
    var kort = {};
    Object.keys(S.antwoorden[l.id] || {}).forEach(function (k) { kort[k] = S.antwoorden[l.id][k].keuze; });
    var rij = {
      inschrijving_id: S.inschrijving, les_id: l.id, antwoorden: kort,
      bijgewerkt_op: new Date().toISOString()
    };
    if (afronden) rij.afgerond_op = new Date().toISOString();
    else if (S.voortgang[l.id] && S.voortgang[l.id].afgerond_op) rij.afgerond_op = S.voortgang[l.id].afgerond_op;
    return sb.from("voortgang").upsert(rij, { onConflict: "inschrijving_id,les_id" }).then(function (r) {
      if (r.error) { console.warn("voortgang", r.error); return; }
      S.voortgang[l.id] = { les_id: l.id, antwoorden: kort, afgerond_op: rij.afgerond_op || null };
    });
  }

  function rondLesAf(l, vragen) {
    var knop = $("#les-klaar");
    knop.disabled = true;
    bewaarAntwoorden(l, true).then(function () {
      var rij = alleLessenOpVolgorde();
      var i = rij.findIndex(function (x) { return x.id === l.id; });
      var volgende = rij[i + 1];
      var m = S.modules.find(function (x) { return x.id === l.module_id; });
      toast("Les afgerond");

      if (volgende && volgende.module_id === l.module_id) {
        naarLes(volgende.id);
      } else if (m && moduleHeeftToets(m) && !toetsGehaald(m.id)) {
        tekenToc();
        naarDashboard();
        toast("Module af. De kennistoets staat klaar.");
      } else if (volgende) {
        naarLes(volgende.id);
      } else {
        naarDashboard();
      }
    });
  }

  /* =====================================================================
     TOETS EN EXAMEN
     ===================================================================== */
  var T = null;

  function startToets(soort, moduleId) {
    toon("view-toets");
    $("#toets-paneel").innerHTML = '<div class="laden"><span class="tol"></span>De vragen worden klaargezet</div>';
    var arg = { p_inschrijving: S.inschrijving, p_soort: soort };
    if (moduleId) arg.p_module = moduleId;

    sb.rpc("start_toets", arg).then(function (r) {
      if (r.error || !r.data) {
        $("#toets-paneel").innerHTML = '<div class="let"><b>De toets kon niet starten</b>' +
          esc(r.error ? r.error.message : "Onbekende melding") +
          ". Mist de functie, draai dan <b>06_cursist.sql</b> in Supabase, stap 9 op de installatiepagina.</div>";
        return;
      }
      T = {
        soort: soort, module: moduleId, poging: r.data.poging,
        drempel: r.data.drempel, vragen: r.data.vragen || [], keuzes: {}
      };
      tekenToets();
    });
  }

  function tekenToets() {
    var m = T.module ? S.modules.find(function (x) { return x.id === T.module; }) : null;
    var titel = T.soort === "examen" ? "Eindexamen" : "Kennistoets";
    var uit = '<div class="kop"><h1>' + esc(titel) + (m ? " <em>" + esc(m.titel) + "</em>" : "") + "</h1>" +
      "<p>" + T.vragen.length + " vragen. Je hebt " + T.drempel + " procent nodig om te slagen. " +
      "Je krijgt de uitslag pas nadat je hebt ingeleverd.</p></div>";

    uit += '<div class="blok"><div class="vragen" id="t-vragen">' + T.vragen.map(function (v, i) {
      var opties = Array.isArray(v.opties) ? v.opties : [];
      return '<div class="vraag" data-v="' + v.id + '">' +
        '<div class="vraag-t"><span class="n">' + (i + 1) + ".</span>" + esc(v.vraag) + "</div>" +
        '<div class="opties">' + opties.map(function (o, k) {
          return '<button type="button" class="optie" data-k="' + k + '">' +
            '<span class="k">' + "ABCDEF"[k] + "</span><span>" + esc(o) + "</span></button>";
        }).join("") + '</div><div class="tk"></div></div>';
    }).join("") + "</div>" +
      '<div class="btn-row"><button type="button" class="btn btn-a" id="t-lever" disabled>Inleveren en nakijken</button>' +
      '<span class="lead" id="t-stand">0 van ' + T.vragen.length + " beantwoord</span></div></div>";

    $("#toets-paneel").innerHTML = uit;

    $("#t-vragen").querySelectorAll(".vraag").forEach(function (vd) {
      vd.querySelectorAll(".optie").forEach(function (b, k) {
        b.addEventListener("click", function () {
          T.keuzes[vd.dataset.v] = k;
          vd.querySelectorAll(".optie").forEach(function (x) { x.classList.remove("gekozen"); });
          b.classList.add("gekozen");
          var n = Object.keys(T.keuzes).length;
          $("#t-stand").textContent = n + " van " + T.vragen.length + " beantwoord";
          $("#t-lever").disabled = n < T.vragen.length;
        });
      });
    });
    $("#t-lever").addEventListener("click", leverIn);
  }

  function leverIn() {
    var knop = $("#t-lever");
    knop.disabled = true; knop.textContent = "Bezig met nakijken";
    sb.rpc("lever_in", { p_poging: T.poging, p_antwoorden: T.keuzes }).then(function (r) {
      if (r.error || !r.data) {
        knop.disabled = false; knop.textContent = "Inleveren en nakijken";
        toast("Nakijken lukte niet: " + (r.error ? r.error.message : "onbekend"));
        return;
      }
      var u = r.data;
      S.pogingen.push({
        id: T.poging, soort: T.soort, module_id: T.module,
        score: u.score, geslaagd: u.geslaagd, ingeleverd_op: new Date().toISOString()
      });
      tekenUitslag(u);
    });
  }

  function tekenUitslag(u) {
    var nak = u.nakijk || {};
    var m = T.module ? S.modules.find(function (x) { return x.id === T.module; }) : null;
    var examen = T.soort === "examen";

    var uit = '<div class="uitslag ' + (u.geslaagd ? "geslaagd" : "gezakt") + '">' +
      '<span class="score">' + u.score + "%</span>" +
      "<h2>" + (u.geslaagd ? "Geslaagd" : "Net niet") + "</h2>" +
      "<p>Je had " + u.goed + " van de " + u.totaal + " vragen goed. Je hebt " + u.drempel + " procent nodig. " +
      (u.geslaagd
        ? (examen ? "Daarmee heb je het theoriegedeelte afgerond." : "Je kunt door naar de volgende module.")
        : "Lees de lesstof nog eens door en probeer het daarna opnieuw. Het aantal pogingen is niet beperkt.") +
      "</p><div class=\"btn-row\">" +
      (u.geslaagd
        ? '<button type="button" class="btn btn-p" id="u-verder">Terug naar het overzicht</button>'
        : '<button type="button" class="btn btn-a" id="u-opnieuw">Opnieuw proberen</button>' +
          '<button type="button" class="btn btn-g" id="u-verder">Terug naar het overzicht</button>') +
      "</div></div>";

    if (u.geslaagd && examen) {
      uit += '<div class="goed" style="margin-top:18px"><b>Wat er nu gebeurt</b>' +
        "Je certificaat staat hieronder. Het wordt straks ook automatisch naar je gemaild zodra wij de mailkoppeling hebben aangezet. " +
        "Daarna volgt de praktijkdag, die wordt apart met je afgestemd.</div>";
    }

    /* nakijken */
    uit += '<div class="blok" style="margin-top:22px"><div class="blok-kop"><h3>Het nakijken</h3>' +
      '<span class="lead">' + (m ? esc(m.titel) : "Eindexamen") + "</span></div><div class=\"vragen\">" +
      T.vragen.map(function (v, i) {
        var opties = Array.isArray(v.opties) ? v.opties : [];
        var n = nak[v.id] || {};
        var mijn = T.keuzes[v.id];
        return '<div class="vraag">' +
          '<div class="vraag-t"><span class="n">' + (i + 1) + ".</span>" + esc(v.vraag) + "</div>" +
          '<div class="opties">' + opties.map(function (o, k) {
            var kl = k === n.juist_index ? " juist" : (k === mijn ? " onjuist" : "");
            return '<button type="button" class="optie' + kl + '" disabled>' +
              '<span class="k">' + "ABCDEF"[k] + "</span><span>" + esc(o) + "</span></button>";
          }).join("") + "</div>" +
          (n.uitleg ? '<div class="terugkoppeling ' + (mijn === n.juist_index ? "ja" : "nee") + '">' +
            (mijn === n.juist_index ? IC.vink : IC.kruis) + "<span>" + esc(n.uitleg) + "</span></div>" : "") +
          "</div>";
      }).join("") + "</div></div>";

    $("#toets-paneel").innerHTML = uit;
    var vk = $("#u-verder");
    if (vk) vk.addEventListener("click", function () {
      if (u.geslaagd && examen) toonCertificaat(); else naarDashboard();
    });
    var ok = $("#u-opnieuw");
    if (ok) ok.addEventListener("click", function () { startToets(T.soort, T.module); });
    window.scrollTo({ top: 0 });
  }

  /* =====================================================================
     CERTIFICAAT
     ===================================================================== */
  function toonCertificaat() {
    toon("view-toets");
    var p = S.profiel;
    var beste = S.pogingen.filter(function (x) { return x.soort === "examen" && x.geslaagd; }).pop();
    var datum = beste && beste.ingeleverd_op ? beste.ingeleverd_op : new Date().toISOString();
    var tot = new Date(datum); tot.setFullYear(tot.getFullYear() + 1);

    $("#toets-paneel").innerHTML =
      '<div class="kop"><h1>Je <em>certificaat</em></h1>' +
      "<p>Dit is het theoriecertificaat van BHV Roden. Het definitieve bestand krijg je per mail zodra de mailkoppeling aanstaat. Het praktijkgedeelte volgt daarna apart.</p></div>" +
      '<div class="cert-scroll"><div class="cert">' +
        '<div class="cert-top"><img src="img/logo-bhv-cert.png" alt="BHV Roden">' +
        '<div class="cert-zegel"><strong>Certificaatnummer volgt</strong><br>Uitgegeven door BHV Roden<br>Erkend opleider NIBHV</div></div>' +
        "<h2>Certificaat</h2>" +
        '<div class="cert-naam">' + esc([p.voornaam, p.achternaam].join(" ")) + "</div>" +
        '<p class="cert-regel">heeft met goed gevolg het theoriegedeelte afgerond van de opleiding</p>' +
        '<div class="cert-cursus">' + esc(S.cursus.titel) + "</div>" +
        '<div class="cert-grid">' +
          '<div><div class="k">Geboortedatum</div><div class="v">' + esc(datumNL(p.geboortedatum)) + "</div></div>" +
          '<div><div class="k">Afgerond op</div><div class="v">' + esc(datumNL(datum)) + "</div></div>" +
          '<div><div class="k">Geldig tot</div><div class="v">' + esc(datumNL(tot.toISOString())) + "</div></div>" +
          '<div><div class="k">Resultaat</div><div class="v">' + (beste ? beste.score + "%" : "") + "</div></div>" +
        "</div>" +
        '<div class="cert-foot"><div class="cert-hand"><img src="img/handtekening.png" alt="">' +
        '<div class="lijn"></div>Dirk Jan Mollema, BHV Roden</div></div>' +
      "</div></div>" +
      '<div class="btn-row" style="margin-top:20px"><button type="button" class="btn btn-p" id="cert-terug">Terug naar het overzicht</button></div>';
    $("#cert-terug").addEventListener("click", naarDashboard);
  }

  /* =====================================================================
     SYSTEEMCONTROLE, alleen voor beheerders
     ===================================================================== */
  function regel(ok, titel, uitleg, waarde) {
    var kl = ok === null ? "bezig" : (ok ? "ja" : "nee");
    var t = ok === null ? "" : (ok ? IC.vink : IC.kruis);
    return '<div class="regel' + (ok === false ? " mis" : "") + '">' +
      '<span class="vink ' + kl + '">' + t + "</span>" +
      '<span class="tekst"><b>' + titel + "</b><span>" + uitleg + "</span></span>" +
      (waarde != null ? '<span class="waarde">' + waarde + "</span>" : "") + "</div>";
  }
  function tel(tabel, f) {
    var v = sb.from(tabel).select("id", { count: "exact", head: true });
    if (f) v = f(v);
    return v.then(function (r) { return r.error ? { fout: r.error } : { n: r.count }; });
  }

  function controleer() {
    $("#c-account").innerHTML = '<div class="laden"><span class="tol"></span>Bezig met ophalen</div>';
    $("#c-inhoud").innerHTML = '<div class="laden"><span class="tol"></span>Bezig met ophalen</div>';
    $("#c-uitslag").innerHTML = "";

    var p = S.profiel || {};
    var naam = [p.voornaam, p.achternaam].filter(Boolean).join(" ") || "(naam nog niet ingevuld)";
    var org = p.organisaties ? p.organisaties.naam : null;
    var a = regel(true, esc(naam), esc(p.email || ""));
    a += regel(p.rol === "beheerder", "Rol: " + esc(p.rol || ""), p.rol === "beheerder" ? "Je mag alles zien en beheren." : "Voor het beheer moet dit beheerder zijn.");
    a += regel(!!org, "Organisatie: " + esc(org || "geen"), org ? "Gekoppeld aan de juiste organisatie." : "Nog niet gekoppeld. Draai 03_gebruikers.sql.");
    a += regel(p.geboortedatum ? true : null, "Geboortedatum",
      p.geboortedatum ? "Staat klaar voor op het certificaat." : "Nog leeg, die vul je in de leeromgeving zelf in.",
      p.geboortedatum ? datumNL(p.geboortedatum) : "nog leeg");
    $("#c-account").innerHTML = a;

    Promise.all([
      sb.from("cursussen").select("titel, in_ontwikkeling, aantal_examenvragen, slaagcriterium").limit(5),
      tel("modules"), tel("lessen"),
      tel("vragen", function (v) { return v.eq("soort", "evaluatie"); }),
      tel("vragen", function (v) { return v.eq("soort", "toets"); }),
      tel("vragen", function (v) { return v.eq("soort", "examen"); }),
      tel("organisaties"),
      sb.rpc("start_toets", { p_inschrijving: "00000000-0000-0000-0000-000000000000", p_soort: "examen" })
    ]).then(function (r) {
      var cursus = r[0], alles = true, uit = "";

      if (cursus.error) { uit += regel(false, "Cursussen ophalen mislukt", esc(cursus.error.message)); alles = false; }
      else {
        var c = cursus.data[0], heeft = cursus.data.length > 0;
        if (!heeft) alles = false;
        uit += regel(heeft, "Cursus gevonden",
          heeft ? esc(c.titel) + ", slaagcriterium " + c.slaagcriterium + " procent, " + c.aantal_examenvragen + " examenvragen"
                : "Er staat nog geen cursus in. Draai 04_cursusinhoud.sql, stap 7.", cursus.data.length);
        if (heeft && c.in_ontwikkeling) {
          uit += regel(null, "Cursus staat op in ontwikkeling",
            "De leeromgeving toont dan bovenin dat de inhoud nog wordt nagekeken.");
        }
      }
      function ct(res, titel, verwacht) {
        if (res.fout) { alles = false; return regel(false, titel, "Melding: " + esc(res.fout.message)); }
        var ok = res.n === verwacht;
        if (!ok) alles = false;
        return regel(ok, titel, ok ? "Klopt met wat erin hoort te staan."
          : "Verwacht " + verwacht + ", gevonden " + res.n + ". Draai 04_cursusinhoud.sql opnieuw, stap 7.", res.n);
      }
      uit += ct(r[1], "Modules", 4);
      uit += ct(r[2], "Lessen", 13);
      uit += ct(r[3], "Evaluatievragen", 25);
      uit += ct(r[4], "Toetsvragen", 15);
      uit += ct(r[5], "Examenbank", 24);
      uit += ct(r[6], "Organisaties", 1);

      /* De functie hoort te bestaan. Hij faalt met een nette melding
         omdat de inschrijving niet van ons is, en dat is precies goed. */
      var fn = r[7];
      var mist = fn.error && /does not exist|not find the function|schema cache/i.test(fn.error.message || "");
      if (mist) alles = false;
      uit += regel(!mist, "Functies voor toetsen",
        mist ? "start_toets ontbreekt. Draai 06_cursist.sql, stap 9 op de installatiepagina."
             : "start_toets, lever_in en schrijf_mij_in staan klaar.");

      $("#c-inhoud").innerHTML = uit;
      $("#c-uitslag").innerHTML = alles
        ? '<div class="goed"><b>Alles staat goed.</b> De database, de toegangsregels en de cursusinhoud werken.</div>'
        : '<div class="let"><b>Er ontbreekt nog iets.</b> Hierboven staat bij elke rode regel welk bestand je nog moet draaien.</div>';
    });
  }
})();
