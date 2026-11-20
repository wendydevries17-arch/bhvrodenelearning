// =====================================================================
//  BHV Roden leeromgeving: inlogmails (code per mail, wachtwoord herstellen)
//
//  Supabase Auth stuurt zijn mails niet zelf. De database-hook
//  public.stuur_inlogmail zet de mail in de tabel inlogmail_wachtrij en
//  roept deze functie aan met alleen het id. Deze functie haalt de rij op,
//  verstuurt de mail via Resend en verwijdert de rij direct weer, zodat
//  er geen codes in de database blijven staan.
// =====================================================================
const SITE = "https://bhvrodenelearning.nl";
const VAN = "BHV Roden <cursus@bhvrodenelearning.nl>";
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
function kop(): Record<string, string> {
  const h: Record<string, string> = { apikey: SLEUTEL, "Content-Type": "application/json" };
  if (SLEUTEL.startsWith("eyJ")) h.Authorization = `Bearer ${SLEUTEL}`;
  return h;
}
function veilig(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const antwoord = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

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

function codeBlok(code: string): string {
  return `<div style="margin:18px 0;padding:16px;background:#F4F4F2;border:1px solid #DCDCD8;border-radius:5px;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:32px;font-weight:bold;letter-spacing:8px;color:#0F1F3D;">${veilig(code)}</div>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return antwoord({ ok: false }, 405);
  let id = "";
  try { id = String((await req.json()).id ?? ""); } catch { /* leeg */ }
  if (!/^[0-9a-f-]{36}$/.test(id)) return antwoord({ ok: false }, 400);

  const r = await fetch(`${URL_}/rest/v1/inlogmail_wachtrij?id=eq.${id}&select=*`, { headers: kop() });
  const rij = r.ok ? (await r.json())[0] : null;
  if (!rij) return antwoord({ ok: false }, 404);
  // Direct weg uit de database, wat er verder ook gebeurt.
  await fetch(`${URL_}/rest/v1/inlogmail_wachtrij?id=eq.${id}`, { method: "DELETE", headers: kop() });

  let onderwerp = "Je inlogcode voor BHV Roden";
  let binnen = `<p style="margin:0 0 6px;font-size:18px;font-weight:bold;color:#1C1C1C;">Je inlogcode</p>
    <p style="margin:0;">Vul deze code in op het inlogscherm van de leeromgeving:</p>${codeBlok(rij.code)}
    <p style="margin:0;">De code is 10 minuten geldig en werkt maar één keer.</p>
    <p style="margin:14px 0 0;font-size:13px;color:#6B6B66;">Heb je niet zelf geprobeerd in te loggen? Dan kun je deze mail negeren. Zonder deze code kan niemand in je account.</p>`;
  if (rij.soort === "recovery" && rij.token_hash) {
    const link = `${URL_}/auth/v1/verify?token=${encodeURIComponent(rij.token_hash)}&type=recovery&redirect_to=${encodeURIComponent(rij.terug || SITE)}`;
    onderwerp = "Nieuw wachtwoord voor BHV Roden";
    binnen = `<p style="margin:0 0 6px;font-size:18px;font-weight:bold;color:#1C1C1C;">Nieuw wachtwoord kiezen</p>
      <p style="margin:0;">Klik op de knop om een nieuw wachtwoord te kiezen. De link is 10 minuten geldig.</p>
      <p style="margin:20px 0;"><a href="${veilig(link)}" style="display:inline-block;background:#B71C1C;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:5px;">Nieuw wachtwoord kiezen</a></p>
      <p style="margin:14px 0 0;font-size:13px;color:#6B6B66;">Heb je dit niet zelf aangevraagd? Dan kun je deze mail negeren.</p>`;
  }
  const s = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: VAN, to: [rij.email], subject: onderwerp, html: omhulsel(SITE, onderwerp, binnen) }),
  });
  if (!s.ok) { console.error("resend", s.status, (await s.text()).slice(0, 300)); return antwoord({ ok: false }, 502); }
  return antwoord({ ok: true });
});
