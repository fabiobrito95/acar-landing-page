/* ==========================================================================
   ACAR™ · Formulário de diagnóstico · form.js
   Etapas, validação, máscara de WhatsApp, rascunho temporário e envio.
   Sem dependências. Nenhuma credencial fica neste arquivo: o envio vai para
   /api/diagnostico (Cloudflare Pages Function), que guarda os segredos no
   servidor. Nenhum dado preenchido é registrado no console.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Configuração ----------
     endpoint:   Cloudflare Pages Function que grava os dados na planilha
                 (functions/api/diagnostico.js). Vazio = envio NÃO conectado:
                 o formulário valida tudo, mas não transmite nada e não
                 redireciona para a página de obrigado.
     privacyUrl: endereço da política de privacidade.
     thanksUrl:  página exibida SOMENTE depois que o servidor confirma a
                 gravação na planilha.
     leadKey:    chave (sessionStorage) com o ID do envio confirmado. A página
                 de obrigado usa esse ID uma única vez para o evento Lead. */
  var CONFIG = {
    endpoint: "/api/diagnostico",
    privacyUrl: "/privacidade/",
    thanksUrl: "/obrigado/",
    storageKey: "acar-diagnostico-rascunho",
    leadKey: "acar-lead-confirmado",
    timeoutMs: 20000
  };

  var startedAt = Date.now();   // início do preenchimento (mantido no rascunho)
  var submitted = false;        // envio confirmado nesta página

  var TOTAL_STEPS = 3;
  var STEP_TITLES = ["Sobre você e sua empresa", "Momento do negócio", "Contato"];

  var form = document.getElementById("formulario");
  if (!form) return;

  var steps = form.querySelectorAll(".form-step");
  var stepperItems = document.querySelectorAll("#stepper .stepper__item");
  var stepper = document.getElementById("stepper");
  var progressText = document.getElementById("form-progress-text");
  var btnBack = document.getElementById("btn-voltar");
  var btnNext = document.getElementById("btn-avancar");
  var btnNextLabel = document.getElementById("btn-avancar-label");
  var btnClear = document.getElementById("btn-limpar");
  var statusBox = document.getElementById("form-status");
  var current = 1;
  var sending = false;

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- Mensagens de erro ---------- */
  var MESSAGES = {
    nome: "Informe seu nome e sobrenome.",
    empresa: "Informe o nome da empresa.",
    segmento: "Selecione o segmento da empresa.",
    segmento_outro: "Informe qual é o segmento.",
    cidade: "Informe a cidade e o estado.",
    desafio: "Selecione o principal desafio comercial.",
    desafio_outro: "Informe qual é o desafio.",
    objetivo: "Descreva o principal objetivo.",
    prazo: "Selecione o prazo.",
    whatsapp: "Informe um WhatsApp válido com DDD, por exemplo (11) 91234-5678.",
    email: "Informe um e-mail válido, por exemplo nome@empresa.com.br.",
    instagram: "Use apenas letras, números, ponto e sublinhado. Ex.: @suaempresa",
    consentimento: "Para continuar, autorize o contato sobre esta solicitação."
  };

  /* ---------- Utilidades ---------- */
  function $(name) {
    return form.elements[name];
  }

  function valueOf(name) {
    var el = $(name);
    if (!el) return "";
    if (el instanceof RadioNodeList) return el.value || "";
    if (el.type === "checkbox") return el.checked ? el.value : "";
    return (el.value || "").trim();
  }

  function digits(str) {
    return (str || "").replace(/\D/g, "");
  }

  function conditionMet(rule) {
    // rule no formato "campo=Valor"
    var parts = rule.split("=");
    return valueOf(parts[0]) === parts[1];
  }

  /* ---------- Rascunho temporário (sessionStorage) ----------
     Guarda as respostas só nesta aba, até o envio, até a pessoa apagar ou até
     a aba ser fechada. Nunca guarda o campo anti-spam. */
  function saveDraft() {
    try {
      var data = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.name === "website") return;
        if (el.type === "radio") { if (el.checked) data[el.name] = el.value; return; }
        if (el.type === "checkbox") { data[el.name] = el.checked; return; }
        data[el.name] = el.value;
      });
      data.__step = current;
      data.__id = submissionId;
      data.__t0 = startedAt;
      sessionStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
    } catch (e) { /* armazenamento indisponível: o formulário segue funcionando */ }
  }

  function loadDraft() {
    try {
      var raw = sessionStorage.getItem(CONFIG.storageKey);
      if (!raw) return 1;
      var data = JSON.parse(raw);
      if (isUuid(data.__id)) submissionId = data.__id;
      // Quem recarrega a página continua com o tempo de preenchimento original
      var t0 = Number(data.__t0);
      if (t0 > 0 && t0 <= Date.now()) startedAt = t0;
      Object.keys(data).forEach(function (name) {
        if (name.indexOf("__") === 0) return;
        var el = $(name);
        if (!el) return;
        if (el instanceof RadioNodeList) {
          Array.prototype.forEach.call(el, function (r) { r.checked = r.value === data[name]; });
        } else if (el.type === "checkbox") {
          el.checked = !!data[name];
        } else {
          el.value = data[name];
        }
      });
      var step = parseInt(data.__step, 10);
      return step >= 1 && step <= TOTAL_STEPS ? step : 1;
    } catch (e) {
      return 1;
    }
  }

  function clearDraft() {
    try { sessionStorage.removeItem(CONFIG.storageKey); } catch (e) { /* nada a fazer */ }
  }

  /* ---------- ID do envio ----------
     Gerado uma vez por preenchimento. Se a mesma solicitação chegar duas
     vezes ao servidor (clique duplo, nova tentativa), ela não vira duas
     linhas na planilha. Não contém dados pessoais. */
  function isUuid(v) {
    return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  var submissionId = newId();

  /* ---------- Campos condicionais ("Outro") ---------- */
  function updateConditionals() {
    form.querySelectorAll("[data-show-when]").forEach(function (wrap) {
      var show = conditionMet(wrap.getAttribute("data-show-when"));
      wrap.hidden = !show;
      if (!show) {
        var input = wrap.querySelector("input, textarea, select");
        if (input) clearError(input.name);
      }
    });
  }

  /* ---------- Máscara de WhatsApp: (11) 91234-5678 ou (11) 1234-5678 ---------- */
  function formatPhone(value) {
    var d = digits(value).slice(0, 11);
    if (d.length === 0) return "";
    if (d.length <= 2) return "(" + d;
    var ddd = d.slice(0, 2);
    var rest = d.slice(2);
    if (rest.length <= 4) return "(" + ddd + ") " + rest;
    if (d.length === 11) return "(" + ddd + ") " + rest.slice(0, 5) + "-" + rest.slice(5);
    return "(" + ddd + ") " + rest.slice(0, 4) + "-" + rest.slice(4);
  }

  function isValidPhone(value) {
    var d = digits(value);
    if (d.length !== 10 && d.length !== 11) return false;
    // DDD brasileiro: dois dígitos de 1 a 9 (11 a 99)
    if (!/^[1-9][1-9]/.test(d)) return false;
    // Celular com 11 dígitos começa com 9 depois do DDD
    if (d.length === 11 && d.charAt(2) !== "9") return false;
    // Rejeita sequências repetidas (ex.: 11 99999-9999 com todos iguais)
    if (/^(\d)\1+$/.test(d.slice(2))) return false;
    return true;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function normalizeInstagram(value) {
    var v = (value || "").trim();
    if (!v) return "";
    // Aceita @perfil, instagram.com/perfil e https://(www.)instagram.com/perfil
    v = v.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
    v = v.replace(/^@+/, "");
    return v ? "@" + v : "";
  }

  /* ---------- Validação ---------- */
  function fieldWrapper(name) {
    var el = $(name);
    if (!el) return null;
    if (el instanceof RadioNodeList) return document.getElementById(name + "-group");
    return el;
  }

  function setError(name, message) {
    var target = fieldWrapper(name);
    var box = document.getElementById(name + "-error");
    if (target) target.setAttribute("aria-invalid", "true");
    if (box) box.textContent = message;
  }

  function clearError(name) {
    var target = fieldWrapper(name);
    var box = document.getElementById(name + "-error");
    if (target) target.removeAttribute("aria-invalid");
    if (box) box.textContent = "";
  }

  // Retorna a mensagem de erro do campo, ou "" se estiver válido
  function check(name) {
    var v = valueOf(name);
    switch (name) {
      case "nome":
        return v.split(/\s+/).filter(function (p) { return p.length > 0; }).length >= 2 ? "" : MESSAGES.nome;
      case "empresa":
      case "segmento":
      case "desafio":
      case "prazo":
        return v ? "" : MESSAGES[name];
      case "cidade":
      case "objetivo":
        return v.length >= 3 ? "" : MESSAGES[name];
      case "segmento_outro":
      case "desafio_outro":
        var rule = $(name).getAttribute("data-required-when");
        return !conditionMet(rule) || v.length >= 2 ? "" : MESSAGES[name];
      case "whatsapp":
        return isValidPhone(v) ? "" : MESSAGES.whatsapp;
      case "email":
        return isValidEmail(v) ? "" : MESSAGES.email;
      case "instagram":
        if (!v) return "";
        return /^@[A-Za-z0-9._]{1,30}$/.test(normalizeInstagram(v)) ? "" : MESSAGES.instagram;
      case "consentimento":
        return $(name).checked ? "" : MESSAGES.consentimento;
      default:
        return "";
    }
  }

  var STEP_FIELDS = {
    1: ["nome", "empresa", "segmento", "segmento_outro", "cidade"],
    2: ["desafio", "desafio_outro", "objetivo", "prazo"],
    3: ["whatsapp", "email", "instagram", "consentimento"]
  };

  function focusField(name) {
    var el = $(name);
    if (!el) return;
    if (el instanceof RadioNodeList) el = el[0];
    el.focus();
  }

  function validateStep(step) {
    var firstInvalid = null;
    STEP_FIELDS[step].forEach(function (name) {
      var msg = check(name);
      if (msg) {
        setError(name, msg);
        if (!firstInvalid) firstInvalid = name;
      } else {
        clearError(name);
      }
    });
    if (firstInvalid) focusField(firstInvalid);
    return !firstInvalid;
  }

  /* ---------- Navegação entre etapas ---------- */
  function showStep(step, moveFocus) {
    current = step;
    steps.forEach(function (fs) {
      fs.hidden = parseInt(fs.getAttribute("data-step"), 10) !== step;
    });

    stepperItems.forEach(function (li, i) {
      var n = i + 1;
      li.classList.toggle("is-current", n === step);
      li.classList.toggle("is-done", n < step);
      if (n === step) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    stepper.style.setProperty("--progress", (step - 1) / (TOTAL_STEPS - 1));

    progressText.textContent = "Etapa " + step + " de " + TOTAL_STEPS + ": " + STEP_TITLES[step - 1];
    btnBack.hidden = step === 1;
    btnNextLabel.textContent = step === TOTAL_STEPS ? "Enviar solicitação" : "Avançar";

    if (moveFocus) {
      var title = form.querySelector('.form-step[data-step="' + step + '"] .form-step__title');
      form.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
      if (title) title.focus({ preventScroll: true });
    }
    saveDraft();
  }

  /* ---------- Dados para envio ---------- */
  function buildPayload() {
    return {
      nome: valueOf("nome"),
      empresa: valueOf("empresa"),
      segmento: valueOf("segmento") === "Outro" ? "Outro: " + valueOf("segmento_outro") : valueOf("segmento"),
      cidade_estado: valueOf("cidade"),
      faturamento: valueOf("faturamento"),
      desafio: valueOf("desafio") === "Outro" ? "Outro: " + valueOf("desafio_outro") : valueOf("desafio"),
      desafio_detalhe: valueOf("desafio_detalhe"),
      objetivo: valueOf("objetivo"),
      prazo: valueOf("prazo"),
      whatsapp: digits(valueOf("whatsapp")),
      email: valueOf("email").toLowerCase(),
      instagram: normalizeInstagram(valueOf("instagram")),
      consentimento: $("consentimento").checked,
      origem: window.location.pathname,
      submission_id: submissionId,
      t: Date.now() - startedAt, // tempo de preenchimento (anti-robô)
      website: valueOf("website") // honeypot: deve chegar vazio ao servidor
    };
  }

  // Campo do servidor → campo do formulário e etapa onde ele está
  var SERVER_FIELDS = {
    nome: "nome", empresa: "empresa", segmento: "segmento", cidade: "cidade",
    faturamento: "faturamento", desafio: "desafio", objetivo: "objetivo", prazo: "prazo",
    whatsapp: "whatsapp", email: "email", instagram: "instagram", consentimento: "consentimento"
  };

  function stepOf(name) {
    for (var s = 1; s <= TOTAL_STEPS; s++) {
      if (STEP_FIELDS[s].indexOf(name) !== -1) return s;
    }
    return 0;
  }

  function showServerErrors(fields) {
    var first = 0;
    Object.keys(fields || {}).forEach(function (key) {
      var name = SERVER_FIELDS[key];
      if (!name) return;
      setError(name, MESSAGES[name] || fields[key]);
      var s = stepOf(name);
      if (s && (!first || s < first)) first = s;
    });
    return first;
  }

  function setStatus(type, html) {
    statusBox.className = "form-status" + (type ? " form-status--" + type : "");
    statusBox.innerHTML = html || "";
  }

  function setSending(on) {
    sending = on;
    btnNext.disabled = on;
    btnBack.disabled = on;
    btnNextLabel.textContent = on ? "Enviando…" : (current === TOTAL_STEPS ? "Enviar solicitação" : "Avançar");
  }

  /* ---------- Envio ----------
     A página de obrigado só abre quando o servidor responde { ok: true, id },
     o que acontece apenas depois que o Google Sheets confirma a gravação.
     Qualquer outra resposta mantém a pessoa no formulário, com os dados. */
  var ERRORS = {
    nao_configurado: "<strong>O envio está temporariamente indisponível.</strong> Suas respostas continuam preenchidas. Tente novamente mais tarde.",
    falha_planilha: "<strong>Não foi possível registrar sua solicitação agora.</strong> Suas respostas continuam preenchidas. Tente novamente em alguns instantes.",
    envio_recusado: "<strong>Não foi possível enviar.</strong> Confira as respostas e tente novamente em alguns segundos.",
    rede: "<strong>Não foi possível enviar agora.</strong> Suas respostas continuam preenchidas. Verifique sua conexão e tente novamente."
  };

  function submitData(payload) {
    // Sem endpoint configurado nada é transmitido (e nada é registrado no console)
    if (!CONFIG.endpoint) {
      setStatus("error", ERRORS.nao_configurado);
      return;
    }

    setSending(true);
    setStatus("", "");
    var controller = "AbortController" in window ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, CONFIG.timeoutMs) : null;

    fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { status: res.status, data: data || {} };
        });
      })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        var data = r.data;

        if (r.status === 200 && data.ok === true && isUuid(data.id) && data.id === submissionId) {
          try { sessionStorage.setItem(CONFIG.leadKey, data.id); } catch (e) { /* sem Lead, mas o envio valeu */ }
          submitted = true;
          clearDraft();
          window.location.assign(CONFIG.thanksUrl);
          return;
        }

        setSending(false);
        if (r.status === 422 && data.fields) {
          var step = showServerErrors(data.fields);
          if (step) showStep(step, true);
          setStatus("error", "<strong>Algumas respostas precisam de ajuste.</strong> Confira os campos indicados.");
          return;
        }
        setStatus("error", ERRORS[data.error] || ERRORS.rede);
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        setSending(false);
        setStatus("error", ERRORS.rede);
      });
  }

  /* ---------- Eventos ---------- */
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (sending) return;
    setStatus("", "");

    if (!validateStep(current)) return;

    if (current < TOTAL_STEPS) {
      showStep(current + 1, true);
      return;
    }

    // Última etapa: confere tudo de novo antes de enviar
    for (var s = 1; s <= TOTAL_STEPS; s++) {
      if (!validateStep(s)) {
        showStep(s, true);
        validateStep(s);
        return;
      }
    }

    var payload = buildPayload();
    if (payload.website) return; // provável robô: ignora em silêncio
    submitData(payload);
  });

  btnBack.addEventListener("click", function () {
    if (current > 1 && !sending) {
      setStatus("", "");
      showStep(current - 1, true);
    }
  });

  btnClear.addEventListener("click", function () {
    form.reset();
    clearDraft();
    submissionId = newId();
    startedAt = Date.now();
    Object.keys(MESSAGES).forEach(clearError);
    updateConditionals();
    setStatus("", "");
    showStep(1, true);
  });

  form.addEventListener("input", function (event) {
    var el = event.target;
    if (el.name === "whatsapp") {
      var formatted = formatPhone(el.value);
      if (formatted !== el.value) el.value = formatted;
    }
    if (el.name && document.getElementById(el.name + "-error") && document.getElementById(el.name + "-error").textContent) {
      if (!check(el.name)) clearError(el.name);
    }
    saveDraft();
  });

  form.addEventListener("change", function (event) {
    var el = event.target;
    if (el.name === "segmento" || el.name === "desafio") updateConditionals();
    if (el.name && !check(el.name)) clearError(el.name);
    if (el.name === "instagram") el.value = normalizeInstagram(el.value);
    saveDraft();
  });

  // Valida o campo ao sair dele, só se a pessoa já digitou algo
  form.addEventListener("focusout", function (event) {
    var el = event.target;
    if (!el.name || el.type === "radio" || el.type === "checkbox" || !el.value) return;
    var msg = check(el.name);
    if (msg) setError(el.name, msg);
  });

  /* ---------- Link da política de privacidade (abre em nova aba para não perder o preenchimento) ---------- */
  document.querySelectorAll("[data-privacy-link]").forEach(function (link) {
    link.setAttribute("href", CONFIG.privacyUrl);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");
  });

  /* ---------- Botão "Voltar" do navegador ----------
     O navegador pode restaurar esta página da memória (bfcache) com o botão
     ainda em "Enviando…". Destrava o botão e, se o envio já foi concluído,
     começa um formulário novo, para não reenviar a mesma solicitação. */
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    setSending(false);
    setStatus("", "");
    if (submitted) {
      submitted = false;
      form.reset();
      clearDraft();
      submissionId = newId();
      startedAt = Date.now();
      Object.keys(MESSAGES).forEach(clearError);
      updateConditionals();
      showStep(1, false);
    }
  });

  /* ---------- Início ----------
     O navegador pode repor sozinho valores antigos (por exemplo, ao voltar
     da página de obrigado). Começamos limpos e restauramos só o rascunho
     desta aba, que é apagado depois de um envio confirmado. */
  function startFromDraft() {
    form.reset();
    var startStep = loadDraft();
    var wa = $("whatsapp");
    if (wa && wa.value) wa.value = formatPhone(wa.value);
    updateConditionals();
    showStep(startStep, false);
  }

  startFromDraft();

  // Em voltar/avançar, o navegador repõe os campos depois deste script:
  // aplicamos o rascunho de novo quando a página termina de carregar.
  window.addEventListener("load", function () {
    var nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
    if (nav && nav.type === "back_forward") setTimeout(startFromDraft, 0);
  });
})();
