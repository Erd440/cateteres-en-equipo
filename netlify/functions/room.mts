// Sala en vivo de "Catéteres en Equipo".
// Quien coordina publica el estado de la partida y el resto lo lee.
// No guarda datos personales: solo el estado del juego y un identificador anónimo por pantalla.
import { getStore, getDeployStore } from "@netlify/blobs";

declare const Netlify: any;

const HOST_TTL = 6 * 60 * 60 * 1000; // un código se puede volver a usar tras 6 h sin actividad
const VIEW_LIVE = 45 * 1000; // una pantalla cuenta como "viendo" si avisó hace menos de 45 s
const VIEW_STALE = 5 * 60 * 1000; // se borra el registro de pantallas que se fueron
const MAX_STATE = 4000; // tamaño máximo del estado, en caracteres

const CODE = /^[a-z0-9]{4}$/;
const ID = /^[a-z0-9]{8,32}$/;

function store() {
  const opts = { name: "salas", consistency: "strong" as const };
  if (Netlify.context?.deploy?.context === "production") return getStore(opts);
  return getDeployStore(opts);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function countViewers(s: any, r: string, now: number) {
  const { blobs } = await s.list({ prefix: `v/${r}/` });
  let n = 0;
  await Promise.all(
    blobs.slice(0, 40).map(async (b: { key: string }) => {
      const e = await s.get(b.key, { type: "json" });
      if (e && now - e.t < VIEW_LIVE) n++;
      else if (!e || now - e.t > VIEW_STALE) await s.delete(b.key);
    }),
  );
  return n;
}

export default async (req: Request) => {
  const now = Date.now();
  const s = store();

  // Lectura: la hace cada pantalla que sigue la partida.
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const r = q.get("r") || "";
    const v = q.get("v") || "";
    if (!CODE.test(r)) return json({ error: "codigo" }, 400);
    if (ID.test(v) && q.get("hb") === "1") await s.setJSON(`v/${r}/${v}`, { t: now });
    const h = await s.get(`h/${r}`, { type: "json" });
    return json({ now, host: h ? { p: h.p, t: h.t, a: h.a } : null });
  }

  // Escritura: solo quien coordina, identificado por la clave que creó la sala.
  if (req.method === "POST") {
    let b: any;
    try {
      b = await req.json();
    } catch {
      return json({ error: "cuerpo" }, 400);
    }
    const r = String(b?.r || "");
    const k = String(b?.k || "");
    if (!CODE.test(r) || !ID.test(k)) return json({ error: "datos" }, 400);

    const key = `h/${r}`;
    const cur = await s.get(key, { type: "json" });
    if (cur && cur.k !== k && now - cur.a < HOST_TTL) return json({ error: "ocupada" }, 403);
    const mine = cur && cur.k === k ? cur : null;

    let t = mine ? mine.t : 0;
    if (b.p !== undefined) {
      if (!b.p || typeof b.p !== "object" || JSON.stringify(b.p).length > MAX_STATE) {
        return json({ error: "estado" }, 400);
      }
      t = now;
      await s.setJSON(key, { k, p: b.p, t, a: now });
    } else if (mine) {
      await s.setJSON(key, { ...mine, a: now }); // aviso de "sigo acá"
    }
    const n = await countViewers(s, r, now);
    return json({ now, t, n });
  }

  return json({ error: "metodo" }, 405);
};

export const config = { path: "/api/room" };
