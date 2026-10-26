; Small native extractor. Both platforms use the same per-user Node installer.
Unicode true
!include "MUI2.nsh"
!ifndef PAYLOAD
!error "Supply /DPAYLOAD=verified Windows payload"
!endif
!ifndef OUTPUT
!define OUTPUT "YAPLIX-0.0.1-windows-x64-setup.exe"
!endif
Name "YAPLIX"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
AutoCloseWindow true
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
Section "YAPLIX"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\payload"
 File /r "${PAYLOAD}\*.*"
 DetailPrint "Проверяем компьютер и запускаем установку YAPLIX…"
 ExecWait '"$PLUGINSDIR\payload\runtime\nodew.exe" "$PLUGINSDIR\payload\scripts\install-ui.mjs"' $0
 IntCmp $0 0 done
 MessageBox MB_OK|MB_ICONEXCLAMATION "Установка YAPLIX не завершена. Предыдущая версия и данные сохранены. Повторите запуск и прочитайте сообщение установщика."
 SetErrorLevel 1
 done:
SectionEnd
