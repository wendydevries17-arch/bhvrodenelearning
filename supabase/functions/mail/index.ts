// =====================================================================
//  BHV Roden leeromgeving, de maildienst
//
//  Dit draait bij Supabase, niet in de browser. Daardoor blijft de
//  sleutel van Resend uit het zicht van bezoekers.
//
//  Wat het doet: het haalt de wachtrij op uit de database, verstuurt
//  wat erin staat, en meldt per regel terug of het gelukt is.
//
//  Wie mag wat, dat beslist de database. Een beheerder krijgt de hele
//  wachtrij terug, een cursist alleen zijn eigen certificaat. Deze
//  functie hoeft dat dus niet zelf te controleren.
//
//  Nodig als geheim bij de functie: RESEND_API_KEY
// =====================================================================

const RESEND = "https://api.resend.com/emails";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function antwoord(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function veilig(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function datumNL(iso: unknown): string {
  const d = String(iso ?? "").slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : "";
}

/* ---------------------------------------------------------------------
   De opmaak van de mail. Bewust met tabellen en vaste kleuren, want
   mailprogramma's doen niet mee aan moderne opmaak.
   --------------------------------------------------------------------- */
function omhulsel(site: string, titel: string, binnenkant: string): string {
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${veilig(titel)}</title></head>
<body style="margin:0;padding:0;background:#F4F4F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F2;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #DCDCD8;border-radius:5px;overflow:hidden;">

  <tr><td style="background:#0F1F3D;padding:22px 26px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px;">
        <img src="${site}/img/logo-bhvroden.jpg" alt="BHV Roden" width="46"
             style="display:block;border-radius:3px;background:#fff;padding:3px 5px;">
      </td>
      <td style="font-family:Helvetica,Arial,sans-serif;color:#FFFFFF;">
        <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.6;font-weight:bold;">Leeromgeving</div>
        <div style="font-size:17px;font-weight:bold;line-height:1.2;">BHV Roden</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:26px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#3E3E3E;">
    ${binnenkant}
  </td></tr>

  <tr><td style="padding:18px 28px 24px;border-top:1px solid #DCDCD8;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6B6B66;">
    Deze cursus wordt verzorgd door <strong style="color:#1C1C1C;">BHV Roden</strong>.<br>
    Lukt het niet? Mail ons op <a href="mailto:info@bhvroden.nl" style="color:#B71C1C;">info@bhvroden.nl</a>.
  </td></tr>

</table>
<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9A9A94;padding-top:14px;">
  BHV Roden</div>
</td></tr></table>
</body></html>`;
}

function knop(link: string, tekst: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 6px;"><tr>
    <td style="background:#B71C1C;border-radius:50px;">
      <a href="${veilig(link)}" style="display:inline-block;padding:13px 28px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${veilig(tekst)}</a>
    </td></tr></table>`;
}

function feiten(rijen: [string, string][]): string {
  const cellen = rijen
    .filter(([, v]) => v)
    .map(([k, v]) =>
      `<tr>
         <td style="padding:5px 16px 5px 0;color:#6B6B66;font-weight:bold;white-space:nowrap;">${veilig(k)}</td>
         <td style="padding:5px 0;color:#1C1C1C;font-weight:bold;">${veilig(v)}</td>
       </tr>`)
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0"
    style="background:#EEF1F6;border-radius:4px;padding:6px 16px;margin:18px 0;font-family:Helvetica,Arial,sans-serif;font-size:13.5px;">
    ${cellen}</table>`;
}

/* ---------------------------------------------------------------------
   De twee mails
   --------------------------------------------------------------------- */
function uitnodigingsmail(r: Record<string, unknown>, site: string) {
  const naam = r.voornaam ? `Hallo ${veilig(r.voornaam)},` : "Hallo,";
  const uren = r.duur ? Math.round(Number(r.duur) / 60) : 6;
  const binnen = `
    <p style="margin:0 0 14px;">${naam}</p>
    <p style="margin:0 0 14px;">Je bent door <strong style="color:#1C1C1C;">${veilig(r.bedrijf)}</strong>
      aangemeld voor de e-learning bedrijfshulpverlening. Met de knop hieronder maak je je account aan
      en kun je meteen beginnen.</p>
    ${feiten([
      ["Cursus", String(r.cursus ?? "")],
      ["Tijd die het kost", `ongeveer ${uren} uur`],
      ["Afronden voor", datumNL(r.deadline)],
    ])}
    <p style="margin:0 0 4px;">Je kunt tussendoor stoppen. Je voortgang wordt bewaard, dus je gaat
      later gewoon verder waar je was gebleven.</p>
    ${knop(String(r.link ?? site), "Account aanmaken en beginnen")}
    <p style="margin:14px 0 0;font-size:13px;color:#6B6B66;">
      Deze link is persoonlijk en dertig dagen geldig. Hij werkt alleen voor dit e-mailadres.</p>`;
  return {
    onderwerp: `Je BHV e-learning staat klaar${r.bedrijf ? ` via ${r.bedrijf}` : ""}`,
    html: omhulsel(site, "Je BHV e-learning staat klaar", binnen),
  };
}

function certificaatmail(r: Record<string, unknown>, site: string) {
  const naam = r.voornaam ? `Hallo ${veilig(r.voornaam)},` : "Hallo,";
  const binnen = `
    <p style="margin:0 0 14px;">${naam}</p>
    <p style="margin:0 0 14px;"><strong style="color:#1C1C1C;font-size:17px;">Je bent geslaagd.</strong></p>
    <p style="margin:0 0 14px;">Je hebt het theoriegedeelte van de opleiding bedrijfshulpverlening
      met goed gevolg afgerond. Hieronder staan de gegevens van je certificaat.</p>
    ${feiten([
      ["Naam", String(r.naam ?? "")],
      ["Cursus", String(r.cursus ?? "")],
      ["Resultaat", r.score != null ? `${r.score} procent` : ""],
      ["Behaald op", datumNL(r.behaald_op)],
      ["Geldig tot", datumNL(r.geldig_tot)],
      ["Certificaatnummer", String(r.nummer ?? "")],
    ])}
    <p style="margin:0 0 4px;">Je certificaat staat klaar in de leeromgeving. Daar kun je het altijd
      terugvinden.</p>
    ${knop(String(r.link ?? site), "Mijn certificaat bekijken")}
    <p style="margin:18px 0 0;padding:13px 16px;background:#FAF0DA;border-left:3px solid #8A5D00;
       border-radius:0 4px 4px 0;font-size:13.5px;color:#4A3200;">
      <strong>Dit is nog niet het hele verhaal.</strong> Dit certificaat gaat over de theorie.
      Om echt bedrijfshulpverlener te zijn volgt daarna nog de praktijkdag. Die wordt apart met
      je afgestemd.</p>`;
  return {
    onderwerp: "Je bent geslaagd, hier is je certificaat",
    html: omhulsel(site, "Je bent geslaagd", binnen),
  };
}

/* ---------------------------------------------------------------------
   De afhandeling
   --------------------------------------------------------------------- */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return antwoord({ fout: "Alleen POST" }, 405);

  // Vanaf hier antwoorden we altijd met 200, ook als er iets misgaat.
  // Zo komt de Nederlandse uitleg netjes in het beheerscherm terecht in
  // plaats van een kale foutcode.

  const sleutel = Deno.env.get("RESEND_API_KEY");
  if (!sleutel) {
    return antwoord({
      fout: "De maildienst is nog niet ingesteld",
      uitleg: "Zet RESEND_API_KEY bij de functie onder Secrets in Supabase.",
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return antwoord({
      fout: "Je bent niet ingelogd",
      uitleg: "Log opnieuw in en probeer het nog eens.",
    });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const kop = {
    "apikey": anon,
    "Authorization": auth,
    "Content-Type": "application/json",
  };

  async function rpc(naam: string, args: Record<string, unknown>) {
    const r = await fetch(`${url}/rest/v1/rpc/${naam}`, {
      method: "POST", headers: kop, body: JSON.stringify(args),
    });
    const tekst = await r.text();
    if (!r.ok) throw new Error(`${naam}: ${tekst}`);
    return tekst ? JSON.parse(tekst) : null;
  }

  let wachtrij;
  try {
    const body = await req.json().catch(() => ({}));
    wachtrij = await rpc("mail_wachtrij", { p_max: Number(body?.max) || 50 });
  } catch (e) {
    return antwoord({
      fout: "De wachtrij kon niet worden opgehaald",
      uitleg: "Draai 08_mail.sql in Supabase als dat nog niet gebeurd is. " + String(e).slice(0, 300),
    });
  }

  const afzender = wachtrij?.afzender ?? {};
  const van = `${afzender.naam ?? "BHV Roden"} <${afzender.adres ?? "cursus@bhvrodenelearning.nl"}>`;
  const antwoordAan = afzender.antwoord ?? "info@bhvroden.nl";
  const site = String(wachtrij?.website ?? "https://bhvrodenelearning.nl").replace(/\/+$/, "");
  const regels: Record<string, unknown>[] = wachtrij?.regels ?? [];

  let verstuurd = 0, mislukt = 0;
  const meldingen: string[] = [];

  for (const r of regels) {
    try {
      const mail = r.soort === "certificaat"
        ? certificaatmail(r, site)
        : uitnodigingsmail(r, site);

      const res = await fetch(RESEND, {
        method: "POST",
        headers: { "Authorization": `Bearer ${sleutel}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: van,
          to: [String(r.aan)],
          reply_to: antwoordAan,
          subject: mail.onderwerp,
          html: mail.html,
        }),
      });

      const uit = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(uit?.message ?? `Resend gaf ${res.status}`);

      await rpc("mail_klaar", { p_id: r.id, p_gelukt: true, p_fout: null });
      verstuurd++;
    } catch (e) {
      mislukt++;
      const melding = String(e).slice(0, 400);
      meldingen.push(`${r.aan}: ${melding}`);
      try {
        await rpc("mail_klaar", { p_id: r.id, p_gelukt: false, p_fout: melding });
      } catch { /* dan blijft hij in de wachtrij staan, ook goed */ }
    }
  }

  return antwoord({
    gevonden: regels.length,
    verstuurd,
    mislukt,
    meldingen: meldingen.slice(0, 10),
  });
});
