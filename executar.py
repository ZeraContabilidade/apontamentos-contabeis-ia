# -*- coding: utf-8 -*-
"""Abre o sistema de Apontamentos Contábeis no navegador.

    python executar.py            liga o sistema e abre o navegador
    python executar.py --sem-navegador

Se o sistema já estiver aberto, só abre o navegador de novo.
Para fechar, feche a janela preta (ou Ctrl+C).
"""
from __future__ import annotations

import json
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apontamentos import __version__, config  # noqa: E402


def ja_aberto(porta: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{porta}/api/ping", timeout=1.5) as r:
            return json.loads(r.read()).get("app") == "apontamentos"
    except Exception:
        return False


def main(argv: list[str]) -> int:
    faltando = []
    for modulo, pacote in (("docx", "python-docx"), ("fpdf", "fpdf2"), ("anthropic", "anthropic")):
        try:
            __import__(modulo)
        except ImportError:
            faltando.append(pacote)
    if faltando:
        print("Faltam bibliotecas: " + ", ".join(faltando))
        print("Dê dois cliques em INSTALAR_E_ABRIR.bat para instalar.")
        input("Enter para sair...")
        return 1

    from apontamentos.servidor import Aplicacao, criar_servidor

    cfg = config.carregar()
    porta = cfg.porta
    url = f"http://127.0.0.1:{porta}/"
    abrir = "--sem-navegador" not in argv
    if ja_aberto(porta):
        print("O sistema já está aberto. Abrindo o navegador...")
        if abrir:
            webbrowser.open(url)
        return 0
    try:
        servidor = criar_servidor(Aplicacao(cfg=cfg), porta)
    except OSError:
        print(f"A porta {porta} está ocupada por outro programa. Troque a porta em "
              f"{config.arquivo_config()} (campo \"porta\") e abra de novo.")
        input("Enter para sair...")
        return 1

    print("=" * 62)
    print(f"  Apontamentos Contábeis IA · Zera Contabilidade · v{__version__}")
    print("=" * 62)
    print(f"  Aberto em {url}")
    print("  Deixe esta janela aberta enquanto usa o sistema.")
    print("  Para fechar, feche esta janela.")
    print()
    if abrir:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
