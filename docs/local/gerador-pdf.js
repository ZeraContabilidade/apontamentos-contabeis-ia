/* PDF do relatório no navegador (jsPDF). Reproduz o layout de
   apontamentos/documento.py (gerar_pdf): mesma marca, mesmas fontes. */
"use strict";

(function (global) {
  const OURO = [168, 132, 63], OURO_CLARO = [201, 166, 98], OURO_SUAVE = [246, 240, 228];
  const PRETO = [17, 17, 17], CINZA = [107, 102, 92], CINZA_LINHA = [228, 222, 210];
  const COR_PRIORIDADE = { "Alta": [196, 56, 61], "Média": [168, 132, 63], "Baixa": [31, 138, 91] };
  const PT = 0.3528;              // 1 ponto em mm
  const ESQ = 18, LARG = 174, TOPO = 34, LIMITE = 275;
  const FONTES = [["Cinzel-Bold.ttf", "Cinzel", "bold"], ["Cinzel-Medium.ttf", "Cinzel", "normal"],
                  ["LiberationSans-Regular.ttf", "Corpo", "normal"], ["LiberationSans-Bold.ttf", "Corpo", "bold"],
                  ["LiberationSans-Italic.ttf", "Corpo", "italic"]];
  let _recursos = null;

  function base64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function recursos() {
    if (_recursos) return _recursos;
    _recursos = (async () => {
      const fontes = {};
      for (const [arq] of FONTES) {
        const r = await fetch("marca/" + arq);
        if (!r.ok) throw new Error("Não consegui carregar a fonte " + arq + ".");
        fontes[arq] = base64(await r.arrayBuffer());
      }
      const r = await fetch("marca/logo_claro.png");
      const logo = r.ok ? "data:image/png;base64," + base64(await r.arrayBuffer()) : null;
      return { fontes, logo };
    })();
    _recursos.catch(() => { _recursos = null; });
    return _recursos;
  }

  async function gerar(c) {
    const { jsPDF } = global.jspdf;
    const res = await recursos();
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    for (const [arq, fam, estilo] of FONTES) {
      pdf.addFileToVFS(arq, res.fontes[arq]);
      pdf.addFont(arq, fam, estilo);
    }
    pdf.setProperties({ title: c.titulo + " - " + c.empresa + " - " + c.competencia,
                        author: c.escritorio, creator: "Apontamentos Contábeis IA" });
    let y = TOPO;

    const fonte = (fam, estilo, tam, cor) => {
      pdf.setFont(fam, estilo); pdf.setFontSize(tam); pdf.setTextColor(...(cor || PRETO));
    };
    const novaPagina = () => { pdf.addPage(); y = TOPO; };
    const cabe = (h) => { if (y + h > LIMITE) novaPagina(); };
    const escrever = (texto, x, yy, op) => pdf.text(texto, x, yy, Object.assign({ baseline: "top" }, op || {}));

    // linha justificada palavra a palavra (o jsPDF não justifica bem com fonte própria)
    function linhaJustificada(linha, x, w) {
      const palavras = linha.split(" ").filter(Boolean);
      if (palavras.length < 2) return escrever(linha, x, y);
      const larguras = palavras.map(p => pdf.getTextWidth(p));
      const espaco = (w - larguras.reduce((a, b) => a + b, 0)) / (palavras.length - 1);
      if (espaco > pdf.getTextWidth(" ") * 3) return escrever(linha, x, y);
      let xx = x;
      palavras.forEach((p, i) => { escrever(p, xx, y); xx += larguras[i] + espaco; });
    }

    function paragrafo(texto, op) {
      op = Object.assign({ x: ESQ, w: LARG, tam: 10.5, estilo: "normal", cor: PRETO, alt: 5.6, justificar: false }, op);
      fonte("Corpo", op.estilo, op.tam, op.cor);
      const linhas = pdf.splitTextToSize(String(texto), op.w);
      linhas.forEach((l, i) => {
        cabe(op.alt);
        fonte("Corpo", op.estilo, op.tam, op.cor);
        if (op.justificar && i < linhas.length - 1) linhaJustificada(l, op.x, op.w);
        else escrever(l, op.x, y);
        y += op.alt;
      });
    }

    function subtitulo(t) {
      if (y > 250) novaPagina();
      fonte("Cinzel", "bold", 11.5, OURO);
      escrever(t.toUpperCase(), ESQ, y + 1);
      y += 7;
      pdf.setDrawColor(...CINZA_LINHA); pdf.setLineWidth(0.2);
      pdf.line(ESQ, y, ESQ + LARG, y);
      y += 3;
    }

    // título
    fonte("Cinzel", "bold", 18, PRETO);
    for (const l of pdf.splitTextToSize(c.titulo, LARG)) { escrever(l, ESQ, y + 1); y += 9; }
    fonte("Corpo", "normal", 10, CINZA);
    escrever("Competência " + c.competencia, ESQ, y + 0.5);
    y += 10;

    // quadro de identificação
    const linhas = [["Cliente", c.empresa]];
    if (c.cnpj) linhas.push(["CNPJ", c.cnpj]);
    linhas.push(["Competência", c.competencia]);
    if (c.destinatario) linhas.push(["A/C", c.destinatario]);
    linhas.push(["Emissão", c.emissao]);
    if (c.prazo) linhas.push(["Retorno até", c.prazo]);
    const altura = 6.2 * linhas.length + 6;
    pdf.setFillColor(...OURO_SUAVE); pdf.rect(ESQ, y, LARG, altura, "F");
    pdf.setFillColor(...OURO); pdf.rect(ESQ, y, 1.4, altura, "F");
    let yq = y + 3;
    for (const [rot, val] of linhas) {
      fonte("Corpo", "bold", 9.5, CINZA); escrever(rot.toUpperCase(), 24, yq + 1);
      fonte("Corpo", "normal", 10, PRETO); escrever(String(val).slice(0, 95), 56, yq + 1);
      yq += 6.2;
    }
    y += altura + 7;

    paragrafo("Prezados(as),");
    y += 1;
    for (const p of c.introducao) { paragrafo(p, { justificar: true }); y += 2; }
    y += 2;

    // resumo
    subtitulo("Resumo");
    const total = c.itens.length;
    const partes = [total + " apontamento" + (total !== 1 ? "s" : "")];
    for (const p of ["Alta", "Média", "Baixa"])
      if (c.por_prioridade[p]) partes.push(c.por_prioridade[p] + " de prioridade " + p.toLowerCase());
    paragrafo(partes.join(" · "), { tam: 10 });
    y += 1.5;
    for (const [cat, n] of Object.entries(c.por_categoria)) {
      cabe(5.4);
      fonte("Corpo", "normal", 10, OURO); escrever("▪", 22, y);
      fonte("Corpo", "normal", 10, PRETO); escrever(cat, 26, y);
      fonte("Corpo", "normal", 10, CINZA); escrever(String(n), 176, y, { align: "right" });
      y += 5.4;
    }
    y += 5;

    // apontamentos
    subtitulo("Apontamentos");
    const X = 30, W = LARG - 12;
    for (const it of c.itens) {
      if (y > 248) novaPagina();
      y += 1;
      fonte("Cinzel", "bold", 13, OURO);
      escrever(String(it.numero).padStart(2, "0"), ESQ, y + 0.5);
      fonte("Corpo", "bold", 11.5, PRETO);
      for (const l of pdf.splitTextToSize(it.titulo, W)) { cabe(7); escrever(l, X, y + 1); y += 7; }
      fonte("Corpo", "normal", 8.5, CINZA);
      escrever(it.categoria, X, y + 0.5);
      const wCat = pdf.getTextWidth(it.categoria) + 3;
      fonte("Corpo", "bold", 8.5, COR_PRIORIDADE[it.prioridade] || OURO);
      escrever("●  Prioridade " + it.prioridade.toLowerCase(), X + wCat, y + 0.5);
      y += 6.5;
      for (const p of it.paragrafos) { paragrafo(p, { x: X, w: W, justificar: true }); y += 1.2; }
      const det = [];
      if (it.referencia) det.push(["Referência", it.referencia]);
      if (it.valor) det.push(["Valor", it.valor]);
      for (const [rot, val] of det) {
        cabe(5.4);
        fonte("Corpo", "bold", 9.5, CINZA); escrever(rot + ":", X, y);
        const yAntes = y;
        paragrafo(val, { x: X + 22, w: W - 22, tam: 9.5, alt: 5.4 });
        if (y === yAntes) y += 5.4;
      }
      if (it.providencia) {
        y += 1;
        fonte("Corpo", "normal", 10, PRETO);
        const lp = pdf.splitTextToSize(it.providencia, W - 6);
        const h = 5.4 * lp.length + 10;
        cabe(h);
        pdf.setFillColor(...OURO_SUAVE); pdf.rect(X, y, W, h, "F");
        pdf.setFillColor(...OURO); pdf.rect(X, y, 1.2, h, "F");
        fonte("Corpo", "bold", 8.5, OURO); escrever("PROVIDÊNCIA SOLICITADA", X + 4, y + 2.3);
        fonte("Corpo", "normal", 10, PRETO);
        lp.forEach((l, i) => escrever(l, X + 4, y + 7.2 + i * 5.4));
        y += h;
      }
      y += 5;
    }

    // encerramento e assinatura
    if (y > 215) novaPagina();
    subtitulo("Considerações finais");
    for (const p of c.encerramento) { paragrafo(p, { justificar: true }); y += 2; }
    y += 4;
    if (y > 228) novaPagina();
    paragrafo("Atenciosamente,");
    y += 16;
    pdf.setDrawColor(...PRETO); pdf.setLineWidth(0.2); pdf.line(ESQ, y, ESQ + 80, y);
    y += 1.5;
    if (c.responsavel) { paragrafo(c.responsavel, { estilo: "bold", alt: 5.5 }); }
    const cargo = (c.cargo || "") + (c.crc ? " · CRC " + c.crc : "");
    if (cargo.trim()) paragrafo(cargo, { tam: 9.5, cor: CINZA, alt: 5 });
    fonte("Cinzel", "bold", 10, OURO); escrever(c.escritorio.toUpperCase(), ESQ, y + 0.8); y += 6;
    const extra = [c.escritorio_cnpj ? "CNPJ " + c.escritorio_cnpj : "", c.escritorio_endereco].filter(Boolean).join(" · ");
    if (extra) paragrafo(extra, { tam: 8.5, cor: CINZA, alt: 4.5 });
    y += 3;
    paragrafo(c.data_extenso, { tam: 9.5, alt: 5 });

    // cabeçalho e rodapé em todas as páginas
    const paginas = pdf.getNumberOfPages();
    for (let n = 1; n <= paginas; n++) {
      pdf.setPage(n);
      if (res.logo) pdf.addImage(res.logo, "PNG", ESQ, 11, 13 * 765 / 299, 13);
      fonte("Cinzel", "bold", 9, OURO);
      escrever("APONTAMENTOS CONTÁBEIS", ESQ + LARG, 13, { align: "right" });
      fonte("Corpo", "normal", 8.5, CINZA);
      escrever((c.empresa + " · " + c.competencia).slice(0, 90), ESQ + LARG, 18, { align: "right" });
      pdf.setDrawColor(...OURO); pdf.setLineWidth(0.6); pdf.line(ESQ, 28, ESQ + LARG, 28);
      pdf.setDrawColor(...OURO_CLARO); pdf.setLineWidth(0.3); pdf.line(ESQ, 280, ESQ + LARG, 280);
      fonte("Corpo", "normal", 7.5, CINZA);
      escrever((c.escritorio + (c.rodape ? " · " + c.rodape : "")).slice(0, 120), ESQ, 282.5);
      escrever("Página " + n + " de " + paginas, ESQ + LARG - 2, 282.5, { align: "right" });
    }
    return pdf.output("blob");
  }

  global.GeradorPDF = { gerar };
})(window);
