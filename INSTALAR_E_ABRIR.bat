@echo off
chcp 65001 >nul
title Apontamentos Contabeis - instalacao
cd /d "%~dp0"
set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY (where python >nul 2>nul && set PY=python)
if not defined PY (
  echo Python nao encontrado. Instale o Python 3.11 ou mais novo em python.org
  echo marcando a opcao "Add python.exe to PATH" e rode este arquivo de novo.
  pause
  exit /b 1
)
echo Instalando/atualizando as bibliotecas...
%PY% -m pip install --upgrade -r requirements.txt
if errorlevel 1 (
  echo.
  echo Nao foi possivel instalar as bibliotecas. Verifique a internet e tente de novo.
  pause
  exit /b 1
)
%PY% executar.py
