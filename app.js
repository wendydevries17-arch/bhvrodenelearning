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
    ["view-laden", "view-profiel", "view-dashboard", "view-les", "view-toets", "view-beheer"]
      .forEach(function (v) { $("#" + v).hidden = (v !== id); });
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }
  /* Kopieren naar het klembord. Sommige browsers weigeren de nieuwe
     manier, bijvoorbeeld in een ingebouwd venster of zonder https.
     Daarom eerst de nieuwe manier, dan de oude, en lukt het allebei
     niet, dan selecteren we de tekst zodat Cmd+C nog werkt. */
  function kopieer(tekst, knop) {
    var klaar = function () {
      if (!knop) return;
      var oud = knop.dataset.oud || knop.textContent;
      knop.dataset.oud = oud;
      knop.textContent = "Gekopieerd";
      knop.classList.add("klaar");
      setTimeout(function () { knop.textContent = oud; knop.classList.remove("klaar"); }, 2200);
    };

    var oudeManier = function () {
      var t = document.createElement("textarea");
      t.value = tekst;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(t);
      t.select();
      t.setSelectionRange(0, tekst.length);
      var gelukt = false;
      try { gelukt = document.execCommand("copy"); } catch (e) { gelukt = false; }
      t.remove();
      if (gelukt) klaar();
      else selecteerVeld();
      return gelukt;
    };

    var selecteerVeld = function () {
      var veld = $("#u-alles");
      if (veld) {
        veld.focus();
        veld.select();
        toast("Selecteren gelukt, druk nu op Cmd+C");
      } else {
        toast("Kopieren lukt niet in deze browser");
      }
    };

    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(tekst).then(klaar).catch(oudeManier);
    } else {
      oudeManier();
    }
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
  $("#nav-beheer").addEventListener("click", function () { naarBeheer("overzicht"); });
  $("#les-terug").addEventListener("click", function () { naarDashboard(); });
  $("#toets-terug").addEventListener("click", function () { naarDashboard(); });
  $("#beheer-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (b) naarBeheer(b.dataset.tab);
  });

  /* Een uitnodigingslink gaat voor op alles. */
  var TOKEN = (new URLSearchParams(location.search)).get("token");
  if (TOKEN) {
    startAanmelden(TOKEN);
  } else {
    sb.auth.getSession().then(function (res) {
      if (res.data && res.data.session) naarApp();
      else $("#scherm-login").hidden = false;
    });
  }

  function naarApp() {
    $("#scherm-login").hidden = true;
    $("#scherm-aanmelden").hidden = true;
    $("#scherm-app").hidden = false;
    toon("view-laden");
    laadAlles();
  }

  /* =====================================================================
     AANMELDEN MET EEN UITNODIGING
     ===================================================================== */
  function startAanmelden(token) {
    $("#scherm-aanmelden").hidden = false;
    sb.rpc("bekijk_uitnodiging", { p_token: token }).then(function (r) {
      var u = r.data;
      if (r.error || !u || !u.geldig) {
        var reden = (!u || !u.email) ? "Deze link hoort bij geen enkele uitnodiging. Controleer of je hem helemaal hebt gekopieerd."
          : u.gebruikt ? "Deze uitnodiging is al gebruikt. Log gewoon in met je e-mailadres en wachtwoord."
          : u.verlopen ? "Deze uitnodiging is verlopen. Vraag een nieuwe aan bij je werkgever."
          : "Deze link werkt niet meer.";
        $("#aanmeld-intro").innerHTML =
          '<div class="let"><b>Deze link werkt niet</b>' + esc(reden) + "</div>" +
          '<div class="btn-row" style="margin-top:14px"><button type="button" class="btn btn-g" id="aa-naar-login">Naar het inlogscherm</button></div>';
        $("#aa-naar-login").addEventListener("click", function () {
          $("#scherm-aanmelden").hidden = true;
          $("#scherm-login").hidden = false;
        });
        return;
      }
      $("#aanmeld-intro").innerHTML =
        '<p class="lead">Je bent door <b>' + esc(u.bedrijf || "je werkgever") + "</b> aangemeld voor " +
        "<b>" + esc(u.cursus || "de BHV e-learning") + "</b>.</p>" +
        '<div class="goed" style="margin-top:10px"><b>' + esc(u.email) + "</b>" +
        "Met dit adres log je straks in." +
        (u.deadline ? " Afronden voor " + esc(datumNL(u.deadline)) + "." : "") + "</div>";
      $("#aanmeld-velden").hidden = false;
      $("#aa-voor").value = u.voornaam || "";
      $("#aa-achter").value = u.achternaam || "";
      $("#aa-gb").value = u.geboortedatum || "";
      $("#aa-gb").max = new Date().toISOString().slice(0, 10);
      AANMELD = { token: token, email: u.email };
    });
  }
  var AANMELD = null;

  $("#aanmeld-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!AANMELD) return;
    var knop = $("#aanmeld-knop"), fout = $("#aanmeld-fout");
    fout.hidden = true;
    knop.disabled = true; knop.textContent = "Bezig met aanmaken";

    var mislukt = function (titel, tekst) {
      knop.disabled = false; knop.textContent = "Account aanmaken";
      fout.hidden = false;
      fout.innerHTML = "<b>" + titel + "</b>" + tekst;
    };

    sb.auth.signUp({
      email: AANMELD.email,
      password: $("#aa-pw").value,
      options: {
        data: {
          voornaam: $("#aa-voor").value.trim(),
          achternaam: $("#aa-achter").value.trim(),
          geboortedatum: $("#aa-gb").value
        }
      }
    }).then(function (res) {
      if (res.error) {
        var m = (res.error.message || "").toLowerCase();
        if (m.indexOf("already registered") > -1 || m.indexOf("already been registered") > -1) {
          /* Account bestond al: gewoon inloggen en daarna koppelen. */
          return sb.auth.signInWithPassword({ email: AANMELD.email, password: $("#aa-pw").value })
            .then(function (r2) {
              if (r2.error) {
                mislukt("Dit account bestaat al",
                  "Er is al een account op " + esc(AANMELD.email) + ", maar dit wachtwoord klopt er niet bij. Ga naar het inlogscherm, of vraag een nieuw wachtwoord aan via info@bhvroden.nl.");
                return null;
              }
              return koppelEnStart();
            });
        }
        mislukt("Aanmaken mislukt", esc(res.error.message));
        return null;
      }
      if (!res.data || !res.data.session) {
        mislukt("Nog even bevestigen",
          "Je account is aangemaakt, maar Supabase wacht op een bevestiging per mail. Zet in Supabase onder Authentication de optie Confirm email uit, of bevestig het account daar handmatig.");
        return null;
      }
      return koppelEnStart();
    }).catch(function (err) {
      mislukt("Geen verbinding", esc(err && err.message ? err.message : err));
    });
  });

  function koppelEnStart() {
    return sb.rpc("wissel_uitnodiging_in", { p_token: AANMELD.token }).then(function (r) {
      if (r.error) {
        $("#aanmeld-fout").hidden = false;
        $("#aanmeld-fout").innerHTML = "<b>Koppelen mislukt</b>" + esc(r.error.message);
        $("#aanmeld-knop").disabled = false;
        $("#aanmeld-knop").textContent = "Account aanmaken";
        return;
      }
      history.replaceState(null, "", location.pathname);
      naarApp();
    });
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

  /* =====================================================================
     HUISSTIJL VAN DE KLANT
     De kleuren staan bij de organisatie in de database. Hier worden ze
     op de pagina gezet. Het certificaat blijft hier buiten: dat is en
     blijft van BHV Roden, met hun logo en handtekening.
     ===================================================================== */
  function hex(h, standaard) {
    h = String(h || "").trim();
    return /^#[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : standaard;
  }
  function rgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  /* Hoe licht is deze kleur werkelijk, zoals een oog hem ziet.
     Nodig om te bepalen of er zwarte of witte tekst op moet. */
  function helderheid(h) {
    return rgb(h).map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }).reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function inkt(h) { return helderheid(h) > 0.42 ? "#1C1C1C" : "#FFFFFF"; }
  function meng(h, doel, deel) {
    var a = rgb(h), b = rgb(doel);
    return "#" + a.map(function (v, i) {
      return Math.round(v + (b[i] - v) * deel).toString(16).padStart(2, "0");
    }).join("").toUpperCase();
  }

  function zetHuisstijl(org) {
    var s = document.documentElement.style;
    if (!org || org.is_eigenaar) {
      /* BHV Roden zelf, of onbekend: laat de standaard staan. */
      return;
    }
    var p = hex(org.kleur_primair, "#0F1F3D");
    var a = hex(org.kleur_accent, "#B71C1C");
    var rond = org.ronde_hoeken === false ? "0px" : "50px";

    s.setProperty("--p", p);
    s.setProperty("--p2", helderheid(p) > 0.42 ? meng(p, "#000000", 0.14) : meng(p, "#FFFFFF", 0.14));
    s.setProperty("--p-ink", inkt(p));
    s.setProperty("--a", a);
    s.setProperty("--a2", helderheid(a) > 0.42 ? meng(a, "#000000", 0.18) : meng(a, "#FFFFFF", 0.14));
    s.setProperty("--a-ink", inkt(a));
    s.setProperty("--a-soft", meng(a, "#FFFFFF", 0.88));
    s.setProperty("--tint", meng(p, "#FFFFFF", 0.92));
    s.setProperty("--rad", rond);
    s.setProperty("--radc", org.ronde_hoeken === false ? "0px" : "4px");
    s.setProperty("--waas-rgb", rgb(p).join(","));

    /* Balk bovenin: naam van de klant, en hun logo als dat er is. */
    var balk = document.querySelector(".balk");
    if (balk) {
      var logo = balk.querySelector("img");
      if (org.logo_url) { logo.src = org.logo_url; logo.alt = org.naam || ""; }
      var naam = balk.querySelector(".naam");
      if (naam) naam.innerHTML = esc(org.naam || "") + "<span>Leeromgeving</span>";
    }
    /* Bij een klantomgeving vertellen we er wel bij wie de opleider is.
       De kleuren zijn van de klant, de opleiding is van BHV Roden. */
    var vd = $("#verzorgd-door");
    if (vd) vd.hidden = false;
    document.body.dataset.klant = "ja";
  }

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
        .select("voornaam, achternaam, geboortedatum, rol, email, organisatie_id, " +
                "organisaties(naam, is_eigenaar, kleur_primair, kleur_accent, ronde_hoeken, logo_url)")
        .eq("id", S.gebruiker.id).maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!r.data) throw new Error("geen-profiel");
          S.profiel = r.data;

          var naam = [S.profiel.voornaam, S.profiel.achternaam].filter(Boolean).join(" ");
          var org = S.profiel.organisaties ? S.profiel.organisaties.naam : "";
          $("#wie").innerHTML = esc(naam || S.profiel.email) + "<span>" + esc(org) + "</span>";
          zetHuisstijl(S.profiel.organisaties);
          $("#nav-beheer").hidden = (S.profiel.rol !== "beheerder" && S.profiel.rol !== "contactpersoon");

          /* Een contactpersoon volgt zelf geen cursus, die gaat direct naar het beheer. */
          if (S.profiel.rol === "contactpersoon") { naarBeheer("deelnemers"); return null; }

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
     BEHEER
     Alles wat hier gebeurt wordt door de database nog eens gecontroleerd.
     Een contactpersoon die deze schermen zou forceren krijgt gewoon
     lege lijsten terug, want ziet_organisatie() beslist, niet de knop.
     ===================================================================== */
  var B = { tab: "overzicht", organisaties: null, cursussen: null, deelnemers: null, laatsteLinks: null };

  var ALLEEN_BEHEER = { uitnodigen: 1, bedrijven: 1, controle: 1 };

  function naarBeheer(tab) {
    if (ALLEEN_BEHEER[tab] && S.profiel.rol !== "beheerder") tab = "deelnemers";
    B.tab = tab;
    toon("view-beheer");
    $("#nav-overzicht").hidden = S.profiel.rol === "contactpersoon";
    $("#beheer-tabs").querySelectorAll("button").forEach(function (b) {
      var mag = !(ALLEEN_BEHEER[b.dataset.tab] && S.profiel.rol !== "beheerder");
      b.hidden = !mag;
      b.setAttribute("aria-current", b.dataset.tab === tab ? "true" : "false");
    });
    $("#beheer-paneel").innerHTML = '<div class="laden"><span class="tol"></span>Bezig met ophalen</div>';

    basisgegevens().then(function () {
      if (tab === "overzicht")         return tekenOverzicht();
      if (tab === "deelnemers")        return tekenDeelnemers();
      if (tab === "uitnodigen")        return tekenUitnodigen();
      if (tab === "bedrijven")         return tekenBedrijven();
      if (tab === "certificaten")      return tekenCertificaten();
      if (tab === "controle")          return tekenControle();
    }).catch(function (e) {
      $("#beheer-paneel").innerHTML =
        '<div class="let"><b>Er ging iets mis</b>' + esc(e && e.message ? e.message : e) +
        ". Staat stap 10 nog niet in Supabase, draai dan <b>07_beheer.sql</b>.</div>";
    });
  }

  function basisgegevens() {
    if (B.organisaties && B.cursussen) return Promise.resolve();
    return Promise.all([
      sb.from("organisaties").select("id, naam, slug, is_eigenaar, kleur_primair, kleur_accent, ronde_hoeken, logo_url, contactpersoon_naam, contactpersoon_email, actief, aangemaakt_op").order("naam"),
      sb.from("cursussen").select("id, titel, organisatie_id, actief").eq("actief", true).order("titel")
    ]).then(function (r) {
      r.forEach(function (x) { if (x.error) throw x.error; });
      B.organisaties = r[0].data || [];
      B.cursussen = r[1].data || [];
    });
  }

  function haalDeelnemers(org) {
    return sb.rpc("deelnemers", { p_org: org || null }).then(function (r) {
      if (r.error) throw r.error;
      B.deelnemers = r.data || [];
      return B.deelnemers;
    });
  }

  function orgNaam(id) {
    var o = (B.organisaties || []).find(function (x) { return x.id === id; });
    return o ? o.naam : "";
  }

  /* ---------- overzicht ---------- */
  function tekenOverzicht() {
    return Promise.all([
      haalDeelnemers(null),
      sb.from("certificaten").select("id, nummer, geldig_tot", { count: "exact" }).is("ingetrokken_op", null),
      sb.from("uitnodigingen").select("id", { count: "exact", head: true }).is("gebruikt_op", null)
    ]).then(function (r) {
      var d = B.deelnemers;
      var certs = r[1].data || [];
      var openUit = r[2].count || 0;
      var vandaag = new Date().toISOString().slice(0, 10);
      var verloopt = certs.filter(function (c) {
        return c.geldig_tot && c.geldig_tot > vandaag &&
               (new Date(c.geldig_tot) - new Date()) / 86400000 < 60;
      }).length;

      var bezig = d.filter(function (x) { return x.status === "bezig"; }).length;
      var klaar = d.filter(function (x) { return x.status === "geslaagd"; }).length;
      var nietBegonnen = d.filter(function (x) { return !x.inschrijving_id || x.lessen_af === 0; }).length;
      var bedrijven = (B.organisaties || []).filter(function (o) { return !o.is_eigenaar; }).length;

      var uit = '<div class="kop"><h1>Beheer<em>overzicht</em></h1>' +
        "<p>De stand van zaken over alle bedrijven heen.</p></div>";

      uit += '<div class="tegels">' +
        tegel(bedrijven, "Klantbedrijven", "naast BHV Roden zelf") +
        tegel(d.length, "Deelnemers", "met een account") +
        tegel(bezig, "Bezig", "onderweg in de cursus", "acc") +
        tegel(klaar, "Geslaagd", "theorie afgerond", "ok") +
        tegel(openUit, "Uitnodigingen open", "nog niet gebruikt") +
        tegel(certs.length, "Certificaten", verloopt ? verloopt + " verlopen binnen 60 dagen" : "geldig") +
        "</div>";

      if (nietBegonnen) {
        uit += '<div class="let"><b>' + nietBegonnen + " deelnemer" + (nietBegonnen === 1 ? "" : "s") +
          " nog niet begonnen</b>Zij hebben wel een account maar nog geen les afgerond. " +
          "Zodra de mailkoppeling aanstaat krijgen ze hier vanzelf een herinnering over.</div>";
      }

      uit += '<div class="paneel" style="margin-top:22px"><div class="paneel-kop"><h2>Per bedrijf</h2></div>';
      var perOrg = {};
      d.forEach(function (x) {
        var o = perOrg[x.organisatie_id] = perOrg[x.organisatie_id] || { naam: x.organisatie, n: 0, klaar: 0 };
        o.n++; if (x.status === "geslaagd") o.klaar++;
      });
      var rijen = Object.keys(perOrg);
      if (!rijen.length) {
        uit += '<div class="leeg">Er staan nog geen deelnemers in. Ga naar Uitnodigen om te beginnen.</div>';
      } else {
        uit += '<div class="tabel-scroll" style="border:0;box-shadow:none"><table><thead><tr>' +
          "<th>Bedrijf</th><th>Deelnemers</th><th>Geslaagd</th><th>Voortgang</th></tr></thead><tbody>";
        rijen.forEach(function (k) {
          var o = perOrg[k];
          var pct = o.n ? Math.round(o.klaar * 100 / o.n) : 0;
          uit += "<tr><td class=\"nm\">" + esc(o.naam) + "</td><td class=\"num\">" + o.n +
            "</td><td class=\"num\">" + o.klaar + '</td><td><span class="bar"><span style="width:' +
            pct + '%"></span></span></td></tr>';
        });
        uit += "</tbody></table></div>";
      }
      uit += "</div>";

      $("#beheer-paneel").innerHTML = uit;
    });
  }
  function tegel(v, k, s, kl) {
    return '<div class="tegel' + (kl ? " " + kl : "") + '"><span class="k">' + esc(k) +
      '</span><span class="v">' + v + '</span><span class="s">' + esc(s || "") + "</span></div>";
  }

  /* ---------- deelnemers ---------- */
  function tekenDeelnemers(org) {
    return haalDeelnemers(org).then(function (d) {
      var beheerder = S.profiel.rol === "beheerder";
      var uit = '<div class="kop"><h1>Deel<em>nemers</em></h1>' +
        "<p>" + (beheerder ? "Iedereen die een account heeft, over alle bedrijven heen."
                           : "De deelnemers van jouw organisatie.") + "</p></div>";

      if (beheerder) {
        uit += '<div class="knoppenrij"><select class="kies" id="d-org"><option value="">Alle bedrijven</option>' +
          B.organisaties.map(function (o) {
            return '<option value="' + o.id + '"' + (o.id === org ? " selected" : "") + ">" + esc(o.naam) + "</option>";
          }).join("") + "</select>" +
          '<button type="button" class="btn btn-g btn-sm" id="d-ververs">Verversen</button></div>';
      }

      if (!d.length) {
        uit += '<div class="tabel-scroll"><div class="leeg">Nog geen deelnemers.' +
          (beheerder ? " Ga naar Uitnodigen om er toe te voegen." : "") + "</div></div>";
      } else {
        uit += '<div class="tabel-scroll"><table><thead><tr>' +
          "<th>Naam</th>" + (beheerder ? "<th>Bedrijf</th>" : "") +
          "<th>Status</th><th>Voortgang</th><th>Examen</th><th>Certificaat</th><th>Geldig tot</th>" +
          "</tr></thead><tbody>";
        d.forEach(function (x) {
          var naam = [x.voornaam, x.achternaam].filter(Boolean).join(" ") || x.email;
          var tot = x.lessen_totaal || 0, af = x.lessen_af || 0;
          var pct = tot ? Math.round(af * 100 / tot) : 0;
          uit += "<tr>" +
            '<td class="nm">' + esc(naam) + "<br><span style=\"font-weight:400;color:var(--muted);font-size:12px\">" + esc(x.email) + "</span></td>" +
            (beheerder ? "<td>" + esc(x.organisatie || "") + "</td>" : "") +
            "<td>" + statusChip(x) + "</td>" +
            '<td><span class="bar"><span style="width:' + pct + '%"></span></span>' +
            '<span style="font-size:11.5px;color:var(--muted)">' + af + " van " + tot + "</span></td>" +
            '<td class="num">' + (x.examen_score != null ? x.examen_score + "%" : "") + "</td>" +
            '<td class="num">' + esc(x.certificaat || "") + "</td>" +
            '<td class="num">' + esc(datumNL(x.geldig_tot)) + "</td></tr>";
        });
        uit += "</tbody></table></div>";
      }
      $("#beheer-paneel").innerHTML = uit;
      var kies = $("#d-org");
      if (kies) {
        kies.addEventListener("change", function () { tekenDeelnemers(kies.value || null); });
        $("#d-ververs").addEventListener("click", function () { B.deelnemers = null; tekenDeelnemers(kies.value || null); });
      }
    });
  }
  function statusChip(x) {
    if (!x.inschrijving_id) return '<span class="chip nieuw">Uitgenodigd</span>';
    if (x.status === "geslaagd") return '<span class="chip af">Geslaagd</span>';
    if (x.status === "gezakt") return '<span class="chip mis">Gezakt</span>';
    if (x.lessen_af > 0) return '<span class="chip bezig">Bezig</span>';
    return '<span class="chip nieuw">Nog niet begonnen</span>';
  }

  /* ---------- uitnodigen ---------- */
  function tekenUitnodigen() {
    var uit = '<div class="kop"><h1>Deelnemers <em>uitnodigen</em></h1>' +
      "<p>Plak hier de lijst van je klant. Eén persoon per regel. Het e-mailadres is het enige dat verplicht is.</p></div>";

    uit += '<div class="split"><div class="blok">' +
      '<div class="veld"><label for="u-org">Bedrijf</label><select class="kies" id="u-org">' +
      B.organisaties.map(function (o) { return '<option value="' + o.id + '">' + esc(o.naam) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="veld"><label for="u-cursus">Cursus</label><select class="kies" id="u-cursus">' +
      B.cursussen.map(function (c) { return '<option value="' + c.id + '">' + esc(c.titel) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="veld"><label for="u-deadline">Afronden voor (mag leeg)</label>' +
      '<input class="kies" id="u-deadline" type="date"></div>' +
      '<div class="veld"><label for="u-plak">De lijst</label>' +
      '<textarea class="plak" id="u-plak" spellcheck="false" placeholder="jan@bedrijf.nl; Jan; de Boer\nmarie@bedrijf.nl, Marie, Visser\npiet@bedrijf.nl"></textarea>' +
      '<span class="hint">Scheiden met een puntkomma, komma of tab. Kopieren uit Excel werkt ook.</span></div>' +
      '<div class="fout" id="u-fout" hidden></div>' +
      '<div class="btn-row"><button type="button" class="btn btn-a" id="u-versturen">Uitnodigingen aanmaken</button>' +
      '<span class="lead" id="u-stand"></span></div>' +
      "</div>" +
      '<div class="blok" id="u-uitkomst"><div class="blok-kop"><h3>Wat er gebeurt</h3></div>' +
      '<p class="lead">Voor elke persoon wordt een uitnodiging met een eigen link aangemaakt, dertig dagen geldig. ' +
      "De mail gaat pas automatisch de deur uit als de mailkoppeling aanstaat. Tot die tijd krijg je hier de links te zien " +
      "en kun je ze zelf versturen of doorgeven aan de contactpersoon.</p></div></div>";

    $("#beheer-paneel").innerHTML = uit;
    $("#u-versturen").addEventListener("click", verstuurUitnodigingen);
    return Promise.resolve();
  }

  function leesLijst(tekst) {
    var mensen = [], fout = [];
    tekst.split(/\r?\n/).forEach(function (regel) {
      var r = regel.trim();
      if (!r) return;
      var delen = r.split(/[;,\t]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var mail = delen.find(function (x) { return x.indexOf("@") > 0; });
      if (!mail) { fout.push(r); return; }
      var rest = delen.filter(function (x) { return x !== mail; });
      mensen.push({ email: mail.toLowerCase(), voornaam: rest[0] || null, achternaam: rest.slice(1).join(" ") || null });
    });
    return { mensen: mensen, fout: fout };
  }

  function verstuurUitnodigingen() {
    var knop = $("#u-versturen"), fout = $("#u-fout");
    fout.hidden = true;
    var lijst = leesLijst($("#u-plak").value);
    if (!lijst.mensen.length) {
      fout.hidden = false;
      fout.innerHTML = "<b>Geen e-mailadressen gevonden</b>Zet op elke regel minstens een e-mailadres.";
      return;
    }
    if (lijst.fout.length) {
      fout.hidden = false;
      fout.innerHTML = "<b>" + lijst.fout.length + " regel" + (lijst.fout.length === 1 ? "" : "s") +
        " zonder e-mailadres</b>Die sla ik over: " + esc(lijst.fout.slice(0, 3).join(" / ")) +
        (lijst.fout.length > 3 ? " en meer" : "");
    }
    knop.disabled = true; knop.textContent = "Bezig";
    $("#u-stand").textContent = lijst.mensen.length + " regels verwerken";

    sb.rpc("nodig_uit", {
      p_organisatie: $("#u-org").value,
      p_cursus: $("#u-cursus").value,
      p_mensen: lijst.mensen,
      p_deadline: $("#u-deadline").value || null
    }).then(function (r) {
      knop.disabled = false; knop.textContent = "Uitnodigingen aanmaken";
      $("#u-stand").textContent = "";
      if (r.error) {
        fout.hidden = false;
        fout.innerHTML = "<b>Aanmaken mislukt</b>" + esc(r.error.message);
        return;
      }
      B.deelnemers = null;
      toonLinks(r.data);
    });
  }

  function toonLinks(u) {
    var basis = location.origin + location.pathname;
    var regels = (u.regels || []).filter(function (x) { return x.token; });
    var uit = '<div class="blok-kop"><h3>Klaar</h3></div>' +
      '<div class="goed"><b>' + u.nieuw + " nieuw, " + u.bestond + " bijgewerkt, " + u.overgeslagen + " overgeslagen</b>" +
      "Overgeslagen betekent dat die persoon al voor deze cursus staat ingeschreven.</div>";

    if (regels.length) {
      var alleLinks = regels.map(function (x) {
        return x.email + "\t" + basis + "?token=" + x.token;
      }).join("\n");

      uit += '<div class="link-lijst">' + regels.map(function (x) {
          var link = basis + "?token=" + encodeURIComponent(x.token);
          return '<div class="link-rij"><span class="wie">' + esc(x.email) + "</span>" +
            '<a class="adres" href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(link) + "</a>" +
            '<button type="button" class="mini" data-link="' + esc(link) + '">Kopieer</button></div>';
        }).join("") + "</div>" +
        '<div class="veld" style="margin-top:6px">' +
        '<label for="u-alles">Alle links bij elkaar</label>' +
        '<textarea class="plak" id="u-alles" readonly rows="4" spellcheck="false">' + esc(alleLinks) + "</textarea>" +
        '<span class="hint">Werkt de kopieerknop niet, klik dan in dit vak. Alles wordt dan geselecteerd en je drukt op Cmd+C.</span></div>' +
        '<div class="btn-row"><button type="button" class="btn btn-g btn-sm" id="u-kopieer-alles">Alle links kopieren</button></div>' +
        '<div class="let"><b>Bewaar deze links goed.</b> Wie de link heeft kan het account aanmaken, ' +
        "al werkt hij alleen voor het e-mailadres waar hij bij hoort. Zodra de mailkoppeling aanstaat " +
        "gaan deze links vanzelf de deur uit en hoef je hier niets meer mee te doen.</div>";
    }

    $("#u-uitkomst").innerHTML = uit;
    $("#u-uitkomst").querySelectorAll("[data-link]").forEach(function (b) {
      b.addEventListener("click", function () { kopieer(b.dataset.link, b); });
    });
    var veld = $("#u-alles");
    if (veld) veld.addEventListener("focus", function () { veld.select(); });
    var alles = $("#u-kopieer-alles");
    if (alles) alles.addEventListener("click", function () {
      kopieer(regels.map(function (x) { return x.email + "\t" + basis + "?token=" + x.token; }).join("\n"), alles);
    });
  }

  /* ---------- bedrijven ---------- */
  function tekenBedrijven() {
    var uit = '<div class="kop"><h1>Klant<em>bedrijven</em></h1>' +
      "<p>Elk bedrijf krijgt een eigen omgeving in zijn eigen huisstijl. De cursus blijft dezelfde, het certificaat blijft van BHV Roden.</p></div>";

    uit += '<div class="split"><div class="blok"><div class="blok-kop"><h3>Nieuw bedrijf</h3></div>' +
      '<div class="veld"><label for="b-naam">Bedrijfsnaam</label><input class="kies" id="b-naam" type="text" placeholder="Gemeente Westerkwartier"></div>' +
      '<div class="veld-rij">' +
      '<div class="veld"><label for="b-contact">Contactpersoon</label><input class="kies" id="b-contact" type="text" placeholder="Sharon Oosterhuis"></div>' +
      '<div class="veld"><label for="b-mail">E-mailadres contactpersoon</label><input class="kies" id="b-mail" type="email" placeholder="naam@bedrijf.nl"></div>' +
      "</div>" +
      '<div class="veld-rij">' +
      '<div class="veld"><label for="b-p">Hoofdkleur</label><div class="kleurveld">' +
      '<input type="color" id="b-p" value="#0F1F3D"><input class="kies" type="text" id="b-pt" value="#0F1F3D"></div></div>' +
      '<div class="veld"><label for="b-a">Accentkleur</label><div class="kleurveld">' +
      '<input type="color" id="b-a" value="#B71C1C"><input class="kies" type="text" id="b-at" value="#B71C1C"></div></div>' +
      "</div>" +
      '<div class="veld"><label for="b-logo">Adres van het logo (mag leeg)</label><input class="kies" id="b-logo" type="url" placeholder="https://..."></div>' +
      '<div class="veld"><label><input type="checkbox" id="b-rond" checked style="width:auto;margin-right:8px">Ronde knoppen</label>' +
      '<span class="hint">Uit betekent rechte hoeken, zoals bij Westerkwartier.</span></div>' +
      '<div class="fout" id="b-fout" hidden></div>' +
      '<div class="btn-row"><button type="button" class="btn btn-a" id="b-maak">Bedrijf aanmaken</button></div></div>' +
      '<div class="blok"><div class="blok-kop"><h3>Zo ziet het eruit</h3></div><div id="b-voorbeeld"></div></div></div>';

    uit += '<div class="paneel" style="margin-top:24px"><div class="paneel-kop"><h2>Bestaande bedrijven</h2></div>' +
      '<div class="tabel-scroll" style="border:0;box-shadow:none"><table><thead><tr>' +
      "<th>Bedrijf</th><th>Webadres</th><th>Contactpersoon</th><th>Huisstijl</th></tr></thead><tbody>" +
      B.organisaties.map(function (o) {
        return "<tr><td class=\"nm\">" + esc(o.naam) + (o.is_eigenaar ? ' <span class="chip nieuw">eigen</span>' : "") + "</td>" +
          '<td class="num" style="font-size:12px;color:var(--muted)">' + esc(o.slug) + ".bhvrodenelearning.nl</td>" +
          "<td>" + esc(o.contactpersoon_naam || "") + (o.contactpersoon_email ? "<br><span style=\"font-size:12px;color:var(--muted)\">" + esc(o.contactpersoon_email) + "</span>" : "") + "</td>" +
          '<td><span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:' + esc(o.kleur_primair) + ';vertical-align:middle"></span>' +
          '<span style="display:inline-block;width:18px;height:18px;border-radius:3px;margin-left:5px;background:' + esc(o.kleur_accent) + ';vertical-align:middle"></span></td></tr>';
      }).join("") + "</tbody></table></div></div>";

    $("#beheer-paneel").innerHTML = uit;

    ["b-naam", "b-contact", "b-p", "b-pt", "b-a", "b-at", "b-rond"].forEach(function (id) {
      $("#" + id).addEventListener("input", tekenVoorbeeld);
      $("#" + id).addEventListener("change", tekenVoorbeeld);
    });
    koppelKleur("b-p", "b-pt"); koppelKleur("b-a", "b-at");
    $("#b-maak").addEventListener("click", maakBedrijf);
    tekenVoorbeeld();
    return Promise.resolve();
  }

  function koppelKleur(kleurId, tekstId) {
    var k = $("#" + kleurId), t = $("#" + tekstId);
    k.addEventListener("input", function () { t.value = k.value.toUpperCase(); tekenVoorbeeld(); });
    t.addEventListener("input", function () {
      if (/^#[0-9a-f]{6}$/i.test(t.value)) { k.value = t.value; tekenVoorbeeld(); }
    });
  }

  function tekenVoorbeeld() {
    var naam = $("#b-naam").value.trim() || "Naam van het bedrijf";
    var p = $("#b-p").value, a = $("#b-a").value;
    var rond = $("#b-rond").checked ? "50px" : "0";
    $("#b-voorbeeld").innerHTML =
      '<div class="voorbeeld"><div class="vb-balk" style="background:' + esc(p) + '">' +
      '<span style="width:30px;height:30px;border-radius:3px;background:#fff;display:inline-block"></span>' +
      '<span class="vb-naam">' + esc(naam) + "<br><span style=\"font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;opacity:.6\">Leeromgeving</span></span></div>" +
      '<div class="vb-body"><span style="font-family:var(--fh);font-weight:700;font-size:15px">Module 1, eerste hulp</span>' +
      '<span class="bar"><span style="width:45%;background:' + esc(a) + '"></span></span>' +
      '<span class="vb-knop" style="background:' + esc(a) + ";border-radius:" + rond + '">Verder gaan</span></div></div>' +
      '<p class="lead" style="margin-top:12px">Het certificaat blijft altijd in de stijl van BHV Roden, met jullie logo en handtekening. ' +
      "Deze kleuren gelden alleen voor de leeromgeving van dit bedrijf.</p>";
  }

  function maakBedrijf() {
    var knop = $("#b-maak"), fout = $("#b-fout");
    fout.hidden = true;
    var naam = $("#b-naam").value.trim();
    if (naam.length < 2) {
      fout.hidden = false;
      fout.innerHTML = "<b>Vul een bedrijfsnaam in</b>Die wordt ook gebruikt voor het webadres.";
      return;
    }
    knop.disabled = true; knop.textContent = "Bezig";
    sb.rpc("nieuw_bedrijf", {
      p_naam: naam,
      p_slug: "",
      p_contact_naam: $("#b-contact").value.trim() || null,
      p_contact_email: $("#b-mail").value.trim() || null,
      p_kleur_primair: $("#b-p").value.toUpperCase(),
      p_kleur_accent: $("#b-a").value.toUpperCase(),
      p_ronde_hoeken: $("#b-rond").checked,
      p_logo_url: $("#b-logo").value.trim() || null
    }).then(function (r) {
      knop.disabled = false; knop.textContent = "Bedrijf aanmaken";
      if (r.error) {
        fout.hidden = false;
        fout.innerHTML = "<b>Aanmaken mislukt</b>" + esc(r.error.message);
        return;
      }
      B.organisaties = null; B.deelnemers = null;
      toast(naam + " staat erin");
      naarBeheer("bedrijven");
    });
  }

  /* ---------- certificaten ---------- */
  function tekenCertificaten() {
    return sb.from("certificaten")
      .select("nummer, naam_op_certificaat, geboortedatum, cursus_titel, score, behaald_op, geldig_tot, organisatie_id, ingetrokken_op")
      .order("behaald_op", { ascending: false })
      .then(function (r) {
        if (r.error) throw r.error;
        var c = (r.data || []).filter(function (x) { return !x.ingetrokken_op; });
        var vandaag = new Date().toISOString().slice(0, 10);

        var uit = '<div class="kop"><h1>Certi<em>ficaten</em></h1>' +
          "<p>Elk certificaat krijgt een oplopend nummer en is een jaar geldig. Ze worden automatisch aangemaakt zodra iemand het examen haalt.</p></div>";

        if (!c.length) {
          uit += '<div class="tabel-scroll"><div class="leeg">Nog geen certificaten. Ze verschijnen hier zodra de eerste deelnemer slaagt.</div></div>';
        } else {
          var verlopen = c.filter(function (x) { return x.geldig_tot <= vandaag; }).length;
          uit += '<div class="tegels">' +
            tegel(c.length, "Uitgegeven", "in totaal") +
            tegel(c.length - verlopen, "Geldig", "vandaag", "ok") +
            tegel(verlopen, "Verlopen", "moeten op herhaling") +
            "</div>";
          uit += '<div class="tabel-scroll"><table><thead><tr>' +
            "<th>Nummer</th><th>Naam</th><th>Geboren</th><th>Bedrijf</th><th>Score</th><th>Behaald</th><th>Geldig tot</th>" +
            "</tr></thead><tbody>" +
            c.map(function (x) {
              var oud = x.geldig_tot <= vandaag;
              return "<tr>" +
                '<td class="num nm">' + esc(x.nummer) + "</td>" +
                '<td class="nm">' + esc(x.naam_op_certificaat) + "</td>" +
                '<td class="num">' + esc(datumNL(x.geboortedatum)) + "</td>" +
                "<td>" + esc(orgNaam(x.organisatie_id)) + "</td>" +
                '<td class="num">' + (x.score != null ? x.score + "%" : "") + "</td>" +
                '<td class="num">' + esc(datumNL(x.behaald_op)) + "</td>" +
                '<td class="num">' + esc(datumNL(x.geldig_tot)) +
                (oud ? ' <span class="chip mis">verlopen</span>' : "") + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        }

        uit += '<div class="let" style="margin-top:20px"><b>Het bestand zelf komt nog.</b> ' +
          "De regels hierboven zijn echt en de nummers liggen vast. Het opmaken van de PDF en het automatisch mailen " +
          "doen we in de volgende stap, samen met de maildienst.</div>";

        $("#beheer-paneel").innerHTML = uit;
      });
  }

  /* ---------- systeemcontrole ---------- */
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

  function tekenControle() {
    $("#beheer-paneel").innerHTML =
      '<div class="kop"><h1>Systeem<em>controle</em></h1>' +
      "<p>Deze pagina praat rechtstreeks met de database en laat zien of alles klaarstaat.</p></div>" +
      '<div class="paneel"><div class="paneel-kop"><h2>Jouw account</h2></div>' +
      '<div class="paneel-body" id="c-account"></div></div>' +
      '<div class="paneel"><div class="paneel-kop"><h2>Wat er in de database staat</h2>' +
      '<button type="button" class="btn btn-g btn-sm" id="c-opnieuw">Opnieuw controleren</button></div>' +
      '<div class="paneel-body" id="c-inhoud"></div></div><div id="c-uitslag"></div>';
    $("#c-opnieuw").addEventListener("click", controleer);
    return controleer();
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

    return Promise.all([
      sb.from("cursussen").select("titel, in_ontwikkeling, aantal_examenvragen, slaagcriterium").limit(5),
      tel("modules"), tel("lessen"),
      tel("vragen", function (v) { return v.eq("soort", "evaluatie"); }),
      tel("vragen", function (v) { return v.eq("soort", "toets"); }),
      tel("vragen", function (v) { return v.eq("soort", "examen"); }),
      tel("organisaties"),
      sb.rpc("start_toets", { p_inschrijving: "00000000-0000-0000-0000-000000000000", p_soort: "examen" }),
      sb.rpc("bekijk_uitnodiging", { p_token: "controle-bestaat-niet" })
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

      if (r[6].fout) { alles = false; uit += regel(false, "Organisaties", esc(r[6].fout.message)); }
      else uit += regel(r[6].n >= 1, "Organisaties", r[6].n >= 1 ? "BHV Roden staat erin, plus je klanten."
        : "BHV Roden hoort er standaard in te staan. Draai 01_schema.sql opnieuw.", r[6].n);

      var mistToets = r[7].error && /does not exist|not find the function|schema cache/i.test(r[7].error.message || "");
      if (mistToets) alles = false;
      uit += regel(!mistToets, "Functies voor toetsen",
        mistToets ? "start_toets ontbreekt. Draai 06_cursist.sql, stap 9."
                  : "start_toets, lever_in en schrijf_mij_in staan klaar.");

      var mistBeheer = r[8].error && /does not exist|not find the function|schema cache/i.test(r[8].error.message || "");
      if (mistBeheer) alles = false;
      uit += regel(!mistBeheer, "Functies voor beheer en uitnodigingen",
        mistBeheer ? "bekijk_uitnodiging ontbreekt. Draai 07_beheer.sql, stap 10. Daar zit ook een beveiligingsfout in dicht."
                   : "Uitnodigen, inwisselen en de deelnemerslijst staan klaar.");

      $("#c-inhoud").innerHTML = uit;
      $("#c-uitslag").innerHTML = alles
        ? '<div class="goed"><b>Alles staat goed.</b> De database, de toegangsregels en de cursusinhoud werken.</div>'
        : '<div class="let"><b>Er ontbreekt nog iets.</b> Hierboven staat bij elke rode regel welk bestand je nog moet draaien.</div>';
    });
  }
})();
