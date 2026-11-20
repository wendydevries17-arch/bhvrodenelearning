// =====================================================================
//  BHV Roden leeromgeving: aanmelden met een uitnodiging
//
//  Zelf een account aanmaken is in Supabase uitgezet. Dit is de enige
//  weg naar een cursistaccount: met een geldige uitnodigingslink.
//  De functie controleert de uitnodiging en maakt het account aan,
//  zonder wachtwoord. Daarna logt de cursist in met een code per mail.
//
//  POST { token, voornaam, achternaam, geboortedatum }
//  ->   { ok: true } of { ok: false, fout }
// =====================================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const antwoord = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
const schoon = (s: unknown, max = 80) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return antwoord({ ok: false, fout: "Niet toegestaan" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return antwoord({ ok: false, fout: "Ongeldige aanvraag" }, 400); }

  const token = schoon(b.token, 200);
  const voornaam = schoon(b.voornaam), achternaam = schoon(b.achternaam);
  const gb = schoon(b.geboortedatum, 10);
  if (!token) return antwoord({ ok: false, fout: "De uitnodigingslink is niet compleet." }, 400);
  if (!voornaam || !achternaam) return antwoord({ ok: false, fout: "Vul je voornaam en achternaam in." }, 400);
  const d = new Date(gb + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gb) || isNaN(d.getTime()) || d.getUTCFullYear() < 1920 || d > new Date())
    return antwoord({ ok: false, fout: "Vul een geldige geboortedatum in." }, 400);

  // De uitnodiging opzoeken
  const r = await fetch(`${URL_}/rest/v1/uitnodigingen?token=eq.${encodeURIComponent(token)}&select=email,gebruikt_op,verloopt_op`, { headers: kop() });
  const rijen = r.ok ? await r.json() : [];
  const u = rijen[0];
  if (!u) return antwoord({ ok: false, fout: "Deze uitnodiging bestaat niet. Controleer of je de hele link hebt gebruikt." }, 404);
  if (new Date(u.verloopt_op) <= new Date()) return antwoord({ ok: false, fout: "Deze uitnodiging is verlopen. Vraag een nieuwe aan bij je werkgever." }, 410);

  // Het account aanmaken. Bestaat het al, dan is dat goed: de cursist
  // logt gewoon in met een code en de uitnodiging wordt daarna gekoppeld.
  const m = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST", headers: kop(),
    body: JSON.stringify({ email: u.email, email_confirm: true, user_metadata: { voornaam, achternaam, geboortedatum: gb } }),
  });
  if (!m.ok) {
    const t = await m.text();
    if (!/already|exists|registered/i.test(t)) {
      console.error("aanmaken mislukt", m.status, t.slice(0, 300));
      return antwoord({ ok: false, fout: "Het account kon niet worden aangemaakt. Mail ons op info@bhvroden.nl." }, 500);
    }
  }
  return antwoord({ ok: true });
});
