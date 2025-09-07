if [ -d /home/linuxbrew/.linuxbrew/bin ]; then
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi

if type brew >/dev/null 2>/dev/null; then
  HOMEBREW_PREFIX="$(brew --prefix)"
  
  # Force load Homebrew completions even if system completion already loaded
  if [[ -r "${HOMEBREW_PREFIX}/share/bash-completion/bash_completion" ]]; then
    # Source Homebrew's bash completion directly to override system completions
    . "${HOMEBREW_PREFIX}/share/bash-completion/bash_completion"
  fi
fi
