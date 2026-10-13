package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/control"
	"github.com/cd2tec/cd2-harness-pocket/ctl/internal/dbconf"
)

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type fakeBackend struct {
	applied  []dbconf.Input
	applyErr error
	cleared  int
}

func (f *fakeBackend) Status() control.Status { return control.Status{Estado: control.SemBanco} }

func (f *fakeBackend) Apply(in dbconf.Input) (control.Status, error) {
	f.applied = append(f.applied, in)
	if f.applyErr != nil {
		return control.Status{}, f.applyErr
	}
	return control.Status{Estado: control.Rodando, Motor: in.Motor}, nil
}

func (f *fakeBackend) Clear() control.Status {
	f.cleared++
	return control.Status{Estado: control.SemBanco}
}

func newH() (http.Handler, *fakeBackend) {
	b := &fakeBackend{}
	return Handler(Options{Key: key, HarnessPort: 8080, CtlPort: 10080}, b), b
}

// do monta um pedido válido (Host, Origin, chave e Content-Type certos); mod estraga o que o teste quer.
func do(h http.Handler, method, path, body string, mod func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:10080"+path, strings.NewReader(body))
	r.Host = "127.0.0.1:10080"
	r.Header.Set("Origin", "http://127.0.0.1:8080")
	r.Header.Set("Authorization", "Bearer "+key)
	if method == http.MethodPost {
		r.Header.Set("Content-Type", "application/json")
	}
	if mod != nil {
		mod(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func erro(w *httptest.ResponseRecorder) string {
	var m map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return m["erro"]
}

const okBody = `{"motor":"postgres","host":"h","porta":5432,"base":"d","usuario":"u","senha":"s"}`

func TestStatusComChave(t *testing.T) {
	h, _ := newH()
	w := do(h, "GET", "/status", "", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"estado":"sem_banco"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:8080" || w.Header().Get("Vary") != "Origin" {
		t.Errorf("CORS: %v", w.Header())
	}
}

func TestGetSemOriginPassaParaCurl(t *testing.T) {
	h, _ := newH()
	w := do(h, "GET", "/status", "", func(r *http.Request) { r.Header.Del("Origin") })
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("%d %v", w.Code, w.Header())
	}
}

func TestChaveAusenteOuErrada(t *testing.T) {
	h, _ := newH()
	for _, auth := range []string{"", "Bearer " + strings.Repeat("0", 64), "bearer " + key, key, "Bearer " + key + "0"} {
		w := do(h, "GET", "/status", "", func(r *http.Request) { r.Header.Set("Authorization", auth) })
		if w.Code != 401 || erro(w) != "chave da sessão ausente ou errada" {
			t.Errorf("auth %q: %d %s", auth, w.Code, w.Body)
		}
		if w.Header().Get("Access-Control-Allow-Origin") == "" {
			t.Errorf("auth %q: 401 sem CORS (o front não leria o erro)", auth)
		}
	}
}

func TestOriginErrada(t *testing.T) {
	h, b := newH()
	for _, o := range []string{"http://evil.example", "http://127.0.0.1:8081", "null", "https://127.0.0.1:8080"} {
		w := do(h, "POST", "/config", okBody, func(r *http.Request) { r.Header.Set("Origin", o) })
		if w.Code != 403 {
			t.Errorf("origin %q: %d", o, w.Code)
		}
	}
	if len(b.applied) != 0 {
		t.Error("backend chamado com origem errada")
	}
}

func TestOriginAusenteEmPostEDelete(t *testing.T) {
	h, b := newH()
	noOrigin := func(r *http.Request) { r.Header.Del("Origin") }
	if w := do(h, "POST", "/config", okBody, noOrigin); w.Code != 403 || erro(w) != "origem ausente" {
		t.Errorf("POST: %d %s", w.Code, w.Body)
	}
	if w := do(h, "DELETE", "/config", "", noOrigin); w.Code != 403 {
		t.Errorf("DELETE: %d", w.Code)
	}
	if len(b.applied) != 0 || b.cleared != 0 {
		t.Error("backend chamado sem Origin")
	}
}

func TestOriginLocalhost(t *testing.T) {
	h, _ := newH()
	w := do(h, "GET", "/status", "", func(r *http.Request) { r.Header.Set("Origin", "http://localhost:8080") })
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8080" {
		t.Errorf("%d %v", w.Code, w.Header())
	}
}

func TestHost(t *testing.T) {
	h, _ := newH()
	for host, want := range map[string]int{"evil.example:10080": 403, "127.0.0.1:8080": 403, "127.0.0.1": 403, "localhost:10080": 200} {
		w := do(h, "GET", "/status", "", func(r *http.Request) { r.Host = host })
		if w.Code != want {
			t.Errorf("host %q: %d, quero %d", host, w.Code, want)
		}
	}
}

func TestContentType(t *testing.T) {
	h, _ := newH()
	for ct, want := range map[string]int{"text/plain": 415, "": 415, "application/x-www-form-urlencoded": 415, "application/json; charset=utf-8": 200} {
		w := do(h, "POST", "/config", okBody, func(r *http.Request) { r.Header.Set("Content-Type", ct) })
		if w.Code != want {
			t.Errorf("Content-Type %q: %d, quero %d", ct, w.Code, want)
		}
	}
}

func TestCorpoAcimaDe8KB(t *testing.T) {
	h, b := newH()
	w := do(h, "POST", "/config", `{"senha":"`+strings.Repeat("x", MaxBody)+`"}`, nil)
	if w.Code != 413 || erro(w) != "corpo: acima de 8 KB" {
		t.Errorf("%d %s", w.Code, w.Body)
	}
	if len(b.applied) != 0 {
		t.Error("backend chamado com corpo grande")
	}
}

func TestJSONInvalido(t *testing.T) {
	h, _ := newH()
	for _, body := range []string{"{", `{"x":1}`, `[]`} {
		w := do(h, "POST", "/config", body, nil)
		if w.Code != 400 || erro(w) != "corpo: JSON inválido" {
			t.Errorf("%q: %d %s", body, w.Code, w.Body)
		}
	}
}

func TestCampoInvalido(t *testing.T) {
	h, b := newH()
	b.applyErr = &dbconf.FieldError{Field: "host", Reason: "obrigatório"}
	w := do(h, "POST", "/config", okBody, nil)
	if w.Code != 400 || erro(w) != "host: obrigatório" {
		t.Errorf("%d %s", w.Code, w.Body)
	}
}

func TestPostEDelete(t *testing.T) {
	h, b := newH()
	w := do(h, "POST", "/config", okBody, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"estado":"rodando"`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if len(b.applied) != 1 || b.applied[0].Motor != "postgres" || b.applied[0].Senha == nil || *b.applied[0].Senha != "s" {
		t.Errorf("Apply recebeu %+v", b.applied)
	}
	if w := do(h, "DELETE", "/config", "", nil); w.Code != 200 || b.cleared != 1 {
		t.Errorf("DELETE: %d", w.Code)
	}
}

func TestPreflight(t *testing.T) {
	h, _ := newH()
	w := do(h, "OPTIONS", "/config", "", func(r *http.Request) {
		r.Header.Del("Authorization")
		r.Header.Set("Access-Control-Request-Method", "POST")
	})
	if w.Code != 204 {
		t.Fatalf("%d", w.Code)
	}
	hd := w.Header()
	if hd.Get("Access-Control-Allow-Origin") != "http://127.0.0.1:8080" ||
		hd.Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" ||
		hd.Get("Access-Control-Allow-Methods") != "GET, POST, DELETE" {
		t.Errorf("headers %v", hd)
	}
	w = do(h, "OPTIONS", "/config", "", func(r *http.Request) { r.Header.Set("Origin", "http://evil.example") })
	if w.Code != 403 {
		t.Errorf("preflight de origem errada: %d", w.Code)
	}
}

func TestRotasEMetodos(t *testing.T) {
	h, _ := newH()
	if w := do(h, "GET", "/nada", "", nil); w.Code != 404 {
		t.Errorf("rota desconhecida: %d", w.Code)
	}
	if w := do(h, "PUT", "/config", okBody, nil); w.Code != 405 {
		t.Errorf("PUT /config: %d", w.Code)
	}
	if w := do(h, "POST", "/status", okBody, nil); w.Code != 405 {
		t.Errorf("POST /status: %d", w.Code)
	}
}

type closedBackend struct{ fakeBackend }

func (closedBackend) Apply(dbconf.Input) (control.Status, error) {
	return control.Status{Estado: control.SemBanco, Erro: control.MsgClosed}, nil
}
func (closedBackend) Clear() control.Status {
	return control.Status{Estado: control.SemBanco, Erro: control.MsgClosed}
}

func TestAposShutdown503(t *testing.T) {
	h := Handler(Options{Key: key, HarnessPort: 8080, CtlPort: 10080}, &closedBackend{})
	if w := do(h, "POST", "/config", okBody, nil); w.Code != 503 {
		t.Errorf("POST: %d", w.Code)
	}
	if w := do(h, "DELETE", "/config", "", nil); w.Code != 503 {
		t.Errorf("DELETE: %d", w.Code)
	}
}
