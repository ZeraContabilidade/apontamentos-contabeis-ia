/* Apontamentos Contábeis IA -- tela.

   A mesma tela roda de dois jeitos:
   - "servidor": aberta pelo programa no Windows (executar.py), que guarda os
     dados no computador e gera os arquivos;
   - "local": aberta direto no navegador (iPhone, iPad, qualquer computador),
     com os dados guardados no próprio aparelho (local/servidor-local.js).
   Sem biblioteca externa na tela. Texto sempre entra como texto
   (textContent), nunca como HTML. */
"use strict";

const VERSAO_APP = "2.0";
window.VERSAO_APP = VERSAO_APP;

const E = {
  modo: "servidor",      // "servidor" (programa no Windows) ou "local" (aparelho)
  estado: null,
  doc: null,
  editando: new Map(),
  formalizando: new Set(),
  seq: 0,
  cartoes: new Map(),
  destacar: new Set(),
  busca: "",
  abaMovel: "escrever",
  ditado: null,
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
const pad2 = (n) => String(n).padStart(2, "0");
const nomeCurto = (caminho) => String(caminho).split(/[\\/]/).pop();

async function detectarModo() {
  try {
    const r = await fetch("api/ping", { cache: "no-store" });
    const d = await r.json();
    if (r.ok && d.app === "apontamentos" && d.modo !== "local") return "servidor";
  } catch (e) { /* sem programa: modo aplicativo */ }
  return "local";
}

async function api(metodo, url, corpo) {
  if (E.modo === "local") {
    try {
      return await window.ServidorLocal.pedir(metodo, url, corpo);
    } catch (e) {
      throw new Error(e.message || String(e));
    }
  }
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
    throw new Error("O sistema não está respondendo. Verifique se a janela preta do programa continua aberta.");
  }
  let dados = {};
  try { dados = await r.json(); } catch (e) { /* resposta vazia */ }
  if (!r.ok) throw new Error(dados.erro || ("Erro " + r.status));
  return dados;
}

/* carrega um script sob demanda (bibliotecas de PDF/DOCX só quando precisa) */
const _scripts = {};
function carregarScript(src) {
  if (!_scripts[src]) {
    _scripts[src] = new Promise((ok, falha) => {
      const s = el("script", { src });
      s.onload = ok;
      s.onerror = () => { delete _scripts[src]; falha(new Error("Não consegui carregar " + src + ". Verifique a internet.")); };
      document.head.append(s);
    });
  }
  return _scripts[src];
}
async function prepararGeradores() {
  await Promise.all([carregarScript("vendor/jspdf.umd.min.js"), carregarScript("vendor/docx.min.js")]);
  await Promise.all([carregarScript("local/gerador-pdf.js"), carregarScript("local/gerador-docx.js")]);
}

function aviso(msg, tipo, tempo) {
  const t = el("div", { class: "toast " + (tipo || ""), text: msg });
  $("#avisos").append(t);
  setTimeout(() => t.remove(), tempo || (tipo === "erro" ? 7000 : 3800));
}

function paragrafos(texto) {
  return String(texto || "").trim().split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
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

function ehEstreito() { return window.matchMedia("(max-width: 900px)").matches; }
function ehIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function instalado() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* janela por cima (modal) ------------------------------------------------- */
function abrirModal(titulo, ...conteudo) {
  const m = $("#modal");
  const fechar = () => { m.classList.add("oculto"); m.replaceChildren(); };
  m.replaceChildren(el("div", { class: "modal-caixa" },
    el("div", { class: "modal-topo" }, el("h2", { text: titulo }),
       el("button", { class: "bt bt-mini", type: "button", text: "Fechar", onclick: fechar })),
    el("div", { class: "modal-corpo" }, ...conteudo)));
  m.classList.remove("oculto");
  m.onclick = (ev) => { if (ev.target === m) fechar(); };
  return fechar;
}

/* menu lateral (no celular vira gaveta) ---------------------------------- */
function abrirMenu(abrir) {
  document.body.classList.toggle("menu-aberto", abrir);
}

/* estado geral ------------------------------------------------------------ */
async function carregarEstado() {
  E.estado = await api("GET", "api/estado");
  $("#versao").textContent = "versão " + (E.estado.versao || VERSAO_APP) + (E.modo === "local" ? " · aplicativo" : "");
  const cfg = E.estado.config;
  const selo = $("#selo-ia");
  if (cfg.chave_configurada) {
    selo.className = "selo-ia ok";
    selo.textContent = "IA ativa · " + (cfg.modelos[cfg.modelo] || cfg.modelo).split(" (")[0].replace("Claude ", "");
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
      onclick: () => { abrirMenu(false); location.hash = "#/doc/" + d.id; } },
    el("span", { class: "nome", text: d.empresa }),
    el("span", { class: "det" }, el("span", { text: d.competencia_extenso }),
       el("span", { text: d.quantidade + (d.quantidade === 1 ? " item" : " itens") }),
       el("span", { class: "status " + d.status, text: d.status === "finalizado" ? "final" : "rascunho" }))));
  lista.replaceChildren(...(itens.length ? itens :
    [el("div", { class: "vazio-lista", text: termo ? "Nenhuma empresa encontrada." : "Nenhum documento ainda." })]));
}

/* rotas ----------------------------------------------------------------- */
async function rota() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/doc\/(\d+)/);
  abrirMenu(false);
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

/* painel (início) ------------------------------------------------------- */
function vistaInicio() {
  const cfg = E.estado.config;
  const docs = E.estado.documentos;
  const rascunhos = docs.filter(d => d.status === "rascunho");
  const mesAtual = new Date().toISOString().slice(0, 7);
  const finalizadosMes = docs.filter(d => d.status === "finalizado" && (d.finalizado_em || "").startsWith(mesAtual));
  const altas = rascunhos.reduce((s, d) => s + (d.quantidade_alta || 0), 0);
  const empresas = new Set(docs.map(d => d.empresa)).size;
  const tile = (n, rot, classe) => el("div", { class: "tile " + (classe || "") }, el("b", { text: String(n) }), el("span", { text: rot }));

  const avisosTopo = [];
  if (!cfg.chave_configurada)
    avisosTopo.push(el("div", { class: "faixa-aviso" }, "A IA ainda não está configurada: os apontamentos ficam com o seu texto. ",
      el("button", { class: "bt-link", type: "button", text: "Configurar agora", onclick: () => { location.hash = "#/config"; } })));
  if (E.modo === "local" && ehIOS() && !instalado())
    avisosTopo.push(el("div", { class: "faixa-aviso" }, "Dica: instale como aplicativo. No Safari, toque em Compartilhar e depois em \"Adicionar à Tela de Início\"."));

  const recentes = docs.slice(0, 6).map(d => el("button", { class: "doc-recente", type: "button",
      onclick: () => { location.hash = "#/doc/" + d.id; } },
    el("span", { class: "nome", text: d.empresa }),
    el("span", { class: "det", text: d.competencia_extenso + " · " + d.quantidade + (d.quantidade === 1 ? " apontamento" : " apontamentos") }),
    el("span", { class: "status " + d.status, text: d.status === "finalizado" ? "Finalizado" : "Rascunho" })));

  $("#principal").replaceChildren(el("div", { class: "painel" },
    ...avisosTopo,
    el("div", { class: "painel-cab" },
      el("div", null, el("h1", { text: saudacao() }),
         el("p", { class: "sub", text: "Escreva os apontamentos do jeito que vier. A IA formaliza, o relatório se monta sozinho e sai pronto para o cliente." })),
      el("button", { class: "bt bt-ouro", type: "button", text: "+ Novo documento", onclick: () => { location.hash = "#/novo"; } })),
    el("div", { class: "tiles" },
      tile(rascunhos.length, rascunhos.length === 1 ? "documento em andamento" : "documentos em andamento"),
      tile(altas, "apontamentos de prioridade alta em aberto", altas ? "alerta" : ""),
      tile(finalizadosMes.length, "finalizados neste mês"),
      tile(empresas, empresas === 1 ? "empresa atendida" : "empresas atendidas")),
    docs.length ? el("div", { class: "cartao" }, el("h2", { text: "Continuar de onde parou" }), el("div", { class: "recentes" }, ...recentes)) :
      el("div", { class: "passos" },
        el("div", { class: "passo" }, el("b", { text: "1" }), "Crie um documento para a empresa e a competência."),
        el("div", { class: "passo" }, el("b", { text: "2" }), "Escreva ou dite os apontamentos. A IA formaliza sem inventar nada e confere os números."),
        el("div", { class: "passo" }, el("b", { text: "3" }), "Finalize e compartilhe o PDF ou o Word com o cliente."))));
}

function saudacao() {
  const h = new Date().getHours();
  const nome = (E.estado.config.responsavel_nome || "").split(" ")[0];
  return (h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite") + (nome ? ", " + nome : "") + ".";
}

/* novo documento ------------------------------------------------------- */
function formularioDados(doc, aoSalvar, textoBotao) {
  const empresas = E.estado.empresas || [];
  const lista = el("datalist", { id: "empresas-conhecidas" }, ...empresas.map(x => el("option", { value: x.empresa })));
  const fEmpresa = el("input", { class: "campo", list: "empresas-conhecidas", value: doc.empresa || "",
                                 placeholder: "Razão social", maxlength: "160", autocomplete: "off" });
  const fCnpj = el("input", { class: "campo", value: doc.cnpj || "", placeholder: "00.000.000/0000-00", maxlength: "30", inputmode: "numeric" });
  const fComp = el("input", { class: "campo", type: "month", value: doc.competencia || competenciaPadrao() });
  const fDest = el("input", { class: "campo", value: doc.destinatario || "", placeholder: "Ex.: Sr. João (sócio)", maxlength: "120" });
  const fPrazo = el("input", { class: "campo", type: "date", value: doc.prazo_retorno || "" });
  fEmpresa.addEventListener("change", () => {
    const achada = empresas.find(x => x.empresa === fEmpresa.value);
    if (achada && !fCnpj.value) fCnpj.value = achada.cnpj;
  });
  fCnpj.addEventListener("input", () => {
    const d = fCnpj.value.replace(/\D/g, "").slice(0, 14);
    if (d.length === 14) fCnpj.value = d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
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
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}

function vistaNovo() {
  const { form, foco } = formularioDados({}, async (dados) => {
    const doc = await api("POST", "api/documentos", dados);
    await carregarEstado();
    location.hash = "#/doc/" + doc.id;
    // há documento anterior da mesma empresa? oferece trazer os apontamentos
    const anteriores = E.estado.documentos.filter(d => d.empresa === doc.empresa && d.id !== doc.id && d.quantidade);
    if (anteriores.length) setTimeout(() => trazerDeOutroMes(doc.id, true), 400);
  }, "Criar documento");
  $("#principal").replaceChildren(el("div", { class: "cartao estreito" },
    el("h2", { text: "Novo documento de apontamentos" }), form));
  if (!ehEstreito()) foco.focus();
}

/* configurações --------------------------------------------------------- */
function vistaConfig() {
  const c = E.estado.config;
  const f = {};
  const txt = (k, ph, props) => (f[k] = el("input", Object.assign({ class: "campo", value: c[k] || "", placeholder: ph || "" }, props || {})));
  const area = (k, linhas) => { f[k] = el("textarea", { class: "campo", rows: String(linhas || 4) }); f[k].value = c[k] || ""; return f[k]; };
  const chave = el("input", { class: "campo", type: "password", autocomplete: "off",
    placeholder: c.chave_configurada ? "Chave já cadastrada (deixe em branco para manter)" : "sk-ant-..." });
  const modelo = select(Object.entries(c.modelos), c.modelo);
  const esforco = select(Object.entries(c.esforcos), c.esforco);
  txt("workspace_id", "wrkspc_... (só se o teste pedir)");
  area("introducao", 5);
  area("encerramento", 4);

  const situacao = el("div", { class: "dica", text: c.chave_configurada ?
    (E.modo === "local" ? "✓ Chave cadastrada neste aparelho." : "✓ Chave cadastrada e protegida neste computador.") :
    "Nenhuma chave cadastrada: a IA está desligada." });
  const btTestar = el("button", { class: "bt", type: "button", text: "Testar a IA", onclick: async () => {
    btTestar.disabled = true; btTestar.textContent = "Testando…";
    try {
      const r = await api("POST", "api/config/testar");
      aviso("A IA respondeu: " + r.exemplo, "ok", 9000);
    } catch (e) { aviso(e.message, "erro", 12000); }
    finally { btTestar.disabled = false; btTestar.textContent = "Testar a IA"; }
  } });
  const btApagar = el("button", { class: "bt bt-perigo", type: "button", text: "Remover chave", onclick: async () => {
    if (!confirm("Remover a chave da API deste aparelho?")) return;
    await api("POST", "api/config/apagar_chave");
    await carregarEstado(); vistaConfig(); aviso("Chave removida.", "ok");
  } });

  const salvar = async () => {
    const dados = { modelo: modelo.value, esforco: esforco.value };
    for (const [k, e] of Object.entries(f)) dados[k] = e.value;
    if (chave.value.trim()) dados.chave_api = chave.value.trim();
    try {
      await api("POST", "api/config", dados);
      await carregarEstado();
      aviso("Configurações salvas.", "ok");
      vistaConfig();
    } catch (e) { aviso(e.message, "erro"); }
  };

  // backup: leva os documentos de um aparelho para outro (Windows <-> iPhone)
  const arquivo = el("input", { type: "file", accept: ".json,application/json", class: "oculto" });
  arquivo.addEventListener("change", async () => {
    const f0 = arquivo.files[0];
    if (!f0) return;
    try {
      const dados = JSON.parse(await f0.text());
      const r = await api("POST", "api/backup/importar", dados);
      await carregarEstado();
      aviso(r.importados + " documento(s) importado(s)" + (r.ignorados ? ", " + r.ignorados + " já existiam." : "."), "ok", 7000);
    } catch (e) { aviso(e instanceof SyntaxError ? "Arquivo de backup inválido." : e.message, "erro"); }
    arquivo.value = "";
  });
  const btBackup = el("button", { class: "bt", type: "button", text: "Baixar backup", onclick: async () => {
    try {
      const dados = await api("GET", "api/backup");
      const nome = "apontamentos-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      const blob = new Blob([JSON.stringify(dados, null, 1)], { type: "application/json" });
      if (!(await compartilharArquivo(blob, nome, "Backup dos apontamentos"))) baixarBlob(blob, nome);
    } catch (e) { aviso(e.message, "erro"); }
  } });

  const instrucaoInstalar = E.modo === "local" ? el("div", { class: "cartao" }, el("h2", { text: "Usar no iPhone e no iPad" }),
    el("ol", { class: "lista-passos" },
      el("li", { text: "Abra este endereço no Safari." }),
      el("li", { text: "Toque em Compartilhar (o quadrado com a seta) e em \"Adicionar à Tela de Início\"." }),
      el("li", { text: "Pronto: o ícone da Zera fica na tela e o sistema abre como aplicativo, até sem internet (a IA precisa de internet)." })),
    el("p", { class: "dica", text: "Os documentos ficam guardados neste aparelho. Para levar para outro aparelho ou para o Windows, use o backup abaixo." })) : null;

  $("#principal").replaceChildren(el("div", { class: "estreito" },
    el("div", { class: "cartao" }, el("h2", { text: "Inteligência artificial" }),
      el("div", { class: "grade" },
        campo("Chave da API da Anthropic", chave, "Crie em console.anthropic.com → Settings → Workspaces → abra o workspace → API Keys." +
          (E.modo === "local" ? " Fica guardada só neste aparelho." : " Fica gravada protegida pelo Windows."), true),
        campo("Modelo", modelo), campo("Esforço de raciocínio", esforco),
        campo("Workspace ID (opcional)", f.workspace_id, "Só preencha se a chave não for de um workspace e o teste pedir.", true)),
      situacao,
      el("div", { class: "acoes espaco-cima" }, btTestar, c.chave_configurada ? btApagar : null)),
    el("div", { class: "cartao" }, el("h2", { text: "Escritório (vai no documento)" }),
      el("div", { class: "grade" },
        campo("Nome do escritório", txt("escritorio_nome")),
        campo("CNPJ do escritório", txt("escritorio_cnpj")),
        campo("Endereço", txt("escritorio_endereco"), null, true),
        campo("Telefone", txt("escritorio_telefone", "", { inputmode: "tel" })),
        campo("E-mail", txt("escritorio_email", "", { inputmode: "email" })),
        campo("Site", txt("escritorio_site")),
        campo("Responsável que assina", txt("responsavel_nome", "Nome completo")),
        campo("Cargo", txt("responsavel_cargo")),
        campo("CRC", txt("responsavel_crc", "Ex.: 1SP123456/O-7")))),
    el("div", { class: "cartao" }, el("h2", { text: "Textos padrão do documento" }),
      el("div", { class: "grade" },
        campo("Introdução", f.introducao, "Use {competencia}, {empresa} e {prazo}: o sistema troca pelos dados do documento.", true),
        campo("Considerações finais", f.encerramento, "Se o documento tiver prazo de retorno, o sistema acrescenta \"Solicitamos o retorno até ...\" no começo.", true),
        E.modo === "servidor" ? campo("Pasta onde os documentos são gravados", txt("pasta_saida"), "Uma subpasta por empresa é criada dentro dela.", true) : null)),
    el("div", { class: "acoes espaco-cima fixo-baixo" },
      el("button", { class: "bt bt-ouro", type: "button", text: "Salvar configurações", onclick: salvar }),
      el("button", { class: "bt", type: "button", text: "Voltar", onclick: () => history.back() })),
    el("div", { class: "cartao espaco-cima" }, el("h2", { text: "Backup e outros aparelhos" }),
      el("p", { class: "dica", text: "O backup leva todos os documentos e apontamentos (sem a chave da API). Abra o arquivo em outro aparelho, no Windows ou no iPhone, com \"Importar backup\"." }),
      el("div", { class: "acoes" }, btBackup,
        el("button", { class: "bt", type: "button", text: "Importar backup", onclick: () => arquivo.click() }), arquivo)),
    instrucaoInstalar));
}

/* documento ------------------------------------------------------------- */
async function vistaDocumento(id) {
  const doc = await api("GET", "api/documentos/" + id);
  if (!E.doc || E.doc.id !== id) {
    E.cartoes.clear();
    E.editando.clear();
    E.abaMovel = "escrever";
    montarEsqueletoDoc();
  }
  aplicarDoc(doc);
}

async function atualizarDoc() {
  if (!E.doc) return;
  const n = ++E.seq;
  const id = E.doc.id;
  try {
    const doc = await api("GET", "api/documentos/" + id);
    if (n === E.seq && E.doc && E.doc.id === id) aplicarDoc(doc);
  } catch (e) { aviso(e.message, "erro"); }
}

function trocarAba(aba) {
  E.abaMovel = aba;
  $("#principal").dataset.aba = aba;
  document.querySelectorAll(".abas-movel button").forEach(b => b.classList.toggle("ativa", b.dataset.aba === aba));
}

function montarEsqueletoDoc() {
  const texto = el("textarea", { class: "campo", id: "novo-texto", rows: "5", maxlength: "6000", enterkeyhint: "enter",
    placeholder: "Escreva como vier. Ex.: nf 1234 do fornecedor Alfa lançada em duplicidade em 10/09, valor 1500. pedir pra conferir e mandar o estorno" });
  const categoria = select(E.estado.categorias, "Documentação pendente", { id: "novo-categoria" });
  const prioridade = select(E.estado.prioridades, "Média", { id: "novo-prioridade" });
  const valor = el("input", { class: "campo", id: "novo-valor", placeholder: "Valor (opcional)", maxlength: "40", inputmode: "decimal" });
  const ref = el("input", { class: "campo", id: "novo-ref", placeholder: "Documento / referência (opcional)", maxlength: "120" });
  const btAdd = el("button", { class: "bt bt-ouro", type: "button", text: "Adicionar apontamento", onclick: adicionar });
  texto.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); adicionar(); }
  });
  for (const c of [valor, ref]) c.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); adicionar(); }
  });
  const btMic = botaoDitado(texto);

  $("#principal").replaceChildren(
    el("div", { class: "cab-doc" },
      el("div", null, el("h1", { id: "doc-empresa" }), el("div", { class: "sub", id: "doc-sub" })),
      el("div", { class: "acoes", id: "doc-acoes" })),
    el("div", { id: "faixa-final" }),
    el("div", { id: "dados-doc", class: "cartao oculto" }),
    el("div", { class: "abas-movel" },
      el("button", { type: "button", "data-aba": "escrever", class: "ativa", text: "Escrever", onclick: () => trocarAba("escrever") }),
      el("button", { type: "button", "data-aba": "previa", text: "Prévia do documento", onclick: () => trocarAba("previa") })),
    el("div", { class: "duas-colunas" },
      el("div", { class: "coluna-escrever" },
        el("div", { class: "cartao escrever", id: "painel-escrever" },
          el("div", { class: "titulo-linha" }, el("h2", { text: "Novo apontamento" }), btMic),
          texto,
          el("div", { class: "linha-opcoes" }, categoria, prioridade),
          el("div", { class: "detalhes-extra" }, valor, ref),
          el("div", { class: "acoes espaco-cima" }, btAdd,
             el("span", { class: "atalho so-largo", text: "ou Ctrl + Enter. Pode continuar escrevendo enquanto a IA trabalha." }))),
        el("div", { class: "lista-ap", id: "lista-ap" })),
      el("div", { class: "previa-wrap coluna-previa" },
        el("div", { class: "previa-titulo" }, el("h2", { text: "Prévia do documento" }),
           el("span", { class: "dica", id: "previa-info" })),
        el("div", { class: "papel", id: "papel" }))));
  trocarAba(E.abaMovel);
}

/* ditado por voz (Safari no iPhone, Chrome e Edge) */
function botaoDitado(alvo) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return null;
  const bt = el("button", { class: "bt bt-mini bt-mic", type: "button", title: "Ditar o apontamento", text: "🎤 Ditar" });
  bt.addEventListener("click", () => {
    if (E.ditado) { E.ditado.stop(); return; }
    const rec = new Rec();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    const base = alvo.value ? alvo.value.replace(/\s*$/, " ") : "";
    let finalTxt = "";
    rec.onresult = (ev) => {
      let parcial = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalTxt += ev.results[i][0].transcript;
        else parcial += ev.results[i][0].transcript;
      }
      alvo.value = base + finalTxt + parcial;
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") aviso("Permita o uso do microfone para ditar.", "erro");
      else if (ev.error !== "no-speech" && ev.error !== "aborted") aviso("Ditado interrompido (" + ev.error + ").", "erro");
    };
    rec.onend = () => { E.ditado = null; bt.classList.remove("gravando"); bt.textContent = "🎤 Ditar"; alvo.focus(); };
    try {
      rec.start();
      E.ditado = rec;
      bt.classList.add("gravando");
      bt.textContent = "■ Parar";
    } catch (e) { aviso("Não consegui ligar o microfone.", "erro"); }
  });
  return bt;
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
  if (E.estado) {
    const d = E.estado.documentos.find(x => x.id === doc.id);
    if (d) {
      Object.assign(d, { quantidade: doc.quantidade, status: doc.status, empresa: doc.empresa,
        competencia_extenso: doc.competencia_extenso, cnpj: doc.cnpj, finalizado_em: doc.finalizado_em,
        quantidade_alta: doc.apontamentos.filter(a => a.prioridade === "Alta").length });
    }
  }
  desenharLista();
  if (final && novoDoc) trocarAba("previa");
  if (novoDoc && !final && !ehEstreito()) $("#novo-texto").focus();
}

function desenharAcoes(doc) {
  const final = doc.status === "finalizado";
  const dados = $("#dados-doc");
  const btDados = el("button", { class: "bt", type: "button", text: "Dados", title: "Dados do documento", onclick: () => {
    if (!dados.classList.contains("oculto")) { dados.classList.add("oculto"); return; }
    const { form } = formularioDados(E.doc, async (novos) => {
      await api("POST", "api/documentos/" + E.doc.id, novos);
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
    acoes.push(el("button", { class: "bt", type: "button", text: "Trazer de outro mês",
                              title: "Copiar apontamentos de outra competência (pendências que continuam)",
                              onclick: () => trazerDeOutroMes(doc.id, false) }));
    const cDocx = el("input", { type: "checkbox", checked: true, id: "fmt-docx" });
    const cPdf = el("input", { type: "checkbox", checked: true, id: "fmt-pdf" });
    acoes.push(el("label", { class: "dica marcar" }, cDocx, " Word"), el("label", { class: "dica marcar" }, cPdf, " PDF"),
      el("button", { class: "bt bt-ouro", type: "button", text: "Finalizar e gerar",
                     onclick: () => finalizar([cDocx.checked && "docx", cPdf.checked && "pdf"].filter(Boolean)) }));
  }
  $("#doc-acoes").replaceChildren(...acoes);
}

/* arquivos gerados: baixar, compartilhar, mensagem ao cliente ---------- */
async function obterArquivo(docId, fmt) {
  if (E.modo === "local") return api("GET", "api/arquivo?doc=" + docId + "&fmt=" + fmt);
  const r = await fetch("api/arquivo?doc=" + docId + "&fmt=" + fmt);
  if (!r.ok) throw new Error("Arquivo não encontrado. Gere o documento de novo.");
  const nome = (E.doc.arquivos || []).map(nomeCurto).find(n => n.toLowerCase().endsWith("." + fmt)) || ("apontamentos." + fmt);
  return { nome, blob: await r.blob() };
}

async function compartilharArquivo(blob, nome, titulo) {
  if (!navigator.canShare) return false;
  const tipo = nome.endsWith(".pdf") ? "application/pdf" : nome.endsWith(".json") ? "application/json" :
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const arq = new File([blob], nome, { type: tipo });
  if (!navigator.canShare({ files: [arq] })) return false;
  try {
    await navigator.share({ files: [arq], title: titulo || nome });
  } catch (e) {
    if (e.name !== "AbortError") return false;
  }
  return true;
}

function mensagemCliente(doc) {
  const c = doc.previa;
  const total = c.itens.length;
  const altas = c.por_prioridade["Alta"] || 0;
  const linhas = [
    (c.destinatario ? "Olá, " + c.destinatario + "!" : "Olá!"),
    "",
    "Segue o relatório de apontamentos contábeis da " + c.empresa + ", competência " + c.competencia + ".",
    "Identificamos " + total + (total === 1 ? " ponto que precisa" : " pontos que precisam") + " da sua atenção" +
      (altas ? ", " + (altas === 1 ? "1 deles" : altas + " deles") + " de prioridade alta" : "") + ":",
    "",
    ...c.itens.map(i => i.numero + ". " + i.titulo),
    "",
    c.prazo ? "Pedimos o retorno até " + c.prazo + "." : "Pedimos o retorno assim que possível.",
    "Qualquer dúvida, estamos à disposição.",
    "",
    c.responsavel ? c.responsavel + " · " + c.escritorio : c.escritorio,
  ];
  return linhas.join("\n");
}

function abrirMensagem(doc) {
  const texto = el("textarea", { class: "campo", rows: "12" });
  texto.value = mensagemCliente(doc);
  const assunto = "Apontamentos contábeis - " + doc.empresa + " - " + doc.previa.competencia;
  abrirModal("Mensagem para o cliente",
    el("p", { class: "dica", text: "Texto montado a partir do relatório, sem nada inventado. Ajuste se quiser e envie junto com o PDF." }),
    texto,
    el("div", { class: "acoes espaco-cima" },
      el("button", { class: "bt bt-ouro", type: "button", text: "Copiar", onclick: async () => {
        try { await navigator.clipboard.writeText(texto.value); aviso("Mensagem copiada.", "ok"); }
        catch (e) { texto.select(); document.execCommand("copy"); aviso("Mensagem copiada.", "ok"); }
      } }),
      el("a", { class: "bt", target: "_blank", rel: "noopener", text: "WhatsApp",
                href: "https://wa.me/?text=" + encodeURIComponent(texto.value),
                onclick: (ev) => { ev.currentTarget.href = "https://wa.me/?text=" + encodeURIComponent(texto.value); } }),
      el("a", { class: "bt", text: "E-mail",
                href: "mailto:?subject=" + encodeURIComponent(assunto) + "&body=" + encodeURIComponent(texto.value),
                onclick: (ev) => { ev.currentTarget.href = "mailto:?subject=" + encodeURIComponent(assunto) + "&body=" + encodeURIComponent(texto.value); } })));
}

function desenharFaixaFinal(doc) {
  const faixa = $("#faixa-final");
  if (doc.status !== "finalizado") { faixa.replaceChildren(); return; }
  const fmts = ["pdf", "docx"].filter(f => (doc.arquivos || []).some(a => a.toLowerCase().endsWith("." + f)));
  const podeCompartilhar = !!navigator.canShare;
  const botoes = [];
  for (const f of fmts) {
    const rot = f === "pdf" ? "PDF" : "Word";
    botoes.push(el("button", { class: "bt bt-mini", type: "button", text: "Baixar " + rot, onclick: async () => {
      try { const a = await obterArquivo(doc.id, f); baixarBlob(a.blob, a.nome); } catch (e) { aviso(e.message, "erro"); }
    } }));
    if (podeCompartilhar) botoes.push(el("button", { class: "bt bt-mini bt-ouro", type: "button", text: "Compartilhar " + rot, onclick: async () => {
      try {
        const a = await obterArquivo(doc.id, f);
        if (!(await compartilharArquivo(a.blob, a.nome, "Apontamentos - " + doc.empresa))) baixarBlob(a.blob, a.nome);
      } catch (e) { aviso(e.message, "erro"); }
    } }));
  }
  botoes.push(el("button", { class: "bt bt-mini", type: "button", text: "Mensagem para o cliente", onclick: () => abrirMensagem(E.doc) }));
  if (E.modo === "servidor") botoes.push(el("button", { class: "bt bt-mini", type: "button", text: "Abrir pasta", onclick: async () => {
    try { await api("POST", "api/documentos/" + doc.id + "/abrir_pasta"); } catch (e) { aviso(e.message, "erro"); }
  } }));
  botoes.push(el("button", { class: "bt bt-mini", type: "button", text: "Reabrir para edição", onclick: async () => {
    try { await api("POST", "api/documentos/" + doc.id + "/reabrir"); trocarAba("escrever"); await atualizarDoc(); }
    catch (e) { aviso(e.message, "erro"); }
  } }));
  faixa.replaceChildren(el("div", { class: "faixa-final" },
    el("div", null, el("b", { text: "Documento finalizado. " }),
       el("span", { class: "so-largo", text: "Arquivos: " + (doc.arquivos || []).map(nomeCurto).join(" e ") })),
    el("div", { class: "acoes" }, ...botoes)));
}

async function excluirDocumento() {
  if (!confirm("Excluir este documento e todos os apontamentos dele?" +
               (E.modo === "servidor" ? " Os arquivos já gerados continuam na pasta." : ""))) return;
  try {
    await api("POST", "api/documentos/" + E.doc.id + "/excluir");
    E.doc = null;
    await carregarEstado();
    location.hash = "#/";
    aviso("Documento excluído.", "ok");
  } catch (e) { aviso(e.message, "erro"); }
}

async function finalizar(formatos) {
  if (!formatos.length) return aviso("Marque Word, PDF ou os dois.", "erro");
  const aps = E.doc.apontamentos;
  if (!aps.length) return aviso("Adicione pelo menos um apontamento.", "erro");
  if (aps.some(a => a.situacao === "pendente") || E.formalizando.size)
    return aviso("Aguarde a IA terminar os apontamentos em andamento.", "erro");
  if (E.editando.size) return aviso("Salve ou cancele a edição aberta antes de finalizar.", "erro");
  const comAviso = aps.filter(a => (a.avisos || []).some(x => !x.startsWith("Sugestão da IA") && !x.startsWith("Trazido de")));
  if (comAviso.length && !confirm(comAviso.length + " apontamento(s) têm avisos de conferência " +
      "(números ou IA indisponível). Gerar o documento assim mesmo?")) return;
  const fechar = abrirModal("Gerando o documento", el("p", null, el("span", { class: "carregando" }), "  Montando " +
    formatos.map(f => f === "pdf" ? "PDF" : "Word").join(" e ") + " com a identidade visual do escritório…"));
  try {
    if (E.modo === "local") await prepararGeradores();
    const r = await api("POST", "api/documentos/" + E.doc.id + "/finalizar", { formatos });
    fechar();
    aviso("Documento gerado: " + r.arquivos.map(nomeCurto).join(" e "), "ok", 7000);
    await carregarEstado();
    await atualizarDoc();
    trocarAba("previa");
  } catch (e) { fechar(); aviso(e.message, "erro", 9000); }
}

/* trazer apontamentos de outra competência ------------------------------- */
async function trazerDeOutroMes(docId, automatico) {
  const atual = E.estado.documentos.find(d => d.id === docId);
  if (!atual) return;
  const candidatos = E.estado.documentos.filter(d => d.id !== docId && d.quantidade)
    .sort((a, b) => (a.empresa === atual.empresa ? 0 : 1) - (b.empresa === atual.empresa ? 0 : 1) ||
                    b.competencia.localeCompare(a.competencia));
  if (!candidatos.length) { if (!automatico) aviso("Não há outro documento com apontamentos."); return; }
  const escolha = select(candidatos.map(d => [String(d.id), d.empresa + " · " + d.competencia_extenso + " (" + d.quantidade + ")"]),
                         String(candidatos[0].id));
  const lista = el("div", { class: "lista-copiar" });
  const carregar = async () => {
    lista.replaceChildren(el("span", { class: "carregando" }));
    try {
      const origem = await api("GET", "api/documentos/" + escolha.value);
      lista.replaceChildren(...origem.apontamentos.map(a => el("label", { class: "item-copiar" },
        el("input", { type: "checkbox", value: String(a.id), checked: true }),
        el("span", null, el("b", { text: (a.titulo || a.categoria) + " " }),
           el("span", { class: "dica", text: "· " + a.prioridade + " · " + (a.texto || a.original).slice(0, 140) })))));
    } catch (e) { lista.replaceChildren(el("div", { class: "aviso", text: e.message })); }
  };
  escolha.addEventListener("change", carregar);
  const fechar = abrirModal(automatico ? "Trazer pendências do mês anterior?" : "Trazer apontamentos de outro mês",
    el("p", { class: "dica", text: "Marque o que continua pendente. Os itens entram no fim da lista, com o aviso de onde vieram, e você pode editar." }),
    campo("Copiar de", escolha),
    lista,
    el("div", { class: "acoes espaco-cima" },
      el("button", { class: "bt bt-ouro", type: "button", text: "Trazer marcados", onclick: async () => {
        const ids = [...lista.querySelectorAll("input:checked")].map(i => Number(i.value));
        if (!ids.length) return aviso("Marque pelo menos um apontamento.");
        try {
          const r = await api("POST", "api/documentos/" + docId + "/copiar_de", { ids });
          fechar();
          aviso(r.copiados + " apontamento(s) trazido(s).", "ok");
          await carregarEstado();
          await atualizarDoc();
        } catch (e) { aviso(e.message, "erro"); }
      } }),
      el("button", { class: "bt", type: "button", text: automatico ? "Agora não" : "Cancelar", onclick: () => fechar() })));
  carregar();
}

/* apontamentos ------------------------------------------------------------ */
async function adicionar() {
  const texto = $("#novo-texto");
  if (E.ditado) E.ditado.stop();
  if (!texto.value.trim()) { texto.focus(); return aviso("Escreva o apontamento primeiro."); }
  const dados = { original: texto.value, categoria: $("#novo-categoria").value,
                  prioridade: $("#novo-prioridade").value, valor: $("#novo-valor").value,
                  referencia: $("#novo-ref").value };
  const docId = E.doc.id;
  texto.value = ""; $("#novo-valor").value = ""; $("#novo-ref").value = "";
  if (!ehEstreito()) texto.focus();
  let r;
  try {
    r = await api("POST", "api/documentos/" + docId + "/apontamentos", dados);
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
    const r = await api("POST", "api/apontamentos/" + id + "/formalizar");
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
    await api("POST", "api/apontamentos/" + id + (caminho ? "/" + caminho : ""), corpo);
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
        const n = cache.elem.querySelector(".ap-num"); if (n) n.textContent = pad2(i + 1);
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
  if (!aps.length) lista.replaceChildren(el("div", { class: "dica vazio-ap", text: "Os apontamentos adicionados aparecem aqui." }));
}

function cartao(ap, i, total, final, pend) {
  const situacao = pend ? "pendente" : ap.situacao;
  const rotulo = pend ? "Formalizando…" : ap.situacao_rotulo;
  const titulo = ap.titulo || (pend ? "Aguardando a IA" : ap.categoria);
  const avisos = (ap.avisos || []).map(a => el("div", {
    class: "aviso" + (a.startsWith("Sugestão da IA") || a.startsWith("Trazido de") ? " sugestao" : ""), text: a }));
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
      el("button", { class: "bt bt-mini", type: "button", text: "↑", title: "Subir", "aria-label": "Subir", disabled: i === 0 ? true : null,
                     onclick: () => acao(ap.id, "mover", { direcao: -1 }) }),
      el("button", { class: "bt bt-mini", type: "button", text: "↓", title: "Descer", "aria-label": "Descer", disabled: i === total - 1 ? true : null,
                     onclick: () => acao(ap.id, "mover", { direcao: 1 }) }),
      el("button", { class: "bt bt-mini bt-perigo", type: "button", text: "Excluir", onclick: () => {
        if (confirm("Excluir o apontamento " + (i + 1) + "?")) acao(ap.id, "excluir", null, "Apontamento excluído.");
      } }));
  }
  return el("div", { class: "ap " + situacao, id: "ap-" + ap.id, "data-modo": "leitura" },
    el("div", { class: "ap-topo" },
      el("div", null, el("span", { class: "ap-num", text: pad2(i + 1) }), el("span", { class: "ap-titulo", text: titulo })),
      el("span", { class: "situacao " + situacao }, pend ? el("span", { class: "carregando" }) : null, " ", rotulo)),
    el("div", { class: "ap-meta" }, el("span", { text: ap.categoria }),
       el("span", { class: "prio " + ap.prioridade, text: "● Prioridade " + ap.prioridade.toLowerCase() }),
       ap.referencia ? el("span", { text: "Ref.: " + ap.referencia }) : null,
       ap.valor ? el("span", { text: "Valor: " + Conteudo.formatarValor(ap.valor) }) : null),
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
  const valor = el("input", { class: "campo", value: v("valor"), placeholder: "Valor", inputmode: "decimal", oninput: guardar("valor") });
  const ref = el("input", { class: "campo", value: v("referencia"), placeholder: "Documento / referência", oninput: guardar("referencia") });
  const coletar = () => ({ titulo: titulo.value, texto: texto.value, providencia: prov.value, original: original.value,
                           categoria: categoria.value, prioridade: prioridade.value, valor: valor.value, referencia: ref.value });
  const fechar = () => { E.editando.delete(ap.id); E.cartoes.delete(ap.id); };
  return el("div", { class: "ap edicao", id: "ap-" + ap.id, "data-modo": "edicao" },
    el("div", { class: "ap-topo" }, el("div", null, el("span", { class: "ap-num", text: pad2(i + 1) }),
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
          await api("POST", "api/apontamentos/" + ap.id, { original: d.original, categoria: d.categoria,
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
      onclick: () => {
        trocarAba("escrever");
        const alvo = document.getElementById("ap-" + it.id);
        if (alvo) { alvo.scrollIntoView({ behavior: "smooth", block: "center" }); alvo.classList.remove("destaque"); void alvo.offsetWidth; alvo.classList.add("destaque"); }
      } },
    el("div", { class: "t" }, el("span", { class: "n", text: pad2(it.numero) }),
       el("span", { class: "tt", text: it.situacao === "pendente" ? "Formalizando…" : it.titulo })),
    el("div", { class: "corpo-item" },
      el("div", { class: "m" }, it.categoria, el("span", { class: "prio " + it.prioridade, text: "● Prioridade " + it.prioridade.toLowerCase() })),
      ...it.paragrafos.map(p => el("p", { text: p })),
      it.referencia ? el("div", { class: "det" }, el("b", { text: "Referência: " }), it.referencia) : null,
      it.valor ? el("div", { class: "det" }, el("b", { text: "Valor: " }), it.valor) : null,
      it.providencia ? el("div", { class: "prov" }, el("b", { text: "PROVIDÊNCIA SOLICITADA" }), it.providencia) : null)));

  const cargo = (c.cargo || "") + (c.crc ? " · CRC " + c.crc : "");
  papel.replaceChildren(
    el("div", { class: "papel-cab" }, el("img", { src: "marca/logo_claro.png", alt: "Zera Contabilidade" }),
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
async function iniciar() {
  E.modo = await detectarModo();
  document.body.dataset.modo = E.modo;
  if (E.modo === "local") {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => null);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => null);
  }
  await carregarEstado();
  await rota();
}

$("#bt-novo").addEventListener("click", () => { abrirMenu(false); location.hash = "#/novo"; });
$("#bt-inicio").addEventListener("click", () => { abrirMenu(false); location.hash = "#/"; });
$("#bt-config").addEventListener("click", () => { abrirMenu(false); location.hash = "#/config"; });
$("#bt-menu").addEventListener("click", () => abrirMenu(!document.body.classList.contains("menu-aberto")));
$("#veu").addEventListener("click", () => abrirMenu(false));
$("#busca").addEventListener("input", (ev) => { E.busca = ev.target.value; desenharLista(); });
window.addEventListener("hashchange", rota);
window.addEventListener("beforeunload", (ev) => {
  if (E.formalizando.size || E.editando.size) { ev.preventDefault(); ev.returnValue = ""; }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("#modal").classList.contains("oculto")) { $("#modal").classList.add("oculto"); $("#modal").replaceChildren(); }
});
iniciar().catch(e => aviso(e.message, "erro", 12000));
