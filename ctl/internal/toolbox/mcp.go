package toolbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const protocolVersion = "2025-06-18"

var errToolError = errors.New("db_connection_status voltou com isError")

// probe: GET / tem de dar 200 (em até livenessTimeout) e db_connection_status tem de voltar sem
// isError (até o prazo de ctx).
func probe(ctx context.Context, c *http.Client, base string) error {
	lctx, lcancel := context.WithTimeout(ctx, livenessTimeout)
	defer lcancel()
	req, err := http.NewRequestWithContext(lctx, http.MethodGet, base+"/", nil)
	if err != nil {
		return err
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET / respondeu %d", resp.StatusCode)
	}
	sid, _, err := rpc(ctx, c, base+"/mcp", "", 1, "initialize", map[string]any{
		"protocolVersion": protocolVersion, "capabilities": map[string]any{},
		"clientInfo": map[string]any{"name": "cd2-ctl", "version": "1"},
	})
	if err != nil {
		return err
	}
	_, res, err := rpc(ctx, c, base+"/mcp", sid, 2, "tools/call", map[string]any{"name": "db_connection_status", "arguments": map[string]any{}})
	if err != nil {
		return err
	}
	var out struct {
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		return err
	}
	if out.IsError {
		return errToolError
	}
	return nil
}

// rpc faz uma chamada JSON-RPC no MCP (Streamable HTTP; resposta em JSON ou SSE). Devolve o
// Mcp-Session-Id (se o servidor mandar) e o result.
func rpc(ctx context.Context, c *http.Client, url, sid string, id int, method string, params any) (string, json.RawMessage, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		return "", nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if method != "initialize" {
		req.Header.Set("MCP-Protocol-Version", protocolVersion)
	}
	if sid != "" {
		req.Header.Set("Mcp-Session-Id", sid)
	}
	resp, err := c.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("%s respondeu HTTP %d", method, resp.StatusCode)
	}
	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		data = sseData(data)
	}
	var msg struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return "", nil, fmt.Errorf("%s: resposta inválida", method)
	}
	if msg.Error != nil {
		return "", nil, fmt.Errorf("%s: %s", method, msg.Error.Message)
	}
	if sid == "" {
		sid = resp.Header.Get("Mcp-Session-Id")
	}
	return sid, msg.Result, nil
}

// sseData junta as linhas data: do primeiro evento.
func sseData(b []byte) []byte {
	var out []string
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "data:") {
			out = append(out, strings.TrimSpace(line[5:]))
		} else if line == "" && len(out) > 0 {
			break
		}
	}
	return []byte(strings.Join(out, "\n"))
}
