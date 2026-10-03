/* Conferência do texto formal contra o que o contador escreveu.
   Mesma regra de apontamentos/conferencia.py: todo número do texto formal
   precisa existir no original (ou nos dados digitados) e todo número do
   original precisa continuar no texto formal. */
"use strict";

(function (global) {
  const NUMERO = /\d+(?:[.,\/\-]\d+)*/g;
  const BR = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$|^\d+,\d+$/;
  const US_DEC = /^\d+\.\d{1,2}$/;
  const DATA = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?$/;
  const DATA_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const MES_ANO = /^(\d{1,2})\/(\d{4})$/;

  function normal(n) {
    // mesma forma do Decimal.normalize() do Python: sem zeros à direita
    let s = String(n);
    if (s.includes("e")) s = n.toFixed(10);
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  function aparar(t) { return t.replace(/^[.,\/\-]+|[.,\/\-]+$/g, ""); }

  function formas(token) {
    const t = aparar(token);
    const f = new Set(["txt:" + t.replace(/\D/g, "")]);
    let m = t.match(DATA_ISO);
    if (m) {
      const [, a, mes, d] = m;
      f.add("data:" + +d + "/" + +mes); f.add("data:" + +d + "/" + +mes + "/" + +a); f.add("num:" + +a);
      return f;
    }
    m = t.match(MES_ANO);
    if (m && +m[1] >= 1 && +m[1] <= 12) { f.add("mes:" + +m[1] + "/" + m[2]); f.add("num:" + +m[2]); }
    m = t.match(DATA);
    if (m && !BR.test(t)) {
      const [, d, mes, a] = m;
      if (+d >= 1 && +d <= 31 && +mes >= 1 && +mes <= 12) {
        f.add("data:" + +d + "/" + +mes);
        if (a) f.add("data:" + +d + "/" + +mes + "/" + (+a + (a.length === 2 ? 2000 : 0)));
      }
    }
    let valor = null;
    if (BR.test(t)) valor = Number(t.replace(/\./g, "").replace(",", "."));
    else if (US_DEC.test(t)) valor = Number(t);
    else if (/^\d+$/.test(t)) valor = Number(t);
    if (valor !== null && isFinite(valor)) f.add("num:" + normal(valor));
    return f;
  }

  function numeros(texto) {
    return (String(texto || "").match(NUMERO) || []).map(aparar).filter(Boolean);
  }

  function cruza(a, b) { for (const x of a) if (b.has(x)) return true; return false; }

  function conferir(original, formal, contexto) {
    const permitidas = new Set();
    for (const t of [original, ...(contexto || [])])
      for (const n of numeros(t)) for (const x of formas(n)) permitidas.add(x);
    const avisos = [];
    const textoFormal = (formal || []).filter(Boolean).join("\n");
    const vistos = new Set();
    for (const n of numeros(textoFormal)) {
      if (vistos.has(n)) continue;
      vistos.add(n);
      if (!cruza(formas(n), permitidas))
        avisos.push("O texto formal traz o número \"" + n + "\", que não está no que você escreveu. " +
                    "Confira antes de enviar.");
    }
    const noFormal = new Set();
    for (const n of numeros(textoFormal)) for (const x of formas(n)) noFormal.add(x);
    const faltando = [];
    for (const n of numeros(original))
      if (!faltando.includes(n) && !cruza(formas(n), noFormal)) faltando.push(n);
    for (const n of faltando)
      avisos.push("O número \"" + n + "\" do seu texto não aparece no texto formal. " +
                  "Confira se ele deveria estar lá.");
    return avisos;
  }

  global.Conferencia = { conferir, numeros };
})(typeof window !== "undefined" ? window : globalThis);
