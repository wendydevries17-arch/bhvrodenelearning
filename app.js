/* =====================================================================
   BHV Roden leeromgeving
   Eerste echte pagina: inloggen op Supabase en controleren of de
   database goed staat. Hierop bouwen we de rest van de cursus.
   ===================================================================== */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  var VINK_JA  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg>';
  var VINK_NEE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  /* ---------- controle vooraf ---------- */
  var cfg = window.CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || cfg.supabaseUrl.indexOf("http") !== 0) {
    toonStartfout(
      "Instellingen ontbreken",
      "In het bestand config.js staan de Project URL en de anon key nog niet goed ingevuld."
    );
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    toonStartfout(
      "Supabase kon niet geladen worden",
      "De bibliotheek van Supabase is niet binnengekomen. Controleer je internetverbinding, of een adblocker die cdn.jsdelivr.net blokkeert."
    );
    return;
  }

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  function toonStartfout(titel, tekst) {
    var doel = $("#login-fout");
    if (!doel) return;
    doel.hidden = false;
    doel.innerHTML = "<b>" + titel + "</b>" + tekst;
    var knop = $("#login-knop");
    if (knop) knop.disabled = true;
  }

  /* ---------- inloggen ---------- */
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
      fout.innerHTML = "<b>Geen verbinding</b>De leeromgeving kon Supabase niet bereiken. Controleer het adres in config.js. Melding: " + (err && err.message ? err.message : err);
    });
  });

  function foutTitel(e) {
    var m = (e.message || "").toLowerCase();
    if (m.indexOf("invalid login") > -1) return "Inloggen mislukt";
    if (m.indexOf("email not confirmed") > -1) return "Account nog niet bevestigd";
    if (m.indexOf("failed to fetch") > -1) return "Geen verbinding";
    return "Er ging iets mis";
  }
  function foutUitleg(e) {
    var m = (e.message || "").toLowerCase();
    if (m.indexOf("invalid login") > -1)
      return "Het e-mailadres of het wachtwoord klopt niet. Let op dat het account in Supabase onder Authentication moet bestaan.";
    if (m.indexOf("email not confirmed") > -1)
      return "Dit account is aangemaakt zonder Auto Confirm User. Zet dat aan in Supabase onder Authentication, of bevestig het account daar handmatig.";
    if (m.indexOf("failed to fetch") > -1)
      return "De leeromgeving kon Supabase niet bereiken. Controleer de Project URL in config.js.";
    return e.message || "Onbekende melding.";
  }

  $("#uitloggen").addEventListener("click", function () {
    sb.auth.signOut().then(function () { location.reload(); });
  });
  $("#opnieuw").addEventListener("click", function () { controleer(); });

  /* ---------- na het inloggen ---------- */
  function naarApp() {
    $("#scherm-login").hidden = true;
    $("#scherm-app").hidden = false;
    controleer();
  }

  sb.auth.getSession().then(function (res) {
    if (res.data && res.data.session) naarApp();
  });

  function regel(ok, titel, uitleg, waarde) {
    var klasse = ok === null ? "bezig" : (ok ? "ja" : "nee");
    var teken  = ok === null ? "" : (ok ? VINK_JA : VINK_NEE);
    return '<div class="regel' + (ok === false ? " mis" : "") + '">' +
             '<span class="vink ' + klasse + '">' + teken + "</span>" +
             '<span class="tekst"><b>' + titel + "</b><span>" + uitleg + "</span></span>" +
             (waarde != null ? '<span class="waarde">' + waarde + "</span>" : "") +
           "</div>";
  }

  function tel(tabel, filter) {
    var v = sb.from(tabel).select("id", { count: "exact", head: true });
    if (filter) v = filter(v);
    return v.then(function (r) { return r.error ? { fout: r.error } : { n: r.count }; });
  }

  function controleer() {
    $("#account").innerHTML = '<div class="laden"><span class="tol"></span>Bezig met ophalen</div>';
    $("#inhoud").innerHTML  = '<div class="laden"><span class="tol"></span>Bezig met ophalen</div>';
    $("#uitslag").innerHTML = "";

    sb.auth.getUser().then(function (u) {
      var gebruiker = u.data ? u.data.user : null;
      if (!gebruiker) { location.reload(); return; }

      sb.from("profielen")
        .select("voornaam, achternaam, geboortedatum, rol, email, organisaties(naam)")
        .eq("id", gebruiker.id)
        .maybeSingle()
        .then(function (r) {
          var p = r.data;
          var uit = "";

          if (r.error) {
            uit += regel(false, "Profiel ophalen mislukt",
              "Melding van de database: " + r.error.message + ". Meestal betekent dit dat bestand 02_beveiliging.sql nog niet gedraaid is.");
          } else if (!p) {
            uit += regel(false, "Geen profiel gevonden",
              "Je kunt wel inloggen, maar er staat geen profiel bij dit account. Draai 03_gebruikers.sql in Supabase.");
          } else {
            var naam = [p.voornaam, p.achternaam].filter(Boolean).join(" ") || "(naam nog niet ingevuld)";
            var org  = p.organisaties ? p.organisaties.naam : null;
            uit += regel(true, naam, p.email);
            uit += regel(p.rol === "beheerder", "Rol: " + p.rol,
                    p.rol === "beheerder"
                      ? "Je mag alles zien en beheren."
                      : "Voor het beheer moet dit beheerder zijn. Draai 03_gebruikers.sql opnieuw.");
            uit += regel(!!org, "Organisatie: " + (org || "geen"),
                    org ? "Gekoppeld aan de juiste organisatie."
                        : "Nog niet gekoppeld. Draai 03_gebruikers.sql.");
            uit += regel(p.geboortedatum ? true : null, "Geboortedatum",
                    p.geboortedatum
                      ? "Staat klaar voor op het certificaat."
                      : "Nog leeg. Dat hoort zo, die vul je straks in de leeromgeving zelf in. Hij komt op je certificaat.",
                    p.geboortedatum || "nog leeg");
            $("#wie").innerHTML = naam + "<span>" + (org || "") + "</span>";
          }
          $("#account").innerHTML = uit;
        });

      Promise.all([
        sb.from("cursussen").select("titel, in_ontwikkeling, aantal_examenvragen, slaagcriterium").limit(5),
        tel("modules"),
        tel("lessen"),
        tel("vragen", function (v) { return v.eq("soort", "evaluatie"); }),
        tel("vragen", function (v) { return v.eq("soort", "toets"); }),
        tel("vragen", function (v) { return v.eq("soort", "examen"); }),
        tel("organisaties")
      ]).then(function (r) {
        var cursus = r[0], mod = r[1], les = r[2], ev = r[3], toets = r[4], ex = r[5], org = r[6];
        var uit = "", alles = true;

        if (cursus.error) {
          uit += regel(false, "Cursussen ophalen mislukt", "Melding: " + cursus.error.message);
          alles = false;
        } else {
          var c = cursus.data[0];
          var heeft = cursus.data.length > 0;
          if (!heeft) alles = false;
          uit += regel(heeft, "Cursus gevonden",
                  heeft ? c.titel + ", slaagcriterium " + c.slaagcriterium + " procent, " + c.aantal_examenvragen + " examenvragen"
                        : "Er staat nog geen cursus in. Draai 04_cursusinhoud.sql.",
                  cursus.data.length);
          if (heeft && c.in_ontwikkeling) {
            uit += regel(null, "Cursus staat op in ontwikkeling",
              "De leeromgeving toont dan bovenaan dat de inhoud nog wordt nagekeken. Zet dat uit zodra een instructeur de teksten heeft gecontroleerd.");
          }
        }

        function controle(res, titel, verwacht, hulp) {
          if (res.fout) { alles = false; return regel(false, titel, "Melding: " + res.fout.message); }
          var ok = res.n === verwacht;
          if (!ok) alles = false;
          return regel(ok, titel,
            ok ? "Klopt met wat erin hoort te staan." : "Verwacht " + verwacht + ", gevonden " + res.n + ". " + hulp,
            res.n);
        }

        uit += controle(mod,   "Modules",          4,  "Draai 04_cursusinhoud.sql opnieuw.");
        uit += controle(les,   "Lessen",           13, "Draai 04_cursusinhoud.sql opnieuw.");
        uit += controle(ev,    "Evaluatievragen",  25, "Draai 04_cursusinhoud.sql opnieuw.");
        uit += controle(toets, "Toetsvragen",      15, "Draai 04_cursusinhoud.sql opnieuw.");
        uit += controle(ex,    "Examenbank",       24, "Draai 04_cursusinhoud.sql opnieuw.");
        uit += controle(org,   "Organisaties",     1,  "BHV Roden hoort er standaard in te staan. Draai 01_schema.sql opnieuw.");

        $("#inhoud").innerHTML = uit;
        $("#uitslag").innerHTML = alles
          ? '<div class="goed"><b>Alles staat goed.</b> De database, de toegangsregels en de cursusinhoud werken. Laat me dit weten, dan bouw ik hierop de leeromgeving voor de cursist.</div>'
          : '<div class="let"><b>Er ontbreekt nog iets.</b> Hierboven staat bij elke rode regel welk bestand je nog moet draaien. Stuur me anders een schermafbeelding van deze pagina.</div>';
      });
    });
  }
})();
