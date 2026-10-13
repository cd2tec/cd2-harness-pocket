//go:build windows

package main

import "syscall"

const (
	synchronize = 0x00100000 // SYNCHRONIZE
	waitTimeout = 0x00000102 // WAIT_TIMEOUT
)

// processAlive diz se o processo pid ainda existe. Abre com SYNCHRONIZE e espera 0 ms: WAIT_TIMEOUT
// = ainda rodando. Acesso negado = existe (de outro usuário); qualquer outro erro ao abrir
// (ERROR_INVALID_PARAMETER) = não existe mais.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := syscall.OpenProcess(synchronize, false, uint32(pid))
	if err != nil {
		return err == syscall.ERROR_ACCESS_DENIED
	}
	defer syscall.CloseHandle(h)
	ev, err := syscall.WaitForSingleObject(h, 0)
	if err != nil {
		return true // na dúvida, não derruba o banco
	}
	return ev == waitTimeout
}
