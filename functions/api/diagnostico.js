
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzS4W-Umu9dK_tO8eHRIkFj2hMO8XXx-8yvtg0gDFZnCjZfBUm2rqmtRGQadjeseLRexQ/exec";

const MAX_BODY_BYTES = 8 * 1024;
const MIN_FILL_MS = 3000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const origin = request.headers.get("Origin");
    const allowedOrigins = [
      new URL(request.url).origin,
      "https://fabiosbrito.com",
      "https://www.fabiosbrito.com"
    ];

    if (origin && !allowedOrigins.includes(origin)) {
      return json(403, { ok: false, error: "origem_nao_permitida" });
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.startsWith("application/json")) {
      return json(415, { ok: false, error: "formato_invalido" });
    }

    const text = await request.text();

    if (text.length > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: "envio_muito_grande" });
    }

    const dados = JSON.parse(text);

    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
      return json(400, { ok: false, error: "json_invalido" });
    }

    if (typeof dados.website === "string" && dados.website.trim()) {
      return json(400, { ok: false, error: "envio_recusado" });
    }

    if (!Number.isFinite(Number(dados.t)) || Number(dados.t) < MIN_FILL_MS) {
      return json(400, { ok: false, error: "envio_recusado" });
    }

    const id = String(dados.submission_id || "").trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return json(400, { ok: false, error: "validacao" });
    }

    const resposta = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(dados),
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });

    if (!resposta.ok) {
      console.error("Apps Script HTTP:", resposta.status);
      return json(502, { ok: false, error: "falha_planilha" });
    }

    const resultado = await resposta.json();

    if (resultado.ok !== true || resultado.id !== id) {
      console.error("Apps Script não confirmou a gravação.");
      return json(502, { ok: false, error: "falha_planilha" });
    }

    return json(200, { ok: true, id });
  } catch (erro) {
    console.error("Erro no diagnóstico:", erro.message);

    return json(502, {
      ok: false,
      error: "falha_planilha"
    });
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }

  return json(405, {
    ok: false,
    error: "metodo_nao_permitido"
  });
}
