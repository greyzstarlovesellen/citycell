const DATA_PATH = "data/citycell.json";
const SESSION_SECONDS = 60 * 60 * 8;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== env.FRONTEND_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function encodeBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64url(value) {
  return btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signToken(payload, secret) {
  const body = base64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64url(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function verifyToken(token, secret) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return false;
  const expected = await signToken(JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))), secret);
  return expected === token;
}

function emptyData() {
  return { products: [], sales: [], expenses: [], customers: [] };
}

async function githubRequest(env, path, options = {}) {
  return fetch(`https://api.github.com/repos/${env.CITYCELL_REPOSITORY}/contents/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

async function readData(env) {
  const response = await githubRequest(env, DATA_PATH);
  if (response.status === 404) return { version: null, data: emptyData() };
  if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
  const file = await response.json();
  const data = JSON.parse(decodeBase64(file.content));
  return { version: file.sha, data: { ...emptyData(), ...data } };
}

function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function authenticated(request, env) {
  const token = bearer(request);
  if (!token) return false;
  try {
    const valid = await verifyToken(token, env.SESSION_SECRET);
    if (!valid) return false;
    const payload = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function handle(request, env) {
  if (!env.FRONTEND_ORIGIN || !env.GITHUB_TOKEN || !env.APP_PASSWORD || !env.SESSION_SECRET || !env.CITYCELL_REPOSITORY) {
    return json({ error: "API não configurada. Consulte api/README.md." }, 503);
  }

  if (request.method === "OPTIONS") {
    const headers = corsHeaders(request, env);
    return headers["Access-Control-Allow-Origin"] ? new Response(null, { status: 204, headers }) : json({ error: "Origem não permitida." }, 403);
  }

  const headers = corsHeaders(request, env);
  if (request.headers.get("Origin") && !headers["Access-Control-Allow-Origin"]) return json({ error: "Origem não permitida." }, 403);
  const url = new URL(request.url);

  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true }, 200, headers);

  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (typeof body.password !== "string" || body.password !== env.APP_PASSWORD) return json({ error: "Senha incorreta." }, 401, headers);
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ iat: now, exp: now + SESSION_SECONDS }, env.SESSION_SECRET);
    return json({ token, expiresAt: new Date((now + SESSION_SECONDS) * 1000).toISOString() }, 200, headers);
  }

  if (!url.pathname.startsWith("/api/")) return json({ error: "Rota não encontrada." }, 404, headers);
  if (!(await authenticated(request, env))) return json({ error: "Sessão expirada. Entre novamente." }, 401, headers);

  if (url.pathname === "/api/data" && request.method === "GET") {
    try { return json(await readData(env), 200, headers); }
    catch { return json({ error: "Não foi possível ler os dados do repositório." }, 502, headers); }
  }

  if (url.pathname === "/api/data" && request.method === "PUT") {
    const body = await request.json().catch(() => null);
    if (!body || !body.data || !["products", "sales", "expenses", "customers"].every((key) => Array.isArray(body.data[key]))) {
      return json({ error: "Formato de dados inválido." }, 400, headers);
    }
    try {
      const current = await readData(env);
      if ((current.version || null) !== (body.version || null)) return json({ error: "Os dados mudaram em outra sessão. Atualize e tente novamente.", current: current.data, version: current.version }, 409, headers);
      const bytes = new TextEncoder().encode(`${JSON.stringify(body.data, null, 2)}\n`);
      const content = encodeBase64(bytes);
      const response = await githubRequest(env, DATA_PATH, {
        method: "PUT",
        body: JSON.stringify({ message: "Atualizar dados da City Cell", content, branch: env.CITYCELL_BRANCH || "main", ...(current.version ? { sha: current.version } : {}) }),
      });
      if (response.status === 409 || response.status === 422) return json({ error: "Os dados mudaram em outra sessão. Atualize e tente novamente." }, 409, headers);
      if (!response.ok) return json({ error: `GitHub recusou a gravação (${response.status}).` }, 502, headers);
      const saved = await response.json();
      return json({ version: saved.content.sha, data: body.data }, 200, headers);
    } catch {
      return json({ error: "Não foi possível gravar os dados no repositório." }, 502, headers);
    }
  }

  return json({ error: "Rota não encontrada." }, 404, headers);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch { return json({ error: "Erro interno da API." }, 500); }
  },
};

