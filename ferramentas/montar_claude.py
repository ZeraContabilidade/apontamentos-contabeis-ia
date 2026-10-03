# -*- coding: utf-8 -*-
"""Monta a versão do sistema que abre dentro do Claude (link do claude.ai).

    python ferramentas/montar_claude.py

Gera a pasta claude/ a partir de docs/: uma página só (index.html, com o
estilo e os scripts dentro) + a pasta marca/ (logo e fontes). Os dados
ficam na conta do Claude de quem usa e a IA é a da própria conta, sem chave.
Publicação: Artifact com capabilities db, user, sample e downloads.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DOCS = RAIZ / "docs"
SAIDA = RAIZ / "claude"

SCRIPTS = ["vendor/jspdf.umd.min.js", "vendor/docx.min.js", "local/conteudo.js",
           "local/conferencia.js", "local/ia.js", "local/servidor-local.js",
           "local/gerador-pdf.js", "local/gerador-docx.js", "app.js"]
MARCA = ["logo_claro.png", "emblema.png", "Cinzel-Bold.ttf", "Cinzel-Medium.ttf",
         "LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf"]


def _script(caminho: str) -> str:
    texto = (DOCS / caminho).read_text(encoding="utf-8")
    # um "</script" dentro do código fecharia a tag antes da hora
    return "<script>\n" + texto.replace("</script", "<\\/script") + "\n</script>"


def montar() -> Path:
    html = (DOCS / "index.html").read_text(encoding="utf-8")
    corpo = re.search(r"<body>(.*?)<script", html, re.S).group(1).strip()
    corpo = corpo.replace('<main id="principal" class="principal"></main>',
                          '<main id="principal" class="principal"><p class="dica">Abrindo os seus documentos…</p></main>')
    estilo = (DOCS / "estilo.css").read_text(encoding="utf-8")
    pagina = "\n".join([
        "<title>Apontamentos Contábeis Zera</title>",
        "<style>\n" + estilo + "\n</style>",
        corpo,
        *(_script(s) for s in SCRIPTS),
        "",
    ])
    if SAIDA.exists():
        shutil.rmtree(SAIDA)
    (SAIDA / "marca").mkdir(parents=True)
    (SAIDA / "index.html").write_text(pagina, encoding="utf-8")
    for nome in MARCA:
        shutil.copy2(DOCS / "marca" / nome, SAIDA / "marca" / nome)
    return SAIDA / "index.html"


if __name__ == "__main__":
    destino = montar()
    print("gerado:", destino, f"({destino.stat().st_size // 1024} KB)")
