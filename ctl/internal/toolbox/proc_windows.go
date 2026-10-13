//go:build windows

package toolbox

import "os"

// terminate no Windows não tem TERM para processo sem console: encerra direto.
func terminate(p *os.Process) { _ = p.Kill() }
