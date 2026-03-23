# Archives — Ressources du jeu 3026

Ce dossier contient les fichiers fournis par **MMA Covéa Le Mans** (organisateur du sujet) ainsi que les backups récupérés à la fin de la compétition.

## Contenu

| Fichier | Description |
|---|---|
| `sujet.pdf` | Le guide du jeu 3026 — règles, objectifs, concepts (îles, ressources, marketplace, broker AMQP) |
| `oas.yml` | La spécification OpenAPI (Swagger) de l'API du jeu — tous les endpoints, paramètres et réponses |
| `3026_backend_save.7z` | Backup du code source du backend du jeu (fourni par MMA après la compétition) |
| `backup_3026_20260323_1047` | Dump de la base de données du jeu au 23/03/2026 à 10h47 |

## Le sujet en bref

**3026** — En l'an 3026, la Terre s'est fragmentée en milliers d'îles après la frappe d'un astéroïde. Chaque équipe pilote une civilisation insulaire : explorer la carte, découvrir des îles, collecter des ressources (Boisium, Feronium, Charbonium, Or), commercer via une marketplace, et améliorer son bateau.

## L'API du jeu (`oas.yml`)

L'API REST du jeu était hébergée sur `http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443`. Principaux endpoints :

| Catégorie | Endpoints |
|---|---|
| **Inscription** | `POST /signupcodes`, `POST /players/register` |
| **Joueur** | `GET /players/details`, `GET /resources` |
| **Bateau** | `POST /ship/build`, `POST /ship/move`, `GET /ship/next-level`, `PUT /ship/upgrade` |
| **Entrepôt** | `GET /storage/next-level`, `PUT /storage/upgrade` |
| **Marketplace** | `GET/POST/PATCH/DELETE /marketplace/offers`, `POST /marketplace/purchases` |
| **Taxes** | `GET /taxes`, `PUT /taxes/:id` |
| **Vols** | `GET /thefts`, `POST /thefts/player` |

Authentification via le header `codinggame-id` contenant un token JWT.
