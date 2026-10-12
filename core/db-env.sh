#!/usr/bin/env sh
# CD2 Harness - conexao com o banco para o MCP Toolbox (funcoes POSIX; carregar com ". core/db-env.sh").
# O arquivo gerado fica no cache do computador, nunca no pen drive. Senha nunca e impressa.

# db_env_defaults ENGINE -> "porta schema_padrao" (schema vazio = decidido na gravacao)
db_env_defaults() {
  case "$1" in
    postgres)  echo "5432 public" ;;
    oracle)    echo "1521" ;;
    mariadb)   echo "3306" ;;
    sqlserver) echo "1433 dbo" ;;
    *) return 1 ;;
  esac
}

# _db_env_q VALOR -> valor entre aspas simples, seguro para o sh ler de volta
_db_env_q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# db_env_write ARQUIVO ENGINE HOST PORT NAME USER PASSWORD SCHEMA
db_env_write() {
  _f="$1"
  umask 077
  {
    printf 'CD2_DB_ENGINE=%s\n'   "$(_db_env_q "$2")"
    printf 'CD2_DB_HOST=%s\n'     "$(_db_env_q "$3")"
    printf 'CD2_DB_PORT=%s\n'     "$(_db_env_q "$4")"
    printf 'CD2_DB_NAME=%s\n'     "$(_db_env_q "$5")"
    printf 'CD2_DB_USER=%s\n'     "$(_db_env_q "$6")"
    printf 'CD2_DB_PASSWORD=%s\n' "$(_db_env_q "$7")"
    printf 'CD2_DB_SCHEMA=%s\n'   "$(_db_env_q "$8")"
  } > "$_f.tmp" && mv "$_f.tmp" "$_f" && chmod 600 "$_f"
}

# db_env_ask ARQUIVO -> pergunta tudo no terminal. Retorna 1 se a pessoa escolher 0 (nenhum banco).
db_env_ask() {
  _f="$1"
  printf '\nConectar a um banco de dados? (a IA vai explorar as tabelas em modo somente leitura)\n'
  printf '  1) PostgreSQL   2) Oracle   3) MariaDB / MySQL   4) SQL Server   0) nenhum, seguir em Demonstracao\n'
  printf 'Opcao [0]: '; read -r _op
  case "${_op:-0}" in
    1) _eng=postgres ;; 2) _eng=oracle ;; 3) _eng=mariadb ;; 4) _eng=sqlserver ;;
    *) return 1 ;;
  esac
  set -- $(db_env_defaults "$_eng"); _dport="$1"; _dschema="${2:-}"
  printf 'Host: '; read -r _host
  printf 'Porta [%s]: ' "$_dport"; read -r _port; _port="${_port:-$_dport}"
  if [ "$_eng" = oracle ]; then printf 'Service name: '; else printf 'Base de dados: '; fi; read -r _name
  printf 'Usuario (use uma conta somente leitura): '; read -r _user
  printf 'Senha (nao aparece ao digitar): '
  stty -echo 2>/dev/null; read -r _pw; stty echo 2>/dev/null; printf '\n'
  case "$_eng" in
    oracle)  _dschema="$(printf '%s' "$_user" | tr '[:lower:]' '[:upper:]')" ;;
    mariadb) _dschema="$_name" ;;
  esac
  printf 'Schema [%s]: ' "$_dschema"; read -r _schema; _schema="${_schema:-$_dschema}"
  db_env_write "$_f" "$_eng" "$_host" "$_port" "$_name" "$_user" "$_pw" "$_schema"
  printf 'Conexao guardada em %s (so neste computador).\n' "$_f"
}
