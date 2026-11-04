// =====================================================================
//  BHV Roden: praktijkcertificaten mailen
//
//  De beheerder maakt op praktijkcertificaten.html de certificaten in de
//  browser. Deze functie stuurt de PDF als bijlage naar één e-mailadres.
//  Namen en geboortedata worden nergens opgeslagen; alleen een regel in
//  het log (soort, datum, aantal, ontvanger).
//
//  POST { email, soort, datum, aantal, bestandsnaam, pdf (base64), bericht? }
//  Alleen voor een ingelogde beheerder.
// =====================================================================

const SITE = "https://bhvrodenelearning.nl";
const VAN = "BHV Roden <cursus@bhvrodenelearning.nl>";
const ANTWOORD = "info@bhvroden.nl";
const KOPIE = "info@bhvroden.nl";
const SOORTEN: Record<string, string> = { reanimatie: "Reanimatie", herhaling: "Herhaling BHV", basis: "Basis BHV" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function antwoord(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function veilig(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
async function ingelogd(req: Request): Promise<{ id: string; rol: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SLEUTEL, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const p = await db(`profielen?id=eq.${u.id}&select=rol`);
  return p?.[0] ? { id: u.id, rol: String(p[0].rol) } : null;
}
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return antwoord({ fout: "Alleen POST" }, 405);
  try {
    const wie = await ingelogd(req);
    if (!wie || wie.rol !== "beheerder") return antwoord({ fout: "Alleen voor de beheerder." }, 403);
    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return antwoord({ fout: "Dit e-mailadres klopt niet." });
    const soort = SOORTEN[String(b.soort)] ?? "BHV";
    const datum = String(b.datum ?? "").slice(0, 20);
    const aantal = Math.max(1, Math.min(500, Number(b.aantal) || 1));
    const pdf = String(b.pdf ?? "");
    if (pdf.length < 1000) return antwoord({ fout: "De PDF ontbreekt." });
    if (pdf.length > 38_000_000) return antwoord({ fout: "De PDF is te groot om te mailen. Maak twee kleinere groepen." });
    const naam = String(b.bestandsnaam ?? "certificaten.pdf").replace(/[^\w .-]/g, "").slice(0, 80) || "certificaten.pdf";
    const bericht = String(b.bericht ?? "").trim().slice(0, 2000);

    const binnen = `<p style="margin:0 0 14px;">Beste,</p>
<p style="margin:0 0 14px;">In de bijlage vindt u ${aantal === 1 ? "het certificaat" : `de ${aantal} certificaten`} van de praktijktraining <strong>${veilig(soort)}</strong> van ${veilig(datum)}.</p>
${bericht ? `<p style="margin:0 0 14px;white-space:pre-line;">${veilig(bericht)}</p>` : ""}
<p style="margin:0 0 14px;">De certificaten zijn een jaar geldig vanaf de cursusdatum. Wij nemen op tijd contact op voor de herhaling.</p>
<p style="margin:0;">Met vriendelijke groet,<br>BHV Roden</p>`;

    const sleutel = Deno.env.get("RESEND_API_KEY");
    if (!sleutel) throw new Error("RESEND_API_KEY ontbreekt");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: VAN, to: [email], reply_to: ANTWOORD, bcc: email.toLowerCase() === KOPIE ? undefined : [KOPIE],
        subject: `Certificaten ${soort} ${datum}`,
        html: omhulsel(`Certificaten ${soort}`, binnen),
        attachments: [{ filename: naam, content: pdf }],
      }),
    });
    const u = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(u?.message ?? `Resend gaf ${r.status}`);
    try {
      await db("praktijkcertificaten_log", { method: "POST", body: JSON.stringify({ soort: String(b.soort), cursusdatum: datum, aantal, verstuurd_naar: email, door: wie.id }) });
    } catch { /* log mag de mail niet tegenhouden */ }
    return antwoord({ ok: true });
  } catch (e) {
    return antwoord({ fout: (e as Error).message }, 500);
  }
});
