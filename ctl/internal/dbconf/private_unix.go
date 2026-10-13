//go:build !windows

package dbconf

import "os"

// createPrivate cria o arquivo novo (falha se já existir) com permissão 0600.
func createPrivate(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	// a umask só tira bits; o Chmod garante 0600 qualquer que seja ela
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return f, nil
}
