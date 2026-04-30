#!/bin/bash
# Wrapper to push this repo bypassing global git URL rewrites
# The global config rewrites SSH URLs to HTTPS which breaks push
GIT_CONFIG_GLOBAL=/dev/null git push origin main "$@"
