#!/bin/sh
SESSION=${SESSION:-unknown}
WIDTH=${WIDTH:-80}
HOST=${HOST:-$(hostname -s)}

if [ "$WIDTH" -lt 80 ]; then
  printf "%s" "$SESSION"
else
  printf "%s: %s" "$HOST" "$SESSION"
fi

