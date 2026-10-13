package toolbox

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func exeName() string {
	if runtime.GOOS == "windows" {
		return "toolbox.exe"
	}
	return "toolbox"
}

// prepareBinary copia o toolbox do pen drive para o cache quando mudou (exFAT/FAT não guarda
// permissão de execução) e, no Mac, tira a quarentena. Confere uma vez por processo.
func (s *Supervisor) prepareBinary() (string, error) {
	dst := filepath.Join(s.opt.CacheDir, exeName())
	if s.copied {
		return dst, nil
	}
	if _, err := os.Stat(s.opt.Source); err != nil {
		return "", fmt.Errorf("binário não encontrado em %s", s.opt.Source)
	}
	same, err := sameContent(s.opt.Source, dst)
	if err != nil {
		return "", err
	}
	if !same {
		if err := copyFile(s.opt.Source, dst+".tmp"); err != nil {
			return "", err
		}
		if err := os.Rename(dst+".tmp", dst); err != nil {
			_ = os.Remove(dst + ".tmp")
			return "", err
		}
		if runtime.GOOS == "darwin" {
			_ = exec.Command("xattr", "-dr", "com.apple.quarantine", dst).Run()
		}
	}
	_ = os.Chmod(dst, 0o755)
	s.copied = true
	return dst, nil
}

func sameContent(a, b string) (bool, error) {
	sb, err := os.Stat(b)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	sa, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	if sa.Size() != sb.Size() {
		return false, nil
	}
	ha, err := fileHash(a)
	if err != nil {
		return false, err
	}
	hb, err := fileHash(b)
	if err != nil {
		return false, err
	}
	return bytes.Equal(ha, hb), nil
}

func fileHash(p string) ([]byte, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return nil, err
	}
	return h.Sum(nil), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(dst)
		return err
	}
	return out.Close()
}
