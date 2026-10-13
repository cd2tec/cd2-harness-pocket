//go:build !windows

package toolbox

import (
	"os"
	"syscall"
)

// terminate pede para o toolbox sair (ele fecha as conexões com o banco).
func terminate(p *os.Process) { _ = p.Signal(syscall.SIGTERM) }
