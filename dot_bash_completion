_go() 
{
    local cmd=$1 cur=${COMP_WORDS[COMP_CWORD]} prev=${COMP_WORDS[COMP_CWORD-1]}
    [[ ${COMP_LINE:COMP_POINT-1:1} = " " ]] && cur=""
    local IFS=$' \t\n' words
    local hcmd=$( echo ${COMP_LINE% *} | sed -En 's/ +-.*$//; s/^'"$cmd"' (help)?/'"$cmd"' help /; p' );
    local hcmd2=$( echo ${COMP_LINE% *} | sed -En 's/^'"$cmd"' tool -n /'"$cmd"' tool /; s/ -.*$//; s/$/ --help/; p' );
    local sed_cmd='sed -En '\''/^((The )?[Cc]ommands are:|Registered analyzers:)$/{ n; :X n; s/^[[:blank:]]*([^[:blank:]]+).*/\1/p; tX }'\'
    local sed_opt
    read -rd '' sed_opt <<\@
    sed -En -e '1bZ' -e 's/^[[:blank:]]+(-[[:alnum:]_-]+).*/\1/; TX; p; b' \
        -e ':X /^The -/!b; :Y s/ flag/&/; tZ; N; bY' \
        -e ':Z s/(.*)([^[:alnum:]]-[[:alnum:]_-]+)(.*)/\2\n\1/; /-[[:alnum:]_-]+\n$/{ s/[^[:alnum:]\n_-]//g; p; b}; tZ'
@
    if [[ $cur == -* ]]; then
        if [[ ${COMP_WORDS[1]} == tool && $COMP_CWORD -ge 3 ]]; then
            hcmd2=${hcmd2%% tool vet*}$' tool vet help'
            words=$( eval "$hcmd2 |& $sed_opt" )
            [[ "${hcmd2%% cgo*} cgo" == "$cmd tool cgo" ]] && { words=${words/--/}
                words=${words/-fgo-pkgpath/} words=${words/-fgo-prefix/} ;}
        else
            words=$( eval "$hcmd |& $sed_opt" )
            case ${COMP_WORDS[1]} in
                clean | get | install | list | run | test | vet)
                words=$words$'\n'$( eval "$cmd help build |& $sed_opt" ) ;;
            esac
        fi
    else
        if (( COMP_CWORD == 1 )); then
            words=$( eval "$cmd help |& $sed_cmd" )$' help'
        else
            if [[ ${COMP_WORDS[1]} == tool ]]; then
                if [[ $COMP_CWORD -eq 2 || ($COMP_CWORD -eq 3 && $prev == "-n") ]]; then
                    words=$( $cmd tool )
                else
                    hcmd2=${hcmd2%% tool vet*}$' tool vet help'
                    words=$( eval "$hcmd2 |& $sed_cmd" )
                fi
            else
                words=$( eval "$hcmd |& $sed_cmd" )
            fi
        fi
    fi
    COMPREPLY=( $(compgen -W "$words" -- "$cur") )
}

complete -o default -o bashdefault -F _go go


