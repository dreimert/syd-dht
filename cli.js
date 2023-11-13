#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import got from 'got'

// Analyse des arguments et des options. Permet de produire l'aide aussi
const argv = yargs(hideBin(process.argv))
  .command('get <key>', 'Récupère la valeur associé à la clé')
  .command('put <key> <value>', 'Place une association clé / valeur')
  .command('lookup <key>', 'Renvoie le nœud responsable de la clef')
  .command('join <nodeUrl>', "Demande au nœud de rejoindre le réseau du nœud cible")
  .command('add <nodeUrl>', "Déclare la présence d'un nouveau nœud")
  .command('config <key>', 'Permet de récupérer la valeur key de la configuration du nœuds')
  .command('version', 'Demande la version du CLI')
  .option('url', {
    alias: 'u',
    default: 'http://localhost',
    description: 'Url du serveur à contacter'
  })
  .option('port', {
    alias: 'p',
    default: '4000',
    description: 'port à utiliser'
  })
  .option('bot', {
    alias: 'b',
    default: false,
    description: 'désactive les messages utilisateur'
  })
  .demandCommand(1, 'Vous devez indiquer une commande')
  .help()
  .argv

// Si l'utilisateur demande la verion
if (argv._[0] === 'version') {
  console.log('1.0.0')
  process.exit(0) // met fin au programme
}

// Fonction utilitaire pour afficher les messages utilisateur en fonction de l'option --bot
function info (msg) {
  if (!argv.bot) {
    console.info(msg)
  }
}

// Construction de l'url de base du nœud à contacter
const baseUrl = `${argv.url}:${argv.port}`

// Fonction utilitaire pour gérer les réponses des requêtes
async function handleResponse (request) {
  try {
    const { body } = await request
    info(body)
  } catch (error) {
    console.error('ERROR:', error)
  }
}

// Gestion des commandes
switch (argv._[0]) {
  case 'get':
    info(`Commande get ${argv.key} =>`)

    await handleResponse(got(`${baseUrl}/db/${argv.key}`))
    break
  case 'put':
    info(`put ${argv.key} ${argv.value} =>`)

    await handleResponse(got.put({
      url: `${baseUrl}/db/${argv.key}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: argv.value })
    }))
    break
  case 'keys':
    info(`Commande keys =>`)

    await handleResponse(got(`${baseUrl}/keys`))
    break
  case 'lookup':
    info(`lookup ${argv.key} =>`)

    await handleResponse(got(`${baseUrl}/lookup/${argv.key}`))
    break
  case 'add':
    info(`add ${argv.nodeUrl} =>`)

    await handleResponse(got.post({
      url: `${baseUrl}/add`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: argv.nodeUrl })
    }))
    break
  case 'join':
    info(`join ${argv.nodeUrl} =>`)

    await handleResponse(got.post({
      url: `${baseUrl}/join`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: argv.nodeUrl })
    }))
    break
  case 'config':
    info(`config ${argv.key} =>`)

    await handleResponse(got(`${baseUrl}/config/${argv.key}`))

    break
  default:
    console.error('Commande inconnue')
}
