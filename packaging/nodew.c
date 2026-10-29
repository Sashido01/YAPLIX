// Build from a Visual Studio Developer Command Prompt (no runtime download).
// A GUI subsystem shim preserves the bundled Node runtime and arguments.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
int WINAPI wWinMain(HINSTANCE h,HINSTANCE prev,PWSTR args,int show) {
 wchar_t path[32768],command[32768];
 DWORD n=GetModuleFileNameW(NULL,path,32768);if(!n||n>=32768)return 1;
 wchar_t *slash=wcsrchr(path,L'\\');if(!slash)return 1;wcscpy_s(slash+1,32768-(slash+1-path),L"node.exe");
 if(swprintf_s(command,32768,L"\"%s\" %s",path,args)<0)return 1;
 STARTUPINFOW si={sizeof(si)};PROCESS_INFORMATION pi;
 if(!CreateProcessW(path,command,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,NULL,&si,&pi))return 1;
 WaitForSingleObject(pi.hProcess,INFINITE);DWORD result;GetExitCodeProcess(pi.hProcess,&result);CloseHandle(pi.hThread);CloseHandle(pi.hProcess);return (int)result;
}
