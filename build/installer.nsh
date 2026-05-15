!include "LogicLib.nsh"

!macro createStartMenuShortcut
  CreateDirectory "$SMPROGRAMS\\Puschelz Client"
  CreateShortCut "$SMPROGRAMS\\Puschelz Client\\Puschelz Client.lnk" "$INSTDIR\\Puschelz Client.exe"
!macroend

!macro removeStartMenuShortcut
  Delete "$SMPROGRAMS\\Puschelz Client\\Puschelz Client.lnk"
  RMDir "$SMPROGRAMS\\Puschelz Client"
!macroend

!macro createDesktopShortcut
  CreateShortCut "$DESKTOP\\Puschelz Client.lnk" "$INSTDIR\\Puschelz Client.exe"
!macroend

!macro removeDesktopShortcut
  Delete "$DESKTOP\\Puschelz Client.lnk"
!macroend

!ifndef BUILD_UNINSTALLER
Var startMenuShortcutPreference
Var desktopShortcutPreference

!macro persistShortcutPreferences
  ${if} $startMenuShortcutPreference == "true"
  ${orIf} $desktopShortcutPreference == "true"
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts "true"
  ${else}
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts "false"
  ${endif}

  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" StartMenuShortcutPreference "$startMenuShortcutPreference"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutPreference "$desktopShortcutPreference"
!macroend

Function configureStartMenuShortcut
  IfSilent startMenuApplySavedChoice 0

  StrCmp $startMenuShortcutPreference "false" 0 startMenuPromptYesDefault
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Create a Start Menu shortcut for Puschelz Client?" IDYES startMenuEnable IDNO startMenuDisable

  startMenuPromptYesDefault:
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Create a Start Menu shortcut for Puschelz Client?" IDYES startMenuEnable IDNO startMenuDisable

  startMenuApplySavedChoice:
  StrCmp $startMenuShortcutPreference "true" startMenuEnable startMenuDisable

  startMenuEnable:
  !insertmacro createStartMenuShortcut
  StrCpy $startMenuShortcutPreference "true"
  Return

  startMenuDisable:
  !insertmacro removeStartMenuShortcut
  StrCpy $startMenuShortcutPreference "false"
  Return
FunctionEnd

Function configureDesktopShortcut
  IfSilent desktopApplySavedChoice 0

  StrCmp $desktopShortcutPreference "false" 0 desktopPromptYesDefault
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Create a Desktop shortcut for Puschelz Client?" IDYES desktopEnable IDNO desktopDisable

  desktopPromptYesDefault:
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Create a Desktop shortcut for Puschelz Client?" IDYES desktopEnable IDNO desktopDisable

  desktopApplySavedChoice:
  StrCmp $desktopShortcutPreference "true" desktopEnable desktopDisable

  desktopEnable:
  !insertmacro createDesktopShortcut
  StrCpy $desktopShortcutPreference "true"
  Return

  desktopDisable:
  !insertmacro removeDesktopShortcut
  StrCpy $desktopShortcutPreference "false"
  Return
FunctionEnd

!macro customInit
  ReadRegStr $startMenuShortcutPreference SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" StartMenuShortcutPreference
  ${if} $startMenuShortcutPreference == ""
    ${if} ${FileExists} "$SMPROGRAMS\\Puschelz Client\\Puschelz Client.lnk"
      StrCpy $startMenuShortcutPreference "true"
    ${elseif} ${isUpdated}
      StrCpy $startMenuShortcutPreference "false"
    ${else}
      StrCpy $startMenuShortcutPreference "true"
    ${endif}
  ${endif}

  ReadRegStr $desktopShortcutPreference SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcutPreference
  ${if} $desktopShortcutPreference == ""
    ${if} ${FileExists} "$DESKTOP\\Puschelz Client.lnk"
      StrCpy $desktopShortcutPreference "true"
    ${elseif} ${isUpdated}
      StrCpy $desktopShortcutPreference "false"
    ${else}
      StrCpy $desktopShortcutPreference "true"
    ${endif}
  ${endif}
!macroend

!macro customInstall
  Call configureStartMenuShortcut
  Call configureDesktopShortcut
  !insertmacro persistShortcutPreferences
!macroend
!endif

!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    !insertmacro removeDesktopShortcut
    !insertmacro removeStartMenuShortcut
  ${endif}
!macroend
