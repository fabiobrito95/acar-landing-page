/* ==========================================================================
   ACAR™ · Diagnóstico Estratégico · script.js
   Interações e animações da página. Sem dependências.
   Carregado no <head> (sem defer) para marcar <html class="js"> antes da
   primeira pintura, evitando que o conteúdo pisque antes da entrada.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Configuração ----------
     Destino de TODOS os botões "Solicitar diagnóstico" (cabeçalho, hero e
     fim das seções): a página do formulário em /diagnostico/. O mesmo
     destino também está escrito no href de cada botão no HTML, para que os
     links funcionem mesmo sem JavaScript. */
  var CONFIG = {
    diagnosticoUrl: "/diagnostico/"
  };

  var root = document.documentElement;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Com JS ativo, os elementos .reveal começam ocultos (ver styles.css).
  root.classList.add("js");

  /* ---------- 1. Entrada do cabeçalho e do hero ---------- */
  function startEntrance() {
    if (reducedMotion.matches) {
      root.classList.add("is-ready");
      return;
    }
    // Dois frames garantem que o estado inicial foi pintado antes da transição.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add("is-ready");
      });
    });
  }

  /* ---------- 2. Reflexo do CTA principal acompanhando o cursor ---------- */
  function initButtonGlow() {
    var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!finePointer.matches || reducedMotion.matches) return;

    document.querySelectorAll(".btn--primary").forEach(function (btn) {
      btn.addEventListener("pointermove", function (event) {
        var rect = btn.getBoundingClientRect();
        btn.style.setProperty("--mx", event.clientX - rect.left + "px");
        btn.style.setProperty("--my", event.clientY - rect.top + "px");
      });
      btn.addEventListener("pointerleave", function () {
        btn.style.removeProperty("--mx");
        btn.style.removeProperty("--my");
      });
    });
  }

  /* ---------- 3. Ciclo ACAR: pausa a órbita fora da tela ---------- */
  // A animação em si é CSS (styles.css, "Ciclo ACAR"). Aqui só economizamos
  // processamento quando o diagrama não está visível.
  function initOrbitVisibility() {
    var visual = document.querySelector(".hero__visual");
    if (!visual || !("IntersectionObserver" in window)) return;

    new IntersectionObserver(function (entries) {
      visual.classList.toggle("is-paused", !entries[0].isIntersecting);
    }).observe(visual);
  }

  /* ---------- 4. Entrada das seções ao rolar (.reveal-on-scroll) ---------- */
  function initScrollReveal() {
    var items = document.querySelectorAll(".reveal-on-scroll");
    if (!items.length) return;

    // Sem suporte ou com movimento reduzido: mostra tudo imediatamente.
    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.15 });

    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- 5. Destino dos CTAs de diagnóstico ---------- */
  // Aplica CONFIG.diagnosticoUrl a todos os botões que levam ao diagnóstico.
  function initDiagnosticoLinks() {
    var links = document.querySelectorAll('[data-cta="diagnostico"]');
    links.forEach(function (link) {
      link.setAttribute("href", CONFIG.diagnosticoUrl);
    });
  }

  /* ---------- 6. Gráfico do bloco 4: pausa o fluxo fora da tela ---------- */
  function initFlowVisibility() {
    var flow = document.querySelector(".shift__visual");
    if (!flow || !("IntersectionObserver" in window)) return;

    new IntersectionObserver(function (entries) {
      flow.classList.toggle("is-paused", !entries[0].isIntersecting);
    }).observe(flow);
  }

  /* ---------- 7. Bloco 8: luz percorrendo as etapas 01 → 02 → 03 ---------- */
  // A animação é CSS (styles.css, "Luz percorrendo a linha"). Aqui medimos os
  // centros dos três círculos para a luz seguir o caminho certo na linha
  // horizontal (desktop) ou vertical (celular), e pausamos fora da tela.
  function initProcessLight() {
    var proc = document.querySelector(".process");
    if (!proc) return;
    var light = proc.querySelector(".process__light");
    var nums = proc.querySelectorAll(".process__num");
    if (!light || nums.length < 3 || reducedMotion.matches) return;

    function measure() {
      var box = proc.getBoundingClientRect();
      var pts = [];
      nums.forEach(function (num, i) {
        var r = num.getBoundingClientRect();
        var x = r.left + r.width / 2 - box.left;
        var y = r.top + r.height / 2 - box.top;
        pts.push([x, y]);
        light.style.setProperty("--x" + (i + 1), x + "px");
        light.style.setProperty("--y" + (i + 1), y + "px");
      });
      var vertical = Math.abs(pts[2][0] - pts[0][0]) < 4;
      light.style.setProperty("--angle", vertical ? "90deg" : "0deg");
      proc.classList.add("has-path");
    }

    measure();
    if ("ResizeObserver" in window) {
      new ResizeObserver(measure).observe(proc);
    } else {
      window.addEventListener("resize", measure);
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        proc.classList.toggle("is-paused", !entries[0].isIntersecting);
      }).observe(proc);
    }
  }

  /* ---------- 8. Bloco 11: acordeão das perguntas frequentes ---------- */
  // Cada pergunta é um <button> com aria-expanded/aria-controls; a altura
  // é animada no CSS. Várias respostas podem ficar abertas ao mesmo tempo.
  function initFaq() {
    var triggers = document.querySelectorAll(".faq__trigger");
    triggers.forEach(function (trigger) {
      // O HTML vem aberto (para quem navega sem JavaScript); aqui fechamos.
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", function () {
        var item = trigger.closest(".faq__item");
        var open = trigger.getAttribute("aria-expanded") === "true";
        trigger.setAttribute("aria-expanded", open ? "false" : "true");
        item.classList.toggle("is-open", !open);
      });
    });
  }

  /* ---------- 9. Bloco 12: pausa a luz da linha final fora da tela ---------- */
  // A animação é CSS (styles.css, "Luz percorrendo a linha do fechamento").
  function initFinalMark() {
    var mark = document.querySelector(".final__mark");
    if (!mark || !("IntersectionObserver" in window)) return;

    new IntersectionObserver(function (entries) {
      mark.classList.toggle("is-paused", !entries[0].isIntersecting);
    }).observe(mark);
  }

  /* ---------- 10. Bloco 9: pausa a luz do contorno do card ACAR™ fora da tela ---------- */
  function initAcarCardLight() {
    var card = document.querySelector(".compare-card--acar");
    if (!card || !("IntersectionObserver" in window)) return;

    new IntersectionObserver(function (entries) {
      card.classList.toggle("is-paused", !entries[0].isIntersecting);
    }).observe(card);
  }

  function init() {
    initDiagnosticoLinks();
    initAcarCardLight();
    initFlowVisibility();
    initProcessLight();
    initFaq();
    initFinalMark();
    startEntrance();
    initButtonGlow();
    initOrbitVisibility();
    initScrollReveal();
    // Próximas seções: registre aqui as inicializações de cada bloco.
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
