// =====================================================================
//  BHV Roden leeromgeving: de verwerkersovereenkomst
//
//  Een klantbedrijf krijgt een mail met een persoonlijke link. Op de
//  pagina verwerkersovereenkomst.html leest de contactpersoon de tekst en
//  geeft akkoord. Pas daarna kunnen de medewerkers beginnen.
//
//  Acties (POST, JSON):
//    lees       { token } of ingelogde contactpersoon  -> gegevens voor de pagina
//    akkoord    { token, naam, functie } of ingelogde contactpersoon
//    versturen  { org }   alleen voor de beheerder      -> eerste mail (of opnieuw)
//    ronde      header x-ronde                          -> dagelijkse herinneringen
//
//  Geheimen: RESEND_API_KEY, AVK_GEHEIM (voor de dagelijkse ronde).
// =====================================================================

const VERSIE = "1 (november 2026)";
const SITE = "https://bhvrodenelearning.nl";
const VAN = "BHV Roden <cursus@bhvrodenelearning.nl>";
const ANTWOORD = "info@bhvroden.nl";
const KOPIE = "info@bhvroden.nl";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ronde",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function antwoord(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function veilig(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function datumNL(iso: unknown): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
}
function tijdNL(iso: unknown): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("nl-NL", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}

/* ---------- database ---------- */
const URL_ = Deno.env.get("SUPABASE_URL")!;
function dienstSleutel(): string {
  try {
    const m = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const v = Object.values(m)[0];
    if (typeof v === "string" && v) return v;
  } catch { /* oude sleutel dan */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const SLEUTEL = dienstSleutel();
function kop(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { apikey: SLEUTEL, "Content-Type": "application/json", ...extra };
  if (SLEUTEL.startsWith("eyJ")) h.Authorization = `Bearer ${SLEUTEL}`;
  return h;
}
async function db(pad: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${pad}`, { ...init, headers: { ...kop(), ...(init.headers as Record<string, string> ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`database: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
async function log(org: string, gebeurtenis: string, details: Record<string, unknown> = {}) {
  try {
    await db("verwerkersovereenkomst_log", { method: "POST", body: JSON.stringify({ organisatie_id: org, gebeurtenis, details }) });
  } catch { /* het log mag de rest niet tegenhouden */ }
}

type Org = { id: string; naam: string; is_eigenaar: boolean; contactpersoon_naam: string | null; contactpersoon_email: string | null; dpa_getekend_op: string | null };
type Rij = { organisatie_id: string; token: string; verstuurd_op: string | null; laatst_gemaild_op: string | null; herinneringen: number; gemeld_op: string | null; akkoord_op: string | null; akkoord_naam: string | null; akkoord_functie: string | null; akkoord_email: string | null };

async function org(id: string): Promise<Org | null> {
  const r = await db(`organisaties?id=eq.${encodeURIComponent(id)}&select=id,naam,is_eigenaar,contactpersoon_naam,contactpersoon_email,dpa_getekend_op`);
  return r?.[0] ?? null;
}
async function rijVoorOrg(id: string): Promise<Rij> {
  const r = await db(`verwerkersovereenkomst?organisatie_id=eq.${encodeURIComponent(id)}&select=*`);
  if (r?.[0]) return r[0];
  const n = await db("verwerkersovereenkomst", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ organisatie_id: id }) });
  return n[0];
}
async function rijVoorToken(token: string): Promise<Rij | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const r = await db(`verwerkersovereenkomst?token=eq.${token}&select=*`);
  return r?.[0] ?? null;
}
async function zet(orgId: string, velden: Record<string, unknown>) {
  await db(`verwerkersovereenkomst?organisatie_id=eq.${encodeURIComponent(orgId)}`, { method: "PATCH", body: JSON.stringify(velden) });
}

/* Wie is er ingelogd? Geeft rol en bedrijf terug, of null. */
async function ingelogd(req: Request): Promise<{ id: string; email: string; rol: string; org: string; naam: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SLEUTEL, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const p = await db(`profielen?id=eq.${u.id}&select=rol,organisatie_id,voornaam,achternaam,email`);
  if (!p?.[0]) return null;
  return { id: u.id, email: p[0].email ?? u.email ?? "", rol: String(p[0].rol), org: p[0].organisatie_id, naam: [p[0].voornaam, p[0].achternaam].filter(Boolean).join(" ") };
}

/* ---------- mail ---------- */
function omhulsel(titel: string, binnen: string): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${veilig(titel)}</title></head>
<body style="margin:0;padding:0;background:#F4F4F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #DCDCD8;border-radius:5px;overflow:hidden;">
<tr><td style="background:#0F1F3D;padding:22px 26px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="${SITE}/img/logo-bhvroden.jpg" alt="BHV Roden" width="46" style="display:block;border-radius:3px;background:#fff;padding:3px 5px;"></td>
<td style="font-family:Helvetica,Arial,sans-serif;color:#FFFFFF;"><div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.6;font-weight:bold;">Leeromgeving</div>
<div style="font-size:17px;font-weight:bold;line-height:1.2;">BHV Roden</div></td></tr></table></td></tr>
<tr><td style="padding:26px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#3E3E3E;">${binnen}</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #DCDCD8;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6B6B66;">
BHV Roden, KvK 57659370, Roden.<br>Vragen? Mail ons op <a href="mailto:info@bhvroden.nl" style="color:#B71C1C;">info@bhvroden.nl</a>.</td></tr>
</table></td></tr></table></body></html>`;
}
function knop(link: string, tekst: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 6px;"><tr><td style="background:#B71C1C;border-radius:50px;">
<a href="${veilig(link)}" style="display:inline-block;padding:13px 28px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${veilig(tekst)}</a></td></tr></table>`;
}
const UITLEG = `<p style="margin:0 0 14px;padding:14px 16px;background:#EEF1F6;border-radius:4px;font-size:14px;">
<strong style="color:#1C1C1C;">Waarom vragen we dit?</strong><br>
Uw medewerkers volgen bij ons de BHV-cursus online. Daarvoor bewaren wij een paar gegevens van ze, zoals naam,
e-mailadres en voortgang. Die gegevens zijn eigenlijk van uw bedrijf: wij bewaren ze alleen voor u. De privacywet
(AVG) zegt dat we daar samen afspraken over moeten maken. Dat heet een verwerkersovereenkomst. Zonder uw akkoord
mogen wij nog niet beginnen.</p>`;

async function stuur(aan: string, onderwerp: string, html: string, bcc?: string) {
  const sleutel = Deno.env.get("RESEND_API_KEY");
  if (!sleutel) throw new Error("RESEND_API_KEY ontbreekt");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: VAN, to: [aan], reply_to: ANTWOORD, subject: onderwerp, html, ...(bcc ? { bcc: [bcc] } : {}) }),
  });
  const u = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(u?.message ?? `Resend gaf ${r.status}`);
}

function aanhef(o: Org) {
  const voornaam = String(o.contactpersoon_naam ?? "").trim().split(/\s+/)[0];
  return voornaam ? `Beste ${veilig(voornaam)},` : "Beste contactpersoon,";
}

async function mailUitnodiging(o: Org, rij: Rij, keer: number) {
  const link = `${SITE}/verwerkersovereenkomst.html?t=${rij.token}`;
  const titels = ["Graag uw akkoord voor de BHV e-learning", "Herinnering: uw akkoord voor de BHV e-learning", "Laatste herinnering: uw akkoord voor de BHV e-learning"];
  const intro = keer === 0
    ? `Fijn dat <strong style="color:#1C1C1C;">${veilig(o.naam)}</strong> de BHV e-learning van BHV Roden gaat gebruiken. Voordat uw medewerkers kunnen beginnen, vragen we u één keer akkoord te geven op de verwerkersovereenkomst. Dat kost u twee minuten.`
    : `Een paar dagen geleden stuurden we u de verwerkersovereenkomst voor <strong style="color:#1C1C1C;">${veilig(o.naam)}</strong>. We hebben uw akkoord nog niet ontvangen. Zolang dat er niet is, kunnen uw medewerkers nog niet beginnen met de e-learning.`;
  const binnen = `<p style="margin:0 0 14px;">${aanhef(o)}</p><p style="margin:0 0 14px;">${intro}</p>${UITLEG}
${knop(link, "Overeenkomst lezen en akkoord geven")}
<p style="margin:14px 0 0;font-size:13px;color:#6B6B66;">Deze link is persoonlijk voor ${veilig(o.naam)}. Bent u niet de juiste persoon? Stuur deze mail dan door naar wie bij u over privacy of personeelszaken gaat, of laat het ons weten.</p>`;
  await stuur(String(o.contactpersoon_email), titels[Math.min(keer, 2)], omhulsel(titels[Math.min(keer, 2)], binnen));
}

async function mailBevestiging(o: Org, rij: Rij, aan: string) {
  const link = `${SITE}/verwerkersovereenkomst.html?t=${rij.token}`;
  const binnen = `<p style="margin:0 0 14px;">Beste ${veilig(String(rij.akkoord_naam ?? "").split(/\s+/)[0] || "contactpersoon")},</p>
<p style="margin:0 0 14px;">Bedankt. Hierbij de bevestiging dat u akkoord heeft gegeven op de verwerkersovereenkomst met BHV Roden.
Uw medewerkers kunnen nu beginnen met de e-learning.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="background:#EEF1F6;border-radius:4px;padding:6px 16px;margin:18px 0;font-size:13.5px;">
<tr><td style="padding:5px 16px 5px 0;color:#6B6B66;font-weight:bold;">Bedrijf</td><td style="color:#1C1C1C;font-weight:bold;">${veilig(o.naam)}</td></tr>
<tr><td style="padding:5px 16px 5px 0;color:#6B6B66;font-weight:bold;">Akkoord door</td><td style="color:#1C1C1C;font-weight:bold;">${veilig(rij.akkoord_naam)}, ${veilig(rij.akkoord_functie)}</td></tr>
<tr><td style="padding:5px 16px 5px 0;color:#6B6B66;font-weight:bold;">Datum en tijd</td><td style="color:#1C1C1C;font-weight:bold;">${veilig(tijdNL(rij.akkoord_op))}</td></tr>
<tr><td style="padding:5px 16px 5px 0;color:#6B6B66;font-weight:bold;">Versie</td><td style="color:#1C1C1C;font-weight:bold;">${veilig(VERSIE)}</td></tr></table>
<p style="margin:0 0 4px;">De volledige overeenkomst kunt u altijd teruglezen en opslaan als PDF via de knop hieronder. Bewaar deze mail bij uw administratie.</p>
${knop(link, "Overeenkomst bekijken")}`;
  await stuur(aan, `Bevestiging verwerkersovereenkomst ${o.naam}`, omhulsel("Bevestiging verwerkersovereenkomst", binnen), KOPIE);
}

async function mailMelding(o: Org, rij: Rij) {
  const binnen = `<p style="margin:0 0 14px;">Hoi Wendy,</p>
<p style="margin:0 0 14px;"><strong style="color:#1C1C1C;">${veilig(o.naam)}</strong> heeft na twee herinneringen nog geen akkoord gegeven op de verwerkersovereenkomst.
De medewerkers kunnen daardoor nog niet beginnen.</p>
<p style="margin:0 0 14px;">Contactpersoon: ${veilig(o.contactpersoon_naam ?? "onbekend")}, ${veilig(o.contactpersoon_email ?? "")}<br>Eerste mail: ${veilig(datumNL(rij.verstuurd_op))}</p>
<p style="margin:0;">Misschien handig om even te bellen. In Beheer, Bedrijven kun je de mail opnieuw sturen of het akkoord zelf vastleggen als het op papier is getekend.</p>`;
  await stuur(KOPIE, `Nog geen akkoord van ${o.naam}`, omhulsel("Nog geen akkoord", binnen));
}

/* ---------- acties ---------- */
async function zoekRij(req: Request, body: Record<string, unknown>) {
  if (typeof body.token === "string" && body.token) {
    const rij = await rijVoorToken(body.token);
    if (!rij) return { fout: "Deze link klopt niet of is niet meer geldig." };
    const o = await org(rij.organisatie_id);
    if (!o) return { fout: "Dit bedrijf bestaat niet meer." };
    return { rij, o, door: null as null | Awaited<ReturnType<typeof ingelogd>> };
  }
  const wie = await ingelogd(req);
  if (!wie) return { fout: "Open de link uit de mail, of log eerst in." };
  if (wie.rol !== "contactpersoon" && wie.rol !== "beheerder") return { fout: "Alleen de contactpersoon van het bedrijf kan akkoord geven." };
  const o = await org(wie.org);
  if (!o) return { fout: "Geen bedrijf gevonden." };
  const rij = await rijVoorOrg(o.id);
  return { rij, o, door: wie };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return antwoord({ fout: "Alleen POST" }, 405);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const actie = String(body.actie ?? "");

  try {
    if (actie === "lees") {
      const z = await zoekRij(req, body);
      if ("fout" in z) return antwoord(z);
      const { rij, o } = z;
      if (rij.akkoord_op || o.dpa_getekend_op || o.is_eigenaar) {
        return antwoord({ bedrijf: o.naam, akkoord: true, akkoord_op: rij.akkoord_op ?? o.dpa_getekend_op, naam: rij.akkoord_naam, functie: rij.akkoord_functie, versie: VERSIE });
      }
      if (body.token) await log(o.id, "geopend", { via: "link" });
      return antwoord({ bedrijf: o.naam, akkoord: false, contact: o.contactpersoon_naam ?? "", versie: VERSIE });
    }

    if (actie === "akkoord") {
      const z = await zoekRij(req, body);
      if ("fout" in z) return antwoord(z);
      const { rij, o, door } = z;
      if (rij.akkoord_op || o.dpa_getekend_op) return antwoord({ ok: true, al: true });
      const naam = String(body.naam ?? "").trim().slice(0, 120);
      const functie = String(body.functie ?? "").trim().slice(0, 120);
      if (naam.length < 2 || functie.length < 2) return antwoord({ fout: "Vul uw naam en functie in." });
      if (body.akkoord !== true) return antwoord({ fout: "Vink aan dat u akkoord gaat." });
      const nu = new Date().toISOString();
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60);
      const browser = (req.headers.get("user-agent") ?? "").slice(0, 300);
      const mail = door?.email || o.contactpersoon_email || "";
      await zet(o.id, { akkoord_op: nu, akkoord_naam: naam, akkoord_functie: functie, akkoord_email: mail, akkoord_versie: VERSIE, akkoord_ip: ip, akkoord_browser: browser });
      await db(`organisaties?id=eq.${o.id}`, { method: "PATCH", body: JSON.stringify({ dpa_getekend_op: nu, dpa_opmerking: `Online akkoord door ${naam} (${functie}), versie ${VERSIE}` }) });
      await log(o.id, "akkoord", { naam, functie, email: mail, ip, versie: VERSIE, via: door ? "ingelogd" : "link" });
      const nieuw = { ...rij, akkoord_op: nu, akkoord_naam: naam, akkoord_functie: functie };
      if (mail) {
        try { await mailBevestiging(o, nieuw, mail); } catch (e) { await log(o.id, "bevestiging_mislukt", { fout: String(e).slice(0, 300) }); }
      }
      return antwoord({ ok: true });
    }

    if (actie === "versturen") {
      const wie = await ingelogd(req);
      if (!wie || wie.rol !== "beheerder") return antwoord({ fout: "Alleen de beheerder kan dit versturen." });
      const o = await org(String(body.org ?? ""));
      if (!o) return antwoord({ fout: "Bedrijf niet gevonden." });
      if (o.is_eigenaar) return antwoord({ fout: "Voor het eigen bedrijf is geen overeenkomst nodig." });
      if (o.dpa_getekend_op) return antwoord({ fout: "Dit bedrijf heeft al akkoord gegeven." });
      if (!o.contactpersoon_email) return antwoord({ fout: "Vul eerst het e-mailadres van de contactpersoon in." });
      const rij = await rijVoorOrg(o.id);
      await mailUitnodiging(o, rij, 0);
      const nu = new Date().toISOString();
      await zet(o.id, { verstuurd_op: nu, laatst_gemaild_op: nu, herinneringen: 0, gemeld_op: null });
      await log(o.id, "verstuurd", { aan: o.contactpersoon_email, door: wie.email });
      return antwoord({ ok: true, aan: o.contactpersoon_email });
    }

    if (actie === "ronde") {
      const geheim = Deno.env.get("AVK_GEHEIM") ?? "";
      if (!geheim || req.headers.get("x-ronde") !== geheim) return antwoord({ fout: "Geen toegang" }, 403);
      const open: Rij[] = await db("verwerkersovereenkomst?akkoord_op=is.null&verstuurd_op=not.is.null&select=*") ?? [];
      const dag = 86400000, nu = Date.now();
      let herinnerd = 0, gemeld = 0;
      for (const rij of open) {
        const o = await org(rij.organisatie_id);
        if (!o || o.dpa_getekend_op || o.is_eigenaar || !o.contactpersoon_email) continue;
        const sinds = nu - new Date(rij.verstuurd_op!).getTime();
        try {
          if ((rij.herinneringen === 0 && sinds >= 3 * dag) || (rij.herinneringen === 1 && sinds >= 7 * dag)) {
            await mailUitnodiging(o, rij, rij.herinneringen + 1);
            await zet(o.id, { herinneringen: rij.herinneringen + 1, laatst_gemaild_op: new Date().toISOString() });
            await log(o.id, "herinnering", { nummer: rij.herinneringen + 1, aan: o.contactpersoon_email });
            herinnerd++;
          } else if (rij.herinneringen >= 2 && !rij.gemeld_op && sinds >= 8 * dag) {
            await mailMelding(o, rij);
            await zet(o.id, { gemeld_op: new Date().toISOString() });
            await log(o.id, "gemeld_aan_bhv_roden", {});
            gemeld++;
          }
        } catch (e) {
          await log(o.id, "mail_mislukt", { fout: String(e).slice(0, 300) });
        }
      }
      return antwoord({ ok: true, herinnerd, gemeld });
    }

    return antwoord({ fout: "Onbekende actie" });
  } catch (e) {
    return antwoord({ fout: "Er ging iets mis", uitleg: String(e).slice(0, 300) });
  }
});
