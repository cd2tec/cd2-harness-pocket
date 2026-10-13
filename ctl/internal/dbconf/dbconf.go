// Package dbconf guarda a conexão com o banco do cd2-ctl: o tipo Config, o arquivo db.env
// (mesmo formato da v0.5.0, gravado antes pelo core/db-env.sh) e a validação dos campos da tela.
package dbconf

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"
)

// Config é uma conexão completa. Port fica como texto, igual ao db.env.
type Config struct {
	Engine   string
	Host     string
	Port     string
	Name     string
	User     string
	Password string
	Schema   string
}

// envKeys na ordem em que a v0.5.0 grava o db.env (db_env_write).
var envKeys = []string{
	"CD2_DB_ENGINE", "CD2_DB_HOST", "CD2_DB_PORT", "CD2_DB_NAME",
	"CD2_DB_USER", "CD2_DB_PASSWORD", "CD2_DB_SCHEMA",
}

func (c Config) values() []string {
	return []string{c.Engine, c.Host, c.Port, c.Name, c.User, c.Password, c.Schema}
}

func (c *Config) set(key, v string) {
	switch key {
	case "CD2_DB_ENGINE":
		c.Engine = v
	case "CD2_DB_HOST":
		c.Host = v
	case "CD2_DB_PORT":
		c.Port = v
	case "CD2_DB_NAME":
		c.Name = v
	case "CD2_DB_USER":
		c.User = v
	case "CD2_DB_PASSWORD":
		c.Password = v
	case "CD2_DB_SCHEMA":
		c.Schema = v
	}
}

// Env devolve as sete variáveis CHAVE=valor, sem aspas, para o ambiente do toolbox.
func (c Config) Env() []string {
	vals := c.values()
	out := make([]string, len(envKeys))
	for i, k := range envKeys {
		out[i] = k + "=" + vals[i]
	}
	return out
}

// quote põe o valor entre aspas simples, com ' escrito como '\” (o sh lê de volta igual).
func quote(v string) string { return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'" }

// Format devolve o conteúdo do db.env: sete linhas CD2_DB_<CAMPO>='<valor>'.
func Format(c Config) []byte {
	var b bytes.Buffer
	vals := c.values()
	for i, k := range envKeys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(quote(vals[i]))
		b.WriteByte('\n')
	}
	return b.Bytes()
}

// unquote lê um valor do jeito do sh: trechos '...' literais, \x vira x, o resto como está.
func unquote(v string) (string, error) {
	var b strings.Builder
	for i := 0; i < len(v); {
		switch {
		case v[i] == '\'':
			j := strings.IndexByte(v[i+1:], '\'')
			if j < 0 {
				return "", errors.New("aspas sem fechar")
			}
			b.WriteString(v[i+1 : i+1+j])
			i += j + 2
		case v[i] == '\\' && i+1 < len(v):
			b.WriteByte(v[i+1])
			i += 2
		default:
			b.WriteByte(v[i])
			i++
		}
	}
	return b.String(), nil
}

// Parse lê um db.env. Aceita linhas em branco, comentários (#), CRLF, valores sem aspas e
// ignora chaves desconhecidas. Sem CD2_DB_ENGINE é erro.
func Parse(r io.Reader) (Config, error) {
	known := map[string]bool{}
	for _, k := range envKeys {
		known[k] = true
	}
	var c Config
	sc := bufio.NewScanner(r)
	n := 0
	for sc.Scan() {
		n++
		line := strings.TrimRight(sc.Text(), "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok || !known[key] {
			continue
		}
		v, err := unquote(val)
		if err != nil {
			return Config{}, fmt.Errorf("db.env linha %d: %v", n, err)
		}
		c.set(key, v)
	}
	if err := sc.Err(); err != nil {
		return Config{}, err
	}
	if c.Engine == "" {
		return Config{}, errors.New("db.env sem CD2_DB_ENGINE")
	}
	return c, nil
}

// Load lê o db.env do caminho. Arquivo ausente: errors.Is(err, fs.ErrNotExist).
func Load(path string) (Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return Config{}, err
	}
	defer f.Close()
	return Parse(f)
}

// Save grava de forma atômica: temporário no mesmo diretório, criado já só do dono
// (createPrivate), depois rename por cima do db.env.
func Save(path string, c Config) error {
	tmp := fmt.Sprintf("%s.%d.tmp", path, time.Now().UnixNano())
	f, err := createPrivate(tmp)
	if err != nil {
		return err
	}
	_, werr := f.Write(Format(c))
	if werr == nil {
		werr = f.Sync()
	}
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		_ = os.Remove(tmp)
		return werr
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// Remove apaga o db.env. Arquivo ausente não é erro.
func Remove(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
