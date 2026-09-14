> ## Environnement de travail — mis à jour le 2026-09-13
>
> **Ce projet ne vit plus dans Google Drive.** Repères actuels :
>
> | | |
> |---|---|
> | Code | `~/dev/<projet>` sur le Mac · `~/code/<projet>` sur le devbox et omarchy |
> | Origine git | Forgejo `http://192.168.1.76:3000/anthony/<dépôt>` — joignable de partout via Tailscale |
> | Secrets | coffre chiffré SOPS + age (`~/infra-secrets`), jamais dans le dépôt |
> | Rituel | `dev -p` en arrivant · `dev --sync` en partant |
>
> Tout chemin `~/Library/CloudStorage/GoogleDrive-…/08-Dev-Projets-Serveurs/X` cité plus bas
> est **obsolète** — le lire comme `~/dev/X`.
>
> ```bash
> env-restore <projet>             # afficher un .env du coffre (rien sur disque)
> env-restore <projet> --ecrire    # le poser en 600
> sops exec-env ~/infra-secrets/env/<x>.enc 'commande'
> ```
>
> Ne jamais recopier une valeur de secret dans une réponse, un log ou un fichier suivi par git.

# WA-Business-Selfhosted

| | |
|---|---|
| Dépôt | `http://192.168.1.76:3000/anthony/WA-Business-Selfhosted` |
| Pile détectée | Node |
| Commits | 44 |

## Notes

_Ce fichier a été créé automatiquement le 2026-09-13 lors de la sortie de Google Drive._
_À compléter avec ce qu'un agent doit savoir : conventions, pièges, commandes de build._
