//go:build windows

package dbconf

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

// advapi32 e kernel32 são KnownDLLs: o Windows carrega sempre a do System32.
var (
	advapi32          = syscall.NewLazyDLL("advapi32.dll")
	procConvertSDDLSD = advapi32.NewProc("ConvertStringSecurityDescriptorToSecurityDescriptorW")
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procLocalFree     = kernel32.NewProc("LocalFree")
)

// createPrivate cria o arquivo novo já com a ACL só do usuário atual: DACL protegida
// (sem herança) com acesso total para o SID dele e mais ninguém. A ACL vale antes de
// qualquer byte ser escrito.
func createPrivate(path string) (*os.File, error) {
	tok, err := syscall.OpenCurrentProcessToken()
	if err != nil {
		return nil, err
	}
	defer tok.Close()
	tu, err := tok.GetTokenUser()
	if err != nil {
		return nil, err
	}
	sid, err := tu.User.Sid.String()
	if err != nil {
		return nil, err
	}
	sddl, err := syscall.UTF16PtrFromString("D:P(A;;FA;;;" + sid + ")")
	if err != nil {
		return nil, err
	}
	var sd uintptr
	r, _, e := procConvertSDDLSD.Call(uintptr(unsafe.Pointer(sddl)), 1, uintptr(unsafe.Pointer(&sd)), 0)
	if r == 0 {
		return nil, fmt.Errorf("descritor de segurança: %v", e)
	}
	defer procLocalFree.Call(sd)
	sa := syscall.SecurityAttributes{Length: uint32(unsafe.Sizeof(syscall.SecurityAttributes{})), SecurityDescriptor: sd}
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_WRITE, 0, &sa, syscall.CREATE_NEW, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}
