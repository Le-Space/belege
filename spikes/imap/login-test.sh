#!/usr/bin/env bash
# Try one IMAP login by hand, without the password ending up in shell history,
# the process list or on screen.
#
#   bash spikes/imap/login-test.sh
#
# "a1 OK" = login works, "a1 NO [AUTHENTICATIONFAILED]" = wrong user or password.
# Mailu rate-limits failed logins per user and IP: try one password at a time.

HOST=${IMAP_HOST:-mail.le-space.de}
PORT=${IMAP_PORT:-993}

read -r -p "User [nico@le-space.de]: " user
user=${user:-nico@le-space.de}
read -r -s -p "Password: " pw
echo
len=$(printf '%s' "$pw" | LC_ALL=C wc -c | tr -d ' ')
echo "Password length: $len bytes"
echo "--- server says:"

# The password goes as an IMAP literal ({n+}, the server offers LITERAL+), so quotes,
# backslashes or other special characters in it need no escaping.
# printf is a shell builtin: the password never appears in a process's arguments.
{
  sleep 1
  printf 'a1 LOGIN "%s" {%s+}\r\n%s\r\n' "$user" "$len" "$pw"
  sleep 2
  printf 'a2 LIST "" "*"\r\n'
  sleep 1
  printf 'a3 LOGOUT\r\n'
  sleep 1
} | openssl s_client -quiet -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null

unset pw
