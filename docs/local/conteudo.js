/* Conteúdo do relatório: o mesmo cálculo de apontamentos/documento.py
   (montar_conteudo), usado quando o sistema roda sozinho no navegador
   (iPhone, iPad, qualquer computador sem o programa instalado). */
"use strict";

(function (global) {
  const CATEGORIAS = [
    "Documentação pendente", "Divergência de valores", "Lançamento sem comprovante",
    "Conciliação bancária", "Fiscal / Tributos", "Folha de pagamento",
    "Estoque / Patrimônio", "Cadastro / Dados da empresa", "Outros",
  ];
  const PRIORIDADES = ["Alta", "Média", "Baixa"];
  const SITUACOES = {
    pendente: "Formalizando…",
    formalizado: "Formalizado pela IA",
    editado: "Editado manualmente",
    sem_ia: "Texto original (sem IA)",
    erro: "IA indisponível — texto original",
  };
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
                 "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  const INTRODUCAO_PADRAO =
    "No decorrer da escrituração contábil referente à competência {competencia}, " +
    "nossa equipe identificou os pontos relacionados a seguir. Eles necessitam da " +
    "atenção e, quando indicado, de providência por parte de V.Sas., para que os " +
    "registros reflitam corretamente a situação da empresa e os trabalhos do " +
    "período possam ser concluídos.";
  const ENCERRAMENTO_PADRAO =
    "Solicitamos a gentileza de analisar os apontamentos acima e nos encaminhar " +
    "os documentos e esclarecimentos indicados. Permanecemos à disposição para " +
    "quaisquer dúvidas.";

  const TITULO_DOC = "Relatório de Apontamentos Contábeis";

  function competenciaIso(texto) {
    const t = String(texto || "").trim().replace(/\s/g, "");
    let m = t.match(/^(\d{4})-(\d{1,2})$/);
    let ano, mes;
    if (m) { ano = +m[1]; mes = +m[2]; }
    else if ((m = t.match(/^(\d{1,2})[\/\-.](\d{4})$/))) { mes = +m[1]; ano = +m[2]; }
    else if ((m = t.match(/^(\d{2})(\d{4})$/))) { mes = +m[1]; ano = +m[2]; }
    if (!ano || mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
    return ano + "-" + String(mes).padStart(2, "0");
  }

  function competenciaExtenso(iso) {
    const [a, m] = String(iso || "").split("-");
    const nome = MESES[parseInt(m, 10) - 1];
    return nome ? nome + "/" + a : iso;
  }

  function dataExtenso(d) {
    return String(d.getDate()).padStart(2, "0") + " de " + MESES[d.getMonth()].toLowerCase() +
      " de " + d.getFullYear();
  }

  function dataBr(d) {
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") +
      "/" + d.getFullYear();
  }

  function formatarValor(valor) {
    const v = String(valor || "").trim();
    if (!v) return "";
    const bruto = v.replace(/^R\$\s*/i, "").trim();
    let numero = null;
    if (/^(\d{1,3}(\.\d{3})+(,\d{1,2})?|\d+(,\d{1,2})?)$/.test(bruto))
      numero = Number(bruto.replace(/\./g, "").replace(",", "."));
    else if (/^\d+\.\d{1,2}$/.test(bruto)) numero = Number(bruto);
    if (numero === null || !isFinite(numero)) {
      if (/^R\$/i.test(v)) return v;
      return /^[\d.,]+$/.test(v) ? "R$ " + v : v;
    }
    const [inteiro, centavos] = numero.toFixed(2).split(".");
    return "R$ " + inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + centavos;
  }

  function paragrafos(texto) {
    return String(texto || "").trim().split(/\n\s*\n/)
      .map(p => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  }

  function montarConteudo(doc, cfg, hoje) {
    hoje = hoje || new Date();
    const comp = competenciaExtenso(doc.competencia);
    const itens = (doc.apontamentos || []).map((a, i) => ({
      id: a.id,
      situacao: a.situacao || "",
      numero: i + 1,
      titulo: a.titulo || a.categoria || "Apontamento",
      categoria: a.categoria || "",
      prioridade: a.prioridade || "Média",
      paragrafos: paragrafos(a.texto || a.original || ""),
      providencia: String(a.providencia || "").trim(),
      valor: formatarValor(a.valor),
      referencia: String(a.referencia || "").trim(),
    }));
    const porPrioridade = {};
    for (const p of PRIORIDADES) porPrioridade[p] = itens.filter(i => i.prioridade === p).length;
    const porCategoria = {};
    for (const i of itens) porCategoria[i.categoria] = (porCategoria[i.categoria] || 0) + 1;

    let prazo = "";
    const m = String(doc.prazo_retorno || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) prazo = m[3] + "/" + m[2] + "/" + m[1];

    const subst = (t) => String(t || "").split("{competencia}").join(comp)
      .split("{empresa}").join(doc.empresa).split("{prazo}").join(prazo);
    let encerramento = subst(cfg.encerramento);
    if (prazo && !String(cfg.encerramento || "").includes("{prazo}"))
      encerramento = ("Solicitamos o retorno até " + prazo + ". " + encerramento).trim();
    const rodape = [cfg.escritorio_telefone, cfg.escritorio_email, cfg.escritorio_site].filter(Boolean);
    return {
      titulo: TITULO_DOC,
      empresa: doc.empresa,
      cnpj: doc.cnpj || "",
      competencia: comp,
      destinatario: doc.destinatario || "",
      prazo,
      emissao: dataBr(hoje),
      data_extenso: dataExtenso(hoje),
      introducao: paragrafos(subst(cfg.introducao)),
      encerramento: paragrafos(encerramento),
      itens,
      por_prioridade: porPrioridade,
      por_categoria: porCategoria,
      escritorio: cfg.escritorio_nome || "Zera Contabilidade",
      escritorio_cnpj: cfg.escritorio_cnpj || "",
      escritorio_endereco: cfg.escritorio_endereco || "",
      rodape: rodape.join(" · "),
      responsavel: cfg.responsavel_nome || "",
      cargo: cfg.responsavel_cargo || "",
      crc: cfg.responsavel_crc || "",
    };
  }

  function nomeArquivo(doc) {
    const empresa = String(doc.empresa || "").normalize("NFKC")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/^[ .]+|[ .]+$/g, "").slice(0, 80) || "Empresa";
    const [ano, mes] = doc.competencia.split("-");
    return "Apontamentos - " + empresa + " - " + mes + "-" + ano;
  }

  global.Conteudo = {
    CATEGORIAS, PRIORIDADES, SITUACOES, MESES, INTRODUCAO_PADRAO, ENCERRAMENTO_PADRAO, TITULO_DOC,
    competenciaIso, competenciaExtenso, dataExtenso, formatarValor, paragrafos, montarConteudo,
    nomeArquivo,
  };
})(typeof window !== "undefined" ? window : globalThis);
