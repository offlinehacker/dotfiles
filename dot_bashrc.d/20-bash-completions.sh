# System bash completions fallback
# This file loads last to provide system completions if Homebrew completions aren't available

if ! shopt -oq posix; then
  # Only load system bash completion if not already loaded by Homebrew or other tools
  if [[ -z "${BASH_COMPLETION_VERSINFO:-}" ]]; then
    # Try to load system bash completion as fallback
    if [[ -f `locate_xdg_data_dirs_file "bash-completion"`/bash_completion ]]; then
      . `locate_xdg_data_dirs_file "bash-completion"`/bash_completion
    elif [ -f /etc/bash_completion ]; then
      . /etc/bash_completion
    elif [ -f /usr/share/bash-completion/bash_completion ]; then
      . /usr/share/bash-completion/bash_completion
    fi
  fi
fi