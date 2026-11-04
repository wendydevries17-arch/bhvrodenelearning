/* Certificaat tekenen op canvas (1414 x 2000, A4). Gedeeld door beheer en tests. */
(function (w) {
  var SOORTEN = {
    reanimatie: { label: "Reanimatie", regels: ["heeft voldaan aan de vereisten van het", "examenreglement reanimatie training binnen", "de NRR"] },
    herhaling:  { label: "Herhaling BHV", regels: ["heeft voldaan aan de vereisten van het", "examenreglement BHV herhaling binnen", "het NIBHV"] },
    basis:      { label: "Basis BHV", regels: ["heeft voldaan aan de vereisten van het", "examenreglement BHV basis binnen", "het NIBHV"] }
  };
  var C = {
    naamFont: '"CertSerif"', naamGrootte: 109, naamBasis: 809, naamMidden: 689, naamMax: 1180, naamKleur: "#DC091A",
    tekstFont: '"CertSans"', tekstKleur: "#003138",
    gebX: 693, gebBasis: 961, gebGrootte: 44.6,
    parMidden: 720, parBasis: [1102, 1164, 1226], parGrootte: 44.8,
    datumX: 295, datumBasis: 1471, datumGrootte: 45.1
  };
  function teken(ctx, bg, d) {
    var s = SOORTEN[d.soort] || SOORTEN.herhaling;
    ctx.drawImage(bg, 0, 0, 1414, 2000);
    ctx.textBaseline = "alphabetic";
    // naam
    var naam = String(d.naam || "").toUpperCase(), g = C.naamGrootte;
    ctx.fillStyle = C.naamKleur; ctx.textAlign = "center";
    do { ctx.font = g + "px " + C.naamFont; g -= 2; } while (ctx.measureText(naam).width > C.naamMax && g > 40);
    ctx.fillText(naam, C.naamMidden, C.naamBasis);
    // geboortedatum
    ctx.fillStyle = C.tekstKleur; ctx.textAlign = "left";
    ctx.font = "700 " + C.gebGrootte + "px " + C.tekstFont;
    ctx.fillText(d.geboren || "", C.gebX, C.gebBasis);
    // cursusregels
    ctx.textAlign = "center"; ctx.font = "400 " + C.parGrootte + "px " + C.tekstFont;
    s.regels.forEach(function (r, i) { ctx.fillText(r, C.parMidden, C.parBasis[i]); });
    // datum
    ctx.textAlign = "left"; ctx.font = "400 " + C.datumGrootte + "px " + C.tekstFont;
    ctx.fillText(d.datum || "", C.datumX, C.datumBasis);
  }
  w.BHVCert = { SOORTEN: SOORTEN, C: C, teken: teken };
})(window);
