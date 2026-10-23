/* ==========================================================================
   ACAR™ · tracking.js
   Consentimento para cookies de publicidade + Meta Pixel. Sem dependências.

   Regras:
   - O Meta Pixel só é carregado DEPOIS que a pessoa clica em "Aceitar".
     Sem escolha ou com "Recusar", nenhum script da Meta é baixado.
   - PageView: uma vez por página carregada (landing, formulário, obrigado).
     Páginas com <body data-pixel-pageview="false"> não enviam PageView.
   - Lead: só na página com <body data-pixel-lead>, e só se existir na aba o
     ID de um envio que o servidor confirmou (gravado pelo formulário). O ID é
     usado uma única vez e apagado: atualizar a página ou acessá-la direto
     não gera um novo Lead. Nenhum dado pessoal vai para a Meta.
   - A escolha fica salva neste navegador (localStorage) por até 12 meses e
     pode ser mudada em "Preferências de cookies", no rodapé.
   ========================================================================== */

(function () {
  "use strict";

  var CONFIG = {
    pixelId: "535225338892600",
    consentKey: "acar-consentimento",
    consentVersion: 1,
    consentMaxAgeDays: 365,
    leadKey: "acar-lead-confirmado",   // o mesmo de diagnostico/form.js
    leadsDoneKey: "acar-leads-contabilizados",
    privacyUrl: "/privacidade/"
  };

  var banner = null;

  /* ---------- Armazenamento da escolha ---------- */
  function readConsent() {
    try {
      var raw = localStorage.getItem(CONFIG.consentKey);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (c.v !== CONFIG.consentVersion || typeof c.marketing !== "boolean") return null;
      var age = (Date.now() - new Date(c.em).getTime()) / 864e5;
      if (!(age >= 0 && age <= CONFIG.consentMaxAgeDays)) return null;
      return c.marketing;
    } catch (e) {
      return null;
    }
  }

  function saveConsent(marketing) {
    try {
      localStorage.setItem(CONFIG.consentKey, JSON.stringify({
        v: CONFIG.consentVersion,
        marketing: marketing,
        em: new Date().toISOString()
      }));
    } catch (e) { /* sem armazenamento: a escolha vale só para esta página */ }
  }

  /* ---------- Meta Pixel ---------- */
  function loadPixel() {
    // Já carregado (ex.: recusou e aceitou de novo nesta página): só reativa
    if (window.__acarPixelLoaded) {
      if (window.fbq) window.fbq("consent", "grant");
      return;
    }
    window.__acarPixelLoaded = true;

    /* Código base oficial do Meta Pixel */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0";
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

    window.fbq("consent", "grant");
    window.fbq("init", CONFIG.pixelId);
    if (document.body.getAttribute("data-pixel-pageview") !== "false") {
      window.fbq("track", "PageView");
    }
  }

  function revokePixel() {
    if (window.fbq) window.fbq("consent", "revoke");
    // Remove o cookie de navegador que o Pixel cria (_fbp), se existir
    var host = location.hostname;
    var parts = host.split(".");
    var domains = ["", host];
    if (parts.length > 2) domains.push("." + parts.slice(-2).join("."));
    if (parts.length > 3) domains.push("." + parts.slice(-3).join("."));
    domains.push("." + host);
    ["_fbp", "_fbc"].forEach(function (name) {
      domains.forEach(function (d) {
        document.cookie = name + "=; Max-Age=0; path=/" + (d ? "; domain=" + d : "");
      });
    });
  }

  /* ---------- Evento Lead (página de obrigado) ---------- */
  function takeLeadId() {
    try {
      var id = sessionStorage.getItem(CONFIG.leadKey);
      if (id) sessionStorage.removeItem(CONFIG.leadKey);
      return id;
    } catch (e) {
      return null;
    }
  }

  // IDs de envios que já geraram Lead neste navegador (só IDs aleatórios,
  // nenhum dado pessoal). Impede contar duas vezes o mesmo envio.
  function alreadyCounted(id) {
    try {
      var list = JSON.parse(localStorage.getItem(CONFIG.leadsDoneKey) || "[]");
      return Array.isArray(list) && list.indexOf(id) !== -1;
    } catch (e) {
      return false;
    }
  }

  function markCounted(id) {
    try {
      var list = JSON.parse(localStorage.getItem(CONFIG.leadsDoneKey) || "[]");
      if (!Array.isArray(list)) list = [];
      list.push(id);
      localStorage.setItem(CONFIG.leadsDoneKey, JSON.stringify(list.slice(-20)));
    } catch (e) { /* sem armazenamento: a chave da aba já foi consumida */ }
  }

  function handleLead(consent) {
    if (!document.body.hasAttribute("data-pixel-lead")) return;
    if (consent === null) return; // aguarda a escolha: o ID continua guardado
    var id = takeLeadId();         // usado uma única vez, com ou sem consentimento
    if (!id || consent !== true || alreadyCounted(id)) return;
    markCounted(id);
    // eventID ajuda a Meta a descartar duplicatas; não é dado pessoal
    window.fbq("track", "Lead", {}, { eventID: id });
  }

  /* ---------- Aplicar a escolha ---------- */
  function apply(consent) {
    if (consent === true) loadPixel();
    handleLead(consent);
  }

  function choose(marketing) {
    var before = readConsent();
    saveConsent(marketing);
    hideBanner();
    if (marketing) apply(true);
    else {
      if (before === true || window.__acarPixelLoaded) revokePixel();
      apply(false);
    }
  }

  /* ---------- Aviso de cookies ---------- */
  function buildBanner() {
    var el = document.createElement("section");
    el.className = "cookie-banner";
    el.setAttribute("aria-labelledby", "cookie-banner-title");
    el.hidden = true;
    el.innerHTML =
      '<div class="cookie-banner__inner">' +
        '<div class="cookie-banner__text">' +
          '<h2 class="cookie-banner__title" id="cookie-banner-title">Sua privacidade</h2>' +
          '<p>Usamos o Meta Pixel para medir o resultado dos nossos anúncios. Ele só é ativado se você aceitar. ' +
          'Se recusar, o site e o formulário funcionam normalmente. ' +
          '<a href="' + CONFIG.privacyUrl + '">Política de privacidade</a></p>' +
        '</div>' +
        '<div class="cookie-banner__actions">' +
          '<button type="button" class="btn btn--outline cookie-banner__btn" data-consent="recusar">Recusar</button>' +
          '<button type="button" class="btn btn--primary cookie-banner__btn" data-consent="aceitar">Aceitar</button>' +
        '</div>' +
      '</div>';
    el.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-consent]");
      if (!btn) return;
      choose(btn.getAttribute("data-consent") === "aceitar");
    });
    el.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && readConsent() !== null) hideBanner();
    });
    // Logo no início da página, para quem navega pelo teclado chegar a ele cedo
    var skip = document.querySelector(".skip-link");
    if (skip && skip.parentNode === document.body) skip.insertAdjacentElement("afterend", el);
    else document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function showBanner(moveFocus) {
    if (!banner) banner = buildBanner();
    banner.hidden = false;
    document.documentElement.classList.add("has-cookie-banner");
    if (moveFocus) {
      var first = banner.querySelector("[data-consent]");
      if (first) first.focus();
    }
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
    document.documentElement.classList.remove("has-cookie-banner");
  }

  /* ---------- Início ---------- */
  function init() {
    // Link "Preferências de cookies" (rodapé) reabre o aviso
    document.querySelectorAll("[data-consent-open]").forEach(function (btn) {
      btn.addEventListener("click", function () { showBanner(true); });
    });

    var consent = readConsent();
    if (consent === null) showBanner(false);
    apply(consent);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
