!include "LogicLib.nsh"

!macro customInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Create a Start Menu shortcut for Puschelz Client?" IDNO skipStartMenuShortcut
      CreateDirectory "$SMPROGRAMS\\Puschelz Client"
      CreateShortCut "$SMPROGRAMS\\Puschelz Client\\Puschelz Client.lnk" "$INSTDIR\\Puschelz Client.exe"
    skipStartMenuShortcut:

    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Create a Desktop shortcut for Puschelz Client?" IDNO skipDesktopShortcut
      CreateShortCut "$DESKTOP\\Puschelz Client.lnk" "$INSTDIR\\Puschelz Client.exe"
    skipDesktopShortcut:
  ${endif}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\\Puschelz Client.lnk"
  Delete "$SMPROGRAMS\\Puschelz Client\\Puschelz Client.lnk"
  RMDir "$SMPROGRAMS\\Puschelz Client"
!macroend
