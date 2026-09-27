/* =====================================================================
   Meekijken met een hoofdstuk, zonder account

   Deze pagina hoort bij een link met een lange sleutel erin:
     bhvrodenelearning.nl/voorbeeld.html?k=<sleutel>

   Hij vraagt de database om precies een hoofdstuk en zet dat neer in
   de huisstijl van dat bedrijf. Meer kan hij ook niet: de functie
   voorbeeld() in de database geeft niets anders terug dan de titel,
   de lessen, de tekst en de video's. Geen deelnemers, geen voortgang,
   geen toetsvragen.

   Er wordt niets bewaard in de browser en er wordt niets teruggestuurd.
   ===================================================================== */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- kleuren, net als in de leeromgeving ---------- */
  function hex(h, standaard) {
    h = String(h || "").trim();
    return /^#[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : standaard;
  }
  function rgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
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

  function zetHuisstijl(stijl, bedrijf) {
    if (!stijl) return;
    var s = document.documentElement.style;
    var p = hex(stijl.kleur_primair, "#0F1F3D");
    var a = hex(stijl.kleur_accent, "#B71C1C");

    s.setProperty("--p", p);
    s.setProperty("--p2", helderheid(p) > 0.42 ? meng(p, "#000000", 0.14) : meng(p, "#FFFFFF", 0.14));
    s.setProperty("--p-ink", inkt(p));
    s.setProperty("--a", a);
    s.setProperty("--a2", helderheid(a) > 0.42 ? meng(a, "#000000", 0.18) : meng(a, "#FFFFFF", 0.14));
    s.setProperty("--a-ink", inkt(a));
    s.setProperty("--a-soft", meng(a, "#FFFFFF", 0.88));
    s.setProperty("--tint", meng(p, "#FFFFFF", 0.92));
    s.setProperty("--rad", stijl.ronde_hoeken === false ? "0px" : "50px");
    s.setProperty("--radc", stijl.ronde_hoeken === false ? "0px" : "4px");
    s.setProperty("--waas-rgb", rgb(p).join(","));

    var balk = document.querySelector(".balk");
    if (balk) {
      if (stijl.logo_url) {
        var logo = balk.querySelector("img");
        logo.src = stijl.logo_url;
        logo.alt = bedrijf || "";
      }
      $("#vb-naam").innerHTML = esc(bedrijf || "BHV Roden") + "<span>Leeromgeving</span>";
    }
    document.body.dataset.klant = "ja";
  }

  /* ---------- de inhoud ---------- */
  function prozaHtml(blokken) {
    if (!Array.isArray(blokken)) return "";
    return blokken.map(function (b) {
      if (b.t === "h") return "<h3>" + b.v + "</h3>";
      if (b.t === "ul") return "<ul>" + (b.v || []).map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>";
      if (b.t === "call") return '<div class="uitroep"><span class="eyebrow">Let op</span>' + b.v + "</div>";
      return "<p>" + b.v + "</p>";
    }).join("");
  }

  function spelerHtml(dienst, v, titel) {
    var bib = (dienst && dienst.bibliotheek) || "";
    var domein = (dienst && dienst.domein) || "iframe.mediadelivery.net";
    var id = v && (v.video || v.id);
    if (!bib || !id) return "";
    var bron = "https://" + domein + "/embed/" + encodeURIComponent(bib) + "/" +
      encodeURIComponent(id) + "?autoplay=false&preload=false&responsive=true";
    return '<div class="video">' +
      '<iframe src="' + esc(bron) + '" loading="lazy" allowfullscreen ' +
      'allow="accelerometer;gyroscope;encrypted-media;picture-in-picture;fullscreen" ' +
      'title="' + esc(titel || (v && v.titel) || "Video") + '"></iframe></div>';
  }

  function duur(sec) {
    sec = Number(sec) || 0;
    if (!sec) return "";
    var m = Math.round(sec / 60);
    return m < 1 ? "minder dan een minuut" : m + (m === 1 ? " minuut" : " minuten");
  }

  function tekenLessen(d) {
    var dienst = d.video_dienst || {};
    var lessen = d.lessen || [];

    if (!lessen.length) {
      $("#vb-lessen").innerHTML =
        '<div class="leeg">In dit hoofdstuk staat nog geen les. Zodra er iets klaarstaat verschijnt het hier.</div>';
      return;
    }

    /* Bij meer dan een les een rijtje knoppen bovenaan, zodat iemand
       die alleen Leek hoeft na te kijken niet eerst langs Marum,
       Grootegast en Zuidhorn moet scrollen. */
    if (lessen.length > 1) {
      $("#vb-wegwijzer").innerHTML = lessen.map(function (l, i) {
        var n = Array.isArray(l.videos) ? l.videos.length : 0;
        return '<a href="#les-' + i + '">' + esc(l.titel) +
          (n ? "<span>" + n + (n === 1 ? " video" : " video's") + "</span>" : "") + "</a>";
      }).join("");
      $("#vb-wegwijzer").hidden = false;
    }

    $("#vb-lessen").innerHTML = lessen.map(function (l, i) {
      var videos = Array.isArray(l.videos) ? l.videos : [];
      var spelers = videos.map(function (v) {
        var sp = spelerHtml(dienst, v, l.titel + ", " + (v.titel || ""));
        return '<div class="video-blok">' +
          (v.titel ? "<h4>" + esc(v.titel) + "</h4>" : "") +
          (sp || '<div class="let">Deze video staat nog te verwerken bij de videodienst. ' +
                 'Ververs de pagina over een paar minuten.</div>') +
          "</div>";
      }).join("");

      return '<section class="paneel vb-les" id="les-' + i + '">' +
        '<div class="paneel-kop">' +
          "<h2>" + (i + 1) + ". " + esc(l.titel) + "</h2>" +
          (duur(l.duur_seconden) ? '<span class="chip nieuw">' + esc(duur(l.duur_seconden)) + "</span>" : "") +
        "</div>" +
        '<div class="paneel-body">' +
          '<div class="proza">' + prozaHtml(l.tekst) + "</div>" +
          (spelers ? '<div class="videos">' + spelers + "</div>"
                   : '<div class="klein">Bij deze les staan nog geen video\'s.</div>') +
        "</div>" +
      "</section>";
    }).join("");
  }

  function fout(titel, tekst) {
    $("#vb-laden").hidden = true;
    $("#vb-fout-titel").innerHTML = titel;
    $("#vb-fout-tekst").textContent = tekst;
    $("#vb-fout").hidden = false;
  }

  /* ---------- starten ---------- */
  var sleutel = new URLSearchParams(location.search).get("k") || "";

  if (!sleutel) {
    fout("Er ontbreekt <em>iets</em> in de link",
      "Deze pagina hoort bij een persoonlijke link. Waarschijnlijk is bij het kopieren het laatste stukje weggevallen. Kopieer hem nog eens helemaal uit de mail.");
    return;
  }

  if (!window.CONFIG || !window.supabase) {
    fout("De pagina kon niet <em>laden</em>",
      "Probeer het over een paar minuten nog eens, of laat het weten via info@bhvroden.nl.");
    return;
  }

  var sb = window.supabase.createClient(window.CONFIG.supabaseUrl, window.CONFIG.supabaseKey);

  sb.rpc("voorbeeld", { p_token: sleutel }).then(function (r) {
    if (r.error) throw r.error;
    var d = r.data || {};

    if (d.fout === "onbekend") {
      fout("Deze link kennen we <em>niet</em>",
        "Misschien is hij niet helemaal meegekomen bij het kopieren, of is hij inmiddels vervangen door een nieuwe.");
      return;
    }
    if (d.fout === "uit") {
      fout("Deze link staat <em>uit</em>",
        "Het hoofdstuk is waarschijnlijk klaar en staat inmiddels gewoon in de cursus.");
      return;
    }
    if (d.fout === "verlopen") {
      fout("Deze link is <em>verlopen</em>",
        "Om te voorkomen dat er oude versies blijven rondslingeren werkt een kijklink maar een tijdje.");
      return;
    }
    if (d.fout) { fout("Deze link werkt <em>niet meer</em>", "Vraag om een nieuwe."); return; }

    zetHuisstijl(d.stijl, d.bedrijf);
    document.title = (d.hoofdstuk || "Meekijken") + ", BHV Roden";
    $("#vb-wie").textContent = d.bedrijf || "";
    $("#vb-titel").innerHTML = esc(d.hoofdstuk || "Hoofdstuk");

    var aantal = (d.lessen || []).length;
    $("#vb-lead").textContent =
      (d.bedrijf ? "Het eigen hoofdstuk voor " + d.bedrijf + ", " : "") +
      "onderdeel van " + (d.cursus || "de cursus") + ". " +
      (aantal === 1 ? "Een les" : aantal + " lessen") +
      ". Kijk het rustig na en laat weten wat er nog aangepast moet worden.";

    tekenLessen(d);
    $("#vb-laden").hidden = true;
    $("#vb-goed").hidden = false;
  }).catch(function (e) {
    fout("Het ophalen <em>lukte niet</em>",
      "Probeer het over een paar minuten nog eens. Blijft het misgaan, mail dan naar info@bhvroden.nl. " +
      (e && e.message ? "(" + e.message + ")" : ""));
  });
})();
