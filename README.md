# trackchain

PWA statique pour **enchaîner deux traces** GPX, KML ou KMZ en une seule, avec jonction linéaire ou routée, puis enregistrer le résultat en GPX (et KML en option).

Aucun backend : HTML/CSS/JS, Leaflet et JSZip embarqués en local, déploiement sur GitHub Pages.

## Fonctionnalités

- **Entrée** : 1 à 5 fichiers `.gpx`, `.kml` ou `.kmz` (un fichier = une trace ; les segments multiples sont fusionnés dans l'ordre).
- **Fonds de carte** (Leaflet) : OSM, IGN Plan v2, IGN BD Ortho. Le dernier fond choisi est mémorisé.
- **Affichage** : une couleur par trace, flèches de direction, départ en vert, arrivée en rouge.
- **Inversion** du sens de chaque trace (bouton ⇄).
- **Enchaînement** de deux traces (« Première » puis « Suivante ») :
  - **Jonction linéaire** : segment droit entre l'arrivée de la première et le départ de la seconde ;
  - **Routage IGN** : itinéraire piéton calculé par la Géoplateforme (`data.geopf.fr/navigation/itineraire`), au choix OSRM, pgRouting ou Valhalla, plus court ou plus rapide.
- **Aperçu** de la jonction (pointillé orange) avant validation, avec retour possible en linéaire.
- **Altitudes** : interpolées linéairement (selon la distance) sur le segment routé, si les deux extrémités ont une altitude.
- **Horodatages** : supprimés à la lecture, absents des sorties.
- **Un enchaînement à la fois** : la trace obtenue remplace les deux traces d'origine dans la liste et peut être enchaînée à son tour. Un bouton annule le dernier enchaînement.
- **Repli** : si le routage IGN échoue (réseau, délai de 15 s, réponse inattendue), la jonction linéaire est utilisée et un message l'indique.

## Utilisation

1. **Ajouter** 1 à 5 fichiers.
2. Choisir la trace **Première** et la trace **Suivante** (inverser le sens si besoin avec ⇄).
3. Choisir **Jonction linéaire** ou **Routage IGN**, puis **Aperçu de la jonction**.
4. Si le résultat convient, **Valider l'enchaînement** (sinon, « Revenir en linéaire » ou changer les options).
5. Dans **Enregistrer**, choisir la trace, cocher GPX et/ou KML, puis **Enregistrer**.

Les fichiers sont nommés `chain_<nom de la trace>.gpx` / `.kml`.

## Sauvegarde dans `Downloads/chain/`

> ⚠ Le sous-dossier **`chain/`** doit être créé **une fois à la main** dans Téléchargements.

- **Chrome / Edge (File System Access API)** : au premier enregistrement, l'application demande de choisir le dossier `chain/`. Le navigateur refuse de sélectionner Téléchargements lui-même, mais accepte un sous-dossier, d'où la création manuelle. Le dossier est mémorisé (IndexedDB) ; une permission peut être redemandée aux sessions suivantes. Le bouton « Choisir le dossier… » permet d'en changer.
- **Autres navigateurs (Firefox, Safari/iOS)** : téléchargement classique dans Téléchargements ; déplacer ensuite le fichier dans `chain/` à la main.

## Déploiement sur GitHub Pages

1. Placer le contenu du dossier à la racine d'un dépôt (ou d'un sous-dossier publié).
2. Activer GitHub Pages sur la branche voulue.
3. Ouvrir l'URL publiée et installer la PWA depuis le navigateur.

Les chemins sont tous relatifs (`start_url` et `scope` valent `./`) : l'application fonctionne aussi bien à la racine qu'en sous-dossier.

## Service worker « brise-cache »

`sw.js` suit le motif habituel :

- version explicite : `CACHE_NAME = 'trackchain-cache-vN'` ;
- purge des anciens caches à l'activation ;
- activation immédiate (`skipWaiting` + `clients.claim`) ;
- fichiers de l'application (HTML, CSS, JS, manifest) en **network-first**, sans cache HTTP intermédiaire ;
- bibliothèques embarquées et icônes en **cache-first** ;
- requêtes d'autres origines (tuiles, API IGN) **non interceptées**, donc jamais mises en cache.

Quand une nouvelle version prend la main, un bandeau « Recharger » s'affiche.

### À chaque livraison

Incrémenter la version à **deux endroits** :

- `CACHE_NAME` dans `sw.js` ;
- `VERSION` dans `app.js` (affichée dans l'en-tête).

Si un fichier est ajouté à l'application, l'ajouter aussi à `APP` ou `VENDOR` dans `sw.js`.

## Structure

```
trackchain/
├── index.html
├── app.js
├── style.css
├── sw.js
├── manifest.json
├── icons/            icon-192.png, icon-512.png
└── vendor/
    ├── jszip.min.js          (JSZip 3.10.1)
    └── leaflet/              (Leaflet 1.9.4 : js, css, images)
```

## Services externes

| Usage | Service |
|---|---|
| Fond OSM | `tile.openstreetmap.org` |
| Fonds IGN | WMTS Géoplateforme (`data.geopf.fr/wmts`) : Plan v2 (`PM`), BD Ortho (`PM_0_19`) |
| Routage | API itinéraire Géoplateforme (`data.geopf.fr/navigation/itineraire`), ressources `bdtopo-osrm`, `bdtopo-pgr`, `bdtopo-valhalla`, profil `pedestrian` |

Aucune clé d'API n'est nécessaire. Le routage et les tuiles exigent une connexion ; le reste de l'application (lecture, inversion, jonction linéaire, export) fonctionne hors ligne une fois la PWA installée.

## Limites connues

- Le routage se fait de l'arrivée de la première trace au départ de la seconde ; le tracé routé part du réseau routier le plus proche, pas forcément des points exacts.
- Pas d'altitude sur la jonction si l'une des deux extrémités n'en a pas.
- Un fichier KML/GPX est converti en une seule trace : les segments multiples sont concaténés dans l'ordre du fichier.
- La sélection du dossier de sauvegarde n'existe pas sur Firefox ni Safari.
