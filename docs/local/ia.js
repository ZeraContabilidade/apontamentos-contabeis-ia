/* Redação formal com a API da Anthropic, chamada direto do navegador
   (modo aplicativo: iPhone, iPad ou qualquer navegador sem o programa).
   Mesmas instruções e mesmo formato de resposta de apontamentos/ia.py;
   o teste confere que os dois textos continuam iguais. */
"use strict";

(function (global) {
  const INSTRUCOES = "Você é o redator técnico de um escritório de contabilidade brasileiro.\nO contador, enquanto faz a escrituração contábil de uma empresa cliente, anota\nde forma rápida e informal cada erro, divergência ou pendência que encontra.\nSua tarefa é reescrever cada anotação como um apontamento formal, que será\nenviado ao cliente em um relatório do escritório.\n\nRegras obrigatórias:\n1. Não invente nada. Use somente os fatos do texto do contador e dos campos\n   informados (valor, referência). Não acrescente valores, datas, números de\n   nota, nomes, artigos de lei, multas, juros, penalidades, prazos ou\n   consequências que não estejam escritos.\n2. Preserve exatamente todos os números, datas, valores, nomes e documentos\n   citados. Valores em reais podem ser escritos no padrão brasileiro\n   (R$ 1.500,00), sem mudar o valor.\n3. Linguagem formal, objetiva, cordial e impessoal, na primeira pessoa do\n   plural do escritório (\"identificamos\", \"verificamos\", \"solicitamos\").\n   Trate o cliente por \"V.Sas.\" quando precisar se dirigir a ele.\n   Nada de tom acusatório: o objetivo é apontar e resolver.\n4. Corrija ortografia, gramática, abreviações e termos técnicos contábeis\n   (ex.: \"nf\" = nota fiscal, \"extrato\" = extrato bancário, \"lcto\" =\n   lançamento). Se uma abreviação for ambígua, mantenha como está e registre\n   a dúvida em pontos_a_confirmar.\n5. Sem saudação, sem assinatura, sem numeração e sem markdown: o texto vai\n   dentro de um relatório já formatado.\n\nCampos da resposta:\n- titulo: título curto do apontamento (até 8 palavras), sem ponto final.\n- texto: o apontamento formal, em 1 a 3 parágrafos curtos (separe parágrafos\n  com uma linha em branco). Descreva o que foi constatado.\n- providencia: a providência solicitada ao cliente em uma frase (ex.:\n  \"Solicitamos o envio da nota fiscal correspondente.\"). Se o texto do\n  contador indicar o que fazer, use isso; se estiver implícito, peça de forma\n  genérica a verificação ou o envio do documento citado, sem criar prazo.\n  Deixe vazio se o apontamento for apenas informativo.\n- pontos_a_confirmar: lista curta (pode ser vazia) de informações que\n  deixariam o apontamento mais completo e que o contador não informou\n  (ex.: \"Número da nota fiscal não informado\"). Isso NÃO vai para o cliente;\n  serve só de lembrete para o contador. Nunca preencha essas lacunas no texto.\n";

  const ESQUEMA = {
    "type": "object",
    "properties": {
      "titulo": {
        "type": "string"
      },
      "texto": {
        "type": "string"
      },
      "providencia": {
        "type": "string"
      },
      "pontos_a_confirmar": {
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    },
    "required": [
      "titulo",
      "texto",
      "providencia",
      "pontos_a_confirmar"
    ],
    "additionalProperties": false
  };

  const COM_ESFORCO = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-sonnet-5"];
  const COM_RESERVA = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5"];
  const BETA_RESERVA = "server-side-fallback-2026-07-01";
  const URL_API = "https://api.anthropic.com/v1/messages";
  let reservaOk = true;

  class ErroIA extends Error {}

  function limpo(v) {
    let t = String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
    for (const m of ["**", "__", "##"]) t = t.split(m).join("");
    return t;
  }

  function mensagemErro(status, texto, modelo) {
    const t = String(texto || "").toLowerCase();
    if (status === 0) return "Sem conexão com a internet (ou a API está fora do ar).";
    if (t.includes("workspace"))
      return "Esta chave da API não pertence a um workspace. Crie uma chave dentro de um " +
        "workspace no console da Anthropic (Settings > Workspaces > abra o workspace > API Keys) " +
        "e cole aqui, ou informe o Workspace ID (começa com wrkspc_) em Configurações.";
    if (status === 401) return "A chave da API foi recusada. Confira a chave em Configurações.";
    if (status === 403) return "A chave da API não tem permissão para este modelo.";
    if (status === 404) return "O modelo '" + modelo + "' não foi encontrado. Escolha outro em Configurações.";
    if (status === 429) return "Limite de uso da API atingido. Aguarde um minuto e tente de novo.";
    if (t.includes("credit") || t.includes("billing")) return "Sem crédito na conta da API da Anthropic.";
    if (status >= 500) return "A API da Anthropic está instável no momento. Tente de novo.";
    return "Falha ao chamar a IA: " + String(texto || status).slice(0, 300);
  }

  async function chamar(cfg, conteudo, usarReserva) {
    const corpo = {
      model: cfg.modelo,
      max_tokens: 16000,
      system: [{ type: "text", text: INSTRUCOES, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: conteudo }],
      output_config: { format: { type: "json_schema", schema: ESQUEMA } },
    };
    if (COM_ESFORCO.includes(cfg.modelo) && cfg.esforco) corpo.output_config.effort = cfg.esforco;
    const cab = {
      "content-type": "application/json",
      "x-api-key": cfg.chave_api,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (cfg.workspace_id) cab["anthropic-workspace-id"] = cfg.workspace_id;
    if (usarReserva) { cab["anthropic-beta"] = BETA_RESERVA; corpo.fallbacks = "default"; }
    let r;
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), 120000);
    try {
      r = await fetch(URL_API, { method: "POST", headers: cab, body: JSON.stringify(corpo),
                                 signal: controle.signal });
    } catch (e) {
      throw new ErroIA(e.name === "AbortError" ? "A IA demorou demais para responder. Tente de novo."
                                               : mensagemErro(0, "", cfg.modelo));
    } finally { clearTimeout(relogio); }
    let dados = null;
    try { dados = await r.json(); } catch (e) { dados = null; }
    if (!r.ok) {
      const msg = dados && dados.error ? dados.error.message : r.statusText;
      const erro = new ErroIA(mensagemErro(r.status, msg, cfg.modelo));
      erro.status = r.status; erro.bruto = msg;
      throw erro;
    }
    return dados;
  }

  async function formalizar(cfg, original, extra) {
    if (!cfg.chave_api) throw new ErroIA("A chave da API não está configurada. Abra Configurações e cole a chave da Anthropic.");
    extra = extra || {};
    const linhas = [
      extra.empresa ? "Empresa: " + extra.empresa : "",
      extra.competencia ? "Competência: " + extra.competencia : "",
      extra.categoria ? "Categoria: " + extra.categoria : "",
      extra.prioridade ? "Prioridade: " + extra.prioridade : "",
      extra.valor ? "Valor informado: " + extra.valor : "",
      extra.referencia ? "Documento/referência informado: " + extra.referencia : "",
      "", "Anotação do contador:", String(original).trim(),
    ];
    // campos não informados não entram; a linha em branco antes da anotação fica
    const conteudo = linhas.filter((x, i) => x !== "" || i === 6).join("\n");
    let resp;
    const tentarReserva = reservaOk && COM_RESERVA.includes(cfg.modelo);
    try {
      resp = await chamar(cfg, conteudo, tentarReserva);
    } catch (e) {
      if (tentarReserva && e.status === 400 && /fallback/i.test(e.bruto || "")) {
        reservaOk = false;
        resp = await chamar(cfg, conteudo, false);
      } else throw e;
    }
    if (resp.stop_reason === "refusal")
      throw new ErroIA("A IA recusou este texto. O apontamento ficou com o seu texto original; edite manualmente se precisar.");
    if (resp.stop_reason === "max_tokens") throw new ErroIA("A resposta da IA veio cortada. Tente de novo.");
    const texto = (resp.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    let d;
    try { d = JSON.parse(texto); } catch (e) { throw new ErroIA("A IA respondeu fora do formato esperado. Tente de novo."); }
    const r = {
      titulo: limpo(d.titulo).replace(/\.+$/, ""),
      texto: limpo(d.texto),
      providencia: limpo(d.providencia),
      pontos_a_confirmar: (d.pontos_a_confirmar || []).map(limpo).filter(Boolean),
    };
    if (!r.texto) throw new ErroIA("A IA devolveu um texto vazio. Tente de novo.");
    r.avisos = global.Conferencia.conferir(original, [r.titulo, r.texto, r.providencia],
      [extra.empresa, extra.competencia, extra.valor, extra.referencia].filter(Boolean));
    return r;
  }

  global.IA = { formalizar, ErroIA, INSTRUCOES, ESQUEMA };
})(typeof window !== "undefined" ? window : globalThis);
