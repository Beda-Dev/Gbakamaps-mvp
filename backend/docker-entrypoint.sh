#!/bin/sh
# =============================================================================
# Démarre en root (nécessaire pour chown), corrige la propriété du volume
# /app/uploads si besoin, puis abandonne les privilèges vers l'utilisateur
# `node` avant de lancer le vrai process — jamais le serveur Node lui-même
# ne tourne en root.
#
# Pourquoi cet entrypoint existe : passer directement `USER node` dans le
# Dockerfile (sans cet entrypoint) casse l'upload de photos pour tout
# déploiement EXISTANT dont le volume `backend_uploads` a déjà été créé du
# temps où le conteneur tournait en root — vérifié réellement le
# 2026-09-09 en reconstruisant l'image contre le volume de dev existant :
# EACCES immédiat sur le premier upload. `chown` étant idempotent (sans
# effet si déjà correct), ce script ne coûte rien sur un volume déjà bon.
# =============================================================================
set -e

chown -R node:node /app/uploads

exec su-exec node "$@"
