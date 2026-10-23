/* =====================================================================
   Lesblokken: zo wordt de tekst van een les op het scherm gezet.

   Een les is een lijst blokken. Elk blok heeft een soort (t):
     h        tussenkop                       { t:"h", v:"Kop" }
     p        alinea                          { t:"p", v:"Tekst" }
     ul       opsomming                       { t:"ul", v:["een","twee"] }
     call     let op-kader                    { t:"call", v:"Tekst" }
     stappen  genummerd stappenplan           { t:"stappen", titel:"", v:[{k:"Kop", v:"Uitleg"}] }
     kaarten  tegels naast elkaar             { t:"kaarten", v:[{i:"vuur", k:"Kop", v:"Uitleg"}] }
     cijfers  kerncijfers, groot              { t:"cijfers", v:[{n:"30:2", v:"Uitleg"}] }
     goedfout wel doen en niet doen           { t:"goedfout", goed:["..."], fout:["..."] }
     stan     tip van BHV-Stan                { t:"stan", v:"Tekst", pose:"tip" }

   De teksten komen van de beheerder. Een beheerder mag er <strong>
   in zetten, daarom worden ze niet ontsmet. Wat een cursist typt komt
   hier nooit langs.
   ===================================================================== */
(function () {
  "use strict";

  var I = {
    telefoon: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    vuur: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.8 2.5-5 .3 1.7 1 2.6 2 3 0-3-1-5.5.5-8z"/>',
    hart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>',
    plus: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
    deur: '<path d="M6 21V4h9v17M3 21h18"/><path d="M15 6l4 1v14"/><circle cx="12.5" cy="13" r=".6" fill="currentColor"/>',
    let: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    oog: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.6-1.5L8 14"/>',
    tijd: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    mensen: '<circle cx="9" cy="7" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="8" r="2.5"/><path d="M16 13.5a5 5 0 0 1 5.5 5"/>',
    blad: '<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15"/><path d="M5 19 13 11"/>',
    zon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    druppel: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    stroom: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    schild: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    praat: '<path d="M4 5h16v11H9l-5 4z"/>',
    kruis: '<path d="M18 6 6 18M6 6l12 12"/>',
    vink: '<path d="M5 12.5 10 17.5 19 7"/>'
  };
  function icoon(naam) {
    var p = I[naam] || I.plus;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }

  function blok(b) {
    if (!b || !b.t) return "";
    switch (b.t) {
      case "h": return "<h3>" + (b.v || "") + "</h3>";
      case "ul": return "<ul>" + (b.v || []).map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>";
      case "call": return '<div class="uitroep"><span class="eyebrow">Let op</span>' + (b.v || "") + "</div>";
      case "stappen":
        return '<div class="lb-stappen">' + (b.titel ? '<div class="lb-titel">' + b.titel + "</div>" : "") +
          "<ol>" + (b.v || []).map(function (s, i) {
            return '<li><span class="lb-nr">' + (i + 1) + "</span><div><b>" + (s.k || "") + "</b>" +
              (s.v ? "<span>" + s.v + "</span>" : "") + "</div></li>";
          }).join("") + "</ol></div>";
      case "kaarten":
        return '<div class="lb-kaarten">' + (b.v || []).map(function (k) {
          return '<div class="lb-kaart">' + (k.i ? '<span class="lb-ic">' + icoon(k.i) + "</span>" : "") +
            "<b>" + (k.k || "") + "</b>" + (k.v ? "<span>" + k.v + "</span>" : "") + "</div>";
        }).join("") + "</div>";
      case "cijfers":
        return '<div class="lb-cijfers">' + (b.v || []).map(function (c) {
          return '<div class="lb-cijfer"><b>' + (c.n || "") + "</b><span>" + (c.v || "") + "</span></div>";
        }).join("") + "</div>";
      case "goedfout":
        return '<div class="lb-goedfout">' +
          '<div class="lb-goed"><div class="lb-gf-kop">' + icoon("vink") + "Wel doen</div><ul>" +
            (b.goed || []).map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>" +
          '<div class="lb-fout"><div class="lb-gf-kop">' + icoon("kruis") + "Niet doen</div><ul>" +
            (b.fout || []).map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>" +
          "</div>";
      case "stan":
        return '<div class="lb-stan"><img src="img/stan/' + (/^(standaard|zwaait|tip|duim)$/.test(b.pose || "") ? b.pose : "tip") +
          '.webp" alt="" loading="lazy" width="88" height="120"><div><span class="lb-stan-naam">Tip van Stan</span><p>' + (b.v || "") + "</p></div></div>";
      default: return "<p>" + (b.v || "") + "</p>";
    }
  }

  window.BHVBlokken = {
    html: function (lijst) { return Array.isArray(lijst) ? lijst.map(blok).join("") : ""; },
    iconen: Object.keys(I),
    soorten: [
      ["p", "Alinea"], ["h", "Tussenkop"], ["ul", "Opsomming"], ["stappen", "Stappenplan"],
      ["kaarten", "Tegels"], ["cijfers", "Kerncijfers"], ["goedfout", "Wel en niet doen"],
      ["call", "Let op"], ["stan", "Tip van Stan"]
    ]
  };
})();
