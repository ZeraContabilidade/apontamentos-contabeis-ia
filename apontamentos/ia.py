# -*- coding: utf-8 -*-
"""Redação formal dos apontamentos com a API da Anthropic (Claude).

Papel da IA aqui: REESCREVER. Ela recebe o que o contador anotou e devolve o
mesmo conteúdo em linguagem formal, clara e cordial, dirigida ao cliente.
Não acrescenta fato, valor, data, número de documento, artigo de lei, multa
ou prazo que não esteja no texto. O resultado ainda passa pela
conferência de números (conferencia.py) antes de aparecer como pronto.
"""
from __future__ import annotations

import json

from . import conferencia

INSTRUCOES = """Você é o redator técnico de um escritório de contabilidade brasileiro.
O contador, enquanto faz a escrituração contábil de uma empresa cliente, anota
de forma rápida e informal cada erro, divergência ou pendência que encontra.
Sua tarefa é reescrever cada anotação como um apontamento formal, que será
enviado ao cliente em um relatório do escritório.

Regras obrigatórias:
1. Não invente nada. Use somente os fatos do texto do contador e dos campos
   informados (valor, referência). Não acrescente valores, datas, números de
   nota, nomes, artigos de lei, multas, juros, penalidades, prazos ou
   consequências que não estejam escritos.
2. Preserve exatamente todos os números, datas, valores, nomes e documentos
   citados. Valores em reais podem ser escritos no padrão brasileiro
   (R$ 1.500,00), sem mudar o valor.
3. Linguagem formal, objetiva, cordial e impessoal, na primeira pessoa do
   plural do escritório ("identificamos", "verificamos", "solicitamos").
   Trate o cliente por "V.Sas." quando precisar se dirigir a ele.
   Nada de tom acusatório: o objetivo é apontar e resolver.
4. Corrija ortografia, gramática, abreviações e termos técnicos contábeis
   (ex.: "nf" = nota fiscal, "extrato" = extrato bancário, "lcto" =
   lançamento). Se uma abreviação for ambígua, mantenha como está e registre
   a dúvida em pontos_a_confirmar.
5. Sem saudação, sem assinatura, sem numeração e sem markdown: o texto vai
   dentro de um relatório já formatado.

Campos da resposta:
- titulo: título curto do apontamento (até 8 palavras), sem ponto final.
- texto: o apontamento formal, em 1 a 3 parágrafos curtos (separe parágrafos
  com uma linha em branco). Descreva o que foi constatado.
- providencia: a providência solicitada ao cliente em uma frase (ex.:
  "Solicitamos o envio da nota fiscal correspondente."). Se o texto do
  contador indicar o que fazer, use isso; se estiver implícito, peça de forma
  genérica a verificação ou o envio do documento citado, sem criar prazo.
  Deixe vazio se o apontamento for apenas informativo.
- pontos_a_confirmar: lista curta (pode ser vazia) de informações que
  deixariam o apontamento mais completo e que o contador não informou
  (ex.: "Número da nota fiscal não informado"). Isso NÃO vai para o cliente;
  serve só de lembrete para o contador. Nunca preencha essas lacunas no texto.
"""

ESQUEMA = {
    "type": "object",
    "properties": {
        "titulo": {"type": "string"},
        "texto": {"type": "string"},
        "providencia": {"type": "string"},
        "pontos_a_confirmar": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["titulo", "texto", "providencia", "pontos_a_confirmar"],
    "additionalProperties": False,
}

# Modelos que aceitam o parâmetro de esforço e a troca automática de modelo
# quando a resposta é recusada pelos filtros de segurança.
_COM_ESFORCO = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-sonnet-5")
_COM_RESERVA = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5")
BETA_RESERVA = "server-side-fallback-2026-07-01"


class ErroIA(Exception):
    """A IA não conseguiu formalizar. A mensagem é para o usuário ler."""


class Redator:
    def __init__(self, chave: str, modelo: str, esforco: str = "medium",
                 workspace_id: str = "", cliente=None):
        self.modelo = modelo
        self.esforco = esforco
        self._reserva_ok = True
        if cliente is not None:          # testes passam um cliente falso
            self.cliente = cliente
            self._anthropic = None
            return
        if not chave:
            raise ErroIA("A chave da API não está configurada. Abra Configurações "
                         "e cole a chave da Anthropic.")
        try:
            import anthropic
        except ImportError as e:
            raise ErroIA("A biblioteca 'anthropic' não está instalada. Rode "
                         "INSTALAR_E_ABRIR de novo.") from e
        self._anthropic = anthropic
        cabecalhos = {"anthropic-workspace-id": workspace_id.strip()} if workspace_id.strip() else None
        self.cliente = anthropic.Anthropic(api_key=chave, timeout=90.0, max_retries=2,
                                           default_headers=cabecalhos)

    # ------------------------------------------------------------------
    def _pedido(self, conteudo: str) -> dict:
        pedido = {
            "model": self.modelo,
            "max_tokens": 16000,
            "system": [{"type": "text", "text": INSTRUCOES,
                        "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": conteudo}],
            "output_config": {"format": {"type": "json_schema", "schema": ESQUEMA}},
        }
        if self.modelo in _COM_ESFORCO and self.esforco:
            pedido["output_config"]["effort"] = self.esforco
        return pedido

    def _chamar(self, conteudo: str):
        pedido = self._pedido(conteudo)
        try:
            if self._reserva_ok and self.modelo in _COM_RESERVA:
                try:
                    return self.cliente.beta.messages.create(
                        betas=[BETA_RESERVA], fallbacks="default", **pedido)
                except Exception as e:
                    # conta sem acesso ao recurso de reserva: segue sem ele
                    if _e_pedido_invalido(e) and "fallback" in str(e).lower():
                        self._reserva_ok = False
                    else:
                        raise
            return self.cliente.messages.create(**pedido)
        except ErroIA:
            raise
        except Exception as e:
            raise ErroIA(self._mensagem_erro(e)) from e

    def _mensagem_erro(self, e: Exception) -> str:
        a = self._anthropic
        texto = str(e)
        if a is not None:
            if isinstance(e, a.AuthenticationError):
                return "A chave da API foi recusada. Confira a chave em Configurações."
            if isinstance(e, a.PermissionDeniedError):
                return "A chave da API não tem permissão para este modelo."
            if isinstance(e, a.NotFoundError):
                return (f"O modelo '{self.modelo}' não foi encontrado. Escolha outro "
                        f"em Configurações.")
            if isinstance(e, a.RateLimitError):
                return "Limite de uso da API atingido. Aguarde um minuto e tente de novo."
            if isinstance(e, a.APITimeoutError):
                return "A IA demorou demais para responder. Tente de novo."
            if isinstance(e, a.APIConnectionError):
                return "Sem conexão com a internet (ou a API está fora do ar)."
            if isinstance(e, a.APIStatusError):
                if "workspace" in texto.lower():
                    return ("Esta chave da API não pertence a um workspace. Crie uma chave "
                            "dentro de um workspace no console da Anthropic (Settings > "
                            "Workspaces > abra o workspace > API Keys) e cole aqui, ou "
                            "informe o Workspace ID (começa com wrkspc_) em Configurações.")
                if "credit" in texto.lower() or "billing" in texto.lower():
                    return "Sem crédito na conta da API da Anthropic."
                if e.status_code >= 500:
                    return "A API da Anthropic está instável no momento. Tente de novo."
        return f"Falha ao chamar a IA: {texto[:300]}"

    # ------------------------------------------------------------------
    def formalizar(self, original: str, *, categoria: str = "", prioridade: str = "",
                   valor: str = "", referencia: str = "", empresa: str = "",
                   competencia: str = "") -> dict:
        linhas = [f"Empresa: {empresa}" if empresa else "",
                  f"Competência: {competencia}" if competencia else "",
                  f"Categoria: {categoria}" if categoria else "",
                  f"Prioridade: {prioridade}" if prioridade else "",
                  f"Valor informado: {valor}" if valor else "",
                  f"Documento/referência informado: {referencia}" if referencia else "",
                  "", "Anotação do contador:", original.strip()]
        resp = self._chamar("\n".join(x for x in linhas if x is not None))

        if getattr(resp, "stop_reason", "") == "refusal":
            raise ErroIA("A IA recusou este texto. O apontamento ficou com o seu "
                         "texto original; edite manualmente se precisar.")
        if getattr(resp, "stop_reason", "") == "max_tokens":
            raise ErroIA("A resposta da IA veio cortada. Tente de novo.")
        texto = "".join(getattr(b, "text", "") for b in resp.content
                        if getattr(b, "type", "") == "text")
        try:
            dados = json.loads(texto)
        except ValueError as e:
            raise ErroIA("A IA respondeu fora do formato esperado. Tente de novo.") from e
        resultado = {
            "titulo": _limpo(dados.get("titulo")).rstrip("."),
            "texto": _limpo(dados.get("texto")),
            "providencia": _limpo(dados.get("providencia")),
            "pontos_a_confirmar": [_limpo(x) for x in dados.get("pontos_a_confirmar") or []
                                   if _limpo(x)],
        }
        if not resultado["texto"]:
            raise ErroIA("A IA devolveu um texto vazio. Tente de novo.")
        resultado["avisos"] = conferencia.conferir(
            original,
            [resultado["titulo"], resultado["texto"], resultado["providencia"]],
            [empresa, competencia, valor, referencia])
        return resultado

    def testar(self) -> str:
        r = self.formalizar("nf 123 sem boleto", categoria="Documentação pendente")
        return r["texto"]


def _limpo(v) -> str:
    texto = str(v or "").replace("\r\n", "\n").strip()
    # remove marcações de markdown que eventualmente escapem
    for marca in ("**", "__", "##"):
        texto = texto.replace(marca, "")
    return texto


def _e_pedido_invalido(e: Exception) -> bool:
    return getattr(e, "status_code", None) == 400
