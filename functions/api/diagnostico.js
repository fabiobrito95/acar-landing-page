/* ==========================================================================
   ACAR™ · Cloudflare Pages Function · POST /api/diagnostico
   Recebe o formulário de diagnóstico, valida no servidor e grava uma linha
   na planilha do Google Sheets usando uma conta de serviço.

   Variáveis de ambiente (Cloudflare Pages → Settings → Variables and Secrets):
     GOOGLE_SERVICE_ACCOUNT_EMAIL  (secret) e-mail da conta de serviço
     GOOGLE_PRIVATE_KEY            (secret) chave privada da conta de serviço
                                   (campo "private_key" do JSON, com \n)
     GOOGLE_SHEET_ID               (secret) ID da planilha (trecho da URL)
     GOOGLE_SHEET_TAB              (opcional) nome da aba. Padrão: "Leads"
     ALLOWED_ORIGINS               (opcional) outros domínios aceitos, separados
                                   por vírgula. O próprio domínio já é aceito.

   Nenhum segredo fica no navegador: o formulário só conhece "/api/diagnostico".
   A resposta de sucesso só é enviada depois que o Google confirma a gravação.
   ========================================================================== */

const SHEET_TAB_DEFAULT = "Leads";
const MAX_BODY_BYTES = 8 * 1024;
const MIN_FILL_MS = 3000;          // envio mais rápido que isso = provável robô
const GOOGLE_TIMEOUT_MS = 8000;
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets/";

/* Opções aceitas: as mesmas do formulário (diagnostico/index.html) */
const SEGMENTOS = ["Clínicas e consultórios", "Estética e procedimentos", "Serviços veterinários",
  "Imobiliária", "Serviços especializados", "Comércio", "Educação"];
const FATURAMENTOS = ["Até R$ 10 mil", "R$ 10 mil a R$ 30 mil", "R$ 30 mil a R$ 100 mil",
  "R$ 100 mil a R$ 300 mil", "R$ 300 mil a R$ 1 milhão", "Acima de R$ 1 milhão", "Prefiro não informar"];
const DESAFIOS = ["Aquisição", "Conversão", "Atendimento", "Retenção"];
const PRAZOS = ["O quanto antes", "Em até 30 dias", "Em 1 a 3 meses", "Sem prazo definido"];

/* Colunas gravadas, na ordem da planilha (A até P) */
const COLUNAS = ["Recebido em", "ID do envio", "Nome", "Empresa", "Segmento", "Cidade/UF",
  "Faturamento mensal", "Principal desafio", "Detalhe do desafio", "Principal objetivo", "Prazo",
  "WhatsApp", "E-mail", "Instagram", "Consentimento de contato", "Página de origem"];

/* Token de acesso do Google reaproveitado enquanto válido (mesma instância) */
let cachedToken = null;

/* ---------- Respostas ---------- */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

/* ---------- Validação no servidor ---------- */
function str(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function validPhone(d) {
  if (!/^\d{10,11}$/.test(d)) return false;
  if (!/^[1-9][1-9]/.test(d)) return false;
  if (d.length === 11 && d.charAt(2) !== "9") return false;
  if (/^(\d)\1+$/.test(d.slice(2))) return false;
  return true;
}

function formatPhone(d) {
  return d.length === 11
    ? "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7)
    : "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
}

function withOther(value, list, maxOther) {
  // Aceita uma opção da lista ou "Outro: <texto>"
  if (list.indexOf(value) !== -1) return value;
  const m = /^Outro: (.{2,})$/.exec(value);
  return m && m[1].length <= maxOther ? value : null;
}

function validate(body) {
  const errors = {};
  const d = {};

  d.nome = str(body.nome, 120);
  if (d.nome.split(/\s+/).filter(Boolean).length < 2) errors.nome = "Informe nome e sobrenome.";

  d.empresa = str(body.empresa, 120);
  if (!d.empresa) errors.empresa = "Informe o nome da empresa.";

  d.segmento = withOther(str(body.segmento, 140), SEGMENTOS, 120);
  if (!d.segmento) errors.segmento = "Segmento inválido.";

  d.cidade_estado = str(body.cidade_estado, 120);
  if (d.cidade_estado.length < 3) errors.cidade = "Informe a cidade e o estado.";

  d.faturamento = str(body.faturamento, 60);
  if (d.faturamento && FATURAMENTOS.indexOf(d.faturamento) === -1) errors.faturamento = "Faixa de faturamento inválida.";

  d.desafio = withOther(str(body.desafio, 140), DESAFIOS, 120);
  if (!d.desafio) errors.desafio = "Desafio inválido.";

  d.desafio_detalhe = str(body.desafio_detalhe, 800);

  d.objetivo = str(body.objetivo, 160);
  if (d.objetivo.length < 3) errors.objetivo = "Descreva o principal objetivo.";

  d.prazo = str(body.prazo, 40);
  if (PRAZOS.indexOf(d.prazo) === -1) errors.prazo = "Prazo inválido.";

  const phone = str(body.whatsapp, 20).replace(/\D/g, "");
  if (!validPhone(phone)) errors.whatsapp = "WhatsApp inválido.";
  d.whatsapp = phone;

  d.email = str(body.email, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) errors.email = "E-mail inválido.";

  d.instagram = str(body.instagram, 40);
  if (d.instagram && !/^@[A-Za-z0-9._]{1,30}$/.test(d.instagram)) errors.instagram = "Instagram inválido.";

  if (body.consentimento !== true) errors.consentimento = "Consentimento obrigatório.";

  d.origem = str(body.origem, 60);
  if (!/^\/[A-Za-z0-9/_-]*$/.test(d.origem)) d.origem = "";

  d.id = str(body.submission_id, 40);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(d.id)) errors.submission_id = "ID de envio inválido.";

  return { data: d, errors };
}

/* ---------- Google: autenticação da conta de serviço (JWT RS256) ---------- */
function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importKey(pem) {
  const clean = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const key = await importKey(env.GOOGLE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + claims));
  const assertion = header + "." + claims + "." + b64url(signature);

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + assertion
  });
  if (!res.ok) throw new Error("google_auth_" + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error("google_auth_sem_token");
  cachedToken = { value: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.value;
}

/* ---------- Google Sheets ---------- */
function rangeOf(tab, cells) {
  return encodeURIComponent("'" + tab.replace(/'/g, "''") + "'!" + cells);
}

async function alreadyRecorded(env, token, tab, id) {
  // Evita linha duplicada se o mesmo envio chegar duas vezes (clique duplo, nova tentativa)
  const res = await fetchWithTimeout(SHEETS_URL + env.GOOGLE_SHEET_ID + "/values/" + rangeOf(tab, "B2:B"), {
    headers: { Authorization: "Bearer " + token }
  });
  if (!res.ok) throw new Error(sheetsError("sheets_read", res.status));
  const data = await res.json();
  return (data.values || []).some((row) => row[0] === id);
}

/* Traduz o status do Google num código de configuração legível nos logs */
function sheetsError(prefix, status) {
  if (status === 400) return "sheets_aba_nao_encontrada";        // nome da aba errado
  if (status === 403) return "sheets_sem_permissao";             // planilha não compartilhada ou API desativada
  if (status === 404) return "sheets_planilha_nao_encontrada";   // GOOGLE_SHEET_ID errado
  return prefix + "_" + status;
}

/* Lista os nomes das abas da planilha (só nomes, sem conteúdo) para o log */
async function tabNames(cfg, token) {
  try {
    const res = await fetchWithTimeout(SHEETS_URL + cfg.GOOGLE_SHEET_ID + "?fields=sheets.properties.title", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.sheets || []).map((s) => s.properties && s.properties.title).filter(Boolean);
  } catch (e) {
    return null;
  }
}

async function appendRow(env, token, tab, row) {
  const url = SHEETS_URL + env.GOOGLE_SHEET_ID + "/values/" + rangeOf(tab, "A:P") +
    ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ majorDimension: "ROWS", values: [row] })
  });
  if (!res.ok) throw new Error(sheetsError("sheets_append", res.status));
  const data = await res.json();
  // Só consideramos gravado se o Google informar exatamente uma linha nova
  if (!data.updates || data.updates.updatedRows !== 1) throw new Error("sheets_append_sem_confirmacao");
}

function timestamp() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date());
}

function buildRow(d) {
  return [
    timestamp(), d.id, d.nome, d.empresa, d.segmento, d.cidade_estado, d.faturamento,
    d.desafio, d.desafio_detalhe, d.objetivo, d.prazo, formatPhone(d.whatsapp), d.email,
    d.instagram, "Sim", d.origem
  ];
}

/* ---------- Leitura tolerante dos secrets ----------
   Corrige erros comuns de colagem no painel: espaços ou quebras de linha nas
   pontas, aspas copiadas do JSON e a URL inteira da planilha no lugar do ID. */
function googleConfig(env) {
  const clean = (v) => String(v || "").trim().replace(/^"(.*)"$/s, "$1").trim();
  const email = clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const key = clean(env.GOOGLE_PRIVATE_KEY);
  let sheetId = clean(env.GOOGLE_SHEET_ID);
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(sheetId);
  if (fromUrl) sheetId = fromUrl[1];
  if (!email || !key || !sheetId) return null;
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: email,
    GOOGLE_PRIVATE_KEY: key,
    GOOGLE_SHEET_ID: sheetId,
    GOOGLE_SHEET_TAB: clean(env.GOOGLE_SHEET_TAB) || SHEET_TAB_DEFAULT
  };
}

/* ---------- Origem da requisição ---------- */
function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // alguns navegadores omitem em requisições do mesmo site
  const self = new URL(request.url).origin;
  if (origin === self) return true;
  const extra = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return extra.indexOf(origin) !== -1;
}

/* ---------- Handler ---------- */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!originAllowed(request, env)) return json(403, { ok: false, error: "origem_nao_permitida" });

  const type = request.headers.get("Content-Type") || "";
  if (type.indexOf("application/json") !== 0) return json(415, { ok: false, error: "formato_invalido" });

  const declared = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: "envio_muito_grande" });

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "envio_muito_grande" });
    body = JSON.parse(text);
  } catch (e) {
    return json(400, { ok: false, error: "json_invalido" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { ok: false, error: "json_invalido" });

  // Proteções contra envios automatizados
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return json(400, { ok: false, error: "envio_recusado" });
  }
  const elapsed = Number(body.t);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) {
    return json(400, { ok: false, error: "envio_recusado" });
  }

  const { data, errors } = validate(body);
  if (Object.keys(errors).length) return json(422, { ok: false, error: "validacao", fields: errors });

  const cfg = googleConfig(env);
  if (!cfg) {
    console.error("[diagnostico] variáveis do Google não configuradas");
    return json(503, { ok: false, error: "nao_configurado" });
  }

  const tab = cfg.GOOGLE_SHEET_TAB;

  let token = null;
  try {
    token = await getAccessToken(cfg);
    if (await alreadyRecorded(cfg, token, tab, data.id)) {
      return json(200, { ok: true, id: data.id, duplicate: true });
    }
    await appendRow(cfg, token, tab, buildRow(data));
    return json(200, { ok: true, id: data.id });
  } catch (err) {
    // Registra só um código técnico (ex.: sheets_append_403). Mensagens de
    // terceiros não são registradas, para não vazar URLs, tokens ou dados.
    const msg = (err && typeof err.message === "string") ? err.message : "";
    const code = /^(google_auth|sheets)_[a-z0-9_]+$/.test(msg) ? msg
      : (err && err.name === "AbortError") ? "google_timeout"
      : "erro_interno";
    console.error("[diagnostico] falha ao gravar: " + code);
    if (code === "sheets_aba_nao_encontrada" && token) {
      // Ajuda a corrigir a configuração: mostra a aba esperada e as existentes
      const names = await tabNames(cfg, token);
      console.error("[diagnostico] aba esperada: \"" + tab + "\" | abas na planilha: " +
        (names ? JSON.stringify(names) : "não foi possível listar") +
        " | ajuste o nome da aba ou a variável GOOGLE_SHEET_TAB");
    }
    // Credencial recusada ou token revogado: descarta o token guardado
    if (/auth|_401$/.test(code) || code === "erro_interno") cachedToken = null;
    return json(502, { ok: false, error: "falha_planilha" });
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  // Abrir o endereço no navegador (GET) mostra que a rota existe, sem gravar nada
  return new Response(JSON.stringify({ ok: false, error: "metodo_nao_permitido", info: "Este endereço recebe apenas envios do formulário (POST)." }), {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
