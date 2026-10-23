
import { onRequestPost } from "../functions/api/diagnostico.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/diagnostico") {
      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "metodo_nao_permitido"
          }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json; charset=utf-8"
            }
          }
        );
      }

      return onRequestPost({
        request,
        env,
        params: {},
        waitUntil: promise => ctx.waitUntil(promise),
        passThroughOnException() {}
      });
    }

    return env.ASSETS.fetch(request);
  }
};
