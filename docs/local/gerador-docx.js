/* DOCX do relatório no navegador (biblioteca docx). Mesmo layout de
   apontamentos/documento.py (gerar_docx). */
"use strict";

(function (global) {
  const OURO = "A8843F", OURO_CLARO = "C9A662", OURO_SUAVE = "F6F0E4", PRETO = "111111",
        CINZA = "6B665C", CINZA_LINHA = "E4DED2";
  const COR_PRIORIDADE = { "Alta": "C4383D", "Média": "A8843F", "Baixa": "1F8A5B" };
  const CM = 567;                 // twips por centímetro
  const TITULO = "Georgia", CORPO = "Arial";
  let _logo = null;

  async function logo() {
    if (!_logo) {
      _logo = fetch("marca/logo_claro.png").then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
    }
    return _logo;
  }

  async function gerar(c) {
    const D = global.docx;
    const { Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, Table, TableRow,
            TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, PageNumber, TabStopType } = D;
    const run = (texto, op) => new TextRun(Object.assign({ text: texto }, op || {}));
    const pts = (n) => Math.round(n * 2);           // tamanho em meio-ponto
    const sombra = (cor) => ({ type: ShadingType.CLEAR, color: "auto", fill: cor });
    const nenhuma = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

    // cabeçalho
    const imagem = await logo();
    const cab = new Table({
      width: { size: 17.4 * CM, type: WidthType.DXA },
      columnWidths: [6 * CM, 11.4 * CM],
      borders: { top: nenhuma, bottom: nenhuma, left: nenhuma, right: nenhuma, insideHorizontal: nenhuma, insideVertical: nenhuma },
      rows: [new TableRow({ children: [
        new TableCell({ width: { size: 6 * CM, type: WidthType.DXA }, children: [new Paragraph({ children:
          imagem ? [new ImageRun({ type: "png", data: imagem, transformation: { width: Math.round(51 * 765 / 299), height: 51 } })] : [] })] }),
        new TableCell({ width: { size: 11.4 * CM, type: WidthType.DXA }, children: [
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [run("APONTAMENTOS CONTÁBEIS",
            { size: pts(9), bold: true, color: OURO, font: TITULO, characterSpacing: 20 })] }),
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(c.empresa + " · " + c.competencia,
            { size: pts(8.5), color: CINZA })] })] }),
      ] })],
    });
    const linhaCab = new Paragraph({ spacing: { after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, space: 1, color: OURO } } });

    const rodape = new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, space: 4, color: OURO_CLARO } },
      tabStops: [{ type: TabStopType.RIGHT, position: 17.4 * CM }],
      children: [
        run(c.escritorio + (c.rodape ? " · " + c.rodape : ""), { size: pts(7.5), color: CINZA }),
        new TextRun({ size: pts(7.5), color: CINZA, children: ["\tPágina ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES] }),
      ],
    });

    const corpo = [];
    const p = (filhos, op) => { const x = new Paragraph(Object.assign({ children: filhos }, op || {})); corpo.push(x); return x; };
    const corrido = (texto, recuo) => p([run(texto)], { alignment: AlignmentType.JUSTIFIED,
      indent: recuo ? { left: Math.round(recuo * CM) } : undefined });
    const subtitulo = (texto) => p([run(texto.toUpperCase(), { size: pts(11.5), bold: true, color: OURO, font: TITULO, characterSpacing: 10 })],
      { spacing: { before: 200, after: 120 }, keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 2, color: CINZA_LINHA } } });

    p([run(c.titulo, { size: pts(19), bold: true, color: PRETO, font: TITULO, allCaps: true })], { spacing: { after: 40 } });
    p([run("Competência " + c.competencia, { size: pts(10), color: CINZA })]);

    const linhas = [["Cliente", c.empresa]];
    if (c.cnpj) linhas.push(["CNPJ", c.cnpj]);
    linhas.push(["Competência", c.competencia]);
    if (c.destinatario) linhas.push(["A/C", c.destinatario]);
    linhas.push(["Emissão", c.emissao]);
    if (c.prazo) linhas.push(["Retorno até", c.prazo]);
    corpo.push(new Table({
      width: { size: 17.4 * CM, type: WidthType.DXA },
      columnWidths: [3.6 * CM, 13.8 * CM],
      borders: { top: nenhuma, bottom: nenhuma, right: nenhuma, insideHorizontal: nenhuma, insideVertical: nenhuma,
                 left: { style: BorderStyle.SINGLE, size: 24, color: OURO } },
      rows: linhas.map(([rot, val]) => new TableRow({ children: [
        new TableCell({ width: { size: 3.6 * CM, type: WidthType.DXA }, shading: sombra(OURO_SUAVE),
          children: [new Paragraph({ spacing: { before: 20, after: 20 }, children: [run(rot.toUpperCase(), { size: pts(8.5), bold: true, color: CINZA })] })] }),
        new TableCell({ width: { size: 13.8 * CM, type: WidthType.DXA }, shading: sombra(OURO_SUAVE),
          children: [new Paragraph({ spacing: { before: 20, after: 20 }, children: [run(val, { size: pts(10), color: PRETO })] })] }),
      ] })),
    }));
    p([], { spacing: { after: 80 } });

    p([run("Prezados(as),")]);
    for (const par of c.introducao) corrido(par);

    subtitulo("Resumo");
    const total = c.itens.length;
    const partes = [total + " apontamento" + (total !== 1 ? "s" : "")];
    for (const pr of ["Alta", "Média", "Baixa"])
      if (c.por_prioridade[pr]) partes.push(c.por_prioridade[pr] + " de prioridade " + pr.toLowerCase());
    p([run(partes.join(" · "), { size: pts(10) })]);
    for (const [cat, n] of Object.entries(c.por_categoria))
      p([run("▪  ", { color: OURO, size: pts(10) }), run(cat + ": ", { size: pts(10) }), run(String(n), { size: pts(10), color: CINZA })],
        { indent: { left: Math.round(0.4 * CM) }, spacing: { after: 20 } });

    subtitulo("Apontamentos");
    for (const it of c.itens) {
      p([run(String(it.numero).padStart(2, "0") + "   ", { size: pts(13), bold: true, color: OURO, font: TITULO }),
         run(it.titulo, { size: pts(11.5), bold: true, color: PRETO })],
        { spacing: { before: 160, after: 20 }, keepNext: true });
      p([run(it.categoria + "   ", { size: pts(8.5), color: CINZA }),
         run("●  Prioridade " + it.prioridade.toLowerCase(), { size: pts(8.5), bold: true, color: COR_PRIORIDADE[it.prioridade] || OURO })],
        { indent: { left: Math.round(1.05 * CM) }, keepNext: true });
      for (const par of it.paragrafos) corrido(par, 1.05);
      if (it.referencia) p([run("Referência: ", { size: pts(9.5), bold: true, color: CINZA }), run(it.referencia, { size: pts(9.5) })],
        { indent: { left: Math.round(1.05 * CM) }, spacing: { after: 20 } });
      if (it.valor) p([run("Valor: ", { size: pts(9.5), bold: true, color: CINZA }), run(it.valor, { size: pts(9.5) })],
        { indent: { left: Math.round(1.05 * CM) }, spacing: { after: 20 } });
      if (it.providencia) {
        const caixa = { indent: { left: Math.round(1.25 * CM) }, shading: sombra(OURO_SUAVE),
                        border: { left: { style: BorderStyle.SINGLE, size: 18, space: 8, color: OURO } } };
        p([run("PROVIDÊNCIA SOLICITADA", { size: pts(8.5), bold: true, color: OURO })],
          Object.assign({ spacing: { before: 80, after: 0 }, keepNext: true }, caixa));
        p([run(it.providencia, { size: pts(10) })], Object.assign({ spacing: { after: 120 } }, caixa));
      }
    }

    subtitulo("Considerações finais");
    for (const par of c.encerramento) corrido(par);
    p([run("Atenciosamente,")], { spacing: { before: 160 } });
    p([run("_".repeat(42))], { spacing: { before: 600, after: 0 } });
    if (c.responsavel) p([run(c.responsavel, { bold: true })], { spacing: { after: 0 } });
    const cargo = (c.cargo || "") + (c.crc ? " · CRC " + c.crc : "");
    if (cargo.trim()) p([run(cargo, { size: pts(9.5), color: CINZA })], { spacing: { after: 0 } });
    p([run(c.escritorio.toUpperCase(), { size: pts(10), bold: true, color: OURO, font: TITULO })], { spacing: { after: 0 } });
    const extra = [c.escritorio_cnpj ? "CNPJ " + c.escritorio_cnpj : "", c.escritorio_endereco].filter(Boolean).join(" · ");
    if (extra) p([run(extra, { size: pts(8.5), color: CINZA })]);
    p([run(c.data_extenso, { size: pts(9.5) })], { spacing: { before: 120 } });

    const doc = new Document({
      creator: c.escritorio,
      title: c.titulo + " - " + c.empresa + " - " + c.competencia,
      styles: { default: { document: { run: { font: CORPO, size: 21 }, paragraph: { spacing: { after: 80, line: 276 } } } } },
      sections: [{
        properties: { page: {
          size: { width: 11906, height: 16838 },
          margin: { top: Math.round(3.2 * CM), bottom: Math.round(2.2 * CM), left: Math.round(1.8 * CM),
                    right: Math.round(1.8 * CM), header: CM, footer: CM } } },
        headers: { default: new Header({ children: [cab, linhaCab] }) },
        footers: { default: new Footer({ children: [rodape] }) },
        children: corpo,
      }],
    });
    return Packer.toBlob(doc);
  }

  global.GeradorDOCX = { gerar };
})(window);
