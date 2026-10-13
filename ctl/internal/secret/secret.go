// Package secret protege a senha do banco: escape para o YAML do toolbox e filtro do log.
package secret

import (
	"bytes"
	"io"
	"net/url"
	"strings"
	"sync"
)

var dq = strings.NewReplacer(`\`, `\\`, `"`, `\"`)

// YamlDQ escapa o valor para um escalar YAML entre aspas duplas: \ vira \\ e " vira \".
// O toolbox troca ${CD2_DB_PASSWORD} pelo texto antes de ler o YAML, e as receitas usam
// password: "${CD2_DB_PASSWORD}".
func YamlDQ(s string) string { return dq.Replace(s) }

// maxLine é o maior pedaço sem quebra de linha que o filtro guarda. Acima disso, o pedaço
// inteiro é descartado até a próxima quebra: cortar no meio poderia partir a senha em dois.
const maxLine = 64 << 10

// Scrubber repassa a saida do toolbox para out linha a linha, descartando toda linha que
// contem a senha (crua, escapada para YAML ou escapada para URL, comparacao literal) ou a palavra password em
// qualquer caixa.
//
// Write e protegido por mutex, mas o buffer de linha e UM so: use um Scrubber por fluxo de
// bytes. Para um processo filho, passe o mesmo Scrubber em Stdout e Stderr (cmd.Stdout,
// cmd.Stderr = s, s), assim o os/exec usa um pipe unico com uma goroutine de copia e as
// linhas nao se misturam. Nunca alimente dois fluxos independentes no mesmo Scrubber: pedacos
// sem quebra de linha de um fluxo se juntariam aos do outro e a senha poderia vazar em
// fragmentos.
type Scrubber struct {
	mu      sync.Mutex
	out     io.Writer
	secrets []string
	buf     []byte
	big     bool
	dropped int
}

// NewScrubber cria o filtro. Senha vazia não vira segredo (senão toda linha casaria).
func NewScrubber(out io.Writer, password string) *Scrubber {
	s := &Scrubber{out: out}
	if password != "" {
		// crua, escapada para YAML e escapada para URL (DSN do tipo postgres://u:<senha>@h)
		for _, v := range []string{password, YamlDQ(password), url.QueryEscape(password), url.PathEscape(password)} {
			dup := false
			for _, have := range s.secrets {
				dup = dup || have == v
			}
			if !dup {
				s.secrets = append(s.secrets, v)
			}
		}
	}
	return s
}

func (s *Scrubber) keep(line string) bool {
	if strings.Contains(strings.ToLower(line), "password") {
		return false
	}
	for _, sec := range s.secrets {
		if strings.Contains(line, sec) {
			return false
		}
	}
	return true
}

func (s *Scrubber) emit(line []byte) error {
	line = bytes.TrimSuffix(line, []byte("\r"))
	if !s.keep(string(line)) {
		s.dropped++
		return nil
	}
	out := make([]byte, 0, len(line)+1)
	out = append(append(out, line...), '\n')
	_, err := s.out.Write(out)
	return err
}

// Write guarda o pedaço sem quebra e repassa cada linha completa que passa no filtro.
func (s *Scrubber) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rest := p
	for len(rest) > 0 {
		i := bytes.IndexByte(rest, '\n')
		if i < 0 {
			if !s.big {
				s.buf = append(s.buf, rest...)
				if len(s.buf) > maxLine {
					s.buf, s.big = s.buf[:0], true
					s.dropped++
				}
			}
			return len(p), nil
		}
		chunk := rest[:i]
		rest = rest[i+1:]
		if s.big {
			s.big = false
			continue
		}
		line := append(s.buf, chunk...)
		err := s.emit(line)
		s.buf = s.buf[:0]
		if err != nil {
			return len(p) - len(rest), err
		}
	}
	return len(p), nil
}

// Close repassa a última linha sem quebra, se houver. Depois dele, não chame Write.
func (s *Scrubber) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.big || len(s.buf) == 0 {
		s.buf, s.big = nil, false
		return nil
	}
	line := s.buf
	s.buf = nil
	return s.emit(line)
}

// Dropped conta as linhas descartadas.
func (s *Scrubber) Dropped() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dropped
}
