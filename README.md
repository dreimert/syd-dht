# SYD : DHT (Distributed Hash Table)

TD de DHT du cours de systèmes distribués du département TC à l'INSA Lyon.

L'objectif de ce TD est de comprendre le fonctionnement d'une Distributed Hash Table (DHT) soit une table de hachage distribuée en français et de l'implémenter. Pour cela, nous allons partir d'un serveur de base de données minimaliste pour arriver à une base de données distribuée. Nous utiliserons le protocole Chord.

Chord est un protocole de DHT qui permet d'associer une clef à un nœud sur un réseau pair à pair sans leader et où tous les nœuds sont égaux. Il permet de retrouver une donnée en O(log(n)). Vous pouvez trouver le papier original ici : https://pdos.csail.mit.edu/papers/chord:sigcomm01/chord_sigcomm.pdf.

Je cite Wikipedia sur les avantages de Chord :

* Décentralisé : Chord est complètement décentralisé, tous les nœuds sont au même niveau. Ce qui le rend robuste et adapté aux applications P2P peu organisées.
* Passage à l'échelle : Le coût d'une recherche est fonction du logarithme du nombre de nœuds.
* Équilibrage de charge : Équilibrage de charge naturel, hérité de la Fonction de hachage (SHA-1).
* Disponibilité : On peut toujours trouver le nœud responsable d'une clef, même lorsque le système est instable.
* Aucune contrainte sur le nom des clefs.

Hum. Oups. Ça c'est le sujet que j'avais imaginé avant de me rendre compte que c'était trop compliqué pour un TD. On va implémenté une version un peu bancale d'une DHT mais dont l'objectif est de vous faire comprendre les grandes lignes. Pour simplifier, je vais rogner sur la propriété de passage à l'échelle. L'implémentation cible est une DHT qui permet de stocker des données sur un réseau pair à pair sans leader et où tous les nœuds sont égaux. Elle permet de retrouver une donnée en O(n) mais au prix d'un passage à l'échelle difficile et d'une très grande vulnérabilité aux attaques.

## Prérequis

Je pars du principe que vous savez coder en Javascript et utiliser git et github. Si ce n'est pas le cas, je vous invite pour le prochain TD à lire :

* Javascript :
  * https://eloquentjavascript.net/ (troisième édition en anglais)
  * https://fr.eloquentjavascript.net/ (première edition en français, anglais, allemand et polonais)
* Programmation évènementielle en Javascript:
  * https://eloquentjavascript.net/11_async.html (Chapitre 11 de Eloquent JavaScript troisième édition)
  * http://www.fil.univ-lille1.fr/~routier/enseignement/licence/tw1/spoc/chap10-evenements-partie1.html (Vidéo / cours de Jean-Christophe Routier)
* Git : http://rogerdudler.github.io/git-guide/index.fr.html

Il vous faut aussi Node.js (version 18 minimum) et un éditeur de texte. Je vous conseille [Visual Studio Code](https://code.visualstudio.com/).

## Installation de node

Pour installer, voir TD précédent : https://github.com/dreimert/syd-scraping.

## Bootstrap et vérification de l'installation

Cloner ce dépôt :

    git clone https://github.com/dreimert/syd-dht.git

Ce déplacer dans le dossier:

    cd syd-dht

Installation des dépendances :

    npm install

Lancer le code :

    node index.js

## Installation de PM2

PM2 est un gestionnaire de processus Node.js. Il permet de lancer des processus en arrière plan et de les gérer. Il permet aussi de les redémarrer automatiquement en cas de crash ou de modification dans le cas de développement.

Pour l'installer globalement (`-g`) et rendre la commande accessible partout :

    npm install -g pm2

Pour lancer un processus Node.js :

    pm2 start monFichier.js

Si vous ne souhaitez pas l'installer globalement, vous pouvez l'installer localement (sans le `-g`) et utiliser la commande `npx` pour l'exécuter : `npx pm2 start monFichier.js`.

En développement, vous allez préférez utiliser l'option `--watch` qui permet de redémarrer le processus à chaque modification du fichier :

    pm2 start monFichier.js --watch

Pour lister les processus actifs :

    pm2 list

Pour arrêter un processus :

    pm2 stop <idDuProcessus>

Pour supprimer un processus :

    pm2 delete <idDuProcessus>

Pour monitorer les processus :

    pm2 monit

Pour passer des paramètres lors du lancement avec pm2, il faut utiliser `--` pour séparer les paramètres de pm2 des paramètres de votre programme :

    pm2 start monFichier.js --watch -- --param1 valeur1 --param2 valeur2

Et pour lancer plusieurs fois le même fichier avec des paramètres différents, il faut le nommer différemment :

    pm2 start monFichier.js --name Instance1
    pm2 start monFichier.js --name Instance2

Pour afficher les logs :

    pm2 log

## Description technique

Une DHT est un réseau pair à pair qui permet d'associer une clef à un nœud. Pour cela, elle utilise une fonction de hachage qui permet de transformer une clef en une valeur numérique. Dans Chord, les nœuds sont disposés sur un **anneau** de taille 2<sup>m</sup>, `m` étant un paramètre du réseau. Ce `m` est fixe pour un réseau donné. **Un nœuds est responsable des clefs qui sont incluses entre lui et son prédécesseur sur l'anneau**. Cette valeur numérique est ensuite utilisée pour trouver le nœud qui est responsable de cette clef. Pour cela, chaque nœud connait ses voisins et le nœud responsable de la clef. Lorsqu'un nœud reçoit une requête pour une clef, il regarde si c'est lui qui est responsable de la clef. Si c'est le cas, il renvoie la valeur associée à la clef. Sinon, il renvoie la requête à son voisin le plus proche de la clef. Si aucun nœud n'est responsable de la clef, la requête est renvoyée au nœud qui a la clef la plus proche de la clef demandée. Si la requête fait le tour de l'anneau, la clef n'existe pas.

**Pour trouver le nœud responsable d'une clef, on utilise la fonction de hachage pour transformer la clef en valeur numérique**. La fonction de hachage garantie que les clefs sont réparties uniformément sur l'anneau. On va utiliser ici SHA. On va faire de même avec l'IP ou dans notre cas l'URL du nœud. Nous n'utilisons pas l'IP mais le port car nous sommes sur une machine locale et que nous voulons avoir plusieurs nœuds sur la même machine.

Dans la vrai vie, utiliser l'IP pour calculer la valeur sur l'anneau empêche un attaquant de choisir la valeur de son nœud pour être responsable d'un grand nombre de clefs sauf si l'attaquant contrôle un grand nombre d'IP.

## Protocole

Dans notre DHT, les nœuds doivent supporter les opérations HTTP suivantes :

* GET db \<key\>: Récupère la valeur associée à la clef *key*. Si le nœud n'est pas responsable de la clef, propage la demande au nœuds suivant et renvoie la réponse. Si la clef n'existe pas, renvoie une erreur 404.
* PUT db \<key\> \<value\> : Associe la valeur *value* à la clef *key*. Si le nœud n'est pas responsable de la clef, propage la demande au nœuds suivant et renvoie la réponse.
* GET keys : Récupère la liste des clefs du nœud.
* POST lookup \<key\> : Renvoie le nœud responsable de la clef *key*. Si le nœud est responsable de la clef, renvoie son url sinon propage la demande au nœuds suivant et renvoie la réponse.
* POST join \<url\> : Demande au nœud de rejoindre le réseau DHT du nœud cible de `url`.
* POST add \<url\> : Déclare la présence d'un nouveau nœud sur le réseau qui a pour URL `url`. Si la valeur du nœud sur l'anneau est plus proche que le successeur ou le prédécesseur, il va venir le remplacer mais ne propage pas l'information.
* GET config \<key\> : Permet de récupérer la valeur du paramètre `key` dans la configuration du nœuds. Par exemple pour récupérer le successeur du nœuds avec le port 4000, on fait un GET sur `http://localhost:4000/config/successor`.

## Code initial

Vous pouvez voir dans `index.js` qu'il y a déjà du code. Ce code est une base de donnée minimaliste et permet de lancer un serveur HTTP sur le port passé en paramètre. Pour lancer le code, il faut faire :

    node index.js --port 4000

Les fonctions de base de données sont déjà implémentées ainsi que celle de lecture de la configuration. Vous pouvez par exemple lancer le serveur et aller sur `http://localhost:4000/db/test` pour voir la valeur associée. Il y a quelques fonctions qui vous seront utiles pour la suite.

J'ai aussi codé un client qui permet d’interagir avec le serveur. Vous pouvez le lancer avec :

    node cli.js --port 4000 <commande>

Vous pouvez trouver la liste des commandes dans le fichier `cli.js` ou via `--help`. Par exemple, pour ajouter une valeur :

    node cli.js --port 4000 put test "Hello World"

Si vous allez sur `http://localhost:4000/db/test`, vous devriez voir la valeur `Hello World!`. Allez maintenant sur `http://localhost:4000/config/id` pour voir l'identifiant du nœud et où il se place sur l'anneau.

## Implémentation

**Durand ce TD, vous ne devez modifier que le fichier `index.js`**.

La première chose à faire est l'implémentation du calcul de l'identifiant du nœud. On veut deux propriétés principale pour cette fonction :

* Elle doit être déterministe. C'est à dire que pour une URL donnée, elle doit toujours renvoyer la même valeur.
* Elle doit être uniforme. C'est à dire que pour un ensemble d'URL, les valeurs doivent être réparties uniformément sur l'anneau.

Pour ce faire, on va utiliser une fonction de hachage et plus spécifiquement SHA.

### Prenons un peu de *hash*

Une fonction de hachage est une fonction qui prend en entrée un ensemble de données et retourne une empreinte, aussi appelée *hash*. L'empreinte respecte deux principes : Elle est unique pour un ensemble de données d'entrée, et une empreinte donnée ne permet pas de remonter à l'ensemble initial. On parle de non-collision et de non calculabilité de la pré-image. Cette empreinte est de taille fixe quelque-soit l'entrée. Une fonction couramment utilisée est SHA. Voici quelques exemples d'empreinte :

```Bash
> echo "Blockchain" | shasum
# efcf8baf5959ad1ebc7f4950425ef1c2eae9cbd9  -

> echo "Block" | shasum
# d1a6b1157e37bdaad78bec4c3240f0d6c576ad21  -

> echo "Vous commencez à voir le principe ?" | shasum
# 25abec7ced7642b886c1bffbc710cc3439f23ab7  -
```

Une propriété intéressante est qu'une petite modification dans l'entrée change totalement l'empreinte :

```Bash
> echo "Blockchain" | shasum
# efcf8baf5959ad1ebc7f4950425ef1c2eae9cbd9  -

> echo "blockchain" | shasum
# ea5f179324c233b002fa8ac4201fa216001515e5  -
```

Les fonctions de hachage sont couramment utilisées pour vérifier que des données n'ont pas été corrompues lors d'un téléchargement par exemple. Le code suivant permet de produire une empreinte en Javascript.

```Javascript
import crypto from 'crypto'

// Retourne l'empreinte de data.
const getHash = function getHash(data) {
  return crypto.createHash('sha1').update(data, 'utf8').digest('hex');
}
```

Mais ici, c'est un entier sur l'anneau que je veux. Il suffit de récupérer les `m` derniers bits de l’empreinte et de les convertir en un entier où `m` est l'exposant de la taille de l'anneau. Je vous ai mis la fonction `getIdFromString` dans le code du serveur qui fait exactement ça.

#### Mettez à jour le code du serveur pour que l'identifiant du nœud soit calculé à partir de l'URL et initialise correctement la configuration

Vous pouvez vérifier via `http://localhost:4000/config/id`. En cas de problème, `pm2 log` pour voir les logs ;).

### Briser la solitude

Pour le moment, notre nœud est tout seul sur l'anneau. Il faut donc qu'il rejoigne un autre nœud ou une DHT existante.

#### Commencez par lancer un deuxième nœud sur le port 4001

Pour vérifier qu'il fonctionne, regardez les logs du serveur et allez sur `http://localhost:4001/config/id`.

Les deux nœud doivent maintenant communiquer. Via le CLI, vous pouvez faire :

    node cli.js --port 4001 join http://localhost:4000

pour demander au nœud 4001 de rejoindre le réseau du nœud 4000. Malheureusement, la commande n'est pas implémentée au niveau du serveur. *Let's go !*

Pour le moment, on va se limiter à deux nœuds. Ce que doit faire la commande `join` dans ce cas :

- Appeler la commande `add` du nœud cible pour lui dire qu'il va rejoindre le réseau.
- Et déclarer le nœud cible comme successeur et prédécesseur.
- Copier les clefs dont le nœud est responsable (cf. protocole).

Et c'est tout ;)

Si je déroule l’exécution de la commande `join` : Le CLI contacte le nœud 4001 via la commande `join`.

- Le nœud 4001 contacte le nœud 4000 via la commande `add`.
    - Le nœud 4000 met à jour son successeur et son prédécesseur avec nœud 4001 dans la commande `add`.
- Le nœud 4001 met à jour son successeur et son prédécesseur avec le nœud 4000.
- Le nœud 4001 demande les clefs dont est responsable le nœud 4000 à l'aide de la commande `keys`.
- Il calcule l'identifiant des clefs et garde celle dont il est responsable (Cf. protocole).
- Pour chaque clef dont il est responsable, il demande la valeur à 4000 et l'ajoute dans sa BDD.

Commencez par implémenter la commande `add` qui doit :

Vérifier si le nœud qui veut rejoindre le réseau est plus proche que le successeur ou le prédécesseur. Si c'est le cas, il doit le remplacer. Mais vu qu'il n'y a pas de successeur ou de prédécesseur, il suffit de mettre le nœud qui veut rejoindre le réseau comme successeur et comme prédécesseur.

#### Implémentez la commande `add` à deux nœuds

Via le CLI, vous pouvez simuler l'appel à la commande `add`.

Vous pouvez vérifier via le CLI ou votre navigateur que le successeur et le prédécesseur du nœud 4000 sont bien le nœud 4001 et inversement.

#### Implémentez la commande `join` à deux nœuds

Vous pouvez vérifier via le CLI ou votre navigateur que le successeur et le prédécesseur du nœud 4001 sont bien le nœud 4000. Et via les logs que le nœud 4000 a bien reçu la commande `add` et s'est mis à jour.

On ignore les clefs dans la base de donnée pour le moment.

### Viewer

Pour vous simplifier la vie, vous pouvez lancer le viewer : `npm run viewer`.

### Trouver le ~~coupable~~ responsable

Vous avez deux nœuds sur l'anneau. Normalement, si vous avez utilisé les port 4000 et 4001 et que vous hachez l'url, ils ont respectivement les ids 47 et 17. Le nœud 4000 a pour id 47 et est responsable des clefs entre son prédécesseur et lui soit des clefs entre 18 et 47 et le nœud 4001 est responsable des clefs entre 48 et 17. Pour le moment, les nœuds ne savent pas qui est responsable de quelle clef. Il faut donc implémenter la commande `lookup` qui permet de trouver le nœud responsable d'une clef.

Pour vous aider :

- POST lookup \<key\> : Renvoie le nœud responsable de la clef key. Si le nœud est responsable de la clef, renvoie son url sinon propage la demande au nœuds suivant et renvoie la réponse.
- Vous pouvez observer le code du CLI pour voir il fait des requêtes HTTP.

#### Implémentez la commande lookup

Pour tester :

    node cli.js lookup Bob # => 4000
    node cli.js lookup Alice # => 4001

### Stocker des données au bon endroit

Maintenant que vous savez qui est responsable de quelle clef, il faut stocker les données au bon endroit. Pour cela, il faut modifier les implémentations des commandes `get` et `put`.

#### Implémentez les commandes get et put

Pour tester :

    node cli.js put Bob Bob # => Doit enregistrer sur 4000
    node cli.js put Alice Alice # => Doit enregistrer sur 4001

    node cli.js get Alice

Utilisez les logs pour savoir où passe les requêtes et sur quelles machines sont stocker les données.

### Plus on est de fous, plus on rit

Vous avez maintenant un réseau de deux nœuds. Il faut maintenant que vous puissiez ajouter plus de nœuds au réseau. Pour cela, il faut modifier la commande `join` pour qu'elle puisse ajouter un nœud au réseau quelque soit sa taille. Ce que doit faire la commande dans ce cas :

- Appeler la commande `lookup` du nœud cible pour récupérer le nœud responsable de la valeur du nœud appelant sur l'anneau.
- Appeler la commande `add` du nœud responsable.
- Récupérer le prédécesseur du nœud responsable.
- Appeler la commande `add` du prédécesseur.
- Mettez à jour le successeur et le prédécesseur du nœud appelant.
- Copier les clefs dont le nœud est responsable.

#### Implémentez la commande join à plusieurs nœuds
#### Mettez à jour la commande add si besoin

## Évaluation

L'évaluation peut inclure le contenu de ce TD. Je ne demande pas de code mais je me réserve la possibilité de demander du pseudo code ou des APIs, une compréhension global du fonctionnement. Je peux aussi demander une question maximum sur l'article original de Chord pour vous motiver à y jeter un œil.

## Pour aller plus loin

Vous pouvez trouver le papier original de Chord ici : https://pdos.csail.mit.edu/papers/chord:sigcomm01/chord_sigcomm.pdf.

Quelques articles plus vulgarisés sur Chord :

* https://jenkov.com/tutorials/p2p/chord.html
* https://medium.com/techlog/chord-building-a-dht-distributed-hash-table-in-golang-67c3ce17417b

Vous pouvez implémenter le protocole décrit dans le papier, une mécanique de finger...
