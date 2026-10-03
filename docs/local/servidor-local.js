/* "Servidor" que roda dentro do navegador (modo aplicativo).

   Atende os mesmos endereços /api/... do programa em Python, mas guarda tudo
   no próprio aparelho (IndexedDB), chama a IA direto e gera o PDF e o DOCX
   no navegador. Assim a mesma tela funciona no Windows (com o programa) e no
   iPhone/iPad (sem programa nenhum). */
"use strict";

(function (global) {
  const C = global.Conteudo;
  const VERSAO_BANCO = 1;
  const MODELOS = {
    "claude-opus-5-5": "Claude Opus 5.5 (recomendado: melhor redação)",
    "claude-sonnet-5-5": "Claude Sonnet 5.5 (mais rápido e mais barato)",
    "claude-haiku-4-5": "Claude Haiku 4.5 (o mais barato)",
  };
  const ESFORCOS = {
    low: "Baixo (mais rápido)",
    medium: "Médio (recomendado)",
    high: "Alto (mais cuidadoso, mais lento)",
  };
  const CFG_PADRAO = {
    chave_api: "", modelo: "claude-opus-5-5", esforco: "medium", workspace_id: "",
    escritorio_nome: "Zera Contabilidade", escritorio_cnpj: "", escritorio_endereco: "",
    escritorio_telefone: "", escritorio_email: "", escritorio_site: "",
    responsavel_nome: "", responsavel_crc: "", responsavel_cargo: "Contador(a) responsável",
    introducao: C.INTRODUCAO_PADRAO, encerramento: C.ENCERRAMENTO_PADRAO,
  };

  class ErroPedido extends Error {
    constructor(msg, status) { super(msg); this.status = status || 400; }
  }

  /* IndexedDB ------------------------------------------------------------ */
  let _banco = null;
  function abrir() {
    if (_banco) return _banco;
    _banco = new Promise((ok, falha) => {
      if (!global.indexedDB) return falha(new ErroPedido(
        "Este navegador não permite guardar dados (modo privado?). Abra numa janela normal."));
      const req = indexedDB.open("apontamentos-contabeis", VERSAO_BANCO);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("config");
        db.createObjectStore("documento", { keyPath: "id", autoIncrement: true });
        const a = db.createObjectStore("apontamento", { keyPath: "id", autoIncrement: true });
        a.createIndex("doc", "documento_id");
        db.createObjectStore("arquivo");
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falha(new ErroPedido("Não consegui abrir os dados deste aparelho: " + req.error));
    });
    return _banco;
  }

  function prometer(req) {
    return new Promise((ok, falha) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falha(req.error);
    });
  }

  async function tx(lojas, modo, fn) {
    const db = await abrir();
    return new Promise((ok, falha) => {
      const t = db.transaction(lojas, modo);
      let resultado;
      Promise.resolve(fn(t)).then(r => { resultado = r; }, e => { falha(e); try { t.abort(); } catch (x) { /* já fechada */ } });
      t.oncomplete = () => ok(resultado);
      t.onerror = () => falha(t.error);
      t.onabort = () => falha(t.error || new ErroPedido("Operação cancelada."));
    });
  }

  const agora = () => {
    const d = new Date();
    const z = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" +
      z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds());
  };

  /* configuração ---------------------------------------------------------- */
  async function lerConfig() {
    const salvo = await tx(["config"], "readonly", t => prometer(t.objectStore("config").get("cfg")));
    const cfg = Object.assign({}, CFG_PADRAO, salvo || {});
    if (!MODELOS[cfg.modelo]) cfg.modelo = CFG_PADRAO.modelo;
    if (!ESFORCOS[cfg.esforco]) cfg.esforco = CFG_PADRAO.esforco;
    return cfg;
  }

  async function gravarConfig(cfg) {
    await tx(["config"], "readwrite", t => prometer(t.objectStore("config").put(cfg, "cfg")));
  }

  function publico(cfg) {
    const d = Object.assign({}, cfg);
    delete d.chave_api;
    d.chave_configurada = !!cfg.chave_api;
    d.modelos = MODELOS;
    d.esforcos = ESFORCOS;
    d.local = true;
    return d;
  }

  /* documentos ------------------------------------------------------------- */
  function validarDoc(dados, parcial) {
    const limpo = {};
    for (const k of ["empresa", "cnpj", "competencia", "destinatario", "prazo_retorno"])
      if (k in dados) limpo[k] = String(dados[k] == null ? "" : dados[k]).trim();
    if (!parcial || "empresa" in limpo)
      if (!limpo.empresa) throw new ErroPedido("Informe o nome da empresa.");
    if (!parcial || "competencia" in limpo) {
      const iso = C.competenciaIso(limpo.competencia);
      if (!iso) throw new ErroPedido("Competência inválida. Use mês e ano (ex.: 09/2026).");
      limpo.competencia = iso;
    }
    if (limpo.prazo_retorno && !/^\d{4}-\d{2}-\d{2}$/.test(limpo.prazo_retorno))
      throw new ErroPedido("Prazo de retorno inválido.");
    return limpo;
  }

  function docSaida(d, aps) {
    const r = Object.assign({}, d);
    r.competencia_extenso = C.competenciaExtenso(d.competencia);
    if (aps) {
      r.apontamentos = aps.map(apSaida);
      r.quantidade = aps.length;
    }
    return r;
  }

  function apSaida(a) {
    return Object.assign({}, a, { situacao_rotulo: C.SITUACOES[a.situacao] || a.situacao });
  }

  async function apsDoDoc(t, docId) {
    const lista = await prometer(t.objectStore("apontamento").index("doc").getAll(docId));
    return lista.sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  }

  async function obterDoc(docId) {
    return tx(["documento", "apontamento"], "readonly", async t => {
      const d = await prometer(t.objectStore("documento").get(docId));
      if (!d) throw new ErroPedido("Documento não encontrado.");
      return docSaida(d, await apsDoDoc(t, docId));
    });
  }

  async function documentoCompleto(docId) {
    const doc = await obterDoc(docId);
    doc.previa = C.montarConteudo(doc, await lerConfig());
    return doc;
  }

  async function exigirRascunho(t, docId) {
    const d = await prometer(t.objectStore("documento").get(docId));
    if (!d) throw new ErroPedido("Documento não encontrado.");
    if (d.status !== "rascunho")
      throw new ErroPedido("Este documento já foi finalizado. Clique em \"Reabrir para edição\" para alterar.");
    return d;
  }

  async function tocar(t, docId) {
    const loja = t.objectStore("documento");
    const d = await prometer(loja.get(docId));
    if (d) { d.atualizado_em = agora(); await prometer(loja.put(d)); }
  }

  async function listarDocumentos() {
    return tx(["documento", "apontamento"], "readonly", async t => {
      const docs = await prometer(t.objectStore("documento").getAll());
      const aps = await prometer(t.objectStore("apontamento").getAll());
      return docs.map(d => {
        const meus = aps.filter(a => a.documento_id === d.id);
        const r = docSaida(d);
        r.quantidade = meus.length;
        r.quantidade_alta = meus.filter(a => a.prioridade === "Alta").length;
        return r;
      }).sort((a, b) => (b.atualizado_em || "").localeCompare(a.atualizado_em || "") || b.id - a.id);
    });
  }

  async function estado() {
    const cfg = await lerConfig();
    const documentos = await listarDocumentos();
    const vistas = new Map();
    for (const d of documentos) {
      const k = d.empresa + "\u0000" + (d.cnpj || "");
      if (!vistas.has(k)) vistas.set(k, { empresa: d.empresa, cnpj: d.cnpj || "" });
    }
    return {
      versao: global.VERSAO_APP || "", modo: "local", config: publico(cfg),
      categorias: C.CATEGORIAS, prioridades: C.PRIORIDADES, documentos,
      empresas: [...vistas.values()],
    };
  }

  async function criarDocumento(dados) {
    const d = validarDoc(dados);
    const momento = agora();
    const id = await tx(["documento"], "readwrite", t => prometer(t.objectStore("documento").add({
      empresa: d.empresa, cnpj: d.cnpj || "", competencia: d.competencia,
      destinatario: d.destinatario || "", prazo_retorno: d.prazo_retorno || "",
      status: "rascunho", arquivos: [], criado_em: momento, atualizado_em: momento, finalizado_em: "",
    })));
    return documentoCompleto(id);
  }

  async function atualizarDocumento(docId, dados) {
    const d = validarDoc(dados, true);
    await tx(["documento"], "readwrite", async t => {
      const atual = await exigirRascunho(t, docId);
      Object.assign(atual, d, { atualizado_em: agora() });
      await prometer(t.objectStore("documento").put(atual));
    });
    return documentoCompleto(docId);
  }

  async function excluirDocumento(docId) {
    await tx(["documento", "apontamento", "arquivo"], "readwrite", async t => {
      for (const a of await apsDoDoc(t, docId)) await prometer(t.objectStore("apontamento").delete(a.id));
      for (const f of ["pdf", "docx"]) await prometer(t.objectStore("arquivo").delete(docId + ":" + f));
      await prometer(t.objectStore("documento").delete(docId));
    });
    return { ok: true };
  }

  /* apontamentos ----------------------------------------------------------- */
  async function obterAp(apId) {
    const a = await tx(["apontamento"], "readonly", t => prometer(t.objectStore("apontamento").get(apId)));
    if (!a) throw new ErroPedido("Apontamento não encontrado.");
    return a;
  }

  async function adicionar(docId, dados) {
    const original = String(dados.original || "").trim();
    if (!original) throw new ErroPedido("Escreva o apontamento antes de adicionar.");
    const momento = agora();
    const id = await tx(["documento", "apontamento"], "readwrite", async t => {
      await exigirRascunho(t, docId);
      const aps = await apsDoDoc(t, docId);
      const ordem = aps.reduce((m, a) => Math.max(m, a.ordem), 0) + 1;
      const novo = await prometer(t.objectStore("apontamento").add({
        documento_id: docId, ordem,
        categoria: C.CATEGORIAS.includes(dados.categoria) ? dados.categoria : "Outros",
        prioridade: C.PRIORIDADES.includes(dados.prioridade) ? dados.prioridade : "Média",
        original, titulo: "", texto: original, providencia: "",
        valor: String(dados.valor || "").trim(), referencia: String(dados.referencia || "").trim(),
        situacao: "pendente", avisos: [], criado_em: momento, atualizado_em: momento,
      }));
      await tocar(t, docId);
      return novo;
    });
    return { apontamento: apSaida(await obterAp(id)), documento: await documentoCompleto(docId) };
  }

  async function gravarAp(apId, novos, forcar) {
    return tx(["documento", "apontamento"], "readwrite", async t => {
      const loja = t.objectStore("apontamento");
      const a = await prometer(loja.get(apId));
      if (!a) throw new ErroPedido("Apontamento não encontrado.");
      if (!forcar) await exigirRascunho(t, a.documento_id);
      Object.assign(a, novos, { atualizado_em: agora() });
      await prometer(loja.put(a));
      await tocar(t, a.documento_id);
      return a;
    });
  }

  async function formalizar(apId) {
    const ap = await obterAp(apId);
    const doc = await obterDoc(ap.documento_id);
    if (doc.status !== "rascunho") throw new ErroPedido("Este documento já foi finalizado.");
    const cfg = await lerConfig();
    let novos, erro = "";
    if (!cfg.chave_api) {
      novos = { situacao: "sem_ia", texto: ap.original, titulo: "", providencia: "",
                avisos: ["IA não configurada: o apontamento ficou com o seu texto. Cadastre a chave em Configurações para formalizar."] };
    } else {
      await gravarAp(apId, { situacao: "pendente" }, true);
      try {
        const r = await global.IA.formalizar(cfg, ap.original, {
          categoria: ap.categoria, prioridade: ap.prioridade, valor: ap.valor,
          referencia: ap.referencia, empresa: doc.empresa, competencia: doc.competencia_extenso });
        novos = { situacao: "formalizado", titulo: r.titulo, texto: r.texto, providencia: r.providencia,
                  avisos: r.avisos.concat(r.pontos_a_confirmar.map(p => "Sugestão da IA (não vai para o cliente): " + p)) };
      } catch (e) {
        erro = e instanceof global.IA.ErroIA ? e.message : "Erro inesperado na IA: " + e.message;
        novos = { situacao: "erro", texto: ap.original, titulo: "", providencia: "", avisos: [erro] };
      }
    }
    const a = await gravarAp(apId, novos, true);
    return { apontamento: apSaida(a), erro, documento: await documentoCompleto(doc.id) };
  }

  async function editar(apId, dados) {
    const atual = await obterAp(apId);
    const novos = {};
    for (const k of ["titulo", "texto", "providencia", "categoria", "prioridade", "valor", "referencia", "original"]) {
      if (!(k in dados)) continue;
      let v = String(dados[k] == null ? "" : dados[k]).trim();
      if (k === "categoria" && !C.CATEGORIAS.includes(v)) continue;
      if (k === "prioridade" && !C.PRIORIDADES.includes(v)) continue;
      if (k === "original" && !v) throw new ErroPedido("O texto original não pode ficar vazio.");
      novos[k] = v;
    }
    const mudouTexto = ["titulo", "texto", "providencia"].some(k => k in novos && novos[k] !== (atual[k] || ""));
    if (mudouTexto) {
      if (!(("texto" in novos ? novos.texto : atual.texto) || "").trim())
        throw new ErroPedido("O texto do apontamento não pode ficar vazio.");
      novos.situacao = "editado";
      novos.avisos = [];
    }
    const a = await gravarAp(apId, novos);
    return { apontamento: apSaida(a), documento: await documentoCompleto(a.documento_id) };
  }

  async function usarOriginal(apId) {
    const atual = await obterAp(apId);
    const a = await gravarAp(apId, { situacao: "sem_ia", texto: atual.original, titulo: "",
                                     providencia: "", avisos: [] });
    return { apontamento: apSaida(a), documento: await documentoCompleto(a.documento_id) };
  }

  async function renumerar(t, docId) {
    const aps = await apsDoDoc(t, docId);
    for (let i = 0; i < aps.length; i++) {
      if (aps[i].ordem !== i + 1) { aps[i].ordem = i + 1; await prometer(t.objectStore("apontamento").put(aps[i])); }
    }
  }

  async function excluirAp(apId) {
    const a = await obterAp(apId);
    await tx(["documento", "apontamento"], "readwrite", async t => {
      await exigirRascunho(t, a.documento_id);
      await prometer(t.objectStore("apontamento").delete(apId));
      await renumerar(t, a.documento_id);
      await tocar(t, a.documento_id);
    });
    return { documento: await documentoCompleto(a.documento_id) };
  }

  async function mover(apId, direcao) {
    const a = await obterAp(apId);
    await tx(["documento", "apontamento"], "readwrite", async t => {
      await exigirRascunho(t, a.documento_id);
      const aps = await apsDoDoc(t, a.documento_id);
      const i = aps.findIndex(x => x.id === apId);
      const j = i + (direcao > 0 ? 1 : -1);
      if (j >= 0 && j < aps.length) [aps[i], aps[j]] = [aps[j], aps[i]];
      for (let n = 0; n < aps.length; n++) { aps[n].ordem = n + 1; await prometer(t.objectStore("apontamento").put(aps[n])); }
      await tocar(t, a.documento_id);
    });
    return { documento: await documentoCompleto(a.documento_id) };
  }

  async function copiarDe(docId, ids) {
    let n = 0;
    await tx(["documento", "apontamento"], "readwrite", async t => {
      await exigirRascunho(t, docId);
      let ordem = (await apsDoDoc(t, docId)).reduce((m, a) => Math.max(m, a.ordem), 0);
      for (const id of ids) {
        const a = await prometer(t.objectStore("apontamento").get(Number(id)));
        if (!a || a.documento_id === docId) continue;
        const origem = await prometer(t.objectStore("documento").get(a.documento_id));
        const momento = agora();
        const novo = Object.assign({}, a, {
          documento_id: docId, ordem: ++ordem, criado_em: momento, atualizado_em: momento,
          situacao: (a.situacao === "pendente" || a.situacao === "erro") ? "sem_ia" : a.situacao,
          texto: a.texto || a.original,
          avisos: ["Trazido de " + C.competenciaExtenso(origem ? origem.competencia : "") + ". Confira se ainda está pendente."],
        });
        delete novo.id;
        await prometer(t.objectStore("apontamento").add(novo));
        n++;
      }
      await tocar(t, docId);
    });
    return { copiados: n, documento: await documentoCompleto(docId) };
  }

  /* finalizar --------------------------------------------------------------- */
  async function finalizar(docId, formatos) {
    formatos = (formatos || ["docx", "pdf"]).filter(f => f === "docx" || f === "pdf");
    if (!formatos.length) throw new ErroPedido("Escolha DOCX, PDF ou os dois.");
    const doc = await obterDoc(docId);
    if (!doc.apontamentos.length) throw new ErroPedido("O documento não tem nenhum apontamento.");
    if (doc.apontamentos.some(a => a.situacao === "pendente"))
      throw new ErroPedido("Ainda há apontamento sendo formalizado pela IA. Aguarde terminar e tente de novo.");
    const cfg = await lerConfig();
    const c = C.montarConteudo(doc, cfg);
    const nome = C.nomeArquivo(doc);
    const gerados = [];
    for (const f of formatos) {
      const blob = f === "pdf" ? await global.GeradorPDF.gerar(c) : await global.GeradorDOCX.gerar(c);
      gerados.push({ fmt: f, nome: nome + "." + f, blob });
    }
    await tx(["documento", "arquivo"], "readwrite", async t => {
      for (const f of ["pdf", "docx"]) await prometer(t.objectStore("arquivo").delete(docId + ":" + f));
      for (const g of gerados) await prometer(t.objectStore("arquivo").put({ nome: g.nome, blob: g.blob }, docId + ":" + g.fmt));
      const d = await prometer(t.objectStore("documento").get(docId));
      Object.assign(d, { status: "finalizado", arquivos: gerados.map(g => g.nome),
                         finalizado_em: agora(), atualizado_em: agora() });
      await prometer(t.objectStore("documento").put(d));
    });
    return { documento: await documentoCompleto(docId), arquivos: gerados.map(g => g.nome) };
  }

  async function reabrir(docId) {
    await tx(["documento"], "readwrite", async t => {
      const d = await prometer(t.objectStore("documento").get(docId));
      if (!d) throw new ErroPedido("Documento não encontrado.");
      d.status = "rascunho"; d.atualizado_em = agora();
      await prometer(t.objectStore("documento").put(d));
    });
    return { documento: await documentoCompleto(docId) };
  }

  async function arquivo(docId, fmt) {
    const a = await tx(["arquivo"], "readonly", t => prometer(t.objectStore("arquivo").get(docId + ":" + fmt)));
    if (!a) throw new ErroPedido("Arquivo não encontrado. Gere o documento de novo.", 404);
    return a;   // {nome, blob}
  }

  /* backup ------------------------------------------------------------------ */
  async function exportar() {
    const docs = [];
    for (const d of await listarDocumentos()) {
      const c = await obterDoc(d.id);
      const doc = {};
      for (const k of ["empresa", "cnpj", "competencia", "destinatario", "prazo_retorno", "status",
                       "criado_em", "atualizado_em", "finalizado_em"]) doc[k] = c[k] || "";
      doc.apontamentos = c.apontamentos.map(a => {
        const r = {};
        for (const k of ["ordem", "categoria", "prioridade", "original", "titulo", "texto", "providencia",
                         "valor", "referencia", "situacao", "avisos", "criado_em", "atualizado_em"]) r[k] = a[k];
        return r;
      });
      docs.push(doc);
    }
    return { app: "apontamentos-contabeis-ia", formato: 1, exportado_em: agora(), documentos: docs };
  }

  async function importar(dados) {
    if (!dados || dados.app !== "apontamentos-contabeis-ia")
      throw new ErroPedido("Este arquivo não é um backup do sistema de apontamentos.");
    let importados = 0, ignorados = 0;
    const existentes = await listarDocumentos();
    for (const d of dados.documentos || []) {
      const limpo = validarDoc(d);
      if (existentes.some(e => e.empresa === limpo.empresa && e.competencia === limpo.competencia &&
                               e.criado_em === (d.criado_em || ""))) { ignorados++; continue; }
      const momento = agora();
      await tx(["documento", "apontamento"], "readwrite", async t => {
        const id = await prometer(t.objectStore("documento").add({
          empresa: limpo.empresa, cnpj: limpo.cnpj || "", competencia: limpo.competencia,
          destinatario: limpo.destinatario || "", prazo_retorno: limpo.prazo_retorno || "",
          status: d.status === "finalizado" ? "finalizado" : "rascunho", arquivos: [],
          criado_em: d.criado_em || momento, atualizado_em: d.atualizado_em || momento,
          finalizado_em: d.finalizado_em || "" }));
        let n = 0;
        for (const a of d.apontamentos || []) {
          const original = String(a.original || a.texto || "").trim();
          if (!original) continue;
          let situacao = C.SITUACOES[a.situacao] ? a.situacao : "sem_ia";
          if (situacao === "pendente") situacao = "sem_ia";
          await prometer(t.objectStore("apontamento").add({
            documento_id: id, ordem: ++n,
            categoria: C.CATEGORIAS.includes(a.categoria) ? a.categoria : "Outros",
            prioridade: C.PRIORIDADES.includes(a.prioridade) ? a.prioridade : "Média",
            original, titulo: String(a.titulo || ""), texto: String(a.texto || original),
            providencia: String(a.providencia || ""), valor: String(a.valor || ""),
            referencia: String(a.referencia || ""), situacao,
            avisos: (a.avisos || []).map(String), criado_em: a.criado_em || momento,
            atualizado_em: a.atualizado_em || momento }));
        }
      });
      importados++;
    }
    return { importados, ignorados };
  }

  /* configurações ----------------------------------------------------------- */
  async function salvarConfig(dados) {
    const cfg = await lerConfig();
    for (const [k, v0] of Object.entries(dados || {})) {
      if (!(k in CFG_PADRAO)) continue;
      let v = String(v0 == null ? "" : v0);
      if (k === "chave_api" || k === "workspace_id") v = v.trim();
      if (k === "chave_api" && !v) continue;
      if (k === "modelo" && !MODELOS[v]) continue;
      if (k === "esforco" && !ESFORCOS[v]) continue;
      cfg[k] = v;
    }
    await gravarConfig(cfg);
    return { config: publico(cfg) };
  }

  async function apagarChave() {
    const cfg = await lerConfig();
    cfg.chave_api = "";
    await gravarConfig(cfg);
    return { config: publico(cfg) };
  }

  async function testarIA() {
    const cfg = await lerConfig();
    if (!cfg.chave_api) throw new ErroPedido("Cadastre a chave da API primeiro.");
    try {
      const r = await global.IA.formalizar(cfg, "nf 123 sem boleto", { categoria: "Documentação pendente" });
      return { ok: true, exemplo: r.texto };
    } catch (e) { throw new ErroPedido(e.message); }
  }

  /* roteador: mesmos endereços do programa em Python ------------------------ */
  async function pedir(metodo, url, corpo) {
    const u = new URL(url, "http://local/");
    const p = u.pathname.replace(/^\/+/, "").split("/");
    if (p[0] !== "api") throw new ErroPedido("Endereço desconhecido.", 404);
    corpo = corpo || {};
    if (metodo === "GET") {
      if (p[1] === "ping") return { app: "apontamentos", modo: "local" };
      if (p[1] === "estado") return estado();
      if (p[1] === "backup") return exportar();
      if (p[1] === "documentos" && p.length === 3) return documentoCompleto(Number(p[2]));
      if (p[1] === "arquivo") return arquivo(Number(u.searchParams.get("doc")), u.searchParams.get("fmt") || "pdf");
      throw new ErroPedido("Endereço desconhecido.", 404);
    }
    if (p[1] === "config") {
      if (p.length === 2) return salvarConfig(corpo);
      if (p[2] === "apagar_chave") return apagarChave();
      if (p[2] === "testar") return testarIA();
    }
    if (p[1] === "backup" && p[2] === "importar") return importar(corpo);
    if (p[1] === "documentos") {
      if (p.length === 2) return criarDocumento(corpo);
      const id = Number(p[2]);
      const acao = p[3] || "";
      if (acao === "") return atualizarDocumento(id, corpo);
      if (acao === "apontamentos") return adicionar(id, corpo);
      if (acao === "finalizar") return finalizar(id, corpo.formatos);
      if (acao === "reabrir") return reabrir(id);
      if (acao === "excluir") return excluirDocumento(id);
      if (acao === "copiar_de") return copiarDe(id, corpo.ids || []);
    }
    if (p[1] === "apontamentos") {
      const id = Number(p[2]);
      const acao = p[3] || "";
      if (acao === "") return editar(id, corpo);
      if (acao === "formalizar") return formalizar(id);
      if (acao === "original") return usarOriginal(id);
      if (acao === "excluir") return excluirAp(id);
      if (acao === "mover") return mover(id, Number(corpo.direcao || 0));
    }
    throw new ErroPedido("Endereço desconhecido.", 404);
  }

  global.ServidorLocal = { pedir, ErroPedido };
})(window);
