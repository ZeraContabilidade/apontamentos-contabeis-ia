# -*- coding: utf-8 -*-
"""Apontamentos Contábeis com IA -- Zera Contabilidade.

O contador escreve, no momento em que encontra, cada erro ou divergência da
empresa que está lançando. A IA reescreve o texto em linguagem formal (sem
inventar fato nenhum) e o documento de apontamentos vai se montando na tela.
No fim, o documento sai em DOCX e PDF com a identidade visual do escritório.

Histórico de versões
1.0  primeira versão: documentos por empresa e competência, formalização
     pela IA com conferência de números, prévia ao vivo, DOCX e PDF.
1.1  campo Workspace ID nas Configurações (chave de organização sem
     workspace) e mensagem clara quando a API pede o workspace.
"""

__version__ = "1.1"
