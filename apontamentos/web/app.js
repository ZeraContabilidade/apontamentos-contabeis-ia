/* Apontamentos Contábeis IA -- tela no navegador.
   Sem biblioteca externa. Texto sempre entra como texto (textContent), nunca
   como HTML: o que o contador escreve não vira código na página. */
"use strict";

const E = {
  estado: null,          // /api/estado
  doc: null,             // documento aberto
  editando: new Map(),   // id do apontamento -> rascunho da edição
  formalizando: new Set(),
  seq: 0,                // ordem dos pedidos de atualização do documento
  cartoes: new Map(),    // id -> {assinatura, elem}
  destacar: new Set(),
  busca: "",
};

/* utilidades ------------------------------------------------------------ */
function el(tag, props, ...filhos) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = String(v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = !!v;
      else e.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false || f === "") continue;
    e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return e;
}
const $ = (s) => document.querySelector(s);

async function api(metodo, url, corpo) {
  const op = { method: metodo, headers: {} };
  if (metodo !== "GET") {
    op.headers["X-Requested-With"] = "Apontamentos";
    op.headers["Content-Type"] = "application/json";
    op.body = JSON.stringify(corpo || {});
  }
  let r;
  try {
    r = await fetch(url, op);
  } catch (e) {
    throw new Error("O sistema não está respondendo. Verifique se a janela preta do " +
                    "programa continua aberta.");
  }
  let dados = {};
  try { dados = await r.json(); } catch (e) { /* resposta vazia */ }
  if (!r.ok) throw new Error(dados.erro || ("Erro " + r.status));
  return dados;
}

function aviso(msg, tipo, tempo) {
  const t = el("div", { class: "toast " + (tipo || ""), text: msg });
  $("#avisos").append(t);
  setTimeout(() => t.remove(), tempo || (tipo === "erro" ? 7000 : 3800));
}

function paragrafos(texto) {
  return String(texto || "").trim().split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function competenciaExtenso(iso) {
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto",
                 "Setembro","Outubro","Novembro","Dezembro"];
  const [a, m] = String(iso || "").split("-");
  return meses[parseInt(m, 10) - 1] ? meses[parseInt(m, 10) - 1] + "/" + a : iso;
}

function select(opcoes, valor, props) {
  const s = el("select", Object.assign({ class: "campo" }, props || {}));
  for (const o of opcoes) {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    s.append(el("option", { value: v, text: t }));
  }
  s.value = valor;
  return s;
}

function campo(rotulo, entrada, dica, largo) {
  return el("div", { class: largo ? "largo" : "" }, el("label", { class: "rotulo", text: rotulo }),
            entrada, dica ? el("div", { class: "dica", text: dica }) : null);
}

/* estado geral ------------------------------------------------------------ */
async function carregarEstado() {
  E.estado = await api("GET", "/api/estado");
  $("#versao").textContent = "versão " + E.estado.versao;
  const cfg = E.estado.config;
  const selo = $("#selo-ia");
  if (cfg.chave_configurada) {
    selo.className = "selo-ia ok";
    selo.textContent = "IA ativa · " + (cfg.modelos[cfg.modelo] || cfg.modelo).split(" (")[0];
  } else {
    selo.className = "selo-ia sem";
    selo.textContent = "IA não configurada";
  }
  desenharLista();
}

function desenharLista() {
  const lista = $("#lista-docs");
  const termo = E.busca.trim().toLowerCase();
  const docs = (E.estado ? E.estado.documentos : []).filter(d =>
    !termo || d.empresa.toLowerCase().includes(termo) || (d.cnpj || "").includes(termo));
  const itens = docs.map(d => el("button", {
      class: "item-doc" + (E.doc && E.doc.id === d.id ? " ativo" : ""), type: "button",
      onclick: () => { location.hash = "#/doc/" + d.id; } },
    el("span", { class: "nome", text: d.empresa }),
    el("span", { class: "det" }, d.competencia_extenso, "·",
       d.quantidade + (d.quantidade === 1 ? " item" : " itens"),
       el("span", { class: "status " + d.status, text: d.status === "finalizado" ? "final" : "rascunho" }))));
  lista.replaceChildren(...(itens.length ? itens :
    [el("div", { class: "vazio-lista", text: termo ? "Nenhuma empresa encontrada." :
       "Nenhum documento ainda." })]));
}

/* rotas ----------------------------------------------------------------- */
async function rota() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/doc\/(\d+)/);
  try {
    if (m) return await vistaDocumento(parseInt(m[1], 10));
    E.doc = null;
    E.cartoes.clear();
    desenharLista();
    if (h.startsWith("#/novo")) return vistaNovo();
    if (h.startsWith("#/config")) return vistaConfig();
    return vistaInicio();
  } catch (e) {
    aviso(e.message, "erro");
    if (m) location.hash = "#/";
  }
}

/* início --------------------------------------------------------------- */
function vistaInicio() {
  const cfg = E.estado.config;
  const p = $("#principal");
  p.replaceChildren(el("div", { class: "boas-vindas" },
    el("h1", { text: "Apontamentos para o cliente, sem retrabalho" }),
    el("p", { class: "sub", text: "Enquanto lança a contabilidade, escreva cada erro ou divergência do jeito que vier. " +
      "A IA transforma em texto formal e o documento vai se montando ao lado. No fim, sai em Word e PDF com a marca do escritório." }),
    el("div", { class: "passos" },
      el("div", { class: "passo" }, el("b", { text: "1" }), "Crie um documento para a empresa e a competência."),
      el("div", { class: "passo" }, el("b", { text: "2" }), "Escreva os apontamentos. A IA formaliza sem inventar nada e confere os números."),
      el("div", { class: "passo" }, el("b", { text: "3" }), "Revise e finalize: o DOCX e o PDF ficam prontos para enviar.")),
    el("div", { class: "acoes" },
      el("button", { class: "bt bt-ouro", type: "button", text: "+ Novo documento",
                     onclick: () => { location.hash = "#/novo"; } }),
      cfg.chave_configurada ? null : el("button", { class: "bt", type: "button",
        text: "Configurar a IA", onclick: () => { location.hash = "#/config"; } })),
    cfg.chave_configurada ? null : el("p", { class: "dica espaco-cima",
      text: "Sem a chave da API o sistema funciona, mas os apontamentos ficam com o texto que você escreveu." })));
}

/* novo documento ------------------------------------------------------- */
function formularioDados(doc, aoSalvar, textoBotao) {
  const empresas = E.estado.empresas || [];
  const lista = el("datalist", { id: "empresas-conhecidas" },
    ...empresas.map(x => el("option", { value: x.empresa })));
  const fEmpresa = el("input", { class: "campo", list: "empresas-conhecidas", value: doc.empresa || "",
                                 placeholder: "Razão social", maxlength: "160" });
  const fCnpj = el("input", { class: "campo", value: doc.cnpj || "", placeholder: "00.000.000/0000-00", maxlength: "30" });
  const fComp = el("input", { class: "campo", type: "month", value: doc.competencia || competenciaPadrao() });
  const fDest = el("input", { class: "campo", value: doc.destinatario || "", placeholder: "Ex.: Sr. João (sócio)", maxlength: "120" });
  const fPrazo = el("input", { class: "campo", type: "date", value: doc.prazo_retorno || "" });
  fEmpresa.addEventListener("change", () => {
    const achada = empresas.find(x => x.empresa === fEmpresa.value);
    if (achada && !fCnpj.value) fCnpj.value = achada.cnpj;
  });
  const enviar = el("button", { class: "bt bt-ouro", type: "submit", text: textoBotao });
  const form = el("form", { class: "grade", onsubmit: async (ev) => {
      ev.preventDefault();
      enviar.disabled = true;
      try {
        await aoSalvar({ empresa: fEmpresa.value, cnpj: fCnpj.value, competencia: fComp.value,
                         destinatario: fDest.value, prazo_retorno: fPrazo.value });
      } catch (e) { aviso(e.message, "erro"); }
      finally { enviar.disabled = false; }
    } },
    lista,
    campo("Empresa (cliente)", fEmpresa, null, true),
    campo("CNPJ", fCnpj),
    campo("Competência", fComp),
    campo("A/C (opcional)", fDest),
    campo("Prazo para retorno (opcional)", fPrazo),
    el("div", { class: "largo acoes" }, enviar));
  return { form, foco: fEmpresa };
}

function competenciaPadrao() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function vistaNovo() {
  const { form, foco } = formularioDados({}, async (dados) => {
    const doc = await api("POST", "/api/documentos", dados);
    await carregarEstado();
    location.hash = "#/doc/" + doc.id;
  }, "Criar documento");
  $("#principal").replaceChildren(el("div", { class: "cartao boas-vindas" },
    el("h2", { text: "Novo documento de apontamentos" }), form));
  foco.focus();
}

/* configurações --------------------------------------------------------- */
function vistaConfig() {
  const c = E.estado.config;
  const f = {};
  const txt = (k, ph, props) => (f[k] = el("input", Object.assign({ class: "campo", value: c[k] || "", placeholder: ph || "" }, props || {})));
  const area = (k, linhas) => (f[k] = el("textarea", { class: "campo", rows: String(linhas || 4) }, ));
  const chave = el("input", { class: "campo", type: "password", autocomplete: "off",
    placeholder: c.chave_configurada ? "Chave já cadastrada (deixe em branco para manter)" : "sk-ant-..." });
  const modelo = select(Object.entries(c.modelos), c.modelo);
  const esforco = select(Object.entries(c.esforcos), c.esforco);
  area("introducao", 5); f.introducao.value = c.introducao;
  area("encerramento", 4); f.encerramento.value = c.encerramento;

  const situacao = el("div", { class: "dica", text: c.chave_configurada ?
    "✓ Chave cadastrada e protegida neste computador." : "Nenhuma chave cadastrada: a IA está desligada." });
  const btTestar = el("button", { class: "bt", type: "button", text: "Testar a IA", onclick: async () => {
    btTestar.disabled = true; btTestar.textContent = "Testando…";
    try {
      const r = await api("POST", "/api/config/testar");
      aviso("A IA respondeu: " + r.exemplo, "ok", 9000);
    } catch (e) { aviso(e.message, "erro"); }
    finally { btTestar.disabled = false; btTestar.textContent = "Testar a IA"; }
  } });
  const btApagar = el("button", { class: "bt bt-perigo", type: "button", text: "Remover chave", onclick: async () => {
    if (!confirm("Remover a chave da API deste computador?")) return;
    await api("POST", "/api/config/apagar_chave");
    await carregarEstado(); vistaConfig(); aviso("Chave removida.", "ok");
  } });

  const salvar = async () => {
    const dados = { modelo: modelo.value, esforco: esforco.value };
    for (const [k, e] of Object.entries(f)) dados[k] = e.value;
    if (chave.value.trim()) dados.chave_api = chave.value.trim();
    try {
      await api("POST", "/api/config", dados);
      await carregarEstado();
      aviso("Configurações salvas.", "ok");
      vistaConfig();
    } catch (e) { aviso(e.message, "erro"); }
  };

  $("#principal").replaceChildren(el("div", { class: "boas-vindas" },
    el("div", { class: "cartao" }, el("h2", { text: "Inteligência artificial" }),
      el("div", { class: "grade" },
        campo("Chave da API da Anthropic", chave, "Crie em console.anthropic.com → API Keys. Fica gravada protegida pelo Windows.", true),
        campo("Modelo", modelo), campo("Esforço de raciocínio", esforco)),
      situacao,
      el("div", { class: "acoes espaco-cima" }, btTestar, c.chave_configurada ? btApagar : null)),
    el("div", { class: "cartao" }, el("h2", { text: "Escritório (vai no documento)" }),
      el("div", { class: "grade" },
        campo("Nome do escritório", txt("escritorio_nome")),
        campo("CNPJ do escritório", txt("escritorio_cnpj")),
        campo("Endereço", txt("escritorio_endereco"), null, true),
        campo("Telefone", txt("escritorio_telefone")),
        campo("E-mail", txt("escritorio_email")),
        campo("Site", txt("escritorio_site")),
        campo("Responsável que assina", txt("responsavel_nome", "Nome completo")),
        campo("Cargo", txt("responsavel_cargo")),
        campo("CRC", txt("responsavel_crc", "Ex.: 1SP123456/O-7")))),
    el("div", { class: "cartao" }, el("h2", { text: "Textos padrão do documento" }),
      el("div", { class: "grade" },
        campo("Introdução", f.introducao, "Use {competencia}, {empresa} e {prazo}: o sistema troca pelos dados do documento.", true),
        campo("Considerações finais", f.encerramento, "Se o documento tiver prazo de retorno, o sistema acrescenta \"Solicitamos o retorno até ...\" no começo.", true),
        campo("Pasta onde os documentos são gravados", txt("pasta_saida"), "Uma subpasta por empresa é criada dentro dela.", true))),
    el("div", { class: "acoes espaco-cima" },
      el("button", { class: "bt bt-ouro", type: "button", text: "Salvar configurações", onclick: salvar }),
      el("button", { class: "bt", type: "button", text: "Voltar", onclick: () => history.back() }))));
}

/* documento ------------------------------------------------------------- */
async function vistaDocumento(id) {
  const doc = await api("GET", "/api/documentos/" + id);
  if (!E.doc || E.doc.id !== id) {
    E.cartoes.clear();
    E.editando.clear();
    montarEsqueletoDoc();
  }
  aplicarDoc(doc);
}

async function atualizarDoc() {
  if (!E.doc) return;
  const n = ++E.seq;
  const id = E.doc.id;
  try {
    const doc = await api("GET", "/api/documentos/" + id);
    if (n === E.seq && E.doc && E.doc.id === id) aplicarDoc(doc);
  } catch (e) { aviso(e.message, "erro"); }
}

function montarEsqueletoDoc() {
  const texto = el("textarea", { class: "campo", id: "novo-texto", rows: "5", maxlength: "6000",
    placeholder: "Escreva como vier. Ex.: nf 1234 do fornecedor Alfa lançada em duplicidade em 10/09, valor 1500. pedir pra conferir e mandar o estorno" });
  const categoria = select(E.estado.categorias, "Documentação pendente", { id: "novo-categoria" });
  const prioridade = select(E.estado.prioridades, "Média", { id: "novo-prioridade" });
  const valor = el("input", { class: "campo", id: "novo-valor", placeholder: "Valor (opcional)", maxlength: "40" });
  const ref = el("input", { class: "campo", id: "novo-ref", placeholder: "Documento / referência (opcional)", maxlength: "120" });
  const btAdd = el("button", { class: "bt bt-ouro", type: "button", text: "Adicionar apontamento", onclick: adicionar });
  texto.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); adicionar(); }
  });
  for (const c of [valor, ref]) c.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); adicionar(); }
  });

  $("#principal").replaceChildren(
    el("div", { class: "cab-doc" },
      el("div", null, el("h1", { id: "doc-empresa" }), el("div", { class: "sub", id: "doc-sub" })),
      el("div", { class: "acoes", id: "doc-acoes" })),
    el("div", { id: "faixa-final" }),
    el("div", { id: "dados-doc", class: "cartao oculto" }),
    el("div", { class: "duas-colunas" },
      el("div", null,
        el("div", { class: "cartao escrever", id: "painel-escrever" },
          el("h2", { text: "Novo apontamento" }),
          texto,
          el("div", { class: "linha-opcoes" }, categoria, prioridade),
          el("div", { class: "detalhes-extra" }, valor, ref),
          el("div", { class: "acoes espaco-cima", }, btAdd,
             el("span", { class: "atalho", text: "ou Ctrl + Enter. Pode continuar escrevendo enquanto a IA trabalha." }))),
        el("div", { class: "lista-ap", id: "lista-ap" })),
      el("div", { class: "previa-wrap" },
        el("div", { class: "previa-titulo" }, el("h2", { text: "Prévia do documento" }),
           el("span", { class: "dica", id: "previa-info" })),
        el("div", { class: "papel", id: "papel" }))));
}

function aplicarDoc(doc) {
  const novoDoc = !E.doc || E.doc.id !== doc.id;
  E.doc = doc;
  const final = doc.status === "finalizado";
  $("#doc-empresa").textContent = doc.empresa;
  $("#doc-sub").replaceChildren(
    "Competência " + doc.competencia_extenso + (doc.cnpj ? " · CNPJ " + doc.cnpj : "") + "  ",
    el("span", { class: "status " + doc.status, text: final ? "Finalizado" : "Rascunho" }));
  desenharAcoes(doc);
  desenharFaixaFinal(doc);
  $("#painel-escrever").classList.toggle("oculto", final);
  desenharCartoes(doc);
  desenharPrevia(doc.previa, doc);
  // atualiza a lista lateral (quantidade / status) sem novo pedido
  if (E.estado) {
    const d = E.estado.documentos.find(x => x.id === doc.id);
    if (d) { d.quantidade = doc.quantidade; d.status = doc.status; d.empresa = doc.empresa;
             d.competencia_extenso = doc.competencia_extenso; d.cnpj = doc.cnpj; }
  }
  desenharLista();
  if (novoDoc && !final) $("#novo-texto").focus();
}

function desenharAcoes(doc) {
  const final = doc.status === "finalizado";
  const dados = $("#dados-doc");
  const btDados = el("button", { class: "bt", type: "button", text: "Dados do documento", onclick: () => {
    if (!dados.classList.contains("oculto")) { dados.classList.add("oculto"); return; }
    const { form } = formularioDados(E.doc, async (novos) => {
      await api("POST", "/api/documentos/" + E.doc.id, novos);
      dados.classList.add("oculto");
      await carregarEstado(); await atualizarDoc();
      aviso("Dados atualizados.", "ok");
    }, "Salvar dados");
    dados.replaceChildren(el("h2", { text: "Dados do documento" }), form,
      el("div", { class: "acoes direita espaco-cima" },
        el("button", { class: "bt bt-perigo bt-mini", type: "button", text: "Excluir documento", onclick: excluirDocumento })));
    if (final) form.querySelectorAll("input,button").forEach(x => { x.disabled = true; });
    dados.classList.remove("oculto");
  } });
  const acoes = [btDados];
  if (!final) {
    const cDocx = el("input", { type: "checkbox", checked: true, id: "fmt-docx" });
    const cPdf = el("input", { type: "checkbox", checked: true, id: "fmt-pdf" });
    acoes.push(el("label", { class: "dica" }, cDocx, " DOCX"), el("label", { class: "dica" }, cPdf, " PDF"),
      el("button", { class: "bt bt-ouro", type: "button", text: "Finalizar e gerar documento",
                     onclick: () => finalizar([cDocx.checked && "docx", cPdf.checked && "pdf"].filter(Boolean)) }));
  }
  $("#doc-acoes").replaceChildren(...acoes);
}

function desenharFaixaFinal(doc) {
  const faixa = $("#faixa-final");
  if (doc.status !== "finalizado") { faixa.replaceChildren(); return; }
  const tem = (ext) => (doc.arquivos || []).some(a => a.toLowerCase().endsWith("." + ext));
  const baixar = (ext, rot) => tem(ext) ? el("a", { class: "bt bt-mini", text: rot,
    href: "/api/arquivo?doc=" + doc.id + "&fmt=" + ext }) : null;
  faixa.replaceChildren(el("div", { class: "faixa-final" },
    el("div", null, el("b", { text: "Documento finalizado. " }),
       "Arquivos gravados em: " + (doc.arquivos || []).map(a => a.split(/[\\/]/).pop()).join(" e ")),
    el("div", { class: "acoes" }, baixar("pdf", "Baixar PDF"), baixar("docx", "Baixar DOCX"),
      el("button", { class: "bt bt-mini", type: "button", text: "Abrir pasta", onclick: async () => {
        try { await api("POST", "/api/documentos/" + doc.id + "/abrir_pasta"); } catch (e) { aviso(e.message, "erro"); }
      } }),
      el("button", { class: "bt bt-mini", type: "button", text: "Reabrir para edição", onclick: async () => {
        try { await api("POST", "/api/documentos/" + doc.id + "/reabrir"); await atualizarDoc(); }
        catch (e) { aviso(e.message, "erro"); }
      } }))));
}

async function excluirDocumento() {
  if (!confirm("Excluir este documento e todos os apontamentos dele? Os arquivos DOCX/PDF já gerados continuam na pasta.")) return;
  try {
    await api("POST", "/api/documentos/" + E.doc.id + "/excluir");
    E.doc = null;
    await carregarEstado();
    location.hash = "#/";
    aviso("Documento excluído.", "ok");
  } catch (e) { aviso(e.message, "erro"); }
}

async function finalizar(formatos) {
  if (!formatos.length) return aviso("Marque DOCX, PDF ou os dois.", "erro");
  const aps = E.doc.apontamentos;
  if (!aps.length) return aviso("Adicione pelo menos um apontamento.", "erro");
  if (aps.some(a => a.situacao === "pendente") || E.formalizando.size)
    return aviso("Aguarde a IA terminar os apontamentos em andamento.", "erro");
  if (E.editando.size) return aviso("Salve ou cancele a edição aberta antes de finalizar.", "erro");
  const comAviso = aps.filter(a => (a.avisos || []).some(x => !x.startsWith("Sugestão da IA")));
  if (comAviso.length && !confirm(comAviso.length + " apontamento(s) têm avisos de conferência " +
      "(números ou IA indisponível). Gerar o documento assim mesmo?")) return;
  try {
    const r = await api("POST", "/api/documentos/" + E.doc.id + "/finalizar", { formatos });
    aviso("Documento gerado: " + r.arquivos.map(a => a.split(/[\\/]/).pop()).join(" e "), "ok", 7000);
    await carregarEstado();
    await atualizarDoc();
  } catch (e) { aviso(e.message, "erro"); }
}

/* apontamentos ------------------------------------------------------------ */
async function adicionar() {
  const texto = $("#novo-texto");
  if (!texto.value.trim()) { texto.focus(); return aviso("Escreva o apontamento primeiro."); }
  const dados = { original: texto.value, categoria: $("#novo-categoria").value,
                  prioridade: $("#novo-prioridade").value, valor: $("#novo-valor").value,
                  referencia: $("#novo-ref").value };
  const docId = E.doc.id;
  texto.value = ""; $("#novo-valor").value = ""; $("#novo-ref").value = "";
  texto.focus();
  let r;
  try {
    r = await api("POST", "/api/documentos/" + docId + "/apontamentos", dados);
  } catch (e) {
    if (!texto.value) { texto.value = dados.original; $("#novo-valor").value = dados.valor; $("#novo-ref").value = dados.referencia; }
    return aviso(e.message, "erro");
  }
  await atualizarDoc();
  formalizar(r.apontamento.id);
}

async function formalizar(id) {
  E.formalizando.add(id);
  if (E.doc) desenharCartoes(E.doc);
  try {
    const r = await api("POST", "/api/apontamentos/" + id + "/formalizar");
    if (r.erro) aviso(r.erro, "erro");
    else E.destacar.add(id);
  } catch (e) { aviso(e.message, "erro"); }
  finally {
    E.formalizando.delete(id);
    await atualizarDoc();
  }
}

async function acao(id, caminho, corpo, msg) {
  try {
    await api("POST", "/api/apontamentos/" + id + (caminho ? "/" + caminho : ""), corpo);
    if (msg) aviso(msg, "ok");
  } catch (e) { aviso(e.message, "erro"); }
  await atualizarDoc();
}

function desenharCartoes(doc) {
  const lista = $("#lista-ap");
  if (!lista) return;
  const final = doc.status === "finalizado";
  const vivos = new Set();
  const elems = [];
  const aps = doc.apontamentos;
  aps.forEach((ap, i) => {
    vivos.add(ap.id);
    const emEdicao = E.editando.has(ap.id);
    const pend = ap.situacao === "pendente" || E.formalizando.has(ap.id);
    const assinatura = JSON.stringify([ap, i, aps.length, final, pend, emEdicao]);
    const cache = E.cartoes.get(ap.id);
    if (cache && (cache.assinatura === assinatura || (emEdicao && cache.elem.dataset.modo === "edicao"))) {
      if (emEdicao && cache.elem.dataset.modo === "edicao") {
        const n = cache.elem.querySelector(".ap-num"); if (n) n.textContent = String(i + 1).padStart(2, "0");
      }
      elems.push(cache.elem);
      return;
    }
    const elem = emEdicao ? cartaoEdicao(ap, i) : cartao(ap, i, aps.length, final, pend);
    if (E.destacar.has(ap.id)) { elem.classList.add("destaque"); E.destacar.delete(ap.id); }
    E.cartoes.set(ap.id, { assinatura, elem });
    elems.push(elem);
  });
  for (const id of [...E.cartoes.keys()]) if (!vivos.has(id)) E.cartoes.delete(id);
  const atuais = [...lista.children];
  if (atuais.length !== elems.length || atuais.some((x, i) => x !== elems[i])) {
    const foco = document.activeElement;
    lista.replaceChildren(...elems);
    if (foco && lista.contains(foco)) foco.focus();
  }
  if (!aps.length) lista.replaceChildren(el("div", { class: "dica", text: "Os apontamentos adicionados aparecem aqui." }));
}

function cartao(ap, i, total, final, pend) {
  const situacao = pend ? "pendente" : ap.situacao;
  const rotulo = pend ? "Formalizando…" : ap.situacao_rotulo;
  const titulo = ap.titulo || (pend ? "Aguardando a IA" : ap.categoria);
  const avisos = (ap.avisos || []).map(a => el("div", {
    class: "aviso" + (a.startsWith("Sugestão da IA") ? " sugestao" : ""), text: a }));
  const botoes = [];
  if (!final && !pend) {
    botoes.push(
      el("button", { class: "bt bt-mini", type: "button", text: "Editar", onclick: () => {
        E.editando.set(ap.id, {}); desenharCartoes(E.doc);
        const c = E.cartoes.get(ap.id); if (c) { const t = c.elem.querySelector("textarea"); if (t) t.focus(); }
      } }),
      el("button", { class: "bt bt-mini", type: "button", text: ap.situacao === "formalizado" ? "Refazer com IA" : "Formalizar com IA",
                     onclick: () => formalizar(ap.id) }),
      ap.situacao !== "sem_ia" ? el("button", { class: "bt bt-mini", type: "button", text: "Usar meu texto",
        title: "Descarta o texto formal e usa exatamente o que você escreveu",
        onclick: () => acao(ap.id, "original", null) }) : null,
      el("button", { class: "bt bt-mini", type: "button", text: "↑", title: "Subir", disabled: i === 0 ? true : null,
                     onclick: () => acao(ap.id, "mover", { direcao: -1 }) }),
      el("button", { class: "bt bt-mini", type: "button", text: "↓", title: "Descer", disabled: i === total - 1 ? true : null,
                     onclick: () => acao(ap.id, "mover", { direcao: 1 }) }),
      el("button", { class: "bt bt-mini bt-perigo", type: "button", text: "Excluir", onclick: () => {
        if (confirm("Excluir o apontamento " + (i + 1) + "?")) acao(ap.id, "excluir", null, "Apontamento excluído.");
      } }));
  }
  return el("div", { class: "ap " + situacao, id: "ap-" + ap.id, "data-modo": "leitura" },
    el("div", { class: "ap-topo" },
      el("div", null, el("span", { class: "ap-num", text: String(i + 1).padStart(2, "0") }),
         el("span", { class: "ap-titulo", text: titulo })),
      el("span", { class: "situacao " + situacao }, pend ? el("span", { class: "carregando" }) : null, " ", rotulo)),
    el("div", { class: "ap-meta" }, el("span", { text: ap.categoria }),
       el("span", { class: "prio " + ap.prioridade, text: "● Prioridade " + ap.prioridade.toLowerCase() }),
       ap.referencia ? el("span", { text: "Ref.: " + ap.referencia }) : null,
       ap.valor ? el("span", { text: "Valor: " + ap.valor }) : null),
    pend ? el("div", { class: "ap-texto dica", text: ap.original }) :
      el("div", { class: "ap-texto" }, ...paragrafos(ap.texto).map(p => el("p", { text: p }))),
    !pend && ap.providencia ? el("div", { class: "ap-prov" }, el("b", { text: "PROVIDÊNCIA SOLICITADA" }), ap.providencia) : null,
    avisos.length && !pend ? el("div", { class: "ap-avisos" }, ...avisos) : null,
    !pend && ap.situacao !== "sem_ia" && ap.situacao !== "erro" ?
      el("details", { class: "ap-original" }, el("summary", { text: "Seu texto original" }), el("div", { text: ap.original })) : null,
    botoes.length ? el("div", { class: "ap-acoes" }, ...botoes) : null);
}

function cartaoEdicao(ap, i) {
  const r = E.editando.get(ap.id) || {};
  const v = (k) => (r[k] !== undefined ? r[k] : ap[k]);
  const guardar = (k) => (ev) => { r[k] = ev.target.value; E.editando.set(ap.id, r); };
  const titulo = el("input", { class: "campo", value: v("titulo"), placeholder: "Título", maxlength: "160", oninput: guardar("titulo") });
  const texto = el("textarea", { class: "campo", rows: "7", oninput: guardar("texto") });
  texto.value = v("texto");
  const prov = el("textarea", { class: "campo", rows: "2", placeholder: "Providência solicitada ao cliente (opcional)", oninput: guardar("providencia") });
  prov.value = v("providencia");
  const original = el("textarea", { class: "campo", rows: "3", oninput: guardar("original") });
  original.value = v("original");
  const categoria = select(E.estado.categorias, v("categoria"), { onchange: guardar("categoria") });
  const prioridade = select(E.estado.prioridades, v("prioridade"), { onchange: guardar("prioridade") });
  const valor = el("input", { class: "campo", value: v("valor"), placeholder: "Valor", oninput: guardar("valor") });
  const ref = el("input", { class: "campo", value: v("referencia"), placeholder: "Documento / referência", oninput: guardar("referencia") });
  const coletar = () => ({ titulo: titulo.value, texto: texto.value, providencia: prov.value, original: original.value,
                           categoria: categoria.value, prioridade: prioridade.value, valor: valor.value, referencia: ref.value });
  const fechar = () => { E.editando.delete(ap.id); E.cartoes.delete(ap.id); };
  return el("div", { class: "ap edicao", id: "ap-" + ap.id, "data-modo": "edicao" },
    el("div", { class: "ap-topo" }, el("div", null, el("span", { class: "ap-num", text: String(i + 1).padStart(2, "0") }),
      el("span", { class: "ap-titulo", text: "Editando" }))),
    el("label", { class: "rotulo", text: "Título" }), titulo,
    el("label", { class: "rotulo", text: "Texto que vai para o cliente" }), texto,
    el("label", { class: "rotulo", text: "Providência solicitada" }), prov,
    el("div", { class: "linha-opcoes" }, categoria, prioridade),
    el("div", { class: "detalhes-extra" }, valor, ref),
    el("label", { class: "rotulo espaco-cima", text: "Seu texto original (base para a IA)" }), original,
    el("div", { class: "ap-acoes" },
      el("button", { class: "bt bt-mini bt-ouro", type: "button", text: "Salvar", onclick: async () => {
        const dados = coletar(); fechar();
        await acao(ap.id, "", dados, "Apontamento salvo.");
      } }),
      el("button", { class: "bt bt-mini", type: "button", text: "Salvar texto original e refazer com IA", onclick: async () => {
        const d = coletar();
        fechar();
        try {
          await api("POST", "/api/apontamentos/" + ap.id, { original: d.original, categoria: d.categoria,
            prioridade: d.prioridade, valor: d.valor, referencia: d.referencia });
        } catch (e) { aviso(e.message, "erro"); await atualizarDoc(); return; }
        await atualizarDoc();
        formalizar(ap.id);
      } }),
      el("button", { class: "bt bt-mini", type: "button", text: "Cancelar", onclick: () => { fechar(); desenharCartoes(E.doc); } })));
}

/* prévia ----------------------------------------------------------------- */
function desenharPrevia(c, doc) {
  const papel = $("#papel");
  const rolagem = papel.scrollTop;
  const pend = doc.apontamentos.filter(a => a.situacao === "pendente").length;
  $("#previa-info").textContent = c.itens.length + (c.itens.length === 1 ? " apontamento" : " apontamentos") +
    (pend ? " · " + pend + " em formalização" : "");
  const quadro = el("dl", { class: "quadro" });
  const linha = (r, v) => { if (v) quadro.append(el("dt", { text: r }), el("dd", { text: v })); };
  linha("Cliente", c.empresa); linha("CNPJ", c.cnpj); linha("Competência", c.competencia);
  linha("A/C", c.destinatario); linha("Emissão", c.emissao); linha("Retorno até", c.prazo);

  const resumo = [c.itens.length + " apontamento" + (c.itens.length === 1 ? "" : "s")];
  for (const p of E.estado.prioridades) if (c.por_prioridade[p]) resumo.push(c.por_prioridade[p] + " de prioridade " + p.toLowerCase());

  const itens = c.itens.map(it => el("div", {
      class: "p-item" + (it.situacao === "pendente" ? " pendente" : ""),
      title: "Clique para ver o apontamento na lista",
      onclick: () => { const alvo = document.getElementById("ap-" + it.id);
        if (alvo) { alvo.scrollIntoView({ behavior: "smooth", block: "center" }); alvo.classList.remove("destaque"); void alvo.offsetWidth; alvo.classList.add("destaque"); } } },
    el("div", { class: "t" }, el("span", { class: "n", text: String(it.numero).padStart(2, "0") }),
       el("span", { class: "tt", text: it.situacao === "pendente" ? "Formalizando…" : it.titulo })),
    el("div", { class: "corpo-item" },
      el("div", { class: "m" }, it.categoria, el("span", { class: "prio " + it.prioridade, text: "● Prioridade " + it.prioridade.toLowerCase() })),
      ...it.paragrafos.map(p => el("p", { text: p })),
      it.referencia ? el("div", { class: "det" }, el("b", { text: "Referência: " }), it.referencia) : null,
      it.valor ? el("div", { class: "det" }, el("b", { text: "Valor: " }), it.valor) : null,
      it.providencia ? el("div", { class: "prov" }, el("b", { text: "PROVIDÊNCIA SOLICITADA" }), it.providencia) : null)));

  const cargo = (c.cargo || "") + (c.crc ? " · CRC " + c.crc : "");
  papel.replaceChildren(
    el("div", { class: "papel-cab" }, el("img", { src: "/marca/logo_claro.png", alt: "Zera Contabilidade" }),
      el("div", { class: "dir" }, el("b", { text: "APONTAMENTOS CONTÁBEIS" }), el("span", { text: c.empresa + " · " + c.competencia }))),
    el("h1", { text: c.titulo }),
    el("div", { class: "comp", text: "Competência " + c.competencia }),
    quadro,
    el("p", { text: "Prezados(as)," }),
    ...c.introducao.map(p => el("p", { text: p })),
    el("h3", { text: "Resumo" }),
    el("p", { text: resumo.join(" · ") }),
    c.itens.length ? el("ul", null, ...Object.entries(c.por_categoria).map(([k, n]) => el("li", { text: k + ": " + n }))) : null,
    el("h3", { text: "Apontamentos" }),
    ...(itens.length ? itens : [el("div", { class: "papel-vazio", text: "Os apontamentos aparecem aqui conforme você escreve." })]),
    el("h3", { text: "Considerações finais" }),
    ...c.encerramento.map(p => el("p", { text: p })),
    el("p", { text: "Atenciosamente," }),
    el("div", { class: "assin" }, el("div", { class: "linha" }),
      c.responsavel ? el("div", null, el("b", { text: c.responsavel })) : null,
      cargo.trim() ? el("div", { class: "dica", text: cargo }) : null,
      el("div", { class: "esc", text: (c.escritorio || "").toUpperCase() }),
      el("div", { class: "dica", text: c.data_extenso })),
    el("div", { class: "papel-rodape", text: c.escritorio + (c.rodape ? " · " + c.rodape : "") }));
  papel.scrollTop = rolagem;
}

/* início ------------------------------------------------------------------ */
$("#bt-novo").addEventListener("click", () => { location.hash = "#/novo"; });
$("#bt-config").addEventListener("click", () => { location.hash = "#/config"; });
$("#busca").addEventListener("input", (ev) => { E.busca = ev.target.value; desenharLista(); });
window.addEventListener("hashchange", rota);
window.addEventListener("beforeunload", (ev) => {
  if (E.formalizando.size || E.editando.size) { ev.preventDefault(); ev.returnValue = ""; }
});
carregarEstado().then(rota).catch(e => aviso(e.message, "erro"));
