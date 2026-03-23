# Frontend 3D — KUZ 3026

Vue immersive du jeu 3026 en **Three.js**. Le joueur navigue en 3D sur un ocean anime, decouvre des iles generees proceduralement, et voit la faune (oiseaux, dauphins) reagir a sa position. Un menu Escape donne acces a toutes les fonctionnalites du jeu (ressources, marketplace, iles, vols, bot, broker).

## Stack technique

| Technologie | Role |
|---|---|
| **Vue.js 3** | Framework UI (Composition API, `<script setup>`) |
| **Three.js** | Moteur de rendu 3D (scene, camera, lumieres, eau, ciel) |
| **simplex-noise** | Bruit procedurale pour le terrain des iles |
| **Axios** | Client HTTP (API du jeu + notre backend) |
| **Vite** | Build tool + dev server (port 3002) |
| **Nginx** | Serveur de production (reverse proxy) |

## Structure du projet

```
frontend-3d/
├── Dockerfile              # Multi-stage : build Vite + serve Nginx
├── nginx.conf              # Proxy /api, /ws, /broker, /backend-api
├── vite.config.js          # Proxy dev (meme config que frontend 2D)
├── public/
│   └── models/             # Modeles 3D GLTF
│       ├── bird/           # Modele d'oiseau (anime)
│       ├── dolphin/        # Modele de dauphin (anime)
│       └── vogmerry/       # Modele du bateau
└── src/
    ├── main.js             # Point d'entree Vue
    ├── App.vue             # Composant racine : init Three.js + WebSocket + HUD
    ├── style.css           # Theme dark + styles HUD glassmorphism
    ├── three/              # Moteur 3D (pur Three.js, pas de Vue)
    │   ├── scene.js        # GameScene : rendu, camera, eau, ciel, boucle d'animation
    │   ├── boat.js         # Chargement du modele GLTF du bateau
    │   ├── islands.js      # IslandManager : detection de clusters + generation procedurale
    │   ├── birds.js        # BirdManager : vols d'oiseaux en orbite autour des iles
    │   ├── dolphins.js     # DolphinManager : dauphins qui sautent autour du bateau
    │   └── api.js          # Client HTTP + WebSocket
    └── components/         # UI overlay (par-dessus le canvas 3D)
        ├── ShipControls.vue  # Pad directionnel + barre d'energie + cooldown
        ├── Compass.vue       # Boussole SVG qui suit la camera
        ├── Minimap.vue       # Mini-carte 2D (canvas, 220x220px)
        └── EscapeMenu.vue    # Menu Escape : ressources, marketplace, iles, vols, bot, broker
```

## Comment ca marche

### Le moteur 3D (`src/three/`)

Le dossier `three/` contient tout le code Three.js, **sans dependance a Vue**. C'est du pur JavaScript qui manipule le DOM canvas. Vue ne fait que l'initialiser et lui passer les donnees.

#### La scene (`scene.js`)

`GameScene` est la classe principale. Elle cree :

- **Renderer** : WebGL avec antialiasing et tone mapping ACES Filmic
- **Camera** : perspective 55°, controlee par OrbitControls (drag + zoom)
- **Eau** : plan 2000×2000 avec le shader Water de Three.js (vagues animees)
- **Ciel** : shader Sky avec soleil configurable (turbidity, rayleigh)
- **Lumieres** : ambiante (bleu doux) + directionnelle (blanc chaud)
- **Managers** : IslandManager, BirdManager, DolphinManager

#### Le systeme de coordonnees

```
Grille du jeu (x, y) → Three.js (x * 10, hauteur, -y * 10)
```

L'axe Y du jeu est inverse en Z dans Three.js. `CELL_SIZE = 10` unites 3D par cellule.

#### L'interpolation du bateau

Le bateau ne se teleporte pas d'une cellule a l'autre — il glisse en douceur :

1. **Smoothstep** : ease-in/ease-out `t*t*(3-2*t)` sur la duree estimee entre updates
2. **Prediction de velocite** : au-dela de 50% du lerp, extrapole la position 30% en avance
3. **Correction residuelle** : lerp final par frame pour absorber les erreurs

Le bateau oscille aussi verticalement (bob: `sin(t*1.5)*0.3`), s'incline vers l'avant proportionnellement a sa vitesse (pitch), et peut faire un salto avec la touche `Y`.

### Les iles procedurales (`islands.js`)

Les iles ne sont pas des modeles 3D statiques — elles sont **generees a partir des cellules SAND** de la carte :

1. **Detection de clusters** : BFS sur les cellules SAND en 8 directions (meme algo qu'un flood fill)
2. **Classification** : TINY (≤2), SMALL (≤15), MEDIUM (<50), LARGE (≥50)
3. **Template** : chaque taille a un template pre-construit (terrain + arbres + buissons + rochers)
4. **Instanciation** : le template est clone, redimensionne, et positionne au centre du cluster

#### Le terrain

Le mesh de terrain est un `PlaneGeometry` deforme par vertex :
- Bruit simplex a 2 octaves pour la forme de la cote (irreguliere, pas un cercle parfait)
- Profil smoothstep pour la forme generale (haut au centre, bas sur les bords)
- Vertex colors : brun sous-marin → sable → herbe → vert fonce → gris roche
- Les triangles submerges sont supprimes du buffer d'index (optimisation)

#### Les palmiers

Tronc courbe via `CatmullRomCurve3` + `TubeGeometry`. 6 palmes en `ShapeGeometry` (silhouette de feuille) positionnees en eventail au sommet.

### La faune animee

#### Oiseaux (`birds.js`)

- Modele GLTF avec animations de vol (ailes qui battent)
- 3 oiseaux max par ile, en orbite circulaire
- Chaque oiseau a sa hauteur, sa vitesse d'orbite, et son amplitude de bob
- Bank (inclinaison) dans les virages

#### Dauphins (`dolphins.js`)

- 6 dauphins autour du bateau, dans un rayon de 200 unites
- Mouvement lineaire + sauts paraboliques periodiques
- Pendant le saut : arc `4*t*(1-t)*hauteur` + rotation pitch (nez en l'air puis plongee)
- Se teleportent quand trop loin du bateau (>350u) pour reapparaitre devant

### Les composants UI

Tous les composants sont positionnes en `position: fixed` **par-dessus** le canvas 3D.

| Composant | Position | Role |
|---|---|---|
| `ShipControls` | Haut droite | Pad directionnel 3×3 + energie + cooldown |
| `Compass` | Bas gauche | Boussole SVG qui suit la rotation camera |
| `Minimap` | Bas droite | Mini-carte 2D (canvas) rayon 40 cellules |
| `EscapeMenu` | Plein ecran | Menu avec 6 onglets (Escape pour toggle) |

### Le menu Escape (`EscapeMenu.vue`)

6 onglets accessibles via la touche `Escape` :

| Onglet | Contenu |
|---|---|
| Ressources | Or, BOISIUM/FERONIUM/CHARBONIUM, barres de stockage |
| Marketplace | Creer/acheter/supprimer des offres (temps reel via broker AMQP) |
| Iles | Ile de depart + liste des iles decouvertes avec etat |
| Vols | Lancer des vols de ressources + historique |
| Bot | Controle du bot Python (start/stop/pause) + logs live |
| Broker | Visualisation brute des evenements AMQP |

### Les connexions reseau

**Deux APIs :**
- `/api` → API du jeu (EC2:8443) : deplacement, joueur, marketplace, vols
- `/backend-api` → notre backend (port 3001) : cellules, iles, position, bot

**Deux WebSocket :**
- `/ws` → evenements de la carte (cellules, position, iles) — utilise dans `App.vue`
- `/broker` → evenements AMQP marketplace — utilise dans `EscapeMenu.vue`

**Polling :**
- Position du bateau : toutes les 5 secondes (`App.vue`)
- Energie du bateau : toutes les 5 secondes (`ShipControls.vue`)
- Status/logs du bot : toutes les 2 secondes (`EscapeMenu.vue`, quand le bot tourne)

### Mode dev (fallback)

Si le backend est injoignable au lancement, l'app bascule en **mode demo** : 3 iles fictives sont generees dans une grille 31×31, le bateau est place au centre, et la scene 3D reste pleinement interactive (navigation, zoom, faune).

## Variables d'environnement

| Variable | Default | Description |
|---|---|---|
| `VITE_BACKEND_URL` | `http://localhost:3001` | URL du backend Node.js |
| `VITE_GAME_ID` | `kuz-team` | Identifiant de la partie |

## Lancer en local

```bash
# Avec Docker Compose (recommande)
docker compose -f docker-compose.local.yml up frontend-3d backend mongodb

# Sans Docker (dev avec hot-reload)
cd frontend-3d
npm install
npm run dev   # http://localhost:3002
```
