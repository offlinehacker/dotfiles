if command -v kubectl &>/dev/null; then
  source <(kubectl completion bash)
fi

alias k=kubectl
complete -F __start_kubectl k
