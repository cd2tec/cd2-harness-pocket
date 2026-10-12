@echo off
title CD2 Harness - gravar pen drive
echo Abrindo uma janela de administrador (formatar o pen drive exige isso)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -Verb RunAs -FilePath powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0core\make-usb-windows.ps1\"'"
if errorlevel 1 (
  echo Nao foi possivel abrir como administrador. Clique com o botao direito neste .bat e escolha "Executar como administrador".
  pause
)
