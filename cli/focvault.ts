/**
 * FocVault – Backup-Programm für die Kommandozeile.
 *
 *   focvault login [--server URL] [--email E-Mail]
 *   focvault status
 *   focvault ls
 *   focvault backup <Ordner> [--name Name] [--dry-run]
 *   focvault restore <Zielordner> [--prefix Name/]
 *   focvault logout
 *
 * Passphrase: wird abgefragt (unsichtbar) oder aus FOCVAULT_PASSPHRASE gelesen (Cron/Automatisierung).
 * Die Passphrase und der Master-Key werden nie gespeichert – nur der Session-Cookie (~/.focvault).
 */
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { api } from '@/features/api/client'
import { formatBytes } from '@/lib/vault'
import { randomBytes } from 'node:crypto'
import { backupFolder, listFiles, login, readConfig, restore, unlock, writeConfig } from './core'
import { startS3Server } from '../server/s3/protocol'
import { VaultS3Store } from './s3-store'

const VERSION = '1.0.0'

function args(argv: string[]) {
  const pos: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) flags[k] = v
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]
      else flags[k] = true
    } else pos.push(a)
  }
  return { pos, flags }
}

async function ask(question: string, hidden = false): Promise<string> {
  if (!stdin.isTTY) throw new Error(`${question.replace(/:\s*$/, '')} fehlt (keine interaktive Eingabe möglich).`)
  if (!hidden) {
    const rl = createInterface({ input: stdin, output: stdout })
    const answer = await rl.question(question)
    rl.close()
    return answer.trim()
  }
  // Unsichtbare Eingabe
  stdout.write(question)
  stdin.setRawMode(true)
  stdin.resume()
  let value = ''
  return new Promise((resolve, reject) => {
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          return resolve(value)
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          return reject(new Error('Abgebrochen.'))
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

const passphrase = async () => process.env.FOCVAULT_PASSPHRASE || (await ask('Passphrase: ', true))

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { pos, flags } = args(rest)

  switch (cmd) {
    case 'login': {
      const saved = await readConfig()
      const server = String(flags.server ?? saved?.server ?? process.env.FOCVAULT_SERVER ?? 'https://focvault.app')
      const email = String(flags.email ?? (await ask('E-Mail: ')))
      const { account } = await login(server, email, await passphrase())
      console.log(`✓ Angemeldet als ${account.label} (${account.plan}) bei ${server}`)
      return
    }
    case 'status': {
      const s = await unlock(await passphrase())
      console.log(`Konto:    ${s.account.label}`)
      console.log(`Paket:    ${s.account.plan}`)
      console.log(`Speicher: ${formatBytes(s.account.usedBytes)} von ${formatBytes(s.account.quotaBytes)}`)
      console.log(`Server:   ${s.config.server} · Gerät: ${s.config.device}`)
      return
    }
    case 'ls': {
      const s = await unlock(await passphrase())
      const files = await listFiles(s)
      for (const f of files) console.log(`${formatBytes(f.size).padStart(10)}  ${new Date(f.storedAt).toISOString().slice(0, 10)}  ${f.name}`)
      console.log(`${files.length} Dateien`)
      return
    }
    case 'backup': {
      if (!pos[0]) throw new Error('Ordner fehlt: focvault backup <Ordner>')
      const s = await unlock(await passphrase())
      const started = Date.now()
      const r = await backupFolder(s, pos[0], {
        name: typeof flags.name === 'string' ? flags.name : undefined,
        dryRun: !!flags['dry-run'],
        onFile: (rel, state, info) => {
          if (state === 'upload') console.log(`↑ ${rel}${info ? ` (${formatBytes(Number(info))})` : ''}`)
          if (state === 'error') console.error(`✗ ${rel}: ${info}`)
        }
      })
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      console.log(
        `✓ ${r.uploaded} hochgeladen (${formatBytes(r.bytes)}), ${r.unchanged} unverändert, ${r.failed.length} Fehler – ${r.scanned} Dateien in ${secs} s`
      )
      if (r.failed.length) process.exitCode = 2
      return
    }
    case 'restore': {
      if (!pos[0]) throw new Error('Zielordner fehlt: focvault restore <Zielordner>')
      const s = await unlock(await passphrase())
      const r = await restore(s, pos[0], {
        prefix: typeof flags.prefix === 'string' ? flags.prefix : undefined,
        onFile: (name, state, info) => (state === 'done' ? console.log(`↓ ${name}`) : console.error(`✗ ${name}: ${info}`))
      })
      console.log(`✓ ${r.restored} Dateien wiederhergestellt (${formatBytes(r.bytes)}), ${r.failed} Fehler`)
      if (r.failed) process.exitCode = 2
      return
    }
    case 's3': {
      const s = await unlock(await passphrase())
      let c = (await readConfig())!
      if (!c.s3AccessKey || !c.s3SecretKey || flags['new-keys']) {
        c = { ...c, s3AccessKey: `FV${randomBytes(9).toString('hex').toUpperCase()}`, s3SecretKey: randomBytes(24).toString('base64url') }
        await writeConfig(c)
      }
      const store = new VaultS3Store(s)
      await store.init()
      const port = Number(flags.port ?? 9000)
      const gw = await startS3Server({ resolve: async ak => (ak === c.s3AccessKey ? { secret: c.s3SecretKey!, store } : null), port, host: '127.0.0.1' })
      console.log(`✓ S3-Gateway läuft auf ${gw.url} (nur dieses Gerät) – Ende mit Strg+C

  Endpoint:    ${gw.url}
  Region:      us-east-1   (Pfad-Stil / path-style)
  Access Key:  ${c.s3AccessKey}
  Secret Key:  ${c.s3SecretKey}

  rclone:  rclone config create focvault s3 provider=Other endpoint=${gw.url} access_key_id=${c.s3AccessKey} secret_access_key=${c.s3SecretKey} force_path_style=true
  AWS CLI: AWS_ACCESS_KEY_ID=${c.s3AccessKey} AWS_SECRET_ACCESS_KEY=${c.s3SecretKey} aws --endpoint-url ${gw.url} s3 ls

Alles wird hier auf dem Gerät verschlüsselt, bevor es FocVault erreicht.`)
      const stop = async () => {
        console.log('\nSpeichere Tresor-Index …')
        await store.flush().catch(() => undefined)
        await gw.close()
        process.exit(0)
      }
      process.on('SIGINT', () => void stop())
      process.on('SIGTERM', () => void stop())
      await new Promise(() => undefined)
      return
    }
    case 'logout': {
      const c = await readConfig()
      if (c?.cookie) {
        const { configureApi } = await import('@/features/api/client')
        configureApi({ baseUrl: c.server, headers: { cookie: c.cookie } })
        await api.logout().catch(() => undefined)
      }
      await writeConfig(null)
      console.log('✓ Abgemeldet')
      return
    }
    case '--version':
    case 'version':
      console.log(VERSION)
      return
    default:
      console.log(`FocVault ${VERSION} – verschlüsseltes Backup auf Filecoin

  focvault login [--server URL] [--email E-Mail]
  focvault status
  focvault ls
  focvault backup <Ordner> [--name Name] [--dry-run]
  focvault restore <Zielordner> [--prefix Name/]
  focvault s3 [--port 9000] [--new-keys]     lokales S3-Gateway (rclone, Cyberduck, AWS CLI …)
  focvault logout

Automatisierung: FOCVAULT_PASSPHRASE setzen, z. B. im Cron:
  0 3 * * * FOCVAULT_PASSPHRASE=… focvault backup ~/Dokumente`)
  }
}

main().catch(e => {
  console.error(`Fehler: ${(e as Error).message}`)
  process.exit(1)
})
