//go:build !windows

package main

import (
	"errors"
	"syscall"
)

// processAlive diz se o processo pid ainda existe. Kill(pid, 0) não manda sinal nenhum: só
// confere. ESRCH = não existe mais; EPERM = existe, mas é de outro usuário (continua vivo).
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
